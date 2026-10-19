// JPC Skullerud infoskjerm v4: statisk frontend + et lite API som henter,
// normaliserer og cacher alle datakilder på serversiden.
//
// Ingen npm-avhengigheter. Krever Node 22+ (global fetch) og TZ=Europe/Oslo.

import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "public");

// Kontorinnholdet (meny, avstemning, beskjed, nedtelling) redigeres fortsatt i
// originalrepoet via Claude-prosjektet. v4 leser derfra, så arbeidsflyten til
// kollegaene er uendret.
const CONTENT_REPO = process.env.CONTENT_REPO || "KrakenSaten/jpc-infoskjerm";
const CONTENT_BRANCH = process.env.CONTENT_BRANCH || "main";

const STOP_ID = "NSR:StopPlace:58227";
const COORDS = { latitude: 59.866685, longitude: 10.840032 };
const NRK_FEED = "https://www.nrk.no/nyheter/siste.rss";
const UA = "jpc-infoskjerm/4 (kontorskjerm Skullerud)";

/* ---------- Cache: siste gode verdi overlever feil ---------- */

const cache = new Map();

async function cached(key, ttlMs, loader) {
  const entry = cache.get(key);
  const now = Date.now();
  if (entry && now - entry.at < ttlMs) return { ...entry.payload, stale: entry.stale };
  if (entry?.pending) return entry.pending;

  const pending = (async () => {
    try {
      const data = await loader();
      const payload = { data, fetchedAt: new Date().toISOString() };
      cache.set(key, { at: Date.now(), payload, stale: false });
      return { ...payload, stale: false };
    } catch (error) {
      console.warn(`[${key}] henting feilet: ${error.message}`);
      if (entry?.payload) {
        // Prøv igjen om 30 sek i stedet for å vente en hel TTL.
        cache.set(key, { at: Date.now() - ttlMs + 30_000, payload: entry.payload, stale: true });
        return { ...entry.payload, stale: true };
      }
      cache.delete(key);
      throw error;
    }
  })();

  cache.set(key, { ...(entry || {}), pending });
  return pending;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
  const response = await fetch(url, {
    ...options,
    headers: { "User-Agent": UA, ...(options.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} fra ${new URL(url).host}`);
  return response;
}

/* ---------- T-bane (Entur) ---------- */

const DEPARTURES_QUERY = `
  query ($stopId: String!) {
    stopPlace(id: $stopId) {
      estimatedCalls(numberOfDepartures: 24, timeRange: 7200) {
        aimedDepartureTime
        expectedDepartureTime
        realtime
        cancellation
        destinationDisplay { frontText }
        quay { publicCode }
        situations { summary { value language } }
        serviceJourney { journeyPattern { line { publicCode transportMode } } }
      }
    }
  }`;

function directionOf(call) {
  const quay = String(call.quay?.publicCode || "").trim();
  const dest = (call.destinationDisplay?.frontText || "").toLowerCase();
  if (quay === "1" || dest.includes("mortensrud")) return "mortensrud";
  return "sentrum";
}

function situationText(call) {
  for (const situation of call.situations || []) {
    const summaries = situation.summary || [];
    const preferred = summaries.find(s => String(s.language || "").startsWith("no")) || summaries[0];
    if (preferred?.value?.trim()) return preferred.value.trim();
  }
  return "";
}

async function loadDepartures() {
  const response = await fetchWithTimeout("https://api.entur.io/journey-planner/v3/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "ET-Client-Name": "jpc-infoskjerm" },
    body: JSON.stringify({ query: DEPARTURES_QUERY, variables: { stopId: STOP_ID } }),
  });
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors[0].message);

  const calls = payload?.data?.stopPlace?.estimatedCalls || [];
  const departures = calls
    .filter(call => call.serviceJourney?.journeyPattern?.line?.transportMode === "metro")
    .map(call => {
      const expected = new Date(call.expectedDepartureTime || call.aimedDepartureTime);
      const aimed = new Date(call.aimedDepartureTime || call.expectedDepartureTime);
      return {
        line: call.serviceJourney.journeyPattern.line.publicCode || "T",
        destination: call.destinationDisplay?.frontText || "Ukjent",
        direction: directionOf(call),
        expected: expected.toISOString(),
        delayMin: Math.max(0, Math.round((expected - aimed) / 60_000)),
        realtime: Boolean(call.realtime),
        cancelled: Boolean(call.cancellation),
        situation: situationText(call),
      };
    })
    .filter(dep => !Number.isNaN(Date.parse(dep.expected)))
    .sort((a, b) => Date.parse(a.expected) - Date.parse(b.expected));

  const situations = [...new Set(departures.map(d => d.situation).filter(Boolean))];
  return { departures, situations };
}

/* ---------- Vær (Open-Meteo) ---------- */

function osloHour(unixSeconds) {
  return Number(new Date(unixSeconds * 1000).toLocaleString("en-GB", {
    timeZone: "Europe/Oslo", hour: "2-digit", hour12: false,
  })) % 24;
}

async function loadWeather() {
  const query = new URLSearchParams({
    latitude: String(COORDS.latitude),
    longitude: String(COORDS.longitude),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,is_day",
    hourly: "temperature_2m,precipitation,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,sunrise,sunset",
    timezone: "Europe/Oslo",
    timeformat: "unixtime",
    forecast_days: "3",
    wind_speed_unit: "ms",
  });
  const response = await fetchWithTimeout("https://api.open-meteo.com/v1/forecast?" + query);
  const p = await response.json();
  if (!p?.daily?.time?.length || !p?.hourly?.time?.length) throw new Error("Mangler prognose");

  const hourly = p.hourly.time.map((t, i) => ({
    t: t * 1000,
    temp: p.hourly.temperature_2m[i],
    rain: p.hourly.precipitation[i],
    code: p.hourly.weather_code[i],
    day: p.hourly.is_day[i] === 1,
  }));

  // daily.weather_code er dagens verste kode: én time med yr gir regn hele
  // dagen. Bruk den vanligste koden mellom 08 og 18 i stedet.
  const dominantCode = (dayStart, fallback) => {
    const counts = new Map();
    for (const h of hourly) {
      if (h.t < dayStart || h.t >= dayStart + 86_400_000) continue;
      const hr = osloHour(h.t / 1000);
      if (hr < 8 || hr > 18) continue;
      counts.set(h.code, (counts.get(h.code) || 0) + 1);
    }
    let best = fallback, bestCount = 0;
    for (const [code, count] of counts) if (count > bestCount) { best = code; bestCount = count; }
    return best;
  };

  const days = p.daily.time.slice(0, 2).map((t, i) => ({
    date: t * 1000,
    code: dominantCode(t * 1000, p.daily.weather_code[i]),
    max: p.daily.temperature_2m_max[i],
    min: p.daily.temperature_2m_min[i],
    rain: p.daily.precipitation_sum[i],
    wind: p.daily.wind_speed_10m_max[i],
    sunrise: p.daily.sunrise[i] * 1000,
    sunset: p.daily.sunset[i] * 1000,
  }));

  return {
    current: {
      temp: p.current.temperature_2m,
      feels: p.current.apparent_temperature,
      code: p.current.weather_code,
      wind: p.current.wind_speed_10m,
      rain: p.current.precipitation,
      day: p.current.is_day === 1,
    },
    days,
    // Klienten klipper til «24 t fra nå» selv; vi sender litt ekstra.
    hourly: hourly.filter(h => h.t >= Date.now() - 3_600_000).slice(0, 30),
  };
}

/* ---------- Nyheter (NRK RSS) ---------- */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeXml(text) {
  return String(text || "")
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, "")
    .trim();
}

function xmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

async function loadNews() {
  const response = await fetchWithTimeout(NRK_FEED);
  const xml = await response.text();
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map(([block]) => ({
      title: xmlTag(block, "title"),
      summary: xmlTag(block, "description"),
      published: Date.parse(xmlTag(block, "pubDate")) || 0,
    }))
    .filter(item => item.title)
    .sort((a, b) => b.published - a.published)
    .slice(0, 12);
  if (!items.length) throw new Error("Tom RSS-strøm");
  return { items };
}

/* ---------- Kontorinnhold fra originalrepoet ---------- */

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; continue; }
      quoted = !quoted;
      continue;
    }
    if (c === ";" && !quoted) { values.push(current.trim()); current = ""; continue; }
    current += c;
  }
  values.push(current.trim());
  return values;
}

function csvRows(text) {
  const rows = String(text || "").replace(/^﻿/, "")
    .split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  if (!rows.length) throw new Error("CSV er tom");
  const [header, ...data] = rows;
  return { headers: splitCsvLine(header).map(h => h.toLowerCase()), data: data.map(splitCsvLine) };
}

const WEEKDAY_ALIASES = [
  ["1", "man", "mandag", "monday"],
  ["2", "tir", "tirsdag", "tuesday"],
  ["3", "ons", "onsdag", "wednesday"],
  ["4", "tor", "torsdag", "thursday"],
  ["5", "fre", "fredag", "friday"],
];

function parseMenu(text) {
  const { headers, data } = csvRows(text);
  const col = name => headers.indexOf(name);
  const [iWeek, iDay, iTitle, iAller] = ["week", "day", "title", "allergens"].map(col);
  if ([iWeek, iDay, iTitle, iAller].includes(-1)) throw new Error("menu.csv mangler kolonner");

  const days = data.map((cells, idx) => {
    const dayText = String(cells[iDay] || "").toLowerCase();
    const found = WEEKDAY_ALIASES.findIndex(aliases => aliases.includes(dayText));
    return {
      day: found >= 0 ? found + 1 : Math.min(idx + 1, 5),
      title: String(cells[iTitle] || "").trim(),
      allergens: String(cells[iAller] || "").replace(/^allergier:\s*/i, "").trim(),
    };
  }).sort((a, b) => a.day - b.day);

  const week = Number(data[0]?.[iWeek]) || 0;
  if (!week) throw new Error("menu.csv mangler ukenummer");
  return { week, days };
}

function parsePoll(text) {
  const { headers, data } = csvRows(text);
  const [iType, iKey, iValue] = ["type", "key", "value"].map(n => headers.indexOf(n));
  if ([iType, iKey, iValue].includes(-1)) throw new Error("poll.csv mangler kolonner");

  let question = "";
  let voters = 7;
  let resultMode = "always";
  const options = [];
  const votes = new Map();

  for (const cells of data) {
    const type = String(cells[iType] || "").toLowerCase();
    const key = String(cells[iKey] || "").toLowerCase();
    const value = String(cells[iValue] || "").trim();
    if (type === "question") question = value;
    else if (type === "option" && key) options.push({ id: key, text: value || key.toUpperCase() });
    else if (type === "voters" && Number(value) > 0) voters = Math.round(Number(value));
    else if (type === "results" && ["always", "done", "hidden"].includes(value.toLowerCase())) resultMode = value.toLowerCase();
    else if (type === "vote" && key) votes.set(key, value.toLowerCase());
  }

  if (!question) return null;
  if (options.length < 2) throw new Error("poll.csv trenger minst to alternativer");

  const tally = new Map(options.map(o => [o.id, 0]));
  let answered = 0;
  for (const choice of votes.values()) {
    if (!tally.has(choice)) continue;
    tally.set(choice, tally.get(choice) + 1);
    answered += 1;
  }
  const complete = answered >= voters;
  const showResults = resultMode === "always" || (resultMode === "done" && complete);
  return {
    question,
    voters,
    answered,
    complete,
    showResults,
    // Uten synlige resultater sendes ikke tallene i det hele tatt.
    options: options.map(o => ({ ...o, votes: showResults ? tally.get(o.id) : null })),
  };
}

function parseCountdown(configJs) {
  const date = configJs.match(/jubileeDepartureDate\s*:\s*new Date\(\s*["']([^"']+)["']\s*\)/);
  const label = configJs.match(/jubileeLabel\s*:\s*(["'])((?:\\.|(?!\1).)*)\1/);
  const target = date ? Date.parse(date[1]) : NaN;
  if (Number.isNaN(target)) return null;
  return { target: new Date(target).toISOString(), label: label ? label[2].replace(/\\(.)/g, "$1") : "" };
}

function parseNotice(indexHtml) {
  const open = indexHtml.match(/<div\b[^>]*\bid=["']notice["'][^>]*>/i);
  if (!open || /\shidden(\s|=|>)/i.test(open[0])) return null;
  const inner = id => {
    const m = indexHtml.match(new RegExp(`<div\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)</div>`, "i"));
    return m ? decodeXml(m[1]).replace(/\s+/g, " ").trim() : "";
  };
  const message = inner("notice-msg");
  if (!message) return null;
  return { tag: inner("notice-tag"), message };
}

// Henter alle fire filer fra samme commit. Raw-URL-er med commit-sha er
// immutable, så vi slipper raw.githubusercontent.com sin 5-minutters CDN-cache
// og ser endringer så snart vi ser ny sha.
async function resolveContentRef() {
  try {
    const response = await fetchWithTimeout(
      `https://api.github.com/repos/${CONTENT_REPO}/commits/${CONTENT_BRANCH}`,
      { headers: { Accept: "application/vnd.github.sha" } }, 6_000);
    const sha = (await response.text()).trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  } catch (error) {
    console.warn(`[office] kunne ikke slå opp commit, bruker ${CONTENT_BRANCH}: ${error.message}`);
  }
  return CONTENT_BRANCH;
}

