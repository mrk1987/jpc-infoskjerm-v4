// JPC Skullerud infoskjerm v4: rim på ruta.
//
// I bitende kulde kryper rimbregner inn fra kantene av skjermen, som på et
// vindu. frost.webp er en ferdig rimramme i skjermens format, laget med
// tools/make_frost.py av et bilde av rim mot svart bakgrunn.
//
// Rimet ligger bak panelene og teksten, men foran værbakgrunnen. Da synes det
// i margene og mellomrommene, og klokka, logoen og nyhetene står alltid
// lesbart oppå det.
//
// Når det blir kaldt nok, vokser rimet fram fra kantene i løpet av noen
// sekunder med en ujevn front, og glimter svakt når det er ferdig.
// ambient.js styrer styrken (0–1) via JpcFrost.draw.
(() => {
  const W = 1080;
  const H = 1920;
  const GROW_S = 8; // sekunder fra klar rute til ferdig rim
  const MASK_SCALE = 0.25; // vekstmasken regnes ut i kvart oppløsning og skaleres opp

  const ambient = document.getElementById("ambient");
  if (!ambient) { window.JpcFrost = { draw() {}, resize() {} }; return; }

  const canvas = document.createElement("canvas");
  canvas.className = "frost";
  canvas.setAttribute("aria-hidden", "true");
  ambient.after(canvas);
  const ctx = canvas.getContext("2d");

  // Hvite bregner bak hvit og grå tekst gir for lite kontrast. Med klassen
  // «frosty» på lerretet får teksten en mørk glorie (styles.css) så lenge
  // det ligger rim.
  const screen = document.getElementById("screen");
  const setFrosty = on => screen?.classList.toggle("frosty", on);

  // Bildet får samme versjon som skriptet, så Cloudflare-cachen følger deployen.
  const version = new URL(document.currentScript.src, location.href).searchParams.get("v");
  const frostImage = new Image();
  frostImage.decoding = "async";
  frostImage.src = "frost.webp" + (version ? "?v=" + version : "");

  /* ---------- Vekstmasken ---------- */

  // Rimet avsløres fra kantene og innover. Fronten følger avstanden til
  // nærmeste kant, gjort ujevn med støy, og når til slutt hele bildet.
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

  // Når fronten har kommet så langt inn, er hele rammen avslørt.
  const FULL_REACH = 620;
  const distOf = new Float32Array(MW * MH);
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const px = (x + 0.5) / MASK_SCALE, py = (y + 0.5) / MASK_SCALE;
      const edge = Math.min(px, W - px, py, H - py);
      // Støyen gjør at noen bregner kommer før andre.
      distOf[y * MW + x] = edge * (0.75 + 0.5 * noise(x / MW, y / MH));
    }
  }

  function updateMask(grow) {
    const d = maskData.data;
    const reach = FULL_REACH * grow;
    for (let i = 0; i < distOf.length; i++) {
      // Fullt rim bak fronten, myk overgang de siste 60 pikslene.
      const a = reach <= 0 ? 0 : Math.min(1, Math.max(0, (reach - distOf[i]) / 60));
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
    updateMask(grow);
    cctx.globalCompositeOperation = "source-over";
    cctx.clearRect(0, 0, W, H);
    cctx.drawImage(frostImage, 0, 0, W, H);
    if (grow < 1) {
      cctx.globalCompositeOperation = "destination-in";
      cctx.imageSmoothingEnabled = true;
      cctx.drawImage(maskCanvas, 0, 0, W, H);
      cctx.globalCompositeOperation = "source-over";
    }
  }

  // Glimtene plasseres der rimet er tettest når det er ferdig grodd.
  function placeSparkles() {
    const data = cctx.getImageData(0, 0, W, H).data;
    sparkles = [];
    for (let tries = 0; tries < 6000 && sparkles.length < 90; tries++) {
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
      if (k <= 0 || !frostImage.complete || !frostImage.naturalWidth) {
        if (visible) {
          ctx.clearRect(0, 0, W, H);
          visible = false;
          setFrosty(false);
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
      setFrosty(k > 0.05);
      ctx.clearRect(0, 0, W, H);
      // Dempet: rimet skal være en svak ramme, ikke konkurrere med innholdet.
      ctx.globalAlpha = 0.42 * k;
      ctx.drawImage(composed, 0, 0);
      ctx.fillStyle = "#ffffff";
      for (const s of sparkles) {
        ctx.globalAlpha = k * Math.max(0, Math.sin(t * s.speed + s.phase)) * 0.6;
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
