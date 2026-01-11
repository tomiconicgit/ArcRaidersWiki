import { startCamera, stopCamera, setFacingMode, getFacingMode, hasCameraStream } from "./camera.js";
import { HUD } from "./hud.js";
import { createVision } from "./vision.js";
import { clickSound, pingSound } from "./sfx.js";

const video = document.getElementById("video");
const canvas = document.getElementById("hud");
const statusText = document.getElementById("statusText");
const hintText = document.getElementById("hintText");

const btnStart = document.getElementById("btnStart");
const btnFlip  = document.getElementById("btnFlip");
const btnScan  = document.getElementById("btnScan");
const btnSnap  = document.getElementById("btnSnap");
const btnClear = document.getElementById("btnClear");
const gallery  = document.getElementById("gallery");

const hud = new HUD(canvas, video);

let vision = null;
let scanOn = false;

let lastFrameTime = performance.now();
let fpsSmoothed = 0;

// Throttle detection so the UI feels smooth even on heavier scenes.
let lastDetectAt = 0;
const DETECT_INTERVAL_MS = 140; // ~7 fps

function setStatus(html) {
  statusText.innerHTML = html;
}

function setHint(html) {
  hintText.innerHTML = html;
}

function setScanButton(on) {
  scanOn = on;
  btnScan.dataset.on = on ? "true" : "false";
  hud.setScanOn(on);
}

function normalizeDetections(mpDetections) {
  // Convert MediaPipe detection coords to canvas coords.
  // MediaPipe returns bounding box in *video pixel* space (not normalized).
  const rect = canvas.getBoundingClientRect();
  const dpr = canvas.width / rect.width;

  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;

  // We display video as cover; need map from video pixels to screen pixels.
  // We'll compute the "cover" scaling similar to CSS object-fit: cover.
  const cw = rect.width;
  const ch = rect.height;

  const videoAspect = vw / vh;
  const canvasAspect = cw / ch;

  let drawW, drawH, offsetX, offsetY;

  if (videoAspect > canvasAspect) {
    // video wider than canvas -> height fits, crop sides
    drawH = ch;
    drawW = ch * videoAspect;
    offsetX = (cw - drawW) / 2;
    offsetY = 0;
  } else {
    // video taller than canvas -> width fits, crop top/bottom
    drawW = cw;
    drawH = cw / videoAspect;
    offsetX = 0;
    offsetY = (ch - drawH) / 2;
  }

  const dets = [];
  const detections = mpDetections?.detections || [];

  for (const det of detections) {
    const bb = det.boundingBox;
    if (!bb) continue;

    const label = det.categories?.[0]?.categoryName ?? "object";
    const score = det.categories?.[0]?.score ?? 0;

    // video pixel -> screen pixel in "cover space"
    let x = offsetX + (bb.originX / vw) * drawW;
    let y = offsetY + (bb.originY / vh) * drawH;
    let w = (bb.width / vw) * drawW;
    let h = (bb.height / vh) * drawH;

    // Handle the CSS mirror we applied to the video (scaleX(-1))
    // If mirrored, flip X in screen space.
    const mirrored = true;
    if (mirrored) {
      x = (cw - (x + w));
    }

    // screen pixel -> canvas pixel (dpr scaled)
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

  const rect = canvas.getBoundingClientRect();
  const snapCanvas = document.createElement("canvas");
  snapCanvas.width = Math.floor(rect.width * (window.devicePixelRatio || 1));
  snapCanvas.height = Math.floor(rect.height * (window.devicePixelRatio || 1));
  const ctx = snapCanvas.getContext("2d");

  // Draw video frame as cover into snapshot
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;

  const cw = snapCanvas.width;
  const ch = snapCanvas.height;

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

  // Mirror to match live view
  ctx.save();
  ctx.translate(cw, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, dx, dy, drawW, drawH);
  ctx.restore();

  // Draw HUD overlay (what’s on screen)
  ctx.drawImage(canvas, 0, 0);

  const url = snapCanvas.toDataURL("image/jpeg", 0.9);
  const wrap = document.createElement("div");
  wrap.className = "shot";
  const img = document.createElement("img");
  img.src = url;
  wrap.appendChild(img);

  gallery.prepend(wrap);

  // Cap gallery items
  while (gallery.children.length > 4) gallery.removeChild(gallery.lastChild);
}

async function ensureVisionLoaded() {
  if (vision) return true;
  setStatus("Loading vision model… (first time can take a moment)");
  try {
    vision = await createVision();
    setStatus("Vision online. Tap <b>Scan</b> to detect objects.");
    return true;
  } catch (err) {
    console.error(err);
    setStatus("Vision failed to load. HUD + camera still works (check network/CDN).");
    return false;
  }
}

btnStart.addEventListener("click", async () => {
  await clickSound();

  try {
    // Start camera (rear by default)
    await startCamera(video, { facingMode: getFacingMode() });
    setStatus("Camera online. Tap <b>Scan</b> for object detection.");
    setHint("Tip: tap anywhere to set a lock point. Use Snapshot to capture.");

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
    setStatus(`Camera switched: <b>${next}</b>`);
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
    setStatus("Scanning… (labels are general: person/chair/etc)");
  } else {
    setScanButton(false);
    hud.setDetections([]);
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
  hud.clearLock();
  hud.setDetections([]);
  setStatus("Cleared snapshots + lock.");
});

function animate(now) {
  const dt = Math.max(0.001, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  // Smooth FPS
  const fps = 1 / dt;
  fpsSmoothed = fpsSmoothed ? (fpsSmoothed * 0.9 + fps * 0.1) : fps;
  hud.setFps(fpsSmoothed);

  // Run detection at a throttled interval
  if (scanOn && vision && hasCameraStream()) {
    if (now - lastDetectAt >= DETECT_INTERVAL_MS) {
      lastDetectAt = now;
      try {
        const mp = vision.detect(video, now);
        Promise.resolve(mp).then((mpDetections) => {
          const dets = normalizeDetections(mpDetections);
          hud.setDetections(dets);
        });
      } catch (e) {
        console.error(e);
      }
    }
  }

  hud.draw(now);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);

// Clean up if page is hidden (optional)
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    setScanButton(false);
    hud.setDetections([]);
  }
});