// JPC Skullerud infoskjerm v4: rim på ruta.
//
// I bitende kulde kryper det rim inn fra kantene av skjermen, som på et
// vindu. Rimet er ekte: frost.webp er laget av et fotografi av rim på en
// rute (Simon Fairhurst, Unsplash), gjort om til en maske der iskrystallene
// er dekkende og glasset mellom dem klart (se tools/make_frost.py). Bildet er
// den nederste stripa av fotoet, der bregnene vokser oppover, altså innover
// fra rammen; her roteres den så rimet vokser inn fra alle fire kanter.
//
// Hvor langt inn rimet når, styres av en «kulde»-maske: lengst i de nederste
// hjørnene, kort langs sidene og minst øverst, der logoen og klokka står.
// Fronten er ujevn og kryper innover i løpet av noen sekunder.
//
// ambient.js styrer styrken (0–1) via JpcFrost.draw.
(() => {
  const W = 1080;
  const H = 1920;
  const GROW_S = 8; // sekunder fra klar rute til ferdig rim
  const MASK_SCALE = 0.25; // masken regnes ut i kvart oppløsning og skaleres opp

  const ambient = document.getElementById("ambient");
  if (!ambient) { window.JpcFrost = { draw() {}, resize() {} }; return; }

  const canvas = document.createElement("canvas");
  canvas.className = "frost";
  canvas.setAttribute("aria-hidden", "true");
  ambient.after(canvas);
  const ctx = canvas.getContext("2d");

  // Bildet får samme versjon som skriptet, så Cloudflare-cachen følger deployen.
  const version = new URL(document.currentScript.src, location.href).searchParams.get("v");
  const band = new Image();
  band.decoding = "async";
  band.src = "frost.webp" + (version ? "?v=" + version : "");

  /* ---------- Rimet langs alle fire kanter ---------- */

  // Stripa er 1920 px lang, med rammen nederst og bregnene pekende oppover.
  // Langs hver kant tegnes den rotert så rammen ligger mot kanten: hele
  // lengden på sidene, og ulike utsnitt øverst og nederst, så ingen kant
  // gjentar en annen og det ikke blir skjøter.
  let frame = null;

  function buildFrame() {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    const bh = band.height;
    // Tegner et utsnitt av stripa langs en kant, med rammen ved y = 0 og
    // bregnene inn mot positiv y. Kalles etter at koordinatene er rotert.
    const along = (from, length, depth, mirror = false) => {
      g.save();
      if (mirror) { g.translate(length, 0); g.scale(-1, 1); }
      g.scale(1, -1);
      g.drawImage(band, from, 0, length, bh, 0, -depth, length, depth);
      g.restore();
    };
    // Bunn: rammen ved y = H.
    g.save(); g.translate(0, H); g.scale(1, -1); along(420, W, bh); g.restore();
    // Topp: grunnere, et annet utsnitt.
    g.save(); along(840, W, bh * 0.6, true); g.restore();
    // Venstre: rammen ved x = 0.
    g.save(); g.translate(0, H); g.rotate(-Math.PI / 2); along(0, H, bh * 0.8); g.restore();
    // Høyre: rammen ved x = W, speilvendt.
    g.save(); g.translate(W, 0); g.rotate(Math.PI / 2); along(0, H, bh * 0.8, true); g.restore();
    return c;
  }

  /* ---------- Kulde-masken ---------- */

  const MW = Math.round(W * MASK_SCALE);
  const MH = Math.round(H * MASK_SCALE);
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = MW;
  maskCanvas.height = MH;
  const mctx = maskCanvas.getContext("2d");
  const maskData = mctx.createImageData(MW, MH);

  // Glatt verdistøy, så fronten blir ujevn og organisk.
  const GRID = 24;
  const lattice = Array.from({ length: (GRID + 1) * (GRID + 1) }, Math.random);
  function noise(u, v) {
    const x = u * GRID, y = v * GRID;
    const i = Math.min(GRID - 1, Math.floor(x)), j = Math.min(GRID - 1, Math.floor(y));
    const fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (a, b) => lattice[b * (GRID + 1) + a];
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return top + (bottom - top) * sy;
  }

  // Hvor langt inn rimet når, og avstanden til nærmeste kant, for hver celle.
  // Regnes én gang; veksten skalerer bare rekkevidden.
  const reachOf = new Float32Array(MW * MH);
  const distOf = new Float32Array(MW * MH);
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const px = (x + 0.5) / MASK_SCALE, py = (y + 0.5) / MASK_SCALE;
      // Bare de nederste hjørnene får ekstra rim; de øverste har logo og klokke.
      const corner = Math.max(
        Math.max(0, 1 - Math.hypot(px, H - py) / 520),
        Math.max(0, 1 - Math.hypot(W - px, H - py) / 520),
      );
      // Øverste 260 px (logo, klokke, dato) får bare en tynn rimkant.
      const top = py < 260 ? 0.45 : py < 360 ? 0.45 + 0.55 * ((py - 260) / 100) : 1;
      const i = y * MW + x;
      reachOf[i] = (50 + 230 * corner) * top * (0.7 + 0.6 * noise(x / MW, y / MH));
      // Toppkanten teller dobbelt så langt unna, så det blir lite rim der.
      distOf[i] = Math.min(px, W - px, H - py, py * 2);
    }
  }

  function updateMask(grow) {
    const d = maskData.data;
    for (let i = 0; i < reachOf.length; i++) {
      const r = reachOf[i] * grow;
      // Fullt rim ytterst, myk overgang ved fronten.
      const t = r > 0 ? distOf[i] / r : 2;
      const a = t <= 0.7 ? 1 : t >= 1 ? 0 : 1 - (t - 0.7) / 0.3;
      d[i * 4 + 3] = a * 255;
    }
    mctx.putImageData(maskData, 0, 0);
  }

  /* ---------- Sammensetting og glimt ---------- */

  const composed = document.createElement("canvas");
  composed.width = W;
  composed.height = H;
  const cctx = composed.getContext("2d", { willReadFrequently: true });
  let grownAt = -1; // tidspunktet veksten startet, -1 = ikke startet
  let lastGrow = -1;
  let sparkles = [];
  let visible = false;

  function compose(grow) {
    if (!frame) frame = buildFrame();
    updateMask(grow);
    cctx.globalCompositeOperation = "source-over";
    cctx.clearRect(0, 0, W, H);
    cctx.drawImage(frame, 0, 0);
    cctx.globalCompositeOperation = "destination-in";
    cctx.imageSmoothingEnabled = true;
    cctx.drawImage(maskCanvas, 0, 0, W, H);
    cctx.globalCompositeOperation = "source-over";
  }

  // Glimtene plasseres der rimet er tettest når det er ferdig grodd.
  function placeSparkles() {
    const data = cctx.getImageData(0, 0, W, H).data;
    sparkles = [];
    for (let tries = 0; tries < 4000 && sparkles.length < 90; tries++) {
      const x = Math.floor(Math.random() * W), y = Math.floor(Math.random() * H);
      if (data[(y * W + x) * 4 + 3] > 200) {
        sparkles.push({ x, y, r: 0.8 + Math.random() * 1.2, phase: Math.random() * 6.28, speed: 0.6 + Math.random() * 1.6 });
      }
    }
  }

  window.JpcFrost = {
    // Kalles for hver tegning fra ambient.js med styrken på rimet.
    // instant: hopper over veksten (redusert bevegelse).
    draw(t, k, instant = false) {
      if (k <= 0 || !band.complete || !band.naturalWidth) {
        if (visible) {
          ctx.clearRect(0, 0, W, H);
          visible = false;
          // Neste kalde dag kryper rimet fram på nytt.
          grownAt = -1;
          lastGrow = -1;
        }
        return;
      }
      if (grownAt < 0) grownAt = t;
      const p = instant ? 1 : Math.min(1, (t - grownAt) / GROW_S);
      const grow = 1 - Math.pow(1 - p, 3); // raskt først, så roligere
      if (grow !== lastGrow) {
        compose(grow);
        if (grow === 1) placeSparkles();
        lastGrow = grow;
      }
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = 0.72 * k;
      ctx.drawImage(composed, 0, 0);
      ctx.fillStyle = "#ffffff";
      for (const s of sparkles) {
        ctx.globalAlpha = k * Math.max(0, Math.sin(t * s.speed + s.phase)) * 0.9;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      visible = true;
    },
    resize(res) {
      canvas.width = Math.round(W * res);
      canvas.height = Math.round(H * res);
      ctx.setTransform(res, 0, 0, res, 0, 0);
      visible = true; // tving ny tegning
    },
  };
})();
