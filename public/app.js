// JPC Skullerud infoskjerm v5 — klient.
// All henting går via serverens /api/*, som cacher og normaliserer kildene.

const REFRESH = {
  departures: 20_000,
  weather: 5 * 60_000,
  news: 5 * 60_000,
  office: 2 * 60_000,
  version: 5 * 60_000,
};
const NEWS_ROTATION_MS = 12_000;

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const WEEKDAYS = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli",
  "august", "september", "oktober", "november", "desember"];

const state = {
  departures: null,
  weather: null,
  news: { nrk: [], itavisen: [] },
  newsIndex: { nrk: 0, itavisen: 0 },
  office: null,
  health: {},
};

/* ---------- Skalering av lerretet ---------- */

// Lerretet fyller hele skjermens høyde uansett format. Innholdet skaleres
// etter bredden (1080 px), og høyden følger skjermen: en høyere skjerm gir
// mer plass til nyhetene, som strekker seg i den ledige høyden. Bredden
// strekkes aldri: er skjermen så bred at høyden ville blitt under 1600 px,
// skaleres det etter høyden og lerretet står midt på med mørk bakgrunn på
// sidene. Skjermer på 9:16 får nøyaktig 1080 × 1920.
const BASE_W = 1080;
const MIN_H = 1600;
let currentScale = 1;
let screenW = 1080;
let screenH = 1920;

function fitScreen() {
  const scale = Math.min(window.innerWidth / BASE_W, window.innerHeight / MIN_H);
  screenW = BASE_W;
  screenH = window.innerHeight / scale;
  const screen = $("screen");
  screen.style.width = screenW + "px";
  screen.style.height = screenH + "px";
  screen.style.transform = `translate(-50%, -50%) scale(${scale})`;
  currentScale = scale;
  window.JpcAmbient?.resize(scale, screenW, screenH);
  fitNews();
}

/* ---------- Henting med lokal reserve ---------- */

async function getJson(path, source) {
  // Nøkkelen beholdt fra v4, så den lokale reservekopien overlever oppgraderingen.
  const key = "jpc-v4-" + source;
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const body = await response.json();
    try { localStorage.setItem(key, JSON.stringify(body)); } catch {}
    state.health[source] = body.stale ? "stale" : "ok";
    return body;
  } catch (error) {
    console.warn(`${source}: ${error.message}`);
    state.health[source] = "stale";
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved) return { ...saved, stale: true };
    } catch {}
    state.health[source] = "down";
    return null;
  } finally {
    renderHealth();
  }
}

function markStale(el, body) {
  el.dataset.stale = String(Boolean(body?.stale));
}

function renderHealth() {
  const values = ["departures", "weather", "news", "office"].map(s => state.health[s]);
  const el = $("health");
  let level = "ok", label = "Sanntid";
  if (values.filter(v => v === "down").length >= 2) { level = "err"; label = "Frakoblet"; }
  else if (values.some(v => v === "down" || v === "stale")) { level = "warn"; label = "Delvis oppdatert"; }
  else if (values.some(v => v === undefined)) { level = ""; label = "Kobler til"; }
  el.dataset.level = level;
  $("health-label").textContent = label;
}

/* ---------- Klokke og dato ---------- */

function renderClock(now) {
  $("clock-hm").textContent = pad(now.getHours()) + ":" + pad(now.getMinutes());
  $("clock-s").textContent = pad(now.getSeconds());
  const day = WEEKDAYS[now.getDay()];
  $("date").textContent =
    `${day[0].toUpperCase()}${day.slice(1)} ${now.getDate()}. ${MONTHS[now.getMonth()]}, uke ${isoWeek(now)}`;
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86_400_000 + 1) / 7);
}

/* ---------- T-bane ---------- */

function minutesUntil(iso, now) {
  return Math.round((Date.parse(iso) - now) / 60_000);
}

function whenText(dep, now) {
  if (dep.cancelled) return "Innstilt";
  const mins = minutesUntil(dep.expected, now);
  if (mins <= 0) return "Nå";
  if (mins <= 20) return `${mins}<small>min</small>`;
  const t = new Date(dep.expected);
  return pad(t.getHours()) + ":" + pad(t.getMinutes());
}

