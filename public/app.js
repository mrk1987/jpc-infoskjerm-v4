// JPC Skullerud infoskjerm v4 — klient.
// All henting går via serverens /api/*, som cacher og normaliserer kildene.

const REFRESH = {
  departures: 20_000,
  weather: 10 * 60_000,
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
  news: [],
  newsIndex: 0,
  office: null,
  health: {},
};

/* ---------- Skalering av lerretet ---------- */

let currentScale = 1;

function fitScreen() {
  const scale = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
  $("screen").style.transform = `scale(${scale})`;
  currentScale = scale;
}

/* ---------- Henting med lokal reserve ---------- */

async function getJson(path, source) {
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
  if (first.delayMin >= 2 && !first.cancelled) dest.append(text("span", "delay-note", `${first.delayMin} min forsinket`));
  next.append(dest);

  for (const dep of rest.slice(0, 3)) {
    const li = el("li");
    const late = dep.delayMin >= 2 || dep.cancelled;
    li.append(text("span", "dest", dep.destination), text("span", "when" + (late ? " late" : ""), laterWhenText(dep, now)));
    later.append(li);
  }
}

function renderBoard(now = Date.now()) {
  const body = state.departures;
  if (!body?.data) return;
  const all = body.data.departures;
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
  if (body) { state.departures = body; renderBoard(); }
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
  $("wx-cond").textContent = WX_TEXT[current.code] || "Ukjent vær";
  const bits = [`Føles som ${Math.round(current.feels)}°`, `vind ${Math.round(current.wind)} m/s`];
  if (current.rain > 0) bits.push(`${current.rain.toLocaleString("no-NO")} mm nå`);
  $("wx-meta").textContent = bits.join(", ");

  const rows = days.map((d, i) => {
    const label = i === 0 ? "I dag" : "I morgen";
    const rain = d.rain >= 0.1 ? `, ${d.rain.toLocaleString("no-NO", { maximumFractionDigits: 1 })} mm` : "";
    return `<dt>${label}</dt><dd>${Math.round(d.max)}° <span class="lo">/ ${Math.round(d.min)}°${rain}</span></dd>`;
  });
  $("wx-days").innerHTML = rows.join("");
  markStale($("weather"), body);

  const now = Date.now();
  const series = hourly.filter(h => h.t >= now - 3_600_000).slice(0, 25);
  renderChart(series);
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

function renderChart(series) {
  const svg = $("wx-chart");
  if (series.length < 2) { svg.innerHTML = ""; return; }

  const W = 952, top = 44, bottom = 136, labelY = 166;
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
    const hgt = Math.max(3, (h.rain / maxRain) * 70);
    out += `<rect x="${(x(i) - step * 0.32).toFixed(1)}" y="${(bottom - hgt).toFixed(1)}" width="${(step * 0.64).toFixed(1)}" height="${hgt.toFixed(1)}" rx="3" fill="var(--rain)" fill-opacity=".75"/>`;
  });
  out += `<line x1="0" x2="${W}" y1="${bottom}" y2="${bottom}" stroke="var(--rule)" stroke-width="2"/>`;
  if (lo < 0 && hi > 0) {
    out += `<line x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--sky)" stroke-opacity=".35" stroke-dasharray="4 6" stroke-width="2"/>`;
  }

  const pts = series.map((h, i) => [x(i), y(h.temp)]);
  const line = smoothPath(pts);
  out += `<defs><linearGradient id="tfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#8fd0ff" stop-opacity=".28"/><stop offset="1" stop-color="#8fd0ff" stop-opacity="0"/></linearGradient></defs>`;
  out += `<path d="${line} L${W},${bottom} L0,${bottom} Z" fill="url(#tfill)"/>`;
  out += `<path d="${line}" fill="none" stroke="var(--sky)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;

  // Temperatur og ikon hver tredje time, klokkeslett under.
  series.forEach((h, i) => {
    if (i % 3 !== 0) return;
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
  if (body) { state.weather = body; renderWeather(); }
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

function isHoliday(date) {
  const fixed = [[0, 1], [4, 1], [4, 17], [11, 25], [11, 26]];
  if (fixed.some(([mo, d]) => date.getMonth() === mo && date.getDate() === d)) return true;
  const easter = easterSunday(date.getFullYear());
  return [-3, -2, 0, 1, 39, 49, 50].some(offset => {
    const d = new Date(easter);
    d.setDate(d.getDate() + offset);
    return d.toDateString() === date.toDateString();
  });
}

function splitDish(title) {
  const match = title.match(/\s[–—-]\s/);
  if (match && match.index > 0) {
    return { main: title.slice(0, match.index).trim(), sub: title.slice(match.index + match[0].length).trim() };
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

function renderCountdown(now = Date.now()) {
  const cd = state.office?.data?.countdown;
  const box = $("countdown");
  const left = cd ? Date.parse(cd.target) - now : -1;
  // Utløpt nedtelling skjules i stedet for å stå på 00 00 00 00.
  box.hidden = !(left > 0);
  if (box.hidden) return;

  $("cd-label").textContent = cd.label || "Nedtelling";
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
}

/* ---------- Nyheter ---------- */

function newsTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

// Når beskjed, avstemning og nedtelling er synlige samtidig blir det lite
// plass igjen; da vises bare overskriften, uten ingress og kø.
function fitNews() {
  const news = $("news");
  news.classList.remove("compact");
  if (news.getBoundingClientRect().height / currentScale < 330) news.classList.add("compact");
}

function showHeadline() {
  const items = state.news;
  const stage = $("news-stage");
  if (!items.length) {
    stage.replaceChildren(text("p", "", "Ingen nyheter tilgjengelig akkurat nå"));
    return;
  }
  const i = state.newsIndex % items.length;
  const item = items[i];

  const card = el("article", "headline");
  card.append(text("span", "time", newsTime(item.published)), text("h3", "", item.title));
  if (item.summary) card.append(text("p", "", item.summary));
  const old = stage.querySelector(".headline.on");
  stage.append(card);
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("on")));
  if (old) {
    old.classList.remove("on");
    setTimeout(() => old.remove(), 700);
  }

  $("news-count").textContent = `${i + 1} av ${items.length}`;

  const queue = $("news-queue");
  queue.replaceChildren();
  for (let k = 1; k <= 2 && k < items.length; k++) {
    const next = items[(i + k) % items.length];
    const li = el("li");
    li.append(text("span", "time", newsTime(next.published)), text("span", "t", next.title));
    queue.append(li);
  }

  const bar = $("news-progress");
  bar.classList.remove("run");
  void bar.offsetWidth;
  bar.style.setProperty("--news-s", NEWS_ROTATION_MS / 1000 + "s");
  bar.classList.add("run");
  fitNews();
}

async function loadNews() {
  const body = await getJson("/api/news", "news");
  if (!body?.data) return;
  const first = state.news.length === 0;
  state.news = body.data.items;
  markStale($("news"), body);
  if (first) showHeadline();
}

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
  if (now.getSeconds() % 5 === 0) renderBoard(now.getTime());
  if (now.getSeconds() === 0) {
    renderLunch(now);
    if (now.getMinutes() % 15 === 0) renderWeather();
  }
}

window.addEventListener("resize", fitScreen);
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
setInterval(() => { state.newsIndex++; showHeadline(); }, NEWS_ROTATION_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAll(); });
scheduleNightlyReload();
