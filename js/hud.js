export class HUD {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.video = video;

    this.lock = null; // {x,y} in canvas coords
    this.detections = [];
    this.scanOn = false;
    this.lastFps = 0;

    this._resize = this._resize.bind(this);
    this._onTap = this._onTap.bind(this);

    window.addEventListener("resize", this._resize, { passive: true });
    canvas.addEventListener("pointerdown", this._onTap, { passive: true });

    this._resize();
  }

  destroy() {
    window.removeEventListener("resize", this._resize);
    this.canvas.removeEventListener("pointerdown", this._onTap);
  }

  setScanOn(on) { this.scanOn = on; }
  setDetections(dets) { this.detections = dets || []; }
  setFps(fps) { this.lastFps = fps; }

  clearLock() { this.lock = null; }

  _onTap(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);
    this.lock = { x, y, t: performance.now() };
  }

  _resize() {
    // Match device pixels for crisp HUD
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
  }

  draw(now) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Subtle scanlines
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "rgba(0,255,220,1)";
    const spacing = Math.max(10, Math.floor(h / 90));
    for (let y = 0; y < h; y += spacing) ctx.fillRect(0, y, w, 1);
    ctx.globalAlpha = 1;

    // Corner brackets
    this._cornerBrackets(ctx, w, h);

    // Center reticle
    this._reticle(ctx, w * 0.5, h * 0.5, Math.min(w, h) * 0.06);

    // Lock point
    if (this.lock) {
      const pulse = 0.5 + 0.5 * Math.sin((now - this.lock.t) / 120);
      this._reticle(ctx, this.lock.x, this.lock.y, 26 + pulse * 10);
      ctx.globalAlpha = 0.85;
      ctx.font = `${Math.floor(h * 0.018)}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = "rgba(0,255,220,0.95)";
      ctx.fillText("LOCK", this.lock.x + 18, this.lock.y - 14);
      ctx.globalAlpha = 1;
    }

    // Detections
    if (this.scanOn && this.detections?.length) {
      for (const d of this.detections) this._drawDetection(ctx, d);
    }

    // Telemetry
    ctx.globalAlpha = 0.75;
    ctx.font = `${Math.floor(h * 0.016)}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = "rgba(0,255,220,0.9)";
    ctx.fillText(`SCAN: ${this.scanOn ? "ON" : "OFF"}`, 16, h - 42);
    ctx.fillText(`FPS: ${this.lastFps.toFixed(1)}`, 16, h - 18);
    ctx.globalAlpha = 1;
  }

  _cornerBrackets(ctx, w, h) {
    const m = 18;
    const len = Math.min(w, h) * 0.08;

    ctx.strokeStyle = "rgba(0,255,220,0.55)";
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

  _reticle(ctx, x, y, r) {
    ctx.strokeStyle = "rgba(0,255,220,0.85)";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - r - 10, y);
    ctx.lineTo(x - r + 6, y);
    ctx.moveTo(x + r - 6, y);
    ctx.lineTo(x + r + 10, y);
    ctx.moveTo(x, y - r - 10);
    ctx.lineTo(x, y - r + 6);
    ctx.moveTo(x, y + r - 6);
    ctx.lineTo(x, y + r + 10);
    ctx.stroke();
  }

  _drawDetection(ctx, d) {
    const { x, y, width, height, label, score } = d;

    // Box
    ctx.strokeStyle = "rgba(0,255,220,0.85)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);

    // Label plate
    const text = `${label} ${(score * 100).toFixed(0)}%`;
    ctx.font = `14px ui-monospace, Menlo, monospace`;

    const pad = 6;
    const tw = ctx.measureText(text).width;
    const plateH = 22;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x, Math.max(0, y - plateH), tw + pad * 2, plateH);

    ctx.fillStyle = "rgba(0,255,220,0.95)";
    ctx.fillText(text, x + pad, Math.max(16, y - 7));
  }
}