function laterWhenText(dep, now) {
  if (dep.cancelled) return "Innstilt";
  const mins = minutesUntil(dep.expected, now);
  if (mins <= 0) return "Nå";
  if (mins <= 20) return mins + " min";
  const t = new Date(dep.expected);
  return pad(t.getHours()) + ":" + pad(t.getMinutes());
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function text(tag, className, value) {
  const node = el(tag, className);
  node.textContent = value;
  return node;
}

function renderDirection(column, departures, now) {
  const next = column.querySelector('[data-slot="next"]');
  const later = column.querySelector('[data-slot="later"]');
  // Avganger som gikk for mer enn et halvt minutt siden er borte fra perrongen.
  const upcoming = departures.filter(d => Date.parse(d.expected) - now > -30_000);

  next.replaceChildren();
  later.replaceChildren();
  next.classList.remove("now");

  if (!upcoming.length) {
    next.append(text("p", "dir-empty", "Ingen avganger"));
    return;
  }

  const [first, ...rest] = upcoming;
  const firstLate = first.delayMin >= 2 || first.cancelled;
  if (minutesUntil(first.expected, now) <= 0 && !first.cancelled) next.classList.add("now");

  next.append(el("div", "when" + (firstLate ? " late" : ""), whenText(first, now)));
  const dest = el("div", "dest");
  dest.append(text("span", "line", first.line), text("span", "", first.destination));
  // Kort «+3 min» på én linje, som i det utvidede vinduet. «3 min forsinket»
  // brøt over to linjer og gjorde kolonnen høyere enn den andre, så radene
  // under ikke lenger sto på linje.
  if (first.delayMin >= 2 && !first.cancelled) dest.append(text("span", "delay-note", `+${first.delayMin} min`));
  next.append(dest);

  for (const dep of rest.slice(0, 2)) {
    const li = el("li");
    const late = dep.delayMin >= 2 || dep.cancelled;
    li.append(text("span", "dest", dep.destination), text("span", "when" + (late ? " late" : ""), laterWhenText(dep, now)));
    later.append(li);
  }
}

function renderBoard(now = Date.now()) {
  const body = state.departures;
  if (!body?.data) return;
  // Bussene er med i svaret for vinduets del; tavla viser bare T-banen.
  const all = body.data.departures.filter(d => !d.mode || d.mode === "metro");
  renderDirection($("dir-sentrum"), all.filter(d => d.direction === "sentrum"), now);
  renderDirection($("dir-mortensrud"), all.filter(d => d.direction === "mortensrud"), now);
  markStale($("board"), body);

  const situations = body.data.situations || [];
  const ticker = $("ticker");
  const message = situations.join("   ◆   ");
  if (message && $("ticker-text").textContent !== message) {
    $("ticker-text").textContent = message;
    ticker.style.setProperty("--ticker-s", Math.max(18, message.length * 0.28) + "s");
  }
  ticker.hidden = !message;
}

async function loadDepartures() {
  const body = await getJson("/api/departures", "departures");
  if (body) { state.departures = body; renderBoard(); refreshPanel("board"); }
}

/* ---------- Vær ---------- */

const WX_TEXT = {
  0: "Klart", 1: "Stort sett klart", 2: "Delvis skyet", 3: "Overskyet",
  45: "Tåke", 48: "Rimtåke",
  51: "Lett yr", 53: "Yr", 55: "Kraftig yr", 56: "Underkjølt yr", 57: "Underkjølt yr",
  61: "Lett regn", 63: "Regn", 65: "Kraftig regn", 66: "Underkjølt regn", 67: "Underkjølt regn",
  71: "Lett snø", 73: "Snø", 75: "Kraftig snø", 77: "Snøkorn",
  80: "Regnbyger", 81: "Kraftige byger", 82: "Voldsomme byger",
  85: "Snøbyger", 86: "Kraftige snøbyger",
  95: "Torden", 96: "Torden med hagl", 99: "Torden med hagl",
};

function condition(code) {
  if (code <= 1) return "clear";
  if (code === 2) return "partly";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  if (code >= 51) return "rain";
  return "cloud";
}

// Linjeikoner på et 48 × 48-rutenett, tegnet med currentColor-strøk.
function wxIcon(code, isDay = true) {
  const kind = condition(code);
  const sun = '<g stroke="#ffcf4d"><circle cx="24" cy="24" r="8" fill="#ffcf4d"/>' +
    [0, 45, 90, 135, 180, 225, 270, 315].map(a => {
      const r = a * Math.PI / 180;
      return `<line x1="${24 + Math.cos(r) * 13}" y1="${24 + Math.sin(r) * 13}" x2="${24 + Math.cos(r) * 18}" y2="${24 + Math.sin(r) * 18}"/>`;
    }).join("") + "</g>";
  const moon = '<path d="M30 10a14 14 0 1 0 8 25A12 12 0 0 1 30 10z" fill="#d9e4ff" stroke="none"/>';
  const cloud = (dx = 0, dy = 0, fill = "#cfd9e8") =>
    `<path transform="translate(${dx} ${dy})" d="M14 36h20a8 8 0 0 0 0-16 11 11 0 0 0-21-2 9 9 0 0 0 1 18z" fill="${fill}" stroke="none"/>`;
  const drops = '<g stroke="#5b9bff"><line x1="18" y1="40" x2="16" y2="45"/><line x1="25" y1="40" x2="23" y2="45"/><line x1="32" y1="40" x2="30" y2="45"/></g>';
  const flakes = '<g fill="#ffffff"><circle cx="17" cy="42" r="2"/><circle cx="25" cy="44" r="2"/><circle cx="33" cy="42" r="2"/></g>';
  const bolt = '<path d="M26 34l-6 9h5l-3 6 9-11h-5l3-4z" fill="#ffcf4d" stroke="none"/>';
  const fog = '<g stroke="#9fb0c8"><line x1="8" y1="20" x2="40" y2="20"/><line x1="12" y1="27" x2="36" y2="27"/><line x1="8" y1="34" x2="40" y2="34"/></g>';
  const sky = isDay ? sun : moon;

  const parts = {
    clear: sky,
    partly: `<g transform="translate(-7 -7) scale(.85)">${sky}</g>${cloud(4, 4)}`,
    cloud: cloud(0, -2),
    fog,
    rain: cloud(0, -6) + drops,
    snow: cloud(0, -6) + flakes,
    storm: cloud(0, -8, "#9aa8bd") + bolt,
  }[kind];
  return `<svg viewBox="0 0 48 48" fill="none" stroke-width="3" stroke-linecap="round">${parts}</svg>`;
}

function renderWeather() {
  const body = state.weather;
  if (!body?.data) return;
  const { current, days, hourly } = body.data;

  $("wx-icon").innerHTML = wxIcon(current.code, current.day);
  $("wx-temp").textContent = Math.round(current.temp) + "°";
  $("wx-cond").textContent = current.text || WX_TEXT[current.code] || "Ukjent vær";
  // Nowcast-meldingen («Regn om 15 min») er det mest nyttige når den finnes.
  const soon = nowcastSummary(body.data.nowcast, current.temp);
  const bits = soon ? [soon] : [`Føles som ${Math.round(current.feels)}°`, `vind ${Math.round(current.wind)} m/s`];
  $("wx-meta").textContent = bits.join(", ");

  const rows = days.slice(0, 2).map((d, i) => {
    const label = i === 0 ? "I dag" : "I morgen";
    const rain = d.rain >= 0.1 ? `, ${d.rain.toLocaleString("no-NO", { maximumFractionDigits: 1 })} mm` : "";
    return `<dt>${label}</dt><dd>${Math.round(d.max)}° <span class="lo">/ ${Math.round(d.min)}°${rain}</span></dd>`;
  });
  $("wx-days").innerHTML = rows.join("");
  markStale($("weather"), body);

  const now = Date.now();
  const series = hourly.filter(h => h.t >= now - 3_600_000).slice(0, 25);
  renderChart($("wx-chart"), series);
  if (!AMBIENT_PREVIEW) window.JpcAmbient?.set(ambientFor(body.data));
}

/* ---------- Værbakgrunn ---------- */

// Nedbørsintensitet i mm/t gjort om til styrke 0–1 på en logaritmisk skala,
// så yr, jevnt regn og styrtregn ser tydelig forskjellige ut:
// 0,5 mm/t ≈ 0,16, 1 ≈ 0,27, 2,5 ≈ 0,5, 5 ≈ 0,7, 10 mm/t eller mer ≈ 1.
// Snø måles i vannmengde, og 1 mm/t er allerede kraftig snøvær, så den
// teller 2,5 ganger så mye.
function precipLevel(mmPerHour, snow = false) {
  const x = snow ? mmPerHour * 2.5 : mmPerHour;
  return clampNum(Math.log2(1 + x) / Math.log2(13), 0.12, 1);
}

function clampNum(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// Hvilken nedbør værsymbolet sier det er. Mengden kommer fra tallene.
function precipKind(code) {
  if (code >= 95) return "rain";
  if (code === 66 || code === 67) return "sleet";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 51) return "rain";
  return null;
}

// Reserve for eldre svar uten skydekke: omtrentlig dekke ut fra symbolet.
const SYMBOL_CLOUD = { 0: 0, 1: 25, 2: 55, 3: 95, 45: 100, 48: 100 };

// Oversetter Yrs tall for akkurat nå til lagene i ambient.js, med styrke 0–1.
// Alt bygger på MET-dataene, ikke på faste nivåer:
// - nedbør: radarens mm/t akkurat nå (Nowcast). Viser radaren ingenting
//   over Skullerud, brukes Yrs prognose for neste time.
// - skyer, tåke: Yrs skydekke og tåkedekke i prosent.
// - sol og stjerner: det som er igjen av himmelen når skyer og tåke er trukket fra.
// - torden: Yrs sannsynlighet for torden neste time.
// - vind: Yrs middelvind, vindkast og vindretning.
function ambientFor({ current, nowcast }) {
  const code = current.code;
  const layers = {};
  const cloud = (current.cloud ?? SYMBOL_CLOUD[code] ?? 90) / 100;
  const fog = (current.fog ?? (code === 45 || code === 48 ? 100 : 0)) / 100;

  const radarRate = nowcast?.radar !== false ? nowcast?.points?.[0]?.rate ?? 0 : 0;
  const rate = radarRate >= 0.1 ? radarRate : current.rain ?? 0;
  let kind = precipKind(code);
  // Nedbør i tallene uten nedbør i symbolet: temperaturen avgjør typen.
  if (!kind && rate >= 0.1) kind = current.temp <= 0.5 ? "snow" : current.temp <= 1.5 ? "sleet" : "rain";
  if (kind) {
    // Symbolet sier nedbør, men mengden er under 0,1 mm: svakeste nivå.
    const k = rate >= 0.05 ? precipLevel(rate, kind === "snow") : 0.12;
    if (kind === "sleet") {
      layers.rain = k * 0.6;
      layers.snow = k * 0.6;
    } else {
      layers[kind] = k;
    }
  }

  // Yr regner tåke med i skydekket. Skyene tynnes ut så tåken ikke dobles.
  const clouds = cloud * (1 - fog * 0.7);
  if (clouds >= 0.05) layers.clouds = clouds;
  if (fog >= 0.1) layers.fog = fog;
  const sky = (1 - cloud) * (1 - fog);
  if (sky >= 0.08) layers[current.day ? "sun" : "stars"] = sky;

  // Lynet blinker oftere jo mer sannsynlig torden er. Yrs egen sannsynlighet
  // gjelder; 60 % brukes bare når et tordensymbol mangler tallet.
  const thunder = (current.thunder ?? (code >= 95 ? 60 : 0)) / 100;
  if (thunder >= 0.2) layers.lightning = thunder;

  // Vindkast teller litt, så en byget dag med rolig middelvind også synes.
  // 8 m/s gir svak vind på skjermen, 16 m/s eller mer full styrke.
  const windy = Math.max(current.wind, (current.gust ?? 0) * 0.6);
  // Rim på ruta i bitende kulde, etter den kaldeste av temperatur og
  // føles-som: svakt fra −8 °C, tydelig rundt −14 °C og fullt fra −20 °C.
  const cold = Math.min(current.temp, current.feels ?? current.temp);
  if (cold <= -8) layers.frost = clampNum((-cold - 8) / 12, 0.15, 1);

  // Vind vises som blader og virvler bare når det er oppholdsvær. Med regn,
  // snø eller sludd er det skrå nedbøren som viser at det blåser.
  if (windy >= 8 && !layers.rain && !layers.snow) layers.wind = clampNum((windy - 6) / 10, 0.2, 1);

  // Vinden styrer vinkelen på regn og snø (se ambient.js), ikke retningen:
  // på skjermen blåser alt fra høyre mot venstre.
  return {
    layers,
    wind: Math.round(windy * 10) / 10,
    dark: Boolean(layers.rain || layers.snow || layers.lightning),
    night: !current.day,
  };
}

// Forhåndsvisning uten å vente på riktig vær: ?vaer=snø,vind
// Lag: sol, natt, skyer, tåke, regn, sludd, snø, torden, vind, frost. Styrke kan
// angis med kolon, fra 0 til 1: ?vaer=regn:1,vind:0.4 er styrtregn med
// moderat vind, ?vaer=regn:0.15 er yr.
const AMBIENT_PREVIEW = (() => {
  const wanted = new URLSearchParams(location.search).get("vaer");
  if (!wanted) return null;
  const presets = {
    sol: k => ({ sun: k }),
    natt: k => ({ stars: k }),
    skyer: k => ({ clouds: k }),
    "tåke": k => ({ fog: k }),
    regn: k => ({ rain: k, clouds: Math.max(0.6, k) }),
    sludd: k => ({ rain: k * 0.6, snow: k * 0.6, clouds: Math.max(0.6, k) }),
    "snø": k => ({ snow: k, clouds: Math.max(0.6, k) }),
    torden: k => ({ rain: k, lightning: 1, clouds: 1 }),
    vind: k => ({ wind: k }),
    frost: k => ({ frost: k }),
  };
  const defaults = { regn: 0.6, sludd: 0.6, "snø": 0.6, torden: 0.9, vind: 0.7, frost: 0.8 };
  const layers = {};
  let windStrength = 0;
  for (const part of wanted.toLowerCase().split(",")) {
    const [name, value] = part.trim().split(":");
    if (!presets[name]) continue;
    const k = value === undefined ? defaults[name] ?? 1 : clampNum(Number(value) || 0, 0, 1);
    if (name === "vind") windStrength = k;
    for (const [layer, v] of Object.entries(presets[name](k))) layers[layer] = Math.max(layers[layer] || 0, v);
  }
  // Som for ekte vær: med nedbør er det vinkelen som viser vinden.
  if (layers.rain || layers.snow) delete layers.wind;
  return {
    layers,
    // vind:1 er storm (24 m/s, nesten vannrett regn), vind:0.5 er 16 m/s.
    wind: windStrength ? 8 + windStrength * 16 : 0,
    dark: Boolean(layers.rain || layers.snow || layers.lightning),
    night: Boolean(layers.stars),
  };
})();
if (AMBIENT_PREVIEW) window.JpcAmbient?.set(AMBIENT_PREVIEW);

// Oppsummerer METs radarbaserte nedbørsvarsel for de neste 90 minuttene.
// Tom streng betyr opphold hele perioden.
function nowcastSummary(nowcast, temp, now = Date.now()) {
  const points = (nowcast?.points || []).filter(p => p.t >= now - 5 * 60_000);
  if (!points.length) return "";
  const wet = p => p.rate >= 0.1;
  const kind = temp <= 0.5 ? "Snø" : "Regn";
  const mins = p => Math.max(1, Math.round((p.t - now) / 60_000));
  if (wet(points[0])) {
    const dry = points.find(p => !wet(p));
    return dry ? `${kind} nå, opphold om ${mins(dry)} min` : `${kind} den neste halvannen timen`;
  }
  const next = points.find(wet);
  return next ? `${kind} om ${mins(next)} min` : "";
}

function smoothPath(points) {
  if (points.length < 2) return "";
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

// every: hvor mange timer mellom etikettene. dayLabels: delelinje og ukedag
// ved midnatt, for grafer som går over mer enn ett døgn.
function renderChart(svg, series, { every = 3, dayLabels = false, gradId = "tfill" } = {}) {
  if (series.length < 2) { svg.innerHTML = ""; return; }

  const W = 952, top = 44, bottom = 118, labelY = 146;
  const step = W / (series.length - 1);
  const temps = series.map(h => h.temp);
  let lo = Math.floor(Math.min(...temps)) - 1;
  let hi = Math.ceil(Math.max(...temps)) + 1;
  if (hi - lo < 6) { const mid = (hi + lo) / 2; lo = Math.floor(mid - 3); hi = Math.ceil(mid + 3); }
  const y = t => bottom - ((t - lo) / (hi - lo)) * (bottom - top);
  const x = i => i * step;
  const maxRain = Math.max(2, ...series.map(h => h.rain));

  let out = "";
  // Natt som mørke bånd.
  series.forEach((h, i) => {
    if (!h.day) out += `<rect x="${(x(i) - step / 2).toFixed(1)}" y="${top - 30}" width="${step.toFixed(1)}" height="${bottom - top + 30}" fill="#ffffff" fill-opacity=".035"/>`;
  });
  // Nedbør som søyler fra bunnlinjen.
  series.forEach((h, i) => {
    if (h.rain < 0.05) return;
    const hgt = Math.max(3, (h.rain / maxRain) * 56);
    out += `<rect x="${(x(i) - step * 0.32).toFixed(1)}" y="${(bottom - hgt).toFixed(1)}" width="${(step * 0.64).toFixed(1)}" height="${hgt.toFixed(1)}" rx="3" fill="var(--rain)" fill-opacity=".75"/>`;
  });
  out += `<line x1="0" x2="${W}" y1="${bottom}" y2="${bottom}" stroke="var(--rule)" stroke-width="2"/>`;
  if (lo < 0 && hi > 0) {
    out += `<line x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--sky)" stroke-opacity=".35" stroke-dasharray="4 6" stroke-width="2"/>`;
  }

  const pts = series.map((h, i) => [x(i), y(h.temp)]);
  const line = smoothPath(pts);
  if (dayLabels) {
    series.forEach((h, i) => {
      const t = new Date(h.t);
      if (i === 0 || t.getHours() !== 0) return;
      const name = WEEKDAYS[t.getDay()];
      out += `<line x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${top - 30}" y2="${bottom}" stroke="var(--faint)" stroke-opacity=".6" stroke-dasharray="3 6" stroke-width="2"/>`;
      out += `<text x="${(x(i) + 10).toFixed(1)}" y="${bottom - 10}" font-size="19" font-weight="700" fill="var(--muted)">${name[0].toUpperCase() + name.slice(1)}</text>`;
    });
  }

  out += `<defs><linearGradient id="${gradId}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#8fd0ff" stop-opacity=".28"/><stop offset="1" stop-color="#8fd0ff" stop-opacity="0"/></linearGradient></defs>`;
  out += `<path d="${line} L${W},${bottom} L0,${bottom} Z" fill="url(#${gradId})"/>`;
  out += `<path d="${line}" fill="none" stroke="var(--sky)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;

  // Temperatur og ikon hver tredje time, klokkeslett under.
  series.forEach((h, i) => {
    if (i % every !== 0) return;
    const t = new Date(h.t);
    const cx = Math.min(Math.max(x(i), 22), W - 22);
    out += `<text x="${cx}" y="${labelY}" text-anchor="middle" font-size="20" font-weight="600" fill="var(--faint)">${i === 0 ? "Nå" : pad(t.getHours())}</text>`;
    out += `<circle cx="${x(i)}" cy="${y(h.temp)}" r="5" fill="var(--night)" stroke="var(--sky)" stroke-width="3"/>`;
    out += `<text x="${cx}" y="${(y(h.temp) - 16).toFixed(1)}" text-anchor="middle" font-size="22" font-weight="700" fill="var(--text)">${Math.round(h.temp)}°</text>`;
    out += `<g transform="translate(${cx - 16} ${-4}) scale(.66)">${wxIcon(h.code, h.day).replace("<svg ", "<svg width=\"48\" height=\"48\" ")}</g>`;
  });

  svg.innerHTML = out;
}

async function loadWeather() {
  const body = await getJson("/api/weather", "weather");
  if (body) { state.weather = body; renderWeather(); refreshPanel("weather"); }
}

/* ---------- Lunsj ---------- */

function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Norske helligdager (de røde dagene i almanakken, som på rodedager.no):
// faste datoer pluss dager regnet fra første påskedag. Samme dato kan ha to
// navn, f.eks. 17. mai 2027, som også er 2. pinsedag.
function holidays(year) {
  const easter = easterSunday(year);
  const fromEaster = days => {
    const d = new Date(easter);
    d.setDate(d.getDate() + days);
    return d;
  };
  const list = [
    [new Date(year, 0, 1), "Nyttårsdag"],
    [fromEaster(-3), "Skjærtorsdag"],
    [fromEaster(-2), "Langfredag"],
    [fromEaster(0), "1. påskedag"],
    [fromEaster(1), "2. påskedag"],
    [new Date(year, 4, 1), "Arbeidernes dag"],
    [new Date(year, 4, 17), "Grunnlovsdagen"],
    [fromEaster(39), "Kristi himmelfartsdag"],
    [fromEaster(49), "1. pinsedag"],
    [fromEaster(50), "2. pinsedag"],
    [new Date(year, 11, 25), "1. juledag"],
    [new Date(year, 11, 26), "2. juledag"],
  ].sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [date, name] of list) {
    const same = merged.find(h => h.date.toDateString() === date.toDateString());
    if (same) same.name += " og " + name.toLowerCase();
    else merged.push({ date, name });
  }
  return merged;
}

function isHoliday(date) {
  return holidays(date.getFullYear()).some(h => h.date.toDateString() === date.toDateString());
}

// Dager JPC gir fri selv om de ikke er røde dager. De teller med i
// langhelger og inneklemte dager, men ikke i kantinens «stengt, helligdag».
const JPC_DAYS_OFF = [[11, 24, "Julaften"], [11, 31, "Nyttårsaften"]];

// Alle fridager i året: røde dager (red) og JPCs egne, sortert på dato.
function daysOffInYear(year) {
  return [
    ...holidays(year).map(h => ({ ...h, red: true })),
    ...JPC_DAYS_OFF.map(([month, day, name]) => ({ date: new Date(year, month, day), name, red: false })),
  ].sort((a, b) => a.date - b.date);
}

const isJpcDayOff = date => JPC_DAYS_OFF.some(([month, day]) => date.getMonth() === month && date.getDate() === day);

// Sammenhengende fridager rundt en helligdag: helligdager og helgedager på
// rad. Inneklemte dager (som fredagen etter Kristi himmelfart) er vanlige
// arbeidsdager og bryter rekka, som på rodedager.no.
const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };
const isDayOff = d => d.getDay() === 0 || d.getDay() === 6 || isHoliday(d) || isJpcDayOff(d);
// Avrunding tar høyde for sommertid, der et døgn kan være 23 eller 25 timer.
const daysBetween = (start, end) => Math.round((end - start) / 86_400_000) + 1;

function daysOffAround(date) {
  let start = new Date(date), end = new Date(date);
  while (isDayOff(addDays(start, -1))) start = addDays(start, -1);
  while (isDayOff(addDays(end, 1))) end = addDays(end, 1);
  return { start, end, days: daysBetween(start, end) };
}

// En inneklemt dag er én arbeidsdag med fridager på begge sider, f.eks.
// fredagen etter Kristi himmelfart. Tar man den fri, smelter fridagene sammen.
// Det kan være én på hver side, f.eks. jula 2030 med julaften på en tirsdag:
// mandag 23. og fredag 27. desember. Hver inneklemt dag returneres med hvor
// langt fridagene strekker seg om man tar den fri.
function bridgeDays(stretch) {
  const bridges = [];
  for (const dir of [-1, 1]) {
    const day = addDays(dir > 0 ? stretch.end : stretch.start, dir);
    if (isDayOff(day) || !isDayOff(addDays(day, dir))) continue;
    const other = daysOffAround(addDays(day, dir));
    bridges.push({ day, start: dir < 0 ? other.start : null, end: dir > 0 ? other.end : null });
  }
  return bridges;
}

// Første fridag etter i dag, rød dag eller JPCs egen. På selve dagen telles
// det mot den neste.
function nextDayOff(now) {
  const year = new Date(now).getFullYear();
  return [...daysOffInYear(year), ...daysOffInYear(year + 1)].find(h => h.date.getTime() > now);
}

function splitDish(title) {
  const match = title.match(/\s[–—-]\s/);
  if (match && match.index > 0) {
    return { main: title.slice(0, match.index).trim(), sub: title.slice(match.index + match[0].length).trim() };
  }
  // Intranettet skriver «Rett med tilbehør» uten tankestrek.
  const med = title.search(/\s(med|m\/)\s/i);
  if (med > 0) {
    const sub = title.slice(med + 1).trim();
    return { main: title.slice(0, med).trim(), sub: sub[0].toUpperCase() + sub.slice(1) };
  }
  return { main: title, sub: "" };
}

function lunchStatus(now) {
  const h = now.getHours() + now.getMinutes() / 60;
  if (now.getDay() === 0 || now.getDay() === 6) return { text: "Stengt i helgen" };
  if (isHoliday(now)) return { text: "Stengt, helligdag" };
  if (h < 11) return { text: "Servering fra 11:00" };
  if (h < 13) return { text: "Serveres nå", live: true };
  return { text: "Ferdig for i dag" };
}

function nextWorkday(now) {
  const d = new Date(now);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6 || isHoliday(d));
  return d;
}

function renderLunch(now = new Date()) {
  const office = state.office?.data;
  const card = $("lunch");
  if (!office) return;
  const menu = office.menu;
  card.classList.remove("error");

  const status = lunchStatus(now);
  $("lunch-status").textContent = status.text;
  $("lunch-status").classList.toggle("live", Boolean(status.live));

  if (!menu || menu.week !== isoWeek(now)) {
    card.classList.add("error");
    $("lunch-heading").textContent = "Lunsj";
    $("lunch-dish").textContent = `Menyen for uke ${isoWeek(now)} er ikke lagt inn ennå`;
    $("lunch-sub").textContent = "";
    $("lunch-aller").textContent = "";
    $("lunch-next-label").textContent = "";
    $("lunch-next").textContent = "";
    return;
  }

  const servingToday = now.getDay() >= 1 && now.getDay() <= 5 && !isHoliday(now);
  const today = servingToday ? menu.days.find(d => d.day === now.getDay()) : null;
  // Etter servering flyttes fokus til neste arbeidsdag.
  const afterLunch = now.getHours() >= 14;
  const next = nextWorkday(now);
  const nextEntry = isoWeek(next) === menu.week ? menu.days.find(d => d.day === next.getDay()) : null;
  const nextName = WEEKDAYS[next.getDay()];
  const nextLabel = next.toDateString() === new Date(now.getTime() + 86_400_000).toDateString() ? "I morgen" : nextName[0].toUpperCase() + nextName.slice(1);

  let hero = today, heading = "Lunsj i dag", footLabel = nextLabel + ":", footDish = nextEntry?.title || "ny meny kommer";
  if ((!today || afterLunch) && nextEntry) {
    hero = nextEntry;
    heading = nextLabel === "I morgen" ? "Lunsj i morgen" : `Lunsj ${nextName}`;
    footLabel = today ? "I dag var det" : "";
    footDish = today ? splitDish(today.title).main : "";
  }

  $("lunch-heading").textContent = heading;
  if (hero) {
    const { main, sub } = splitDish(hero.title);
    $("lunch-dish").textContent = main;
    $("lunch-sub").textContent = sub;
    $("lunch-aller").textContent = hero.allergens ? "Allergener: " + hero.allergens : "";
  } else {
    $("lunch-dish").textContent = "Ingen servering i dag";
    $("lunch-sub").textContent = "";
    $("lunch-aller").textContent = "";
  }
  $("lunch-next-label").textContent = footLabel;
  $("lunch-next").textContent = footDish;
}

/* ---------- Avstemning, beskjed, nedtelling ---------- */

function renderPoll() {
  const poll = state.office?.data?.poll;
  const card = $("poll");
  card.hidden = !poll;
  $("midrow").classList.toggle("with-poll", Boolean(poll));
  if (!poll) return;

  $("poll-question").textContent = poll.question;
  $("poll-status").textContent = poll.complete ? "Alle har svart" : `${poll.answered} av ${poll.voters} har svart`;
  const most = Math.max(0, ...poll.options.map(o => o.votes ?? 0));
  const list = $("poll-options");
  list.replaceChildren();
  for (const option of poll.options) {
    const li = el("li");
    li.append(text("span", "key", option.id.toUpperCase()), text("span", "txt", option.text));
    if (poll.showResults) {
      li.append(text("span", "cnt", String(option.votes)));
      li.style.setProperty("--fill", most ? (option.votes / most) * 100 + "%" : "0%");
      if (most && option.votes === most) li.classList.add("lead");
    }
    list.append(li);
  }
}

function renderNotice() {
  const notice = state.office?.data?.notice;
  $("notice").hidden = !notice;
  if (!notice) return;
  $("notice-tag").textContent = notice.tag || "";
  $("notice-msg").textContent = notice.message;
}

// JPCs egen nedtelling (config.js i innholdsrepoet) går foran. Er den ikke
// satt eller allerede passert, telles det ned til neste røde dag.
function countdownTarget(now) {
  const cd = state.office?.data?.countdown;
  const target = cd ? Date.parse(cd.target) : NaN;
  if (target > now) return { target, label: cd.label || "Nedtelling" };
  const holiday = nextDayOff(now);
  if (!holiday) return null;
  const d = holiday.date;
  const day = WEEKDAYS[d.getDay()];
  // Fri flere dager på rad fremheves; to dager er bare en vanlig helg.
  // En inneklemt dag pekes også ut, med hvor mange dager fri den gir.
  const stretch = daysOffAround(d);
  // Ordlyden følger rodedager.no: 3–4 dager er en langhelg.
  const notes = [];
  const span = `(${WEEKDAYS[stretch.start.getDay()]}–${WEEKDAYS[stretch.end.getDay()]})`;
  // «Langhelg» bare når en helg er med; tirsdag–torsdag er ingen helg.
  const hasWeekend = [...Array(stretch.days).keys()].some(i => [0, 6].includes(addDays(stretch.start, i).getDay()));
  if (stretch.days >= 5 || (stretch.days >= 3 && !hasWeekend)) notes.push(`${stretch.days} dager fri på rad ${span}`);
  else if (stretch.days >= 3) notes.push(`Langhelg: ${stretch.days} dager fri ${span}`);
  // Inneklemte dager som allerede er passert, er ikke verdt å nevne.
  const bridges = bridgeDays(stretch).filter(b => addDays(b.day, 1).getTime() > now);
  if (bridges.length) {
    const start = bridges.find(b => b.start)?.start ?? stretch.start;
    const end = bridges.find(b => b.end)?.end ?? stretch.end;
    const total = daysBetween(start, end);
    const days = bridges.map(b => b.day);
    const sameMonth = days.every(b => b.getMonth() === days[0].getMonth());
    const names = days.map((b, i) => `${WEEKDAYS[b.getDay()]} ${b.getDate()}.` +
      (!sameMonth || i === days.length - 1 ? ` ${MONTHS[b.getMonth()]}` : "")).join(" og ");
    notes.push(days.length === 1
      ? `Inneklemt ${names}: ${total} dager fri med én feriedag`
      : `Inneklemte ${names}: ${total} dager fri med to feriedager`);
  }
  // Datoen står i den lille linja over, så navnet får plass på én linje.
  // JPCs egne fridager er ikke røde dager, og kalles derfor «fridag».
  const kind = holiday.red ? "Neste røde dag" : "Neste fridag";
  return { target: d.getTime(), kicker: `${kind} · ${day} ${d.getDate()}. ${MONTHS[d.getMonth()]}`, label: holiday.name, notes };
}

function renderCountdown(now = Date.now()) {
  const box = $("countdown");
  const cd = countdownTarget(now);
  const left = cd ? cd.target - now : -1;
  // Utløpt nedtelling skjules i stedet for å stå på 00 00 00 00.
  box.hidden = !(left > 0);
  if (box.hidden) return;

  const label = $("cd-label");
  label.textContent = cd.label;
  if (cd.kicker) label.prepend(text("span", "cd-kicker", cd.kicker));
  for (const note of cd.notes || []) label.append(text("span", "cd-note", note));
  const s = Math.floor(left / 1000);
  const units = [
    [Math.floor(s / 86400), "dager"],
    [Math.floor(s / 3600) % 24, "timer"],
    [Math.floor(s / 60) % 60, "min"],
    [s % 60, "sek"],
  ];
  const digits = $("cd-digits");
  if (digits.children.length !== 4) {
    digits.innerHTML = units.map(() => '<div class="cd-unit"><b></b><span></span></div>').join("");
  }
  units.forEach(([value, label], i) => {
    const unit = digits.children[i];
    unit.querySelector("b").textContent = pad(value);
    unit.querySelector("span").textContent = label;
  });
}

async function loadOffice() {
  const body = await getJson("/api/office", "office");
  if (!body) return;
  state.office = body;
  markStale($("lunch"), body);
  renderLunch();
  renderPoll();
  renderNotice();
  renderCountdown();
  fitNews();
  refreshPanel("lunch");
}

/* ---------- Nyheter ---------- */

function newsTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  // Strømmene kan ha eldre saker; da er klokkeslett alene misvisende.
  if (d.toDateString() !== new Date().toDateString()) return `${d.getDate()}.${d.getMonth() + 1}.`;
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

// Når beskjed, avstemning og nedtelling er synlige samtidig blir det lite
// plass igjen; da vises bare overskriften, uten ingress og kø.
function fitNews() {
  const news = $("news");
  news.classList.remove("compact");
  document.querySelectorAll(".news-stage").forEach(stage => {
    stage.style.flexBasis = "";
    stage.style.removeProperty("--clamp");
  });
  if (news.getBoundingClientRect().height / currentScale < 300) news.classList.add("compact");
  document.querySelectorAll(".news-queue").forEach(trimQueue);
  document.querySelectorAll(".news-col").forEach(growStage);
  document.querySelectorAll(".news-stage .headline").forEach(fitHeadline);
}

// På svært høye skjermer kan alle sakene få plass i lista med plass til
// overs. Da får hovedsaken den ledige høyden og viser flere linjer ingress,
// i stedet for at kortet ender i et tomt felt.
const STAGE_H = 236;
const SUMMARY_LINE_H = 32;
function growStage(col) {
  if ($("news").classList.contains("compact")) return;
  const queue = col.querySelector(".news-queue");
  const items = state.news[col.dataset.feed] || [];
  // Er lista kuttet, er det ingen ledig plass å gi bort.
  if (!items.length || queue.children.length < items.length - 1) return;
  const used = queue.lastElementChild?.getBoundingClientRect().bottom ?? queue.getBoundingClientRect().top;
  const spare = (queue.getBoundingClientRect().bottom - used) / currentScale;
  if (spare < SUMMARY_LINE_H) return;
  const stage = col.querySelector(".news-stage");
  stage.style.flexBasis = STAGE_H + spare + "px";
  stage.style.setProperty("--clamp", 2 + Math.floor(spare / SUMMARY_LINE_H));
}

const FEEDS = ["nrk", "itavisen"];

// Køen fyller plassen under overskriften; saker som ikke får plass helt
// fjernes i stedet for å bli kuttet midt i linja.
// Overskriften skal alltid vises i sin helhet, aldri kuttes med «…». Blir
// saken for høy, droppes ingressen først; får tittelen fortsatt ikke plass,
// krymper den gradvis ned til 22 px.
function fitHeadline(card) {
  const stage = card.parentElement;
  const title = card.querySelector("h3");
  const summary = card.querySelector("p");
  if (!stage || !title) return;
  title.style.fontSize = "";
  if (summary) summary.hidden = false;
  const tooTall = () => card.scrollHeight > stage.clientHeight + 1;
  if (summary && tooTall()) summary.hidden = true;
  let size = parseFloat(getComputedStyle(title).fontSize);
  while (tooTall() && size > 22) {
    size -= 1;
    title.style.fontSize = size + "px";
  }
}

function trimQueue(queue) {
  const bottom = queue.getBoundingClientRect().bottom;
  [...queue.children].forEach(li => { if (li.getBoundingClientRect().bottom > bottom + 1) li.remove(); });
}

function showHeadline(feed, durationMs = NEWS_ROTATION_MS) {
  const col = document.querySelector(`.news-col[data-feed="${feed}"]`);
  const items = state.news[feed] || [];
  const stage = col.querySelector(".news-stage");
  if (!items.length) {
    stage.replaceChildren(text("p", "", "Ingen saker tilgjengelig akkurat nå"));
    col.querySelector(".news-queue").replaceChildren();
    col.querySelector(".news-qr").hidden = true;
    return;
  }
  const i = state.newsIndex[feed] % items.length;
  const item = items[i];

  const card = el("article", "headline");
  card.append(text("span", "time", newsTime(item.published)), text("h3", "", item.title));
  // Ingressen etterfølges av resten av saken (ITavisen sender hele teksten).
  // Normalt vises bare to linjer; på høye skjermer får den flere (growStage).
  const body = [item.summary, ...(item.paragraphs || []).filter(p => !p.heading && p.text !== item.summary).map(p => p.text)]
    .filter(Boolean).join(" ");
  if (body) card.append(text("p", "", body));
  // Alle tidligere saker fases ut, ikke bare den synlige. requestAnimationFrame
  // stopper i bakgrunnsfaner, så tidligere ble saker liggende uten «on» og
  // hopet seg opp oppå hverandre.
  stage.querySelectorAll(":scope > .headline.leaving").forEach(n => n.remove());
  stage.querySelectorAll(":scope > :not(.headline)").forEach(n => n.remove());
  const previous = [...stage.querySelectorAll(":scope > .headline")];
  stage.append(card);
  void card.offsetWidth; // tving layout så overgangen starter fra skjult tilstand
  card.classList.add("on");
  for (const old of previous) {
    old.classList.remove("on");
    old.classList.add("leaving");
    setTimeout(() => old.remove(), 700);
  }

  // Liten QR-kode til saken som vises, så den kan skannes rett fra tavla.
  const qr = col.querySelector(".news-qr");
  qr.innerHTML = qrSvg(item.link, "L");
  qr.hidden = !qr.innerHTML;

  // Alle de andre sakene legges i lista; trimQueue (via fitNews) fjerner
  // dem som ikke får plass, så høye skjermer får vist flere.
  const queue = col.querySelector(".news-queue");
  queue.replaceChildren();
  for (let k = 1; k < items.length; k++) {
    const index = (i + k) % items.length;
    const li = el("li");
    li.dataset.index = index;
    li.append(text("span", "time", newsTime(items[index].published)), text("span", "t", items[index].title));
    queue.append(li);
  }

  const bar = col.querySelector(".news-progress i");
  bar.classList.remove("run");
  void bar.offsetWidth;
  bar.style.setProperty("--news-s", durationMs / 1000 + "s");
  bar.classList.add("run");
  fitNews();
}

function rotateNews(feed) {
  state.newsIndex[feed]++;
  showHeadline(feed);
}

// Hver kolonne bytter sak på sin egen klokke. Den startes på nytt når noen
// velger en sak i lista, så den valgte saken får stå en hel periode.
const rotationTimers = {};
function restartRotation(feed, delay = NEWS_ROTATION_MS) {
  clearTimeout(rotationTimers[feed]);
  clearInterval(rotationTimers[feed]);
  rotationTimers[feed] = setTimeout(() => {
    rotateNews(feed);
    rotationTimers[feed] = setInterval(() => rotateNews(feed), NEWS_ROTATION_MS);
  }, delay);
}

// Trykk på en sak i lista gjør den til hovedsaken i kortet, i stedet for å
// åpne det store vinduet (det gjør et trykk på selve saken fortsatt).
for (const feed of FEEDS) {
  document.querySelector(`.news-col[data-feed="${feed}"] .news-queue`).addEventListener("click", event => {
    const li = event.target.closest("li[data-index]");
    if (!li) return;
    event.stopPropagation();
    state.newsIndex[feed] = Number(li.dataset.index);
    showHeadline(feed);
    restartRotation(feed);
  });
}

async function loadNews() {
  const body = await getJson("/api/news", "news");
  if (!body?.data) return;
  markStale($("news"), body);
  for (const feed of FEEDS) {
    const first = !state.news[feed]?.length;
    state.news[feed] = body.data[feed]?.items || state.news[feed] || [];
    // ITavisen bytter første gang etter halvannen periode, se forskyvningen nederst.
    if (first) showHeadline(feed, feed === "itavisen" ? NEWS_ROTATION_MS * 1.5 : NEWS_ROTATION_MS);
  }
}

/* ---------- Utvidede vinduer ---------- */

// Skjermen er en berøringsskjerm i gangen. Et trykk på et panel løfter det ut
// som et vindu over resten av skjermen. Folk går fra skjermen midt i, så et
// vindu som står urørt lukker seg selv; ringen rundt krysset viser hvor lenge
// det er igjen, og hver berøring starter den på nytt.
const PANEL_IDLE_MS = 3 * 60_000;
const PANEL_MARGIN = 40;
// Vinduet er like bredt som innholdet i .xp-inner (1000 px) og så høyt
// som skjermen tillater; begge regnes ut når det åpnes, etter skjermens format.
const PANEL_W = 1000;
const panelMaxH = () => screenH - 2 * PANEL_MARGIN;
const PANEL_EASE = "cubic-bezier(.2, .8, .2, 1)";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const PANELS = {
  board: {
    source: () => $("board"),
    title: "Avganger fra Skullerud",
    skin: "led",
    render: renderBoardPanel,
  },
  weather: {
    source: () => $("weather"),
    title: "Været på Skullerud",
    full: true,
    render: renderWeatherPanel,
  },
  lunch: {
    source: () => $("lunch"),
    title: "Ukemeny",
    render: renderLunchPanel,
  },
  nrk: {
    source: () => document.querySelector('.news-col[data-feed="nrk"]'),
    title: "NRK",
    full: true,
    render: body => renderNewsPanel(body, "nrk"),
  },
  itavisen: {
    source: () => document.querySelector('.news-col[data-feed="itavisen"]'),
    title: "ITavisen",
    full: true,
    render: body => renderNewsPanel(body, "itavisen"),
  },
};

const PANEL_HTML = `
  <div class="xp-backdrop"></div>
  <div class="xp-box">
    <div class="xp-inner">
      <header class="xp-head">
        <div><h2 id="xp-title"></h2><p class="xp-sub" id="xp-sub"></p></div>
        <button class="xp-close" type="button" aria-label="Lukk">
          <svg viewBox="0 0 80 80" aria-hidden="true">
            <circle class="xp-ring-bg" cx="40" cy="40" r="36"/>
            <circle class="xp-ring" cx="40" cy="40" r="36"/>
            <path d="M29 29L51 51M51 29L29 51"/>
          </svg>
        </button>
      </header>
      <div class="xp-body"></div>
    </div>
  </div>`;

let panel = null;

// Posisjon i lerretets egne piksler, uavhengig av skaleringen.
function rectIn(node) {
  const s = $("screen").getBoundingClientRect();
  const r = node.getBoundingClientRect();
  return {
    left: (r.left - s.left) / currentScale,
    top: (r.top - s.top) / currentScale,
    width: r.width / currentScale,
    height: r.height / currentScale,
  };
}

const px = rect => Object.fromEntries(Object.entries(rect).map(([k, v]) => [k, v + "px"]));

function openPanel(key) {
  if (panel) return;
  const def = PANELS[key];
  const source = def.source();
  if (!source || source.hidden) return;

  const root = el("div", "xp", PANEL_HTML);
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "xp-title");
  root.style.setProperty("--idle", PANEL_IDLE_MS / 1000 + "s");
  const box = root.querySelector(".xp-box");
  const inner = root.querySelector(".xp-inner");
  const body = root.querySelector(".xp-body");
  if (def.skin) box.classList.add("xp-" + def.skin);
  root.querySelector("#xp-title").textContent = def.title;
  $("screen").append(root);

  panel = { key, def, root, box, inner, body, source, state: {} };
  def.render(body);

  // Mål innholdets naturlige høyde i full bredde før animasjonen starter.
  const left = Math.round((screenW - PANEL_W) / 2);
  Object.assign(box.style, { left: left + "px", top: "0px", width: PANEL_W + "px", height: "auto", visibility: "hidden" });
  const height = def.full ? panelMaxH() : Math.min(Math.ceil(inner.scrollHeight), panelMaxH());
  inner.style.height = height + "px";
  const to = { left, top: Math.round((screenH - height) / 2), width: PANEL_W, height };
  const from = rectIn(source);
  Object.assign(box.style, px(to), { visibility: "" });
  panel.to = to;
  updateScrollHint();

  source.classList.add("xp-source");
  const radius = getComputedStyle(source).borderRadius || "0px";
  const duration = reduceMotion ? 0 : 480;
  box.animate([{ ...px(from), borderRadius: radius }, { ...px(to), borderRadius: "32px" }], { duration, easing: PANEL_EASE });
  inner.animate([{ opacity: 0 }, { opacity: 0, offset: .3 }, { opacity: 1 }], { duration, easing: "ease-out" });
  root.querySelector(".xp-backdrop").animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration * .8 });

  root.querySelector(".xp-backdrop").addEventListener("click", closePanel);
  root.querySelector(".xp-close").addEventListener("click", closePanel);
  for (const type of ["pointerdown", "wheel", "keydown"]) root.addEventListener(type, armIdle, { passive: true });
  body.addEventListener("scroll", () => { armIdle(); updateScrollHint(); }, { passive: true });
  root.querySelector(".xp-close").focus({ preventScroll: true });
  armIdle();
}

function closePanel() {
  if (!panel || panel.closing) return;
  const p = panel;
  p.closing = true;
  clearTimeout(p.timer);
  const radius = getComputedStyle(p.source).borderRadius || "0px";
  const duration = reduceMotion ? 0 : 380;
  const shrink = p.box.animate(
    [{ ...px(p.to), borderRadius: "32px" }, { ...px(rectIn(p.source)), borderRadius: radius }],
    { duration, easing: PANEL_EASE, fill: "forwards" });
  p.inner.animate([{ opacity: 1 }, { opacity: 0, offset: .35 }, { opacity: 0 }], { duration, fill: "forwards" });
  p.root.querySelector(".xp-backdrop").animate([{ opacity: 1 }, { opacity: 0 }], { duration, fill: "forwards" });
  shrink.onfinish = () => {
    p.root.remove();
    p.source.classList.remove("xp-source");
    if (panel === p) panel = null;
  };
}

function armIdle() {
  if (!panel || panel.closing) return;
  clearTimeout(panel.timer);
  panel.timer = setTimeout(closePanel, PANEL_IDLE_MS);
  const ring = panel.root.querySelector(".xp-ring");
  ring.classList.remove("run");
  void ring.getBoundingClientRect();
  ring.classList.add("run");
}

// Toning nederst viser at det er mer å bla til, og forsvinner på bunnen.
function updateScrollHint() {
  if (!panel) return;
  const b = panel.body;
  panel.box.classList.toggle("more-below", b.scrollHeight - b.scrollTop - b.clientHeight > 4);
}

function refreshPanel(key) {
  if (panel?.key !== key || panel.closing) return;
  const top = panel.body.scrollTop;
  panel.def.render(panel.body);
  panel.body.scrollTop = top;
  updateScrollHint();
}

function setPanelSub(value) {
  if (panel) panel.root.querySelector("#xp-sub").textContent = value;
}

function clockText(ms) {
  const d = new Date(ms);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

/* ----- Avganger: T-bane i to retninger, buss under ----- */

function depRow(dep, now, withQuay) {
  const li = el("li");
  const late = dep.delayMin >= 2 || dep.cancelled;
  if (late) li.classList.add("is-late");
  if (!dep.cancelled && minutesUntil(dep.expected, now) <= 0) li.classList.add("is-now");
  li.append(text("span", "badge " + (dep.mode === "bus" ? "bus" : "metro"), dep.line));
  li.append(text("span", "dest", dep.destination));
  if (withQuay) li.append(text("span", "quay", dep.quay ? "Plattform " + dep.quay : ""));
  const when = el("span", "when");
  when.append(document.createTextNode(laterWhenText(dep, now)));
  if (late && !dep.cancelled) when.append(text("small", "", `+${dep.delayMin}`));
  li.append(when);
  return li;
}

function renderBoardPanel(body, now = Date.now()) {
  const data = state.departures?.data;
  if (!data) { body.replaceChildren(text("p", "xp-empty", "Henter avganger")); return; }
  setPanelSub("T-bane og buss, sanntid fra Entur");

  const upcoming = data.departures.filter(d => Date.parse(d.expected) - now > -30_000);
  const metro = upcoming.filter(d => !d.mode || d.mode === "metro");
  const bus = upcoming.filter(d => d.mode === "bus");

  const wrap = el("div", "xp-dep");
  wrap.append(el("h3", "xp-h", '<span class="badge metro">T</span>T-bane'));
  const cols = el("div", "xp-dep-cols");
  for (const [dir, label] of [["sentrum", "Mot sentrum"], ["mortensrud", "Mot Mortensrud"]]) {
    const col = el("div", "xp-dep-col");
    const list = el("ol", "dep-list");
    const deps = metro.filter(d => d.direction === dir).slice(0, 8);
    deps.forEach(d => list.append(depRow(d, now, false)));
    if (!deps.length) list.append(text("li", "dep-empty", "Ingen avganger"));
    col.append(text("h4", "", label), list);
    cols.append(col);
  }
  wrap.append(cols);

  wrap.append(el("h3", "xp-h", '<span class="badge bus">B</span>Buss'));
  const busList = el("ol", "dep-list bus");
  bus.slice(0, 14).forEach(d => busList.append(depRow(d, now, true)));
  if (!bus.length) busList.append(text("li", "dep-empty", "Ingen bussavganger"));
  wrap.append(busList);

  const situations = [...new Set(upcoming.map(d => d.situation).filter(Boolean))];
  if (situations.length) {
    wrap.append(text("h3", "xp-h", "Avvik"));
    const list = el("ul", "xp-sit");
    situations.forEach(s => list.append(text("li", "", s)));
    wrap.append(list);
  }
  body.replaceChildren(wrap);
}

/* ----- Vær: nå, radar, 48 timer og sju dager ----- */

// Nedbør hvert femte minutt de neste 90 minuttene, som søyler.
function renderNowcastChart(points, now = Date.now()) {
  const upcoming = points.filter(p => p.t >= now - 5 * 60_000).slice(0, 19);
  const W = 904, H = 120, base = 92;
  const step = W / Math.max(upcoming.length, 1);
  const max = Math.max(2, ...upcoming.map(p => p.rate));
  let out = `<line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="var(--rule)" stroke-width="2"/>`;
  upcoming.forEach((p, i) => {
    const h = p.rate >= 0.05 ? Math.max(4, (p.rate / max) * (base - 8)) : 0;
    if (h) out += `<rect x="${(i * step + step * .15).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${(step * .7).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="var(--rain)"/>`;
    const ahead = Math.round((p.t - now) / 60_000 / 15) * 15;
    if (i === 0 || (i % 6 === 0 && ahead > 0)) {
      const last = i === upcoming.length - 1;
      out += `<text x="${(last ? W : i * step + step / 2).toFixed(1)}" y="${H - 4}" text-anchor="${last ? "end" : "middle"}" font-size="19" font-weight="600" fill="var(--faint)">${i === 0 ? "Nå" : "+" + ahead + " min"}</text>`;
    }
  });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.classList.add("xp-nowcast");
  svg.innerHTML = out;
  return svg;
}

