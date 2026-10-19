// JPC Skullerud infoskjerm v4: værbakgrunn.
//
// Rolige animasjoner bak panelene som speiler været ute: sol, stjerner,
// skyer, tåke, regn, sludd, snø, torden og vind. app.js bestemmer hvilke lag
// som er på og hvor sterke de er (0 til 1); her tegnes alt på ett lerret.
// Alt holdes dempet, så teksten foran alltid er lett å lese.
//
// Styrken styrer både hvor mange partikler det er og hvordan de ser ut:
// yr er få, korte og tynne dråper, styrtregn er hundrevis av lange, raske
// striper. Endres styrken, glir lagene mot den nye verdien over noen
// sekunder; nye partikler kommer inn ovenfra, og overflødige forsvinner når
// de har falt ut av skjermen. Da ser det ut som om regnet tiltar eller
// stilner, i stedet for at bildet hopper.
(() => {
  const W = 1080;
  const H = 1920;
  const TAU = Math.PI * 2;
  const EASE_S = 4; // tidskonstant for overgangen mellom styrker
  const canvas = document.getElementById("ambient");
  if (!canvas?.getContext) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const LAYERS = ["sun", "stars", "clouds", "fog", "rain", "snow", "lightning", "wind"];

  let target = { layers: {}, wind: 0, dark: false, night: false };
  const level = Object.fromEntries(LAYERS.map(l => [l, 0])); // styrken som vises nå
  let wind = 0; // vind i m/s, inkludert litt av kastene
  let sceneKey = "";
  let started = false;
  let cloudTint = "";
  const pools = { stars: [], clouds: [], fog: [], rain: [], snow: [], gusts: [] };
  let frame = 0;
  let last = 0;
  const flash = { level: 0, next: 0, second: 0 };

  // Hvor mange partikler hvert lag skal ha ved en gitt styrke.
  const want = {
    rain: k => (k < 0.02 ? 0 : Math.round(30 + 570 * Math.pow(k, 1.2))),
    snow: k => (k < 0.02 ? 0 : Math.round(30 + 470 * k)),
    gusts: k => (k < 0.02 ? 0 : Math.round(3 + 15 * k)),
  };

  /* ---------- Sprites: skyer og tåke tegnes uskarpe én gang ---------- */

  function sprite(w, h, color, blobs, blur) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.filter = `blur(${blur}px)`;
    g.fillStyle = color;
    for (const [x, y, rx, ry] of blobs) {
      g.beginPath();
      g.ellipse(x * w, y * h, rx * w, ry * h, 0, 0, TAU);
      g.fill();
    }
    return c;
  }

  function cloudSprite(color) {
    const blobs = [[0.5, 0.62, 0.34, 0.2]];
    for (let i = 0; i < 6; i++) blobs.push([rand(0.24, 0.76), rand(0.4, 0.6), rand(0.1, 0.18), rand(0.13, 0.22)]);
    return sprite(760, 340, color, blobs, 26);
  }

  // Ni skyer lages alltid; styrken bestemmer hvor mange som vises og hvor tett.
  function buildClouds() {
    cloudTint = target.dark ? "#7d8aa0" : "#dfe8f5";
    const sprites = [cloudSprite(cloudTint), cloudSprite(cloudTint), cloudSprite(cloudTint)];
    pools.clouds = Array.from({ length: 9 }, (_, i) => ({
      img: sprites[i % 3], x: rand(-500, W), y: rand(-100, H * 0.78), s: rand(0.7, 1.5), v: rand(6, 16), a: rand(0.5, 1),
    }));
  }

  function buildStatic() {
    pools.stars = Array.from({ length: 110 }, () => ({
      // Stjernene samles øverst, der himmelen ville vært.
      x: rand(0, W), y: H * 0.7 * Math.pow(Math.random(), 1.6), r: rand(0.6, 1.8), phase: rand(0, TAU), speed: rand(0.4, 1.4),
    }));
    const fog = sprite(1800, 320, "#c3cedd", [[0.5, 0.5, 0.42, 0.26]], 40);
    pools.fog = Array.from({ length: 6 }, (_, i) => ({
      img: fog, x: rand(W - 1800, 0), y: (H / 6) * i + rand(-40, 80), v: rand(6, 14) * (Math.random() < 0.5 ? -1 : 1), a: rand(0.6, 1), phase: rand(0, TAU),
    }));
    buildClouds();
  }

  /* ---------- Partikler ---------- */

  // Vinden bestemmer bare vinkelen, ikke kompassretningen: alt blåser fra
  // høyre mot venstre. Stille gir loddrett regn, frisk bris (~8 m/s) ~30°,
  // kuling (~14 m/s) ~50°, sterk kuling (~20 m/s) ~70° og storm (24 m/s
  // eller mer) ~80°, nesten vannrett.
  const MAX_TILT = (80 * Math.PI) / 180;
  const tilt = () => MAX_TILT * Math.pow(clamp(wind / 24, 0, 1), 0.9);

  // Hvor nye partikler kommer inn, gitt retningen de beveger seg i. På skrå
  // kommer de både ovenfra og fra høyre kant, i forhold til hvor mye av
  // strømmen som krysser hver kant. Ellers ville høyre side av skjermen
  // tømmes i sterk vind.
  function entry(dx, dy, margin) {
    const fromTop = Math.abs(dy) * W;
    const fromSide = Math.abs(dx) * H;
    if (Math.random() * (fromTop + fromSide) < fromTop) return { x: rand(-margin, W + margin), y: rand(-margin, -10) };
    return { x: W + rand(10, margin), y: rand(-margin, H) };
  }

  // Ute av skjermen nederst eller til venstre, der alt forsvinner.
  const gone = (p, margin) => p.y > H + margin || p.x < -margin;

  // Dråpens størrelse og fart følger styrken da den ble født, så kraftig
  // regn gradvis får lengre og raskere striper etter hvert som dråpene byttes.
  // Sterk vind gjør dem også raskere.
  function drop(anywhere) {
    const k = level.rain;
    const a = tilt();
    return {
      ...(anywhere ? { x: rand(0, W), y: rand(0, H) } : entry(Math.sin(a), Math.cos(a), 200)),
      len: rand(10, 18) + 26 * k * Math.random() + 10 * k,
      v: rand(800, 1000) + 700 * k * Math.random() + 15 * wind,
    };
  }

  // Snøen blåses sidelengs raskere enn den faller, så en snøstorm blir
  // nesten vannrett. push gir hvert fnugg sin egen vindfølsomhet.
  const snowWind = () => 30 * wind;
  const snowFall = () => 60 + 4 * wind;

  function flake(anywhere) {
    const k = level.snow;
    return {
      ...(anywhere ? { x: rand(0, W), y: rand(0, H) } : entry(snowWind(), snowFall(), 40)),
      r: rand(1.2, 2.4) + 2.6 * k * Math.random(),
      v: rand(30, 70) + 50 * k * Math.random(),
      phase: rand(0, TAU),
      sway: rand(12, 34),
      push: rand(0.7, 1.3),
    };
  }

  function gust(anywhere) {
    const k = level.wind;
    const len = rand(220, 360) + 220 * k;
    return {
      len,
      x: anywhere ? rand(-len, W) : W + rand(50, 700),
      y: rand(80, H - 80),
      v: rand(420, 650) + 500 * k,
      amp: rand(6, 14) + 10 * k,
      phase: rand(0, TAU),
    };
  }

  // Fyller på nye partikler ovenfra til laget har så mange det skal ha.
  // Overflødige fjernes først når de har forlatt skjermen (se oppdateringene).
  function topUp(pool, count, make) {
    while (pool.length < count) pool.push(make(!started));
  }

  /* ---------- Tegning ---------- */

  function drawSun(t, k) {
    const cx = W * 0.8, cy = -40;
    const breathe = 0.85 + 0.15 * Math.sin(t * 0.4);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 950);
    glow.addColorStop(0, `rgba(255, 200, 110, ${0.22 * k * breathe})`);
    glow.addColorStop(0.35, `rgba(255, 178, 56, ${0.08 * k * breathe})`);
    glow.addColorStop(1, "rgba(255, 178, 56, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Stråler som dreier svært sakte.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.015);
    const rays = ctx.createRadialGradient(0, 0, 0, 0, 0, 1400);
    rays.addColorStop(0, "rgba(255, 214, 150, 1)");
    rays.addColorStop(1, "rgba(255, 214, 150, 0)");
    ctx.fillStyle = rays;
    ctx.globalAlpha = 0.06 * k * breathe;
    for (let i = 0; i < 12; i++) {
      ctx.rotate(TAU / 12);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(1500, -70);
      ctx.lineTo(1500, 70);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawStars(t, k) {
    const moon = ctx.createRadialGradient(W * 0.82, 80, 0, W * 0.82, 80, 520);
    moon.addColorStop(0, `rgba(190, 210, 255, ${0.1 * k})`);
    moon.addColorStop(1, "rgba(190, 210, 255, 0)");
    ctx.fillStyle = moon;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#dfe8ff";
    for (const s of pools.stars) {
      ctx.globalAlpha = (0.2 + 0.45 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase))) * k;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFog(t, dt, k) {
    for (const f of pools.fog) {
      f.x += f.v * dt;
      if (f.x > 0) f.v = -Math.abs(f.v);
      if (f.x < W - f.img.width) f.v = Math.abs(f.v);
      ctx.globalAlpha = (0.22 + 0.08 * Math.sin(t * 0.2 + f.phase)) * k * f.a;
      ctx.drawImage(f.img, f.x, f.y - f.img.height / 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawClouds(dt, k) {
    const dim = target.night ? 0.6 : 1;
    const visible = Math.round(3 + 6 * k);
    pools.clouds.forEach((c, i) => {
      const w = c.img.width * c.s;
      // Skyene driver mot venstre og jager av gårde i sterk vind.
      c.x -= (c.v + wind * 9) * dt;
      if (c.x < -w - 60) c.x = W + 20;
      if (i >= visible) return;
      ctx.globalAlpha = 0.22 * c.a * k * dim;
      ctx.drawImage(c.img, c.x, c.y, w, c.img.height * c.s);
    });
    ctx.globalAlpha = 1;
  }

  function drawRain(dt, k) {
    const a = tilt();
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const count = want.rain(k);
    topUp(pools.rain, count, drop);
    // Kraftig regn er både tettere, tykkere og litt lysere.
    ctx.strokeStyle = `rgba(170, 200, 240, ${0.22 + 0.16 * k})`;
    ctx.lineWidth = 1.1 + 1.1 * k;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = pools.rain.length - 1; i >= 0; i--) {
      const d = pools.rain[i];
      d.x -= d.v * sin * dt;
      d.y += d.v * cos * dt;
      if (gone(d, 60)) {
        if (pools.rain.length > count) { pools.rain.splice(i, 1); continue; }
        Object.assign(d, drop(false));
      }
      // Halen peker mot der dråpen kom fra: opp og til høyre.
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + d.len * sin, d.y - d.len * cos);
    }
    ctx.stroke();
  }

  function drawSnow(t, dt, k) {
    const count = want.snow(k);
    topUp(pools.snow, count, flake);
    ctx.fillStyle = `rgba(240, 246, 255, ${0.6 + 0.2 * k})`;
    ctx.beginPath();
    for (let i = pools.snow.length - 1; i >= 0; i--) {
      const f = pools.snow[i];
      f.y += (f.v + 4 * wind) * dt;
      f.x += (Math.sin(t * 0.9 + f.phase) * f.sway - snowWind() * f.push) * dt;
      if (gone(f, 20)) {
        if (pools.snow.length > count) { pools.snow.splice(i, 1); continue; }
        Object.assign(f, flake(false));
      }
      // I stille vær kan et fnugg vugge litt ut til høyre; hent det inn igjen.
      if (f.x > W + 120) f.x -= W + 240;
      ctx.moveTo(f.x + f.r, f.y);
      ctx.arc(f.x, f.y, f.r, 0, TAU);
    }
    ctx.fill();
  }

  function drawGusts(t, dt, k) {
    const count = want.gusts(k);
    topUp(pools.gusts, count, gust);
    ctx.strokeStyle = `rgba(225, 235, 250, ${0.09 + 0.08 * k})`;
    ctx.lineWidth = 1.6 + 1.2 * k;
    for (let i = pools.gusts.length - 1; i >= 0; i--) {
      const g = pools.gusts[i];
      g.x -= (g.v + 15 * wind) * dt;
      if (g.x + g.len < -100) {
        if (pools.gusts.length > count) { pools.gusts.splice(i, 1); continue; }
        Object.assign(g, gust(false));
      }
      ctx.beginPath();
      for (let j = 0; j <= 24; j++) {
        const p = j / 24;
        const x = g.x + p * g.len;
        const y = g.y + Math.sin(p * 6 + t * 3 + g.phase) * g.amp * Math.sin(p * Math.PI);
        if (j) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }

  // Lynet er et svakt, dobbelt lysglimt med lang pause mellom, godt under
  // grensene for blinkende lys som kan utløse anfall. Styrken er Yrs
  // tordensannsynlighet: ved 100 % kommer et glimt hvert 14.–40. sekund,
  // ved 20 % omtrent hvert eller annet minutt.
  function drawLightning(t, dt, k) {
    const spacing = () => rand(14, 40) / Math.max(0.3, k);
    if (!flash.next) flash.next = t + rand(6, 14);
    if (t >= flash.next) {
      flash.level = 1;
      flash.second = t + 0.14;
      flash.next = t + spacing();
    }
    if (flash.second && t >= flash.second) {
      flash.level = Math.max(flash.level, 0.7);
      flash.second = 0;
    }
    if (flash.level > 0.01) {
      ctx.fillStyle = `rgba(220, 230, 255, ${0.13 * flash.level})`;
      ctx.fillRect(0, 0, W, H);
      flash.level *= Math.pow(0.02, dt);
    }
  }

  // Styrkene glir mot målet. Første tegning hopper rett dit.
  function ease(dt) {
    const f = started ? 1 - Math.exp(-dt / EASE_S) : 1;
    for (const l of LAYERS) {
      const goal = target.layers[l] || 0;
      level[l] += (goal - level[l]) * f;
      if (Math.abs(goal - level[l]) < 0.002) level[l] = goal;
    }
    wind += (target.wind - wind) * f;
  }

  function draw(t, dt) {
    ease(dt);
    ctx.clearRect(0, 0, W, H);
    if (level.sun) drawSun(t, level.sun);
    if (level.stars) drawStars(t, level.stars);
    if (level.fog) drawFog(t, dt, level.fog);
    if (level.clouds) drawClouds(dt, level.clouds);
    if (level.rain || pools.rain.length) drawRain(dt, level.rain);
    if (level.snow || pools.snow.length) drawSnow(t, dt, level.snow);
    if (level.wind || pools.gusts.length) drawGusts(t, dt, level.wind);
    if (level.lightning > 0.05 && !reduceMotion) drawLightning(t, dt, level.lightning);
    started = true;
  }

  /* ---------- Styring ---------- */

  const busy = () =>
    LAYERS.some(l => level[l] > 0 || (target.layers[l] || 0) > 0) ||
    pools.rain.length > 0 || pools.snow.length > 0 || pools.gusts.length > 0;

  function loop(now) {
    const t = now / 1000;
    const dt = last ? Math.min(0.05, t - last) : 0;
    last = t;
    draw(t, dt);
    frame = busy() ? requestAnimationFrame(loop) : 0;
    if (!frame) ctx.clearRect(0, 0, W, H);
  }

  function render() {
    // Med redusert bevegelse vises ett stillbilde i stedet for animasjon.
    if (reduceMotion) {
      started = false;
      for (const pool of ["rain", "snow", "gusts"]) pools[pool] = [];
      draw(0, 0);
      return;
    }
    if (!frame && busy()) {
      last = 0;
      frame = requestAnimationFrame(loop);
    }
  }

  buildStatic();

  window.JpcAmbient = {
    // layers: { sun, stars, clouds, fog, rain, snow, lightning, wind } med styrke 0–1.
    // wind: vind i m/s. Den styrer vinkelen på regn og snø og farten på skyer
    // og vindstriper; alt blåser fra høyre mot venstre.
    set(next) {
      const key = JSON.stringify(next);
      if (key === sceneKey) return;
      sceneKey = key;
      target = { layers: next.layers || {}, wind: next.wind || 0, dark: Boolean(next.dark), night: Boolean(next.night) };
      if ((target.dark ? "#7d8aa0" : "#dfe8f5") !== cloudTint) buildClouds();
      render();
    },
    // Lerretet følger skjermens oppløsning, men høyst 1,5× for å spare GPU.
    resize(scale) {
      const res = clamp(scale * (window.devicePixelRatio || 1), 0.5, 1.5);
      canvas.width = Math.round(W * res);
      canvas.height = Math.round(H * res);
      ctx.setTransform(res, 0, 0, res, 0, 0);
      if (reduceMotion) render();
    },
  };
})();
