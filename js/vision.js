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

function coverTransform(overlayCanvas, videoEl) {
  const W = overlayCanvas.width;
  const H = overlayCanvas.height;

  const vw = videoEl.videoWidth || 1280;
  const vh = videoEl.videoHeight || 720;

  const scale = Math.max(W / vw, H / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const offsetX = (W - drawW) / 2;
  const offsetY = (H - drawH) / 2;

  return { W, H, vw, vh, scale, offsetX, offsetY };
}

export function normPointToScreen(xn, yn, overlayCanvas, videoEl) {
  const t = coverTransform(overlayCanvas, videoEl);
  const sx = t.offsetX + (xn * t.vw) * t.scale;
  const sy = t.offsetY + (yn * t.vh) * t.scale;
  return { sx, sy, t };
}

export function detToScreenRect(det, overlayCanvas, videoEl) {
  const t = coverTransform(overlayCanvas, videoEl);
  const [x, y, w, h] = det.bbox;

  const sx = t.offsetX + x * t.scale;
  const sy = t.offsetY + y * t.scale;
  const sw = w * t.scale;
  const sh = h * t.scale;

  return { sx, sy, sw, sh, cx: sx + sw/2, cy: sy + sh/2, t };
}

export function drawDetections(overlayCanvas, detections, videoEl, opts = {}) {
  const ctx = overlayCanvas.getContext("2d");
  const { W, H } = coverTransform(overlayCanvas, videoEl);

  ctx.clearRect(0, 0, W, H);

  ctx.lineWidth = 2;
  ctx.font = "12px -apple-system, system-ui, Segoe UI, Roboto, Arial";
  ctx.textBaseline = "top";

  for (let i = 0; i < detections.length; i++) {
    const d = detections[i];
    const r = detToScreenRect(d, overlayCanvas, videoEl);

    const label = `${d.class} ${(d.score * 100).toFixed(0)}%`;
    const pad = 6;
    const tw = ctx.measureText(label).width + pad * 2;

    const isSelected = (opts.selectedIndex === i);

    ctx.strokeStyle = isSelected ? "rgba(255,255,255,0.95)" : "rgba(68,255,175,0.85)";
    ctx.fillStyle = isSelected ? "rgba(255,255,255,0.10)" : "rgba(68,255,175,0.12)";

    roundRect(ctx, r.sx, r.sy, r.sw, r.sh, 12);
    ctx.fill();
    ctx.stroke();

    // Label pill
    ctx.fillStyle = isSelected ? "rgba(255,255,255,0.18)" : "rgba(15,19,27,0.72)";
    roundRect(ctx, r.sx, Math.max(0, r.sy - 22), tw, 20, 10);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(label, r.sx + pad, Math.max(0, r.sy - 20) + 3);
  }

  // Cursor dot
  if (opts.cursor) {
    const { sx, sy } = opts.cursor;
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(sx, sy, 12, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.stroke();
  }
}

export function pickDetectionAt(screenX, screenY, detections, overlayCanvas, videoEl) {
  let best = null;
  let bestDist = Infinity;

  for (let i = 0; i < detections.length; i++) {
    const d = detections[i];
    const r = detToScreenRect(d, overlayCanvas, videoEl);

    const inside = screenX >= r.sx && screenX <= r.sx + r.sw && screenY >= r.sy && screenY <= r.sy + r.sh;
    if (inside) return { index: i, det: d, rect: r };

    const dist = (screenX - r.cx) ** 2 + (screenY - r.cy) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = { index: i, det: d, rect: r };
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