// Radarbildet er en animert GIF på ~3,5 MB. Samme element gjenbrukes når
// vinduet tegnes på nytt, så det ikke lastes og starter om hvert femte minutt.
function radarFigure() {
  const ps = panel.state;
  const version = Math.floor(Date.now() / 600_000);
  if (!ps.radar || ps.radarVersion !== version) {
    const figure = el("figure", "xp-radar");
    const img = el("img");
    img.alt = "Nedbørsradar for Sørøst-Norge";
    img.decoding = "async";
    img.addEventListener("error", () => figure.classList.add("broken"));
    img.src = "/api/radar?v=" + version;
    figure.append(img, text("figcaption", "", "Radar fra Meteorologisk institutt, siste timer. Skullerud ligger rett sørøst for Oslo."));
    ps.radar = figure;
    ps.radarVersion = version;
  }
  return ps.radar;
}

function renderWeatherPanel(body) {
  const w = state.weather;
  if (!w?.data) { body.replaceChildren(text("p", "xp-empty", "Henter været")); return; }
  const { current, days, hourly, nowcast } = w.data;
  // MET-data er lisensiert CC BY 4.0 og skal krediteres.
  const fetched = w.fetchedAt ? `, hentet ${clockText(Date.parse(w.fetchedAt))}` : "";
  setPanelSub(`Data fra MET Norge (Yr)${fetched}`);

  const hero = el("div", "xp-wx-hero");
  hero.append(el("div", "wx-icon", wxIcon(current.code, current.day)), text("div", "big", Math.round(current.temp) + "°"));
  const words = el("div");
  words.append(text("p", "cond", current.text || WX_TEXT[current.code] || "Ukjent vær"));
  const today = days[0];
  if (today) words.append(text("p", "range", `Resten av dagen ${Math.round(today.max)}° / ${Math.round(today.min)}°`));
  hero.append(words);

  const facts = el("div", "xp-facts");
  const fact = (value, label) => { const f = el("div", "xp-fact"); f.append(text("b", "", value), text("span", "", label)); facts.append(f); };
  fact(Math.round(current.feels) + "°", "Føles som");
  fact(Math.round(current.wind) + " m/s", current.gust != null ? `Vind, kast ${Math.round(current.gust)} m/s` : "Vind nå");
  fact(current.rain.toLocaleString("no-NO", { maximumFractionDigits: 1 }) + " mm", "Nedbør neste time");
  if (today?.sunrise) fact(`${clockText(today.sunrise)}–${clockText(today.sunset)}`, "Sol opp og ned");

  const radarParts = [text("h3", "xp-h", "Nedbør neste 90 minutter")];
  if (nowcast?.points?.length) {
    const summary = nowcastSummary(nowcast, current.temp);
    radarParts.push(text("p", "xp-nowcast-text", summary || "Opphold de neste 90 minuttene"));
    // Når det er tørt, er en tom graf bare støy.
    if (summary) radarParts.push(renderNowcastChart(nowcast.points));
  } else {
    radarParts.push(text("p", "xp-nowcast-text", "Korttidsvarselet er ikke tilgjengelig akkurat nå"));
  }
  radarParts.push(radarFigure());

  const chart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chart.setAttribute("viewBox", "0 0 952 150");
  chart.classList.add("xp-chart");
  const series = hourly.filter(h => h.t >= Date.now() - 3_600_000).slice(0, 49);
  renderChart(chart, series, { every: 4, dayLabels: true, gradId: "tfill-xp" });

  const lo = Math.min(...days.map(d => d.min));
  const hi = Math.max(...days.map(d => d.max));
  const span = Math.max(1, hi - lo);
  const week = el("ol", "xp-week");
  days.forEach((d, i) => {
    const date = new Date(d.date);
    const name = WEEKDAYS[date.getDay()];
    const label = i === 0 ? "I dag" : i === 1 ? "I morgen" : name[0].toUpperCase() + name.slice(1);
    const li = el("li");
    li.append(text("span", "wk-day", label));
    li.append(el("span", "wk-icon", wxIcon(d.code, true)));
    const rain = d.rain >= 0.1 ? `${d.rain.toLocaleString("no-NO", { maximumFractionDigits: 1 })} mm` : "Opphold";
    li.append(text("span", "wk-rain" + (d.rain >= 0.1 ? " wet" : ""), d.rainChance != null && d.rain >= 0.1 ? `${rain}, ${d.rainChance} %` : rain));
    li.append(text("span", "wk-lo", Math.round(d.min) + "°"));
    const bar = el("span", "wk-bar", "<i></i>");
    bar.style.setProperty("--a", ((d.min - lo) / span) * 100 + "%");
    bar.style.setProperty("--b", ((hi - d.max) / span) * 100 + "%");
    li.append(bar, text("span", "wk-hi", Math.round(d.max) + "°"), text("span", "wk-wind", Math.round(d.wind) + " m/s"));
    week.append(li);
  });

  body.replaceChildren(hero, facts, ...radarParts, text("h3", "xp-h", "Neste 48 timer"), chart,
    text("h3", "xp-h", `${days.length} dager`), week);
}