async function loadOffice() {
  const ref = await resolveContentRef();
  const raw = async file => {
    const response = await fetchWithTimeout(`https://raw.githubusercontent.com/${CONTENT_REPO}/${ref}/${file}`);
    return response.text();
  };
  const [menuText, pollText, configText, indexText] = await Promise.allSettled(
    ["menu.csv", "poll.csv", "config.js", "index.html"].map(raw));

  const attempt = (result, parser) => {
    if (result.status !== "fulfilled") return { error: result.reason.message };
    try { return { value: parser(result.value) }; } catch (error) { return { error: error.message }; }
  };

  const menu = attempt(menuText, parseMenu);
  const poll = attempt(pollText, parsePoll);
  const countdown = attempt(configText, parseCountdown);
  const notice = attempt(indexText, parseNotice);

  if (menu.error && poll.error && countdown.error && notice.error) {
    throw new Error("Ingen kontorfiler kunne leses: " + menu.error);
  }
  return {
    ref: ref.slice(0, 7),
    menu: menu.value ?? null,
    menuError: menu.error ?? null,
    poll: poll.value ?? null,
    pollError: poll.error ?? null,
    countdown: countdown.value ?? null,
    notice: notice.value ?? null,
  };
}

/* ---------- Versjon: klienten laster på nytt ved ny deploy ---------- */

