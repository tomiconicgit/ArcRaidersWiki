let model = null;
let tfReady = false;

export async function loadVisionModel(setStatus = () => {}) {
  if (model) return model;

  setStatus("Loading AI…");

  const tf = await import("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.21.0/dist/tf.min.js");
  await tf.ready();

  const cocoSsd = await import("https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js");
  model = await cocoSsd.load();

  tfReady = true;
  setStatus("AI Ready");
  return model;
}

export function isVisionReady() {
  return !!model && tfReady;
}

export async function detectFrame(videoEl, minScore = 0.55) {
  if (!model) return [];
  const preds = await model.detect(videoEl);
  return preds.filter(p => (p.score ?? 0) >= minScore);
}

export function drawDetections(overlayCanvas, detections, videoEl) {
  const ctx = overlayCanvas.getContext("2d");
  const W = overlayCanvas.width;
  const H = overlayCanvas.height;

  ctx.clearRect(0, 0, W, H);

  const vw = videoEl.videoWidth || 1280;
  const vh = videoEl.videoHeight || 720;

  const scale = Math.max(W / vw, H / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const offsetX = (W - drawW) / 2;
  const offsetY = (H - drawH) / 2;

  ctx.lineWidth = 2;
  ctx.font = "12px -apple-system, system-ui, Segoe UI, Roboto, Arial";
  ctx.textBaseline = "top";

  for (const d of detections) {
    const [x, y, w, h] = d.bbox;

    const sx = offsetX + x * scale;
    const sy = offsetY + y * scale;
    const sw = w * scale;
    const sh = h * scale;

    const label = `${d.class} ${(d.score * 100).toFixed(0)}%`;
    const pad = 6;
    const tw = ctx.measureText(label).width + pad * 2;

    ctx.strokeStyle = "rgba(68,255,175,0.85)";
    ctx.fillStyle = "rgba(68,255,175,0.12)";
    roundRect(ctx, sx, sy, sw, sh, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "rgba(15,19,27,0.72)";
    roundRect(ctx, sx, Math.max(0, sy - 22), tw, 20, 10);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(label, sx + pad, Math.max(0, sy - 20) + 3);
  }
}

export function pickDetectionAt(screenX, screenY, detections, overlayCanvas, videoEl) {
  const W = overlayCanvas.width;
  const H = overlayCanvas.height;

  const vw = videoEl.videoWidth || 1280;
  const vh = videoEl.videoHeight || 720;

  const scale = Math.max(W / vw, H / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const offsetX = (W - drawW) / 2;
  const offsetY = (H - drawH) / 2;

  let best = null;
  let bestDist = Infinity;

  for (const d of detections) {
    const [x, y, w, h] = d.bbox;

    const sx = offsetX + x * scale;
    const sy = offsetY + y * scale;
    const sw = w * scale;
    const sh = h * scale;

    const inside = screenX >= sx && screenX <= sx + sw && screenY >= sy && screenY <= sy + sh;
    if (inside) return { det: d, rect: { sx, sy, sw, sh } };

    const cx = sx + sw / 2;
    const cy = sy + sh / 2;
    const dist = (screenX - cx) ** 2 + (screenY - cy) ** 2;

    if (dist < bestDist) {
      bestDist = dist;
      best = { det: d, rect: { sx, sy, sw, sh } };
    }
  }

  return best;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}