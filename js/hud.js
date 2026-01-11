function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function lerp(a, b, t) { return a + (b - a) * t; }

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });

    this.scanOn = false;

    // Raw detections for click logic
    this.detections = [];

    // Animated label states
    // key -> {x,y,w,h,label,score,firstSeen,lastSeen}
    this.labelStates = new Map();

    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize, { passive: true });
    this._resize();
  }

  destroy() {
    window.removeEventListener("resize", this._resize);
  }

  setScanOn(on) { this.scanOn = on; }

  setDetections(dets, now) {
    this.detections = dets || [];

    // Update label animation memory
    const seenKeys = new Set();

    for (const d of this.detections) {
      const key = this._keyFor(d);
      seenKeys.add(key);

      const existing = this.labelStates.get(key);
      if (existing) {
        // Smooth position a bit to reduce jitter
        existing.x = lerp(existing.x, d.x, 0.35);
        existing.y = lerp(existing.y, d.y, 0.35);
        existing.w = lerp(existing.w, d.width, 0.35);
        existing.h = lerp(existing.h, d.height, 0.35);
        existing.score = lerp(existing.score, d.score, 0.25);
        existing.label = d.label;
        existing.lastSeen = now;
      } else {
        this.labelStates.set(key, {
          x: d.x, y: d.y, w: d.width, h: d.height,
          label: d.label, score: d.score,
          firstSeen: now,
          lastSeen: now
        });
      }
    }

    // Let old labels fade out; don’t delete immediately
    // (deleted during draw when fully faded).
  }

  getDetections() { return this.detections; }

  _resize() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
  }

  _cornerBrackets(ctx, w, h) {
    const m = 18;
    const len = Math.min(w, h) * 0.075;

    ctx.strokeStyle = "rgba(0,255,220,0.35)";
    ctx.lineWidth = 2;

    const corners = [
      [m, m, 1, 1],
      [w - m, m, -1, 1],
      [m, h - m, 1, -1],
      [w - m, h - m, -1, -1],
    ];

    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len * sx, y);
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + len * sy);
      ctx.stroke();
    }
  }

  draw(now, fps) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Very subtle frame brackets (immersive but not noisy)
    this._cornerBrackets(ctx, w, h);

    // Telemetry (tiny, clean)
    ctx.globalAlpha = 0.55;
    ctx.font = `${Math.floor(h * 0.015)}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = "rgba(0,255,220,0.85)";
    ctx.fillText(`SCAN ${this.scanOn ? "ON" : "OFF"}`, 16, h - 18);
    if (typeof fps === "number") ctx.fillText(`${fps.toFixed(0)} FPS`, 120, h - 18);
    ctx.globalAlpha = 1;

    if (!this.scanOn) {
      // Don’t draw boxes when scan is off
      return;
    }

    // Draw animated detections
    for (const [key, s] of this.labelStates.entries()) {
      const age = now - s.firstSeen;
      const sinceSeen = now - s.lastSeen;

      // Animation curve:
      // - fade in quickly
      // - hold while being seen
      // - fade out after not seen for a bit
      const fadeIn = clamp01(age / 160);
      const fadeOut = clamp01((sinceSeen - 250) / 240); // start fading after 250ms unseen
      const a = clamp01(fadeIn * (1 - fadeOut));

      if (a <= 0.02 && sinceSeen > 700) {
        this.labelStates.delete(key);
        continue;
      }

      // Small “pop” scale on appear
      const pop = 1 + 0.06 * (1 - clamp01(age / 220));

      this._drawDetection(ctx, s, a, pop);
    }
  }

  _drawDetection(ctx, s, alpha, scale) {
    const x = s.x, y = s.y, w = s.w, h = s.h;

    // Box (thin, crisp)
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(0,255,220,0.75)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Label plate
    const label = (s.label || "object").toUpperCase();
    const score = Math.round((s.score || 0) * 100);
    const text = `${label}  ${score}%`;

    ctx.font = `800 14px ui-sans-serif, system-ui, -apple-system`;
    const padX = 10;
    const padY = 7;
    const tw = ctx.measureText(text).width;
    const plateW = tw + padX * 2;
    const plateH = 28;

    const px = x;
    const py = Math.max(0, y - plateH - 6);

    // Animate plate scale from center
    const cx = px + plateW / 2;
    const cy = py + plateH / 2;

    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    // Glass plate
    ctx.fillStyle = "rgba(0,0,0,0.52)";
    ctx.strokeStyle = "rgba(0,255,220,0.22)";
    ctx.lineWidth = 1;

    this._roundRect(ctx, px, py, plateW, plateH, 10);
    ctx.fill();
    ctx.stroke();

    // Accent notch
    ctx.fillStyle = "rgba(0,255,220,0.55)";
    ctx.fillRect(px, py + plateH - 2, Math.min(plateW, 78), 2);

    // Text
    ctx.fillStyle = "rgba(240,255,255,0.95)";
    ctx.fillText(text, px + padX, py + 19);

    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  _keyFor(d) {
    // Stable-ish key (label + quantized center)
    const cx = Math.round((d.x + d.width / 2) / 28);
    const cy = Math.round((d.y + d.height / 2) / 28);
    return `${d.label}|${cx}|${cy}`;
  }
}