/* ----- Lunsj: hele uka ----- */

const MONTHS_SHORT = ["jan.", "feb.", "mars", "apr.", "mai", "juni", "juli", "aug.", "sep.", "okt.", "nov.", "des."];

function renderLunchPanel(body, now = new Date()) {
  const office = state.office?.data;
  if (!office) { body.replaceChildren(text("p", "xp-empty", "Henter menyen")); return; }
  const menu = office.menu;
  const week = isoWeek(now);
  if (!menu || menu.week !== week) {
    setPanelSub(`Uke ${week}`);
    body.replaceChildren(text("p", "xp-empty", `Menyen for uke ${week} er ikke lagt inn ennå`));
    return;
  }
  setPanelSub(`Uke ${menu.week}, servering 11:00–13:00` + (office.menuSource === "intranet" ? ", fra Skullerud Park" : ""));

  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const status = lunchStatus(now);
  const list = el("ol", "xp-menu");

  for (let day = 1; day <= 5; day++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + day - 1);
    const isToday = date.toDateString() === now.toDateString();
    const entry = menu.days.find(d => d.day === day);
    const li = el("li");
    if (isToday) li.classList.add("today");
    else if (date < now) li.classList.add("past");

    const when = el("div", "day");
    const name = WEEKDAYS[date.getDay()];
    when.append(text("span", "day-name", name[0].toUpperCase() + name.slice(1)),
      text("span", "day-date", `${date.getDate()}. ${MONTHS_SHORT[date.getMonth()]}`));
    if (isToday) when.append(text("span", "pill" + (status.live ? " live" : ""), status.live ? "Serveres nå" : "I dag"));

    const dish = el("div", "what");
    if (isHoliday(date)) {
      dish.append(text("p", "closed", "Stengt, helligdag"));
      li.classList.add("holiday");
    } else if (entry) {
      const { main, sub } = splitDish(entry.title);
      dish.append(text("p", "main", main));
      if (sub) dish.append(text("p", "sub", sub));
      if (entry.allergens) dish.append(text("p", "aller", "Allergener: " + entry.allergens));
    } else {
      dish.append(text("p", "closed", "Ikke lagt inn"));
    }
    li.append(when, dish);
    list.append(li);
  }
  body.replaceChildren(list);
}

