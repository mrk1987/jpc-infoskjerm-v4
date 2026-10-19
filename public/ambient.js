// JPC Skullerud infoskjerm v4: værbakgrunn.
//
// Rolige animasjoner bak panelene som speiler været ute: sol, stjerner,
// skyer, tåke, regn, sludd, snø, torden og vind. app.js bestemmer hvilke lag
// som er på og hvor sterke de er (0 til 1); her tegnes alt på ett lerret.
// Alt holdes dempet, så teksten foran alltid er lett å lese.
(() => {
  const W = 1080;
  const H = 1920;
  const TAU = Math.PI * 2;
  const canvas = document.getElementById("ambient");
  if (!canvas?.getContext) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  let scene = { layers: {}, windX: 0, dark: false, night: false };
  let sceneKey = "";
  let pools = { stars: [], clouds: [], fog: [], rain: [], snow: [], gusts: [] };
  let slant = 0;
  let frame = 0;
  let last = 0;
  const flash = { level: 0, next: 0, second: 0 };

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

  /* ---------- Partikler ---------- */

  // Regn faller skrått med vinden, så dråpene må starte litt på lovsiden.
  const drop = anywhere => ({
    x: rand(-200 - Math.max(0, slant) * H, W + 200 - Math.min(0, slant) * H),
    y: anywhere ? rand(-0.1 * H, H) : rand(-160, -20),
    len: rand(18, 34),
    v: rand(950, 1400),
  });

  const flake = anywhere => ({
    x: rand(-100, W + 100),
    y: anywhere ? rand(0, H) : rand(-40, -8),
    r: rand(1.4, 4),
    v: rand(35, 95),
    phase: rand(0, TAU),
    sway: rand(12, 34),
  });

  function gust(anywhere) {
    const len = rand(240, 480);
    const right = scene.windX >= 0;
    return {
      len,
      x: anywhere ? rand(-len, W) : right ? -len - rand(50, 700) : W + rand(50, 700),
      y: rand(80, H - 80),
      v: rand(520, 900),
      amp: rand(6, 18),
      phase: rand(0, TAU),
    };
  }

  function build() {
    const L = scene.layers;
    slant = clamp(scene.windX / 700, -0.45, 0.45);
    const tint = scene.dark ? "#7d8aa0" : "#dfe8f5";
    const clouds = [];
    if (L.clouds) {
      const sprites = [cloudSprite(tint), cloudSprite(tint), cloudSprite(tint)];
      const count = Math.round(3 + L.clouds * 6);
      for (let i = 0; i < count; i++) {
        clouds.push({ img: sprites[i % 3], x: rand(-500, W), y: rand(-100, H * 0.78), s: rand(0.7, 1.5), v: rand(6, 16), a: rand(0.5, 1) });
      }
    }
    const fog = [];
    if (L.fog) {
      const img = sprite(1800, 320, "#c3cedd", [[0.5, 0.5, 0.42, 0.26]], 40);
      for (let i = 0; i < 6; i++) {
        fog.push({ img, x: rand(W - 1800, 0), y: (H / 6) * i + rand(-40, 80), v: rand(6, 14) * (Math.random() < 0.5 ? -1 : 1), a: rand(0.6, 1), phase: rand(0, TAU) });
      }
    }
    pools = {
      // Stjernene samles øverst, der himmelen ville vært.
      stars: L.stars ? Array.from({ length: 110 }, () => ({
        x: rand(0, W), y: H * 0.7 * Math.pow(Math.random(), 1.6), r: rand(0.6, 1.8), phase: rand(0, TAU), speed: rand(0.4, 1.4),
      })) : [],
      clouds,
      fog,
      rain: L.rain ? Array.from({ length: Math.round(60 + L.rain * 260) }, () => drop(true)) : [],
      snow: L.snow ? Array.from({ length: Math.round(50 + L.snow * 190) }, () => flake(true)) : [],
      gusts: L.wind ? Array.from({ length: Math.round(4 + L.wind * 10) }, () => gust(true)) : [],
    };
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
    const dim = scene.night ? 0.6 : 1;
    for (const c of pools.clouds) {
      const w = c.img.width * c.s;
      c.x += (c.v + scene.windX * 0.25) * dt;
      if (c.x > W + 40) c.x = -w - 40;
      if (c.x < -w - 60) c.x = W + 20;
      ctx.globalAlpha = 0.22 * c.a * k * dim;
      ctx.drawImage(c.img, c.x, c.y, w, c.img.height * c.s);
    }
    ctx.globalAlpha = 1;
  }

  function drawRain(dt) {
    ctx.strokeStyle = "rgba(170, 200, 240, .3)";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const d of pools.rain) {
      d.y += d.v * dt;
      d.x += d.v * slant * dt;
      if (d.y > H + 40) Object.assign(d, drop(false));
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * slant, d.y - d.len);
    }
    ctx.stroke();
  }

  function drawSnow(t, dt) {
    ctx.fillStyle = "rgba(240, 246, 255, .7)";
    ctx.beginPath();
    for (const f of pools.snow) {
      f.y += f.v * dt;
      f.x += (scene.windX * 0.5 + Math.sin(t * 0.9 + f.phase) * f.sway) * dt;
      if (f.y > H + 10) Object.assign(f, flake(false));
      if (f.x > W + 120) f.x -= W + 240;
      if (f.x < -120) f.x += W + 240;
      ctx.moveTo(f.x + f.r, f.y);
      ctx.arc(f.x, f.y, f.r, 0, TAU);
    }
    ctx.fill();
  }

  function drawGusts(t, dt, k) {
    const dir = scene.windX >= 0 ? 1 : -1;
    ctx.strokeStyle = "rgba(225, 235, 250, .13)";
    ctx.lineWidth = 2;
    ctx.globalAlpha = k;
    for (const g of pools.gusts) {
      g.x += g.v * dir * dt;
      if ((dir > 0 && g.x > W + 100) || (dir < 0 && g.x + g.len < -100)) Object.assign(g, gust(false));
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const p = i / 24;
        const x = g.x + p * g.len;
        const y = g.y + Math.sin(p * 6 + t * 3 + g.phase) * g.amp * Math.sin(p * Math.PI);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Lynet er et svakt, dobbelt lysglimt med lang pause mellom, godt under
  // grensene for blinkende lys som kan utløse anfall.
  function drawLightning(t, dt) {
    if (!flash.next) flash.next = t + rand(6, 14);
    if (t >= flash.next) {
      flash.level = 1;
      flash.second = t + 0.14;
      flash.next = t + rand(14, 40);
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

  function draw(t, dt) {
    const L = scene.layers;
    ctx.clearRect(0, 0, W, H);
    if (L.sun) drawSun(t, L.sun);
    if (L.stars) drawStars(t, L.stars);
    if (L.fog) drawFog(t, dt, L.fog);
    if (L.clouds) drawClouds(dt, L.clouds);
    if (L.rain) drawRain(dt);
    if (L.snow) drawSnow(t, dt);
    if (L.wind) drawGusts(t, dt, L.wind);
    if (L.lightning && !reduceMotion) drawLightning(t, dt);
  }

  /* ---------- Styring ---------- */

  const active = () => Object.values(scene.layers).some(v => v > 0);

  function loop(now) {
    const t = now / 1000;
    const dt = last ? Math.min(0.05, t - last) : 0;
    last = t;
    draw(t, dt);
    frame = active() ? requestAnimationFrame(loop) : 0;
  }

  function render() {
    if (!active()) {
      ctx.clearRect(0, 0, W, H);
      return;
    }
    // Med redusert bevegelse vises ett stillbilde i stedet for animasjon.
    if (reduceMotion) {
      draw(0, 0);
      return;
    }
    if (!frame) {
      last = 0;
      frame = requestAnimationFrame(loop);
    }
  }

  window.JpcAmbient = {
    // layers: { sun, stars, clouds, fog, rain, snow, lightning, wind } med styrke 0–1.
    // windX: vindens fart sideveis i px/s, positiv mot høyre.
    set(next) {
      const key = JSON.stringify(next);
      if (key === sceneKey) return;
      sceneKey = key;
      scene = { layers: next.layers || {}, windX: next.windX || 0, dark: Boolean(next.dark), night: Boolean(next.night) };
      build();
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
