/**
 * app.js - Pocket Vision HUD (GitHub Pages / iPhone Safari)
 * - Camera AR-style overlay (getUserMedia)
 * - Draggable / resizable widgets (dashboard tools)
 * - Tap-to-inspect snapshot: crops around tap point + magnifies into viewer
 * - Device orientation parallax (when permitted)
 */

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  stream: null,
  videoTrack: null,
  isStreaming: false,
  torchOn: false,
  facingMode: "environment",
  zoom: 1,
  maxZoom: 1,
  minZoom: 1,
  focusSupported: false,
  orientation: { beta: 0, gamma: 0, alpha: 0 },
  orientationPermitted: false,
};

init().catch(console.error);

async function init() {
  // Service worker
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    } catch (e) {
      console.warn("SW registration failed:", e);
    }
  }

  wireUI();
  await warmStartCamera();
  await tryEnableOrientation();
  updateStatus("Ready");
}

function wireUI() {
  // Buttons
  $("#btnCamera")?.addEventListener("click", () => toggleCamera());
  $("#btnFlip")?.addEventListener("click", () => flipCamera());
  $("#btnTorch")?.addEventListener("click", () => toggleTorch());
  $("#btnSnapshot")?.addEventListener("click", () => snapshotCenterInspect());
  $("#btnAddWidget")?.addEventListener("click", () => addWidgetMenu());

  // Slider controls
  $("#zoom")?.addEventListener("input", (e) => setZoom(Number(e.target.value)));

  // Tap on viewport => inspect snapshot around tap
  const viewport = $("#viewport");
  viewport?.addEventListener("pointerdown", onViewportPointerDown, { passive: false });

  // Make widgets draggable/resizable
  enableWidgetInteractions($("#hud"));

  // Clock widget ticks
  setInterval(() => {
    const el = $("#clockValue");
    if (!el) return;
    const d = new Date();
    el.textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, 500);

  // Demo stats updating
  setInterval(() => {
    const users = $("#statUsers");
    const fps = $("#statFps");
    if (users) users.textContent = `${(9800 + Math.floor(Math.random() * 2000)).toLocaleString()} / day`;
    if (fps) fps.textContent = `${(55 + Math.floor(Math.random() * 5))} fps`;
  }, 1200);
}

async function warmStartCamera() {
  // Try to start camera immediately (user gesture sometimes required on iOS; if fails, user presses button)
  try {
    await startCamera();
  } catch (e) {
    updateStatus("Tap “Camera” to start");
  }
}

async function toggleCamera() {
  if (state.isStreaming) {
    stopCamera();
    updateStatus("Camera stopped");
  } else {
    await startCamera();
    updateStatus("Camera live");
  }
}

async function startCamera() {
  stopCamera();

  // iOS Safari: best to request ideal constraints and then check capabilities
  const constraints = {
    audio: false,
    video: {
      facingMode: state.facingMode,
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  state.stream = stream;
  state.isStreaming = true;

  const video = $("#camera");
  video.srcObject = stream;

  // iOS needs play() after a user gesture sometimes; try anyway
  await video.play().catch(() => {});

  const [track] = stream.getVideoTracks();
  state.videoTrack = track;

  // Capabilities: zoom/torch/focus
  const caps = (track.getCapabilities && track.getCapabilities()) || {};
  state.minZoom = caps.zoom?.min ?? 1;
  state.maxZoom = caps.zoom?.max ?? 1;
  state.zoom = clamp(state.zoom, state.minZoom, state.maxZoom);

  state.focusSupported = !!caps.focusMode || !!caps.focusDistance;

  const zoomSlider = $("#zoom");
  if (zoomSlider) {
    zoomSlider.min = String(state.minZoom);
    zoomSlider.max = String(state.maxZoom);
    zoomSlider.step = String(caps.zoom?.step ?? 0.1);
    zoomSlider.value = String(state.zoom);
    zoomSlider.disabled = !(caps.zoom);
  }

  // HUD hint
  $("#hint")?.classList.add("fade");

  // Apply zoom initial
  if (caps.zoom) await applyTrackConstraints({ advanced: [{ zoom: state.zoom }] });

  // Torch button availability
  const torchSupported = !!caps.torch;
  $("#btnTorch")?.toggleAttribute("disabled", !torchSupported);
  $("#btnTorch")?.classList.toggle("disabled", !torchSupported);

  // A little “boot” sound
  softClick();
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
  }
  state.stream = null;
  state.videoTrack = null;
  state.isStreaming = false;
  state.torchOn = false;

  const video = $("#camera");
  if (video) video.srcObject = null;
}

async function flipCamera() {
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  if (state.isStreaming) {
    await startCamera();
    updateStatus(`Switched to ${state.facingMode}`);
  }
}

async function setZoom(z) {
  state.zoom = z;
  const track = state.videoTrack;
  if (!track) return;
  const caps = track.getCapabilities?.() || {};
  if (!caps.zoom) return;
  await applyTrackConstraints({ advanced: [{ zoom: state.zoom }] });
  $("#zoomValue")?.textContent = `${state.zoom.toFixed(1)}×`;
}

async function toggleTorch() {
  const track = state.videoTrack;
  if (!track) return;
  const caps = track.getCapabilities?.() || {};
  if (!caps.torch) return;

  state.torchOn = !state.torchOn;
  await applyTrackConstraints({ advanced: [{ torch: state.torchOn }] });
  updateStatus(state.torchOn ? "Torch ON" : "Torch OFF");
  softClick();
}

async function applyTrackConstraints(constraints) {
  try {
    await state.videoTrack.applyConstraints(constraints);
  } catch (e) {
    console.warn("applyConstraints failed:", e);
  }
}

/** Tap-to-inspect */
let tapStart = null;

function onViewportPointerDown(e) {
  // Prevent scroll/zoom gestures interfering
  e.preventDefault();

  tapStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  const viewport = $("#viewport");
  viewport.setPointerCapture(e.pointerId);

  const move = (ev) => {
    // If user drags, ignore (widgets handle their own drag)
  };

  const up = async (ev) => {
    viewport.releasePointerCapture(ev.pointerId);
    viewport.removeEventListener("pointermove", move);
    viewport.removeEventListener("pointerup", up);

    const dt = performance.now() - tapStart.t;
    const dx = Math.abs(ev.clientX - tapStart.x);
    const dy = Math.abs(ev.clientY - tapStart.y);

    // Treat as tap
    if (dt < 350 && dx < 12 && dy < 12) {
      await inspectAt(ev.clientX, ev.clientY);
    }
  };

  viewport.addEventListener("pointermove", move);
  viewport.addEventListener("pointerup", up);
}

async function inspectAt(clientX, clientY) {
  if (!state.isStreaming) {
    updateStatus("Start camera first");
    return;
  }

  const viewport = $("#viewport");
  const rect = viewport.getBoundingClientRect();

  const x = (clientX - rect.left) / rect.width;   // 0..1
  const y = (clientY - rect.top) / rect.height;   // 0..1

  // Visual ping reticle
  spawnReticle(clientX - rect.left, clientY - rect.top);

  // Grab current frame into canvas and crop around tap
  const video = $("#camera");
  const full = frameToCanvas(video);
  if (!full) return;

  // Crop box size based on zoom slider; higher zoom => smaller crop => more magnification
  const cropSize = Math.round(full.width * clamp(0.25 / (state.zoom || 1), 0.08, 0.25));
  const cx = Math.round(x * full.width);
  const cy = Math.round(y * full.height);

  const sx = clamp(cx - Math.floor(cropSize / 2), 0, full.width - cropSize);
  const sy = clamp(cy - Math.floor(cropSize / 2), 0, full.height - cropSize);

  const crop = document.createElement("canvas");
  crop.width = 640;
  crop.height = 640;
  const ctx = crop.getContext("2d");

  // Draw cropped region scaled up
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(full, sx, sy, cropSize, cropSize, 0, 0, crop.width, crop.height);

  // Show in viewer
  showInspectViewer(crop.toDataURL("image/jpeg", 0.92));
  softClick();
  updateStatus("Inspect snapshot");
}

function snapshotCenterInspect() {
  const viewport = $("#viewport");
  const rect = viewport.getBoundingClientRect();
  inspectAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function frameToCanvas(videoEl) {
  if (!videoEl || videoEl.readyState < 2) return null;
  const c = document.createElement("canvas");
  // Use the actual video resolution when possible
  c.width = videoEl.videoWidth || 1280;
  c.height = videoEl.videoHeight || 720;
  const ctx = c.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, c.width, c.height);
  return c;
}

/** Viewer widget for inspect snapshots */
function showInspectViewer(dataUrl) {
  const viewer = $("#inspectViewer");
  const img = $("#inspectImg");
  if (!viewer || !img) return;

  img.src = dataUrl;
  viewer.classList.add("show");

  $("#btnCloseInspect")?.addEventListener("click", () => {
    viewer.classList.remove("show");
    softClick();
  }, { once: true });

  $("#btnSaveInspect")?.addEventListener("click", () => {
    // iOS Safari: trigger download via anchor (works best in standalone, may open new tab)
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `inspect_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    updateStatus("Saved image");
    softClick();
  }, { once: true });
}

/** HUD widgets */
function addWidgetMenu() {
  const panel = $("#widgetPicker");
  if (!panel) return;
  panel.classList.toggle("show");
  softClick();
}

window.addEventListener("click", (e) => {
  // Click outside picker closes it
  const picker = $("#widgetPicker");
  if (!picker) return;
  if (!picker.classList.contains("show")) return;
  if (picker.contains(e.target) || e.target?.id === "btnAddWidget") return;
  picker.classList.remove("show");
});

window.addEventListener("DOMContentLoaded", () => {
  // Widget picker buttons (if you included them in HTML)
  document.querySelectorAll("[data-add-widget]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-add-widget");
      spawnWidget(type);
      $("#widgetPicker")?.classList.remove("show");
      softClick();
    });
  });
});

function spawnWidget(type) {
  const hud = $("#hud");
  if (!hud) return;

  const w = document.createElement("div");
  w.className = "widget glass";
  w.setAttribute("data-widget", type);

  const header = document.createElement("div");
  header.className = "widgetHeader";
  header.innerHTML = `
    <div class="widgetTitle">${titleFor(type)}</div>
    <button class="widgetClose" aria-label="Close">✕</button>
  `;
  w.appendChild(header);

  const body = document.createElement("div");
  body.className = "widgetBody";
  body.appendChild(renderWidgetBody(type));
  w.appendChild(body);

  // default position
  w.style.left = `${20 + Math.floor(Math.random() * 40)}px`;
  w.style.top = `${120 + Math.floor(Math.random() * 80)}px`;
  w.style.width = "260px";
  w.style.height = "190px";

  hud.appendChild(w);

  // close
  header.querySelector(".widgetClose")?.addEventListener("click", () => {
    w.remove();
    softClick();
  });

  // enable interactions
  enableWidgetInteractions(w);

  updateStatus(`Added ${titleFor(type)}`);
}

function titleFor(type) {
  switch (type) {
    case "photos": return "Photo Viewer";
    case "notes": return "Quick Notes";
    case "compass": return "Compass";
    case "stats": return "Live Stats";
    default: return "Widget";
  }
}

function renderWidgetBody(type) {
  const wrap = document.createElement("div");
  wrap.className = "widgetInner";

  if (type === "photos") {
    wrap.innerHTML = `
      <div class="row">
        <button class="pill" id="btnPickPhoto">Import photo</button>
        <button class="pill" id="btnClearPhoto">Clear</button>
      </div>
      <div class="photoFrame">
        <img id="photoPreview" alt="Preview" />
      </div>
    `;
    // Wire
    queueMicrotask(() => {
      const pick = $("#btnPickPhoto", wrap);
      const clear = $("#btnClearPhoto", wrap);
      const img = $("#photoPreview", wrap);

      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";

      pick?.addEventListener("click", () => input.click());
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        img.src = url;
        updateStatus("Photo loaded");
        softClick();
      });

      clear?.addEventListener("click", () => {
        img.src = "";
        softClick();
      });
    });
    return wrap;
  }

  if (type === "notes") {
    wrap.innerHTML = `
      <textarea class="notes" placeholder="Type quick notes..."></textarea>
      <div class="row">
        <button class="pill" id="btnSaveNote">Save</button>
        <button class="pill" id="btnLoadNote">Load</button>
        <button class="pill" id="btnClearNote">Clear</button>
      </div>
      <div class="tiny muted">Saved locally on this device.</div>
    `;
    queueMicrotask(() => {
      const ta = $("textarea", wrap);
      $("#btnSaveNote", wrap)?.addEventListener("click", () => {
        localStorage.setItem("pvh_note", ta.value || "");
        updateStatus("Note saved");
        softClick();
      });
      $("#btnLoadNote", wrap)?.addEventListener("click", () => {
        ta.value = localStorage.getItem("pvh_note") || "";
        updateStatus("Note loaded");
        softClick();
      });
      $("#btnClearNote", wrap)?.addEventListener("click", () => {
        ta.value = "";
        softClick();
      });
    });
    return wrap;
  }

  if (type === "compass") {
    wrap.innerHTML = `
      <div class="compass">
        <div class="compassRing" id="compassRing">
          <div class="compassNeedle"></div>
        </div>
        <div class="row">
          <div class="muted tiny">iOS may require motion permission.</div>
        </div>
      </div>
    `;
    // Basic compass using alpha orientation if available
    queueMicrotask(() => {
      const ring = $("#compassRing", wrap);
      if (!ring) return;
      setInterval(() => {
        const a = state.orientation.alpha || 0;
        ring.style.transform = `rotate(${-a}deg)`;
      }, 60);
    });
    return wrap;
  }

  if (type === "stats") {
    wrap.innerHTML = `
      <div class="kpis">
        <div class="kpi">
          <div class="kpiLabel">Users</div>
          <div class="kpiValue" id="kUsers">—</div>
        </div>
        <div class="kpi">
          <div class="kpiLabel">Motion</div>
          <div class="kpiValue" id="kMotion">—</div>
        </div>
        <div class="kpi">
          <div class="kpiLabel">Zoom</div>
          <div class="kpiValue" id="kZoom">—</div>
        </div>
      </div>
    `;
    queueMicrotask(() => {
      const ku = $("#kUsers", wrap);
      const km = $("#kMotion", wrap);
      const kz = $("#kZoom", wrap);
      setInterval(() => {
        if (ku) ku.textContent = `${(9000 + Math.floor(Math.random() * 3000)).toLocaleString()}`;
        if (km) km.textContent = state.orientationPermitted ? "ON" : "OFF";
        if (kz) kz.textContent = `${(state.zoom || 1).toFixed(1)}×`;
      }, 500);
    });
    return wrap;
  }

  wrap.textContent = "Widget body";
  return wrap;
}

/** Widget drag + resize */
function enableWidgetInteractions(rootEl) {
  if (!rootEl) return;

  rootEl.querySelectorAll(".widget").forEach(setupWidgetInteractions);
  if (rootEl.classList?.contains("widget")) setupWidgetInteractions(rootEl);
}

function setupWidgetInteractions(widget) {
  if (widget.__wired) return;
  widget.__wired = true;

  const header = widget.querySelector(".widgetHeader");
  if (header) {
    header.style.touchAction = "none";
    header.addEventListener("pointerdown", (e) => dragStart(e, widget));
  }

  // Add resize handle if not present
  if (!widget.querySelector(".resizeHandle")) {
    const handle = document.createElement("div");
    handle.className = "resizeHandle";
    handle.title = "Resize";
    handle.style.touchAction = "none";
    handle.addEventListener("pointerdown", (e) => resizeStart(e, widget));
    widget.appendChild(handle);
  }
}

function dragStart(e, widget) {
  e.preventDefault();
  widget.setPointerCapture(e.pointerId);

  const start = {
    x: e.clientX,
    y: e.clientY,
    left: parseFloat(widget.style.left || "0"),
    top: parseFloat(widget.style.top || "0"),
  };

  const move = (ev) => {
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    widget.style.left = `${start.left + dx}px`;
    widget.style.top = `${start.top + dy}px`;
  };

  const up = (ev) => {
    widget.releasePointerCapture(ev.pointerId);
    widget.removeEventListener("pointermove", move);
    widget.removeEventListener("pointerup", up);
  };

  widget.addEventListener("pointermove", move);
  widget.addEventListener("pointerup", up);
}

function resizeStart(e, widget) {
  e.preventDefault();
  widget.setPointerCapture(e.pointerId);

  const start = {
    x: e.clientX,
    y: e.clientY,
    w: widget.getBoundingClientRect().width,
    h: widget.getBoundingClientRect().height,
  };

  const move = (ev) => {
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    widget.style.width = `${clamp(start.w + dx, 180, 420)}px`;
    widget.style.height = `${clamp(start.h + dy, 140, 520)}px`;
  };

  const up = (ev) => {
    widget.releasePointerCapture(ev.pointerId);
    widget.removeEventListener("pointermove", move);
    widget.removeEventListener("pointerup", up);
  };

  widget.addEventListener("pointermove", move);
  widget.addEventListener("pointerup", up);
}

/** Orientation / “spatial” parallax */
async function tryEnableOrientation() {
  // iOS requires explicit permission from user gesture sometimes.
  // We try passive first; if blocked, show a button in UI if you have it.
  const btn = $("#btnMotion");
  if (btn) btn.addEventListener("click", requestOrientationPermission);

  // try without prompt
  attachOrientationListener();
}

async function requestOrientationPermission() {
  try {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const res = await DeviceMotionEvent.requestPermission();
      state.orientationPermitted = (res === "granted");
      if (state.orientationPermitted) {
        attachOrientationListener(true);
        updateStatus("Motion enabled");
      } else {
        updateStatus("Motion denied");
      }
      softClick();
      return;
    }

    // Non-iOS or already allowed
    state.orientationPermitted = true;
    attachOrientationListener(true);
    updateStatus("Motion enabled");
    softClick();
  } catch (e) {
    console.warn("Motion permission error:", e);
    updateStatus("Motion not available");
  }
}

function attachOrientationListener(force = false) {
  if (!("DeviceOrientationEvent" in window)) return;

  // If iOS blocked it, values will remain null; user can press btnMotion to request permission.
  window.addEventListener("deviceorientation", (ev) => {
    const { alpha, beta, gamma } = ev;
    if (alpha == null && beta == null && gamma == null) return;

    state.orientation.alpha = alpha || 0;
    state.orientation.beta = beta || 0;
    state.orientation.gamma = gamma || 0;

    // Apply subtle parallax to HUD (feels more “spatial”)
    const hud = $("#hud");
    if (hud) {
      const tx = clamp((state.orientation.gamma / 45) * 10, -10, 10);
      const ty = clamp((state.orientation.beta / 45) * 10, -10, 10);
      hud.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    }

    if (force) state.orientationPermitted = true;
  }, { passive: true });
}

/** Reticle ping */
function spawnReticle(x, y) {
  const overlay = $("#overlay");
  if (!overlay) return;

  const r = document.createElement("div");
  r.className = "reticle";
  r.style.left = `${x}px`;
  r.style.top = `${y}px`;
  overlay.appendChild(r);

  setTimeout(() => r.remove(), 650);
}

/** UI helpers */
function updateStatus(text) {
  const el = $("#status");
  if (el) el.textContent = text;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** Tiny click sound (no external files) */
function softClick() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.03;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.03);
    setTimeout(() => ctx.close(), 80);
  } catch {}
}