/* ----- Nyheter: valgt sak stort, resten som liste ----- */

// QR-koden lar folk ta med seg saken på mobilen. Skjermen selv navigerer
// aldri bort, ellers ville den bli stående på en nettavis.
// level: feilkorrigering. «L» gir færre og større ruter, som skannes lettere
// når koden er liten, som i hjørnet av nyhetskortene.
function qrSvg(url, level = "M") {
  if (!url || typeof window.qrcode !== "function") return "";
  try {
    const qr = window.qrcode(0, level);
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return `<svg viewBox="-3 -3 ${n + 6} ${n + 6}" shape-rendering="crispEdges" aria-hidden="true">` +
      `<rect x="-3" y="-3" width="${n + 6}" height="${n + 6}" fill="#fff"/><path d="${d}" fill="#0a1220"/></svg>`;
  } catch (error) {
    console.warn("QR: " + error.message);
    return "";
  }
}

function newsImage(src, className) {
  const img = el("img", className);
  img.alt = "";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("error", () => img.classList.add("broken"));
  img.src = src;
  return img;
}

function renderNewsPanel(body, feed) {
  const items = state.news[feed] || [];
  if (!items.length) { body.replaceChildren(text("p", "xp-empty", "Ingen saker tilgjengelig akkurat nå")); return; }
  const ps = panel.state;
  // Vinduet åpner på saken som står på skjermen akkurat nå.
  if (ps.featured === undefined) ps.featured = state.newsIndex[feed] % items.length;
  const item = items[ps.featured] || items[0];
  setPanelSub(`Siste nytt, ${items.length} saker`);

  const feature = el("article", "xp-feature");
  if (item.image) feature.append(newsImage(item.image, "hero"));
  const textCol = el("div", "xp-feature-text");
  textCol.append(text("span", "time", [newsTime(item.published), item.kicker].filter(Boolean).join("  ·  ")));
  textCol.append(text("h3", "", item.title));
  // ITavisen sender hele saken som avsnitt og mellomtitler. NRK sender hele
  // notisen som ingress, med linjeskift mellom avsnittene.
  if (item.paragraphs?.length) {
    for (const para of item.paragraphs) {
      textCol.append(text(para.heading ? "h4" : "p", para.heading ? "xp-subhead" : "xp-summary", para.text));
    }
  } else {
    for (const para of (item.summary || "").split(/\n+/).map(s => s.trim()).filter(Boolean)) {
      textCol.append(text("p", "xp-summary", para));
    }
  }
  const grid = el("div", "xp-feature-body");
  grid.append(textCol);
  const qr = qrSvg(item.link);
  if (qr) {
    const box = el("div", "xp-qr", qr);
    box.append(text("p", "", "Les hele saken på mobilen"));
    grid.append(box);
  } else {
    grid.classList.add("no-qr");
  }
  feature.append(grid);

  const list = el("ol", "xp-news-list");
  items.forEach((other, i) => {
    if (i === ps.featured) return;
    const li = el("li");
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.append(other.image ? newsImage(other.image, "thumb") : el("span", "thumb"));
    const words = el("div");
    words.append(text("span", "time", newsTime(other.published)), text("p", "t", other.title));
    if (other.summary) words.append(text("p", "s", other.summary));
    li.append(words);
    const pick = () => {
      ps.featured = i;
      renderNewsPanel(body, feed);
      body.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    };
    li.addEventListener("click", pick);
    li.addEventListener("keydown", e => { if (e.key === "Enter") pick(); });
    list.append(li);
  });

  body.replaceChildren(feature, text("h3", "xp-h", "Flere saker"), list);
}