async function hashPublicDir() {
  const hash = createHash("sha256");
  for (const name of (await readdir(PUBLIC_DIR)).sort()) {
    hash.update(name).update(await readFile(join(PUBLIC_DIR, name)));
  }
  return hash.digest("hex").slice(0, 12);
}
const VERSION = await hashPublicDir();

/* ---------- HTTP ---------- */

const ROUTES = {
  "/api/departures": () => cached("departures", 20_000, loadDepartures),
  "/api/weather": () => cached("weather", 10 * 60_000, loadWeather),
  "/api/news": () => cached("news", 5 * 60_000, loadNews),
  "/api/office": () => cached("office", 3 * 60_000, loadOffice),
  "/api/version": async () => ({ data: { version: VERSION } }),
  "/healthz": async () => ({ data: { ok: true, version: VERSION } }),
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(body);
}

async function serveStatic(pathname, res) {
  const rel = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^([/\\])+/, "");
  if (rel.startsWith("..")) return send(res, 400, "Ugyldig sti");
  try {
    let body = await readFile(join(PUBLIC_DIR, rel));
    const type = MIME[extname(rel)] || "application/octet-stream";
    const isHtml = type.startsWith("text/html");
    // Cloudflare cacher JS/CSS i 4 timer uansett hva vi sender. Versjonen i
    // asset-URL-ene gjør at en ny deploy alltid gir nye URL-er, mens HTML-en
    // (som Cloudflare ikke cacher) hentes ferskt.
    if (isHtml) {
      body = body.toString("utf8").replace(/(href|src)="([\w-]+\.(?:css|js|svg))"/g, `$1="$2?v=${VERSION}"`);
    }
    const cacheControl = isHtml ? "no-cache" : "public, max-age=31536000, immutable";
    send(res, 200, body, { "Content-Type": type, "Cache-Control": cacheControl });
  } catch {
    send(res, 404, "Finnes ikke", { "Content-Type": "text/plain; charset=utf-8" });
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "");

  const route = ROUTES[pathname];
  if (!route) return serveStatic(pathname, res);

  try {
    const body = JSON.stringify(await route());
    send(res, 200, body, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  } catch (error) {
    send(res, 502, JSON.stringify({ error: error.message }), {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    });
  }
}).listen(PORT, () => {
  console.log(`infoskjerm v4 (${VERSION}) lytter på :${PORT}, innhold fra ${CONTENT_REPO}@${CONTENT_BRANCH}`);
});
