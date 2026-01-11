import { startCamera, setFacingMode, getFacingMode, hasCameraStream } from "./camera.js";
import { HUD } from "./hud.js";
import { createVision } from "./vision.js";
import { clickSound, pingSound } from "./sfx.js";
import { Hologram } from "./holo.js";

const stage = document.getElementById("stage");
const video = document.getElementById("video");
const hudCanvas = document.getElementById("hud");
const statusText = document.getElementById("statusText");

const btnStart = document.getElementById("btnStart");
const btnFlip  = document.getElementById("btnFlip");
const btnScan  = document.getElementById("btnScan");
const btnSnap  = document.getElementById("btnSnap");
const btnClear = document.getElementById("btnClear");

const gallery  = document.getElementById("gallery");

const holoPanel = document.getElementById("holoPanel");
const holoCanvas = document.getElementById("holoCanvas");
const holoMeta = document.getElementById("holoMeta");
const holoClose = document.getElementById("holoClose");

const hud = new HUD(hudCanvas);
const holo = new Hologram(holoPanel, holoCanvas, holoMeta);

let vision = null;
let scanOn = false;

let lastFrame = performance.now();
let fpsSmooth = 0;

let lastDetectAt = 0;
const DETECT_INTERVAL_MS = 140; // ~7fps detection, UI stays smooth
let lastNormalized = [];        // last frame detections in canvas coords

function setStatus(html) {
  statusText.innerHTML = html;
}

function setScanButton(on) {
  scanOn = on;
  btnScan.dataset.on = on ? "true" : "false";
  hud.setScanOn(on);
}

function setMirrorForFacing(mode) {
  // Mirror only for selfie (user)
  stage.classList.toggle("mirror", mode === "user");
}