/* ----- Gjør panelene trykkbare ----- */

for (const [key, def] of Object.entries(PANELS)) {
  const node = def.source();
  node.classList.add("expandable");
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-haspopup", "dialog");
  node.setAttribute("aria-label", `Åpne ${def.title}`);
  node.addEventListener("click", () => openPanel(key));
  node.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPanel(key); }
  });
}

// Langt trykk på berøringsskjermen skal ikke åpne kontekstmenyen.
document.addEventListener("contextmenu", event => event.preventDefault());

/* ---------- Versjon og vedlikehold ---------- */

let knownVersion = null;
async function checkVersion() {
  try {
    const response = await fetch("/api/version", { cache: "no-store" });
    const { data } = await response.json();
    if (knownVersion && data.version !== knownVersion) location.reload();
    knownVersion = data.version;
  } catch {}
}

function scheduleNightlyReload() {
  const next = new Date();
  next.setHours(4, 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  setTimeout(() => location.reload(), next - new Date());
}

function refreshAll() {
  loadDepartures();
  loadWeather();
  loadNews();
  loadOffice();
}

document.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();
  if (event.key === "Escape") closePanel();
  if (key === "r") refreshAll();
  if (key === "f") {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
});

/* ---------- Oppstart ---------- */

function tick() {
  const now = new Date();
  renderClock(now);
  renderCountdown(now.getTime());
  // Minuttene på tavla regnes fra forventet avgang hvert sekund, ikke bare
  // når dataene hentes, så «2 min» blir «1 min» i riktig øyeblikk.
  if (now.getSeconds() % 5 === 0) {
    renderBoard(now.getTime());
    refreshPanel("board");
  }
  if (now.getSeconds() === 0) {
    renderLunch(now);
    refreshPanel("lunch");
    if (now.getMinutes() % 15 === 0) renderWeather();
  }
}

// Feiler et bilde, stilark eller skript (typisk midt i en utrulling), lastes
// siden på nytt etter et minutt, høyst tre ganger på rad.
// Bare egne filer teller. Nyhetsbilder fra NRK og ITavisen kan feile uten at
// siden skal lastes på nytt.
function ownAsset(node) {
  if (!(node instanceof HTMLElement) || !/^(IMG|SCRIPT|LINK)$/.test(node.tagName)) return false;
  // Radarbildet under /api/ er data, ikke en del av siden.
  try {
    const url = new URL(node.src || node.href, location.href);
    return url.origin === location.origin && !url.pathname.startsWith("/api/");
  } catch { return false; }
}

let assetFailed = false;
function retryAfterAssetError() {
  if (assetFailed) return;
  assetFailed = true;
  let tries = 0;
  try { tries = Number(sessionStorage.getItem("jpc-asset-retries")) || 0; } catch {}
  if (tries >= 3) return;
  try { sessionStorage.setItem("jpc-asset-retries", String(tries + 1)); } catch {}
  setTimeout(() => location.reload(), 60_000);
}
window.addEventListener("error", event => {
  if (ownAsset(event.target)) retryAfterAssetError();
}, true);
// Bildet kan ha feilet før dette skriptet kjørte.
document.querySelectorAll("img").forEach(img => { if (ownAsset(img) && img.complete && img.naturalWidth === 0) retryAfterAssetError(); });
// Telleren nullstilles bare etter en innlasting uten feil.
setTimeout(() => { if (!assetFailed) try { sessionStorage.removeItem("jpc-asset-retries"); } catch {} }, 5 * 60_000);

window.addEventListener("resize", fitScreen);
// Webfonten kan komme etter første måling; mål overskriftene på nytt da.
document.fonts?.ready.then(fitNews);
fitScreen();
tick();
setTimeout(() => {
  tick();
  setInterval(tick, 1000);
}, 1000 - (Date.now() % 1000));

refreshAll();
checkVersion();
setInterval(loadDepartures, REFRESH.departures);
setInterval(loadWeather, REFRESH.weather);
setInterval(loadNews, REFRESH.news);
setInterval(loadOffice, REFRESH.office);
setInterval(checkVersion, REFRESH.version);
// Kolonnene bytter sak forskjøvet med en halv periode, så ikke alt på
// skjermen beveger seg samtidig.
restartRotation("nrk");
restartRotation("itavisen", NEWS_ROTATION_MS * 1.5);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAll(); });
scheduleNightlyReload();