function canvasPointFromEvent(e) {
  const rect = hudCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (hudCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (hudCanvas.height / rect.height);
  return { x, y };
}

function pickDetectionAtPoint(pt) {
  // First try: inside box
  for (const d of lastNormalized) {
    if (pt.x >= d.x && pt.x <= d.x + d.width && pt.y >= d.y && pt.y <= d.y + d.height) {
      return d;
    }
  }
  // Else nearest center
  let best = null;
  let bestDist = Infinity;
  for (const d of lastNormalized) {
    const cx = d.x + d.width / 2;
    const cy = d.y + d.height / 2;
    const dx = cx - pt.x;
    const dy = cy - pt.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  // Only accept if reasonably close
  if (best && bestDist < (Math.max(hudCanvas.width, hudCanvas.height) * 0.08) ** 2) return best;
  return null;
}

function cropDetectionFromVideo(det) {
  // We’ll crop from the *rendered cover* view, using an offscreen “screen canvas”
  const rect = hudCanvas.getBoundingClientRect();
  const dpr = hudCanvas.width / rect.width;

  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const cw = rect.width;
  const ch = rect.height;

  // Match object-fit: cover used by the video
  const videoAspect = vw / vh;
  const canvasAspect = cw / ch;

  let drawW, drawH, offsetX, offsetY;
  if (videoAspect > canvasAspect) {
    drawH = ch;
    drawW = ch * videoAspect;
    offsetX = (cw - drawW) / 2;
    offsetY = 0;
  } else {
    drawW = cw;
    drawH = cw / videoAspect;
    offsetX = 0;
    offsetY = (ch - drawH) / 2;
  }

  // Build a screen-sized render of the current video frame (so crop math is easy)
  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = Math.floor(cw * (window.devicePixelRatio || 1));
  screenCanvas.height = Math.floor(ch * (window.devicePixelRatio || 1));
  const sctx = screenCanvas.getContext("2d");

  // Draw video as cover, with mirroring if selfie
  const mirrored = stage.classList.contains("mirror");
  sctx.save();
  if (mirrored) {
    sctx.translate(screenCanvas.width, 0);
    sctx.scale(-1, 1);
  }

  const sx = (offsetX) * (screenCanvas.width / cw);
  const sy = (offsetY) * (screenCanvas.height / ch);
  const sw = (drawW) * (screenCanvas.width / cw);
  const sh = (drawH) * (screenCanvas.height / ch);

  sctx.drawImage(video, sx, sy, sw, sh);
  sctx.restore();

  // Now crop the detection region from HUD canvas coords -> screen canvas coords
  const dx = det.x / dpr;
  const dy = det.y / dpr;
  const dw = det.width / dpr;
  const dh = det.height / dpr;

  const px = Math.floor(dx * (screenCanvas.width / cw));
  const py = Math.floor(dy * (screenCanvas.height / ch));
  const pw = Math.floor(dw * (screenCanvas.width / cw));
  const ph = Math.floor(dh * (screenCanvas.height / ch));

  const crop = document.createElement("canvas");
  // Add a small padding so it feels nicer
  const pad = Math.floor(Math.max(10, Math.min(pw, ph) * 0.08));
  crop.width = Math.max(2, pw + pad * 2);
  crop.height = Math.max(2, ph + pad * 2);

  const cctx = crop.getContext("2d");
  cctx.fillStyle = "rgba(0,0,0,0)";
  cctx.clearRect(0, 0, crop.width, crop.height);

  // Clamp source rect to screen canvas bounds
  const srcX = Math.max(0, px - pad);
  const srcY = Math.max(0, py - pad);
  const srcW = Math.min(screenCanvas.width - srcX, pw + pad * 2);
  const srcH = Math.min(screenCanvas.height - srcY, ph + pad * 2);

  cctx.drawImage(screenCanvas, srcX, srcY, srcW, srcH, 0, 0, crop.width, crop.height);
  return crop;
}

function normalizeDetections(mpDetections) {
  const rect = hudCanvas.getBoundingClientRect();
  const dpr = hudCanvas.width / rect.width;

  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;

  const cw = rect.width;
  const ch = rect.height;

  const videoAspect = vw / vh;
  const canvasAspect = cw / ch;

  let drawW, drawH, offsetX, offsetY;
  if (videoAspect > canvasAspect) {
    drawH = ch;
    drawW = ch * videoAspect;
    offsetX = (cw - drawW) / 2;
    offsetY = 0;
  } else {
    drawW = cw;
    drawH = cw / videoAspect;
    offsetX = 0;
    offsetY = (ch - drawH) / 2;
  }

  const mirrored = stage.classList.contains("mirror");
  const dets = [];
  const detections = mpDetections?.detections || [];

  for (const det of detections) {
    const bb = det.boundingBox;
    if (!bb) continue;

    const label = det.categories?.[0]?.categoryName ?? "object";
    const score = det.categories?.[0]?.score ?? 0;

    // Map from video pixel space -> screen pixel space (cover)
    let x = offsetX + (bb.originX / vw) * drawW;
    let y = offsetY + (bb.originY / vh) * drawH;
    let w = (bb.width / vw) * drawW;
    let h = (bb.height / vh) * drawH;

    if (mirrored) {
      x = (cw - (x + w));
    }

    dets.push({
      x: x * dpr,
      y: y * dpr,
      width: w * dpr,
      height: h * dpr,
      label,
      score
    });
  }

  return dets;
}

function takeSnapshot() {
  if (!hasCameraStream()) return;

  const rect = hudCanvas.getBoundingClientRect();
  const out = document.createElement("canvas");
  out.width = Math.floor(rect.width * (window.devicePixelRatio || 1));
  out.height = Math.floor(rect.height * (window.devicePixelRatio || 1));
  const ctx = out.getContext("2d");

  // Draw video in cover mode
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;

  const cw = out.width;
  const ch = out.height;

  const videoAspect = vw / vh;
  const canvasAspect = cw / ch;

  let drawW, drawH, dx, dy;
  if (videoAspect > canvasAspect) {
    drawH = ch;
    drawW = ch * videoAspect;
    dx = (cw - drawW) / 2;
    dy = 0;
  } else {
    drawW = cw;
    drawH = cw / videoAspect;
    dx = 0;
    dy = (ch - drawH) / 2;
  }

  const mirrored = stage.classList.contains("mirror");

  ctx.save();
  if (mirrored) {
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, dx, dy, drawW, drawH);
  ctx.restore();

  // Draw HUD
  ctx.drawImage(hudCanvas, 0, 0, cw, ch);

  // If hologram is visible, draw it into snapshot (bottom area)
  if (holoPanel.classList.contains("on")) {
    const hp = holoPanel.getBoundingClientRect();
    const x = (hp.left - rect.left) * (out.width / rect.width);
    const y = (hp.top - rect.top) * (out.height / rect.height);
    const w = hp.width * (out.width / rect.width);
    const h = hp.height * (out.height / rect.height);

    // Draw the panel background by a simple translucent rect, then the holo canvas
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x, y, w, h);
    ctx.drawImage(holo.getCanvas(), x, y + 44 * (out.height / rect.height), w, h - 44 * (out.height / rect.height));
  }

  const url = out.toDataURL("image/jpeg", 0.9);
  const wrap = document.createElement("div");
  wrap.className = "shot";
  const img = document.createElement("img");
  img.src = url;
  wrap.appendChild(img);
  gallery.prepend(wrap);

  while (gallery.children.length > 4) gallery.removeChild(gallery.lastChild);
}

async function ensureVisionLoaded() {
  if (vision) return true;
  setStatus("Loading vision model… (first time can take a moment)");
  try {
    vision = await createVision();
    setStatus("Vision online. Turn <b>Scan</b> on, then tap an object for hologram.");
    return true;
  } catch (err) {
    console.error(err);
    setStatus("Vision failed to load. HUD + camera still works (check network/CDN).");
    return false;
  }
}

// Tap on HUD canvas -> if scan is on, tap an object to open hologram
hudCanvas.addEventListener("pointerdown", async (e) => {
  if (!scanOn) return;
  if (!lastNormalized.length) return;

  const pt = canvasPointFromEvent(e);
  const picked = pickDetectionAtPoint(pt);
  if (!picked) return;

  await pingSound();

  const cropCanvas = cropDetectionFromVideo(picked);
  await holo.showFromCrop({
    cropCanvas,
    label: picked.label,
    score: picked.score
  });
}, { passive: true });

btnStart.addEventListener("click", async () => {
  await clickSound();
  try {
    // Default rear camera, not mirrored
    setFacingMode(getFacingMode());
    await startCamera(video, { facingMode: getFacingMode() });
    setMirrorForFacing(getFacingMode());
    setStatus("Camera online. Turn <b>Scan</b> on for detection + tap-to-hologram.");
  } catch (e) {
    console.error(e);
    setStatus("Camera blocked. iPhone Safari needs HTTPS + permission.");
  }
});

btnFlip.addEventListener("click", async () => {
  await clickSound();
  if (!hasCameraStream()) {
    setStatus("Start the camera first.");
    return;
  }
  const next = getFacingMode() === "environment" ? "user" : "environment";
  setFacingMode(next);
  try {
    await startCamera(video, { facingMode: next });
    setMirrorForFacing(next);
    setStatus(`Camera switched: <b>${next}</b>. Scan + tap to open hologram.`);
  } catch (e) {
    console.error(e);
    setStatus("Couldn’t switch camera.");
  }
});

btnScan.addEventListener("click", async () => {
  await pingSound();

  if (!hasCameraStream()) {
    setStatus("Start the camera first.");
    return;
  }

  if (!scanOn) {
    const ok = await ensureVisionLoaded();
    if (!ok) return;
    setScanButton(true);
    setStatus("Scanning… Tap an object to open hologram panel.");
  } else {
    setScanButton(false);
    lastNormalized = [];
    hud.setDetections([], performance.now());
    holo.hide();
    setStatus("Scan paused.");
  }
});

btnSnap.addEventListener("click", async () => {
  await clickSound();
  takeSnapshot();
});

btnClear.addEventListener("click", async () => {
  await clickSound();
  gallery.innerHTML = "";
  lastNormalized = [];
  hud.setDetections([], performance.now());
  holo.hide();
  setStatus("Cleared snapshots + HUD state.");
});

holoClose.addEventListener("click", async () => {
  await clickSound();
  holo.hide();
});

// Main loop
function animate(now) {
  const dt = Math.max(0.001, (now - lastFrame) / 1000);
  lastFrame = now;

  const fps = 1 / dt;
  fpsSmooth = fpsSmooth ? (fpsSmooth * 0.9 + fps * 0.1) : fps;

  // Detection throttle
  if (scanOn && vision && hasCameraStream()) {
    if (now - lastDetectAt >= DETECT_INTERVAL_MS) {
      lastDetectAt = now;
      try {
        const mp = vision.detect(video, now);
        Promise.resolve(mp).then((mpDetections) => {
          lastNormalized = normalizeDetections(mpDetections);
          hud.setDetections(lastNormalized, performance.now());
        });
      } catch (e) {
        console.error(e);
      }
    }
  }

  hud.draw(now, fpsSmooth);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    setScanButton(false);
    lastNormalized = [];
    hud.setDetections([], performance.now());
    holo.hide();
  }
});