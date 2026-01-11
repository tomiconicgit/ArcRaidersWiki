import { startCamera as camStart, stopCamera as camStop, captureToCanvas } from "./camera.js";
import { saveSnap, listSnaps, deleteSnap } from "./storage.js";
import { createPanel, setPanelBody, getPanelBody } from "./ui.js";
import { loadVisionModel, isVisionReady, detectFrame, drawDetections, pickDetectionAt } from "./vision.js";
import { initHandGestures, gesturesReady, estimateHand } from "./gestures.js";

const $ = (sel, root = document) => root.querySelector(sel);

const els = {
  app: $("#app"),
  cam: $("#cam"),
  overlay: $("#overlay"),

  hudStatus: $("#hudStatus"),
  hudFps: $("#hudFps"),
  hudHeading: $("#hudHeading"),
  hudPitch: $("#hudPitch"),
  hudGestures: $("#hudGestures"),
  hudZoom: $("#hudZoom"),

  btnStart: $("#btnStart"),
  btnAI: $("#btnAI"),
  btnSnap: $("#btnSnap"),
  btnGallery: $("#btnGallery"),
  btnPanels: $("#btnPanels"),
  btnGest: $("#btnGest"),
  btnAR: $("#btnAR"),
  btnZoomReset: $("#btnZoomReset"),

  sheet: $("#sheet"),
  btnPerms: $("#btnPerms"),
  btnCloseSheet: $("#btnCloseSheet"),
};

const state = {
  cam: {
    stream: null,
    track: null,
    capabilities: {},
    settings: {},
    streaming: false,
    zoomMin: null,
    zoomMax: null,
    zoomCur: null,
  },

  aiOn: false,
  aiLooping: false,
  detections: [],
  aiFps: 0,

  motionOn: false,
  alpha: 0,
  beta: 0,

  gesturesOn: false,

  // gesture interaction state
  cursor: null,             // {xPx,yPx} in CSS pixels
  pinching: false,
  pinch01: 0,
  pinchStartZoom: null,
  pinchStartHudScale: 1,

  grabbedPanel: null,
  grabMode: null, // "drag" | "resize"
  grabOffset: { x: 0, y: 0 },
  resizeStart: { x: 0, y: 0, w: 0, h: 0 },

  lastPointSnapTs: 0,

  // AR overlay toggles
  ar: {
    enabled: true,
    grid: false,
    reticle: true,
    horizon: true,
    cursor: true
  },

  hudScale: 1,
};

boot().catch(console.error);

async function boot() {
  sizeOverlay();
  window.addEventListener("resize", sizeOverlay);

  // Register SW (safe)
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    } catch (e) {
      console.warn("SW register failed:", e);
    }
  }

  els.btnStart?.addEventListener("click", onStartPressed);
  els.btnPerms?.addEventListener("click", grantPermissionsAndStart);
  els.btnCloseSheet?.addEventListener("click", () => hideSheet());

  els.btnAI?.addEventListener("click", toggleAI);
  els.btnSnap?.addEventListener("click", () => snapAt("center"));
  els.btnGallery?.addEventListener("click", openGalleryPanel);
  els.btnPanels?.addEventListener("click", openDashboardPanel);
  els.btnGest?.addEventListener("click", toggleGestures);
  els.btnAR?.addEventListener("click", openARToolsPanel);
  els.btnZoomReset?.addEventListener("click", () => setZoomNormalized(0));

  // Tap on video to snap (ignore taps on UI)
  els.app?.addEventListener("pointerdown", (e) => {
    const isUi = e.target.closest?.(".dock, .panel, .sheet");
    if (isUi) return;
    snapAt({ x: e.clientX, y: e.clientY });
  }, { passive: true });

  setHudStatus("Idle — tap Start");
  setHudFps("--");
  setHudHeading("--");
  setHudPitch("--");
  setHudGestures("Off");
  setHudZoom("--");

  // Render overlay loop (AR tools + AI boxes + gesture cursor)
  requestAnimationFrame(renderLoop);
}

/* ---------- HUD helpers ---------- */
function setHudStatus(t) { if (els.hudStatus) els.hudStatus.textContent = t; }
function setHudFps(t) { if (els.hudFps) els.hudFps.textContent = `AI: ${t} fps`; }
function setHudHeading(deg) { if (els.hudHeading) els.hudHeading.textContent = `Heading: ${deg}°`; }
function setHudPitch(deg) { if (els.hudPitch) els.hudPitch.textContent = `Pitch: ${deg}°`; }
function setHudGestures(t) { if (els.hudGestures) els.hudGestures.textContent = `Gestures: ${t}`; }
function setHudZoom(t) { if (els.hudZoom) els.hudZoom.textContent = `Zoom: ${t}`; }

function showSheet() { els.sheet?.classList.remove("hidden"); }
function hideSheet() { els.sheet?.classList.add("hidden"); }

function sizeOverlay() {
  if (!els.overlay) return;
  const dpr = window.devicePixelRatio || 1;
  els.overlay.width = Math.floor(window.innerWidth * dpr);
  els.overlay.height = Math.floor(window.innerHeight * dpr);
  els.overlay.style.width = "100%";
  els.overlay.style.height = "100%";
}

/* ---------- Start / Permissions ---------- */
async function onStartPressed() {
  if (state.cam.streaming) {
    stopStream();
    els.btnStart.textContent = "Start";
    setHudStatus("Stopped");
    return;
  }
  showSheet();
}

async function grantPermissionsAndStart() {
  hideSheet();

  await startStream();
  els.btnStart.textContent = "Stop";
  setHudStatus("Camera live");

  await enableMotion();

  // Don’t auto-enable gestures (keeps startup fast); user taps Gestures.
  // But we DO show if zoom is supported.
  updateZoomHud();
}

async function startStream() {
  if (state.cam.streaming) return;
  if (!els.cam) throw new Error("Missing #cam element");

  const cam = await camStart(els.cam);
  state.cam.stream = cam.stream;
  state.cam.track = cam.track;
  state.cam.capabilities = cam.capabilities || {};
  state.cam.settings = cam.settings || {};
  state.cam.streaming = true;

  // Zoom support (not guaranteed on iOS)
  const cap = state.cam.capabilities;
  if (cap && typeof cap.zoom === "object") {
    state.cam.zoomMin = cap.zoom.min ?? 1;
    state.cam.zoomMax = cap.zoom.max ?? 1;
    state.cam.zoomCur = state.cam.settings.zoom ?? state.cam.zoomMin ?? 1;
  } else {
    state.cam.zoomMin = null;
    state.cam.zoomMax = null;
    state.cam.zoomCur = null;
  }

  clearOverlay();
}

function stopStream() {
  if (!state.cam.streaming) return;

  camStop(els.cam);
  state.cam.streaming = false;
  state.cam.stream = null;
  state.cam.track = null;
  state.cam.capabilities = {};
  state.cam.settings = {};

  // stop ai
  state.aiOn = false;
  state.detections = [];
  els.btnAI?.classList.remove("on");

  // stop gestures
  state.gesturesOn = false;
  state.cursor = null;
  state.pinching = false;
  state.pinch01 = 0;
  state.grabbedPanel = null;
  setHudGestures("Off");
  els.btnGest?.classList.remove("on");

  clearOverlay();
}

/* ---------- Motion (heading/pitch-ish) ---------- */
async function enableMotion() {
  try {
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== "granted") {
        state.motionOn = false;
        return;
      }
    }
    window.addEventListener("deviceorientation", onDeviceOrientation, { passive: true });
    state.motionOn = true;
  } catch (e) {
    console.warn("Motion permission failed:", e);
    state.motionOn = false;
  }
}

function onDeviceOrientation(ev) {
  state.alpha = ev.alpha ?? 0;
  state.beta = ev.beta ?? 0;
  setHudHeading(Math.round(state.alpha));
  setHudPitch(Math.round(state.beta));
}

/* ---------- Gestures ---------- */
async function toggleGestures() {
  if (!state.cam.streaming) {
    setHudStatus("Start camera first");
    return;
  }

  state.gesturesOn = !state.gesturesOn;
  els.btnGest?.classList.toggle("on", state.gesturesOn);

  if (state.gesturesOn) {
    try {
      setHudGestures("Loading…");
      await initHandGestures((t) => setHudGestures(t.replace("Gestures:", "").trim()));
      setHudGestures("On");
      setHudStatus("Gestures ready");
    } catch (e) {
      console.warn("Gestures failed:", e);
      state.gesturesOn = false;
      els.btnGest?.classList.remove("on");
      setHudGestures("Off");
      setHudStatus("Gestures failed (see console)");
    }
  } else {
    state.cursor = null;
    state.pinching = false;
    state.grabbedPanel = null;
    setHudGestures("Off");
    setHudStatus("Gestures off");
  }
}

/* ---------- AI ---------- */
async function toggleAI() {
  if (!state.cam.streaming) {
    setHudStatus("Start camera first");
    return;
  }

  state.aiOn = !state.aiOn;
  els.btnAI?.classList.toggle("on", state.aiOn);

  if (state.aiOn) {
    setHudStatus("Loading AI…");
    await loadVisionModel((t) => setHudStatus(t));
    setHudStatus("AI Ready");
    if (!state.aiLooping) aiLoop();
  } else {
    state.detections = [];
    setHudStatus("AI Off");
    setHudFps("--");
  }
}

async function aiLoop() {
  if (state.aiLooping) return;
  state.aiLooping = true;

  while (state.aiOn) {
    if (!state.cam.streaming || !isVisionReady()) break;

    const t0 = performance.now();
    const dets = await detectFrame(els.cam, 0.55);
    const t1 = performance.now();

    state.detections = dets;

    const dt = Math.max(1, t1 - t0);
    state.aiFps = Math.round(1000 / dt);
    setHudFps(String(state.aiFps));

    // iPhone-friendly throttle
    await sleep(140);
  }

  state.aiLooping = false;
}

/* ---------- AR Tools Panel ---------- */
function openARToolsPanel() {
  const html = `
    <div class="kv"><small>AR Overlay</small><div>${state.ar.enabled ? "On" : "Off"}</div></div>
    <div class="grid" style="margin-top:10px;">
      <button class="dockBtn" id="arEnable">${state.ar.enabled ? "Overlay Off" : "Overlay On"}</button>
      <button class="dockBtn" id="arRet">${state.ar.reticle ? "Reticle On" : "Reticle Off"}</button>
      <button class="dockBtn" id="arHor">${state.ar.horizon ? "Horizon On" : "Horizon Off"}</button>
      <button class="dockBtn" id="arGrid">${state.ar.grid ? "Grid On" : "Grid Off"}</button>
      <button class="dockBtn" id="arCur">${state.ar.cursor ? "Cursor On" : "Cursor Off"}</button>
      <button class="dockBtn" id="hudScale">HUD Scale: ${state.hudScale.toFixed(2)}x</button>
    </div>
    <div class="notice" style="margin-top:10px;">
      Gestures: pinch on a panel header to move it, pinch near bottom-right to resize. <br/>
      Pinch in empty space = zoom (camera if supported, otherwise HUD scale).
    </div>
  `;

  const panel = createPanel({
    title: "AR Tools",
    x: 12,
    y: 120,
    w: Math.min(360, Math.floor(window.innerWidth * 0.92)),
    h: Math.min(420, Math.floor(window.innerHeight * 0.56)),
    bodyHTML: html
  });

  els.app.appendChild(panel);
  clampPanelIntoView(panel);

  const body = getPanelBody(panel);

  $("#arEnable", body)?.addEventListener("click", () => {
    state.ar.enabled = !state.ar.enabled;
    panel.remove();
    openARToolsPanel();
  });
  $("#arRet", body)?.addEventListener("click", () => {
    state.ar.reticle = !state.ar.reticle;
    panel.remove();
    openARToolsPanel();
  });
  $("#arHor", body)?.addEventListener("click", () => {
    state.ar.horizon = !state.ar.horizon;
    panel.remove();
    openARToolsPanel();
  });
  $("#arGrid", body)?.addEventListener("click", () => {
    state.ar.grid = !state.ar.grid;
    panel.remove();
    openARToolsPanel();
  });
  $("#arCur", body)?.addEventListener("click", () => {
    state.ar.cursor = !state.ar.cursor;
    panel.remove();
    openARToolsPanel();
  });
  $("#hudScale", body)?.addEventListener("click", () => {
    state.hudScale = clamp(state.hudScale + 0.1, 0.8, 1.5);
    applyHudScale();
    panel.remove();
    openARToolsPanel();
  });
}

function applyHudScale() {
  document.documentElement.style.setProperty("--hudScale", String(state.hudScale));
}

/* ---------- Snap / Inspect ---------- */
async function snapAt(where) {
  if (!state.cam.streaming) {
    setHudStatus("Start camera first");
    return;
  }

  const full = captureToCanvas(els.cam, document.createElement("canvas"));
  const vw = full.width, vh = full.height;

  const rect = els.cam.getBoundingClientRect();
  let sx = rect.left + rect.width / 2;
  let sy = rect.top + rect.height / 2;

  if (where && typeof where === "object") {
    sx = where.x;
    sy = where.y;
  }

  // AI-aware pick nearest detection (if AI on)
  let picked = null;
  if (state.aiOn && state.detections?.length) {
    const ox = (sx / window.innerWidth) * els.overlay.width;
    const oy = (sy / window.innerHeight) * els.overlay.height;
    picked = pickDetectionAt(ox, oy, state.detections, els.overlay, els.cam);
  }

  // map screen -> video coords
  const nx = (sx - rect.left) / rect.width;
  const ny = (sy - rect.top) / rect.height;
  const cx = Math.round(nx * vw);
  const cy = Math.round(ny * vh);

  const base = Math.min(vw, vh);
  const size = picked?.det ? Math.round(base * 0.24) : Math.round(base * 0.28);

  const x0 = clamp(cx - Math.floor(size / 2), 0, vw - size);
  const y0 = clamp(cy - Math.floor(size / 2), 0, vh - size);

  const crop = document.createElement("canvas");
  crop.width = 900;
  crop.height = 900;
  const ctx = crop.getContext("2d");
  ctx.drawImage(full, x0, y0, size, size, 0, 0, crop.width, crop.height);

  const dataUrl = crop.toDataURL("image/jpeg", 0.92);
  const meta = picked?.det ? { label: picked.det.class, score: picked.det.score } : null;
  const saved = await saveSnap({ dataUrl, meta });

  openInspectPanel(saved);
  setHudStatus(meta?.label ? `Snapped: ${meta.label}` : "Snapped");
}

function openInspectPanel(snap) {
  const label = snap.meta?.label ? `${snap.meta.label} (${Math.round((snap.meta.score || 0) * 100)}%)` : "—";

  const panel = createPanel({
    title: "Inspect",
    x: 12,
    y: 120,
    w: Math.min(360, Math.floor(window.innerWidth * 0.92)),
    h: Math.min(520, Math.floor(window.innerHeight * 0.56)),
    bodyHTML: `
      <div class="thumb" style="aspect-ratio: 1/1; margin-bottom:10px;">
        <img src="${snap.dataUrl}" alt="inspect"/>
      </div>
      <div class="kv"><small>Detected</small><div>${label}</div></div>
      <div class="grid" style="margin-top:10px;">
        <a class="dockBtn" href="${snap.dataUrl}" download="snapshot.jpg"
           style="text-decoration:none; display:flex; align-items:center; justify-content:center;">
          Download
        </a>
        <button class="dockBtn" id="delSnap">Delete</button>
      </div>
      <div class="notice" style="margin-top:10px;">
        Gestures: pinch panel header to move. Pinch bottom-right to resize. Pinch empty space to zoom.
      </div>
    `
  });

  els.app.appendChild(panel);
  clampPanelIntoView(panel);

  const body = getPanelBody(panel);
  $("#delSnap", body)?.addEventListener("click", async () => {
    await deleteSnap(snap.id);
    panel.remove();
    setHudStatus("Deleted");
  });
}

/* ---------- Panels ---------- */
function openDashboardPanel() {
  const html = `
    <div class="kv"><small>Camera</small><div>${state.cam.streaming ? "Live" : "Off"}</div></div>
    <div class="kv"><small>AI</small><div>${state.aiOn ? "On" : "Off"}</div></div>
    <div class="kv"><small>Motion</small><div>${state.motionOn ? "On" : "Off"}</div></div>
    <div class="kv"><small>Gestures</small><div>${state.gesturesOn ? "On" : "Off"}</div></div>

    <div class="grid" style="margin-top:10px;">
      <button class="dockBtn" id="pAI">${state.aiOn ? "AI Off" : "AI On"}</button>
      <button class="dockBtn" id="pGallery">Gallery</button>
      <button class="dockBtn" id="pSnap">Snap</button>
      <button class="dockBtn" id="pGest">${state.gesturesOn ? "Gestures Off" : "Gestures On"}</button>
    </div>

    <div class="notice" style="margin-top:10px;">
      If gestures don’t start, ensure you’re on HTTPS (GitHub Pages) and refresh after updating service worker cache.
    </div>
  `;

  const panel = createPanel({
    title: "Dashboard",
    x: 12,
    y: 110,
    w: Math.min(360, Math.floor(window.innerWidth * 0.92)),
    h: Math.min(360, Math.floor(window.innerHeight * 0.46)),
    bodyHTML: html
  });

  els.app.appendChild(panel);
  clampPanelIntoView(panel);

  const body = getPanelBody(panel);
  $("#pAI", body)?.addEventListener("click", () => toggleAI());
  $("#pGallery", body)?.addEventListener("click", () => openGalleryPanel());
  $("#pSnap", body)?.addEventListener("click", () => snapAt("center"));
  $("#pGest", body)?.addEventListener("click", () => toggleGestures());
}

async function openGalleryPanel() {
  const panel = createPanel({
    title: "Gallery",
    x: 12,
    y: 240,
    w: Math.min(360, Math.floor(window.innerWidth * 0.92)),
    h: Math.min(460, Math.floor(window.innerHeight * 0.56)),
    bodyHTML: `<div class="notice">Loading…</div>`
  });

  els.app.appendChild(panel);
  clampPanelIntoView(panel);

  const snaps = await listSnaps(60);

  if (!snaps.length) {
    setPanelBody(panel, `<div class="notice">No snapshots yet. Tap the camera or press Snap.</div>`);
    return;
  }

  const thumbs = snaps.map(s => `
    <div class="thumb" data-id="${s.id}">
      <img src="${s.dataUrl}" alt="snap"/>
    </div>
  `).join("");

  setPanelBody(panel, `
    <div class="gallery">${thumbs}</div>
    <div style="margin-top:10px" class="notice">Tap a shot to inspect.</div>
  `);

  const body = getPanelBody(panel);
  body.querySelectorAll(".thumb").forEach(el => {
    el.addEventListener("click", async () => {
      const id = el.getAttribute("data-id");
      const all = await listSnaps(60);
      const snap = all.find(x => x.id === id);
      if (snap) openInspectPanel(snap);
    });
  });
}

/* ---------- Overlay render loop ---------- */
function renderLoop(ts) {
  const ctx = els.overlay.getContext("2d");
  const W = els.overlay.width;
  const H = els.overlay.height;

  // clear once per frame
  ctx.clearRect(0, 0, W, H);

  // update gestures (throttled) and cursor
  if (state.gesturesOn && gesturesReady() && state.cam.streaming) {
    // throttle to ~12fps
    if (!renderLoop._lastHand || (ts - renderLoop._lastHand) > 80) {
      renderLoop._lastHand = ts;
      const g = estimateHand(els.cam, ts);

      if (g.ok) {
        const p = normToScreen(g.xN, g.yN);
        state.cursor = p;
        state.pinch01 = g.pinch01;

        // pinch state transitions
        const wasPinching = state.pinching;
        state.pinching = g.pinching;

        if (!wasPinching && state.pinching) onPinchStart(p.x, p.y);
        if (state.pinching) onPinchMove(p.x, p.y);
        if (wasPinching && !state.pinching) onPinchEnd();

        setHudGestures(g.pinching ? `On (pinch ${Math.round(g.pinch01 * 100)}%)` : "On");
      } else {
        state.cursor = null;
        if (state.pinching) {
          state.pinching = false;
          onPinchEnd();
        }
        setHudGestures("On (no hand)");
      }
    }
  }

  // AR overlay
  if (state.ar.enabled) {
    drawAR(ctx, W, H);
  }

  // AI boxes
  if (state.aiOn && state.detections?.length) {
    drawDetections(ctx, els.overlay, state.detections, els.cam);
  }

  // cursor overlay
  if (state.ar.enabled && state.ar.cursor && state.cursor) {
    drawCursor(ctx, W, H, state.cursor.x, state.cursor.y, state.pinching, state.pinch01);
  }

  requestAnimationFrame(renderLoop);
}

/* ---------- Pinch interactions ---------- */
function onPinchStart(x, y) {
  // try grab a panel header
  const panel = document.elementFromPoint(x, y)?.closest(".panel");
  if (panel) {
    const header = panel.querySelector(".panelHeader");
    if (header) {
      const hr = header.getBoundingClientRect();
      const inHeader = x >= hr.left && x <= hr.right && y >= hr.top && y <= hr.bottom;
      if (inHeader) {
        state.grabbedPanel = panel;

        const pr = panel.getBoundingClientRect();
        const nearBR = (x > pr.right - 60) && (y > pr.bottom - 60);
        state.grabMode = nearBR ? "resize" : "drag";
        panel.style.zIndex = String(nextZ());

        if (state.grabMode === "drag") {
          state.grabOffset.x = x - pr.left;
          state.grabOffset.y = y - pr.top;
        } else {
          state.resizeStart.x = x;
          state.resizeStart.y = y;
          state.resizeStart.w = pr.width;
          state.resizeStart.h = pr.height;
        }
        return;
      }
    }
  }

  // no panel grabbed => pinch = zoom control
  state.pinchStartZoom = state.cam.zoomCur;
  state.pinchStartHudScale = state.hudScale;
}

function onPinchMove(x, y) {
  // panel drag/resize
  const p = state.grabbedPanel;
  if (p) {
    if (state.grabMode === "drag") {
      const w = p.offsetWidth;
      const h = p.offsetHeight;

      const left = clamp(x - state.grabOffset.x, 8, window.innerWidth - w - 8);
      const top = clamp(y - state.grabOffset.y, 8, window.innerHeight - h - 90);
      p.style.left = `${left}px`;
      p.style.top = `${top}px`;
    } else if (state.grabMode === "resize") {
      const dx = x - state.resizeStart.x;
      const dy = y - state.resizeStart.y;

      const newW = clamp(state.resizeStart.w + dx, 220, Math.min(0.96 * window.innerWidth, 520));
      const newH = clamp(state.resizeStart.h + dy, 200, Math.min(0.62 * window.innerHeight, 620));
      p.style.width = `${newW}px`;
      p.style.height = `${newH}px`;
    }
    return;
  }

  // zoom control if supported, otherwise HUD scale fallback
  if (state.cam.zoomMin != null && state.cam.zoomMax != null) {
    // pinch01: 0 open -> 1 strong pinch
    // map pinch strength to zoom smoothly
    const t = state.pinch01; // 0..1
    const zoom = lerp(state.cam.zoomMin, state.cam.zoomMax, t);
    setZoomAbsolute(zoom);
  } else {
    // fallback: scale HUD a bit
    const t = state.pinch01; // 0..1
    state.hudScale = clamp(lerp(0.9, 1.35, t), 0.8, 1.5);
    applyHudScale();
    updateZoomHud();
  }
}

function onPinchEnd() {
  state.grabbedPanel = null;
  state.grabMode = null;
  state.pinchStartZoom = null;
}

/* ---------- Zoom helpers ---------- */
function updateZoomHud() {
  if (state.cam.zoomCur != null) {
    setHudZoom(`${state.cam.zoomCur.toFixed(2)}x`);
  } else {
    setHudZoom(`HUD ${state.hudScale.toFixed(2)}x`);
  }
}

function setZoomNormalized(t01) {
  if (state.cam.zoomMin == null || state.cam.zoomMax == null) {
    state.hudScale = 1;
    applyHudScale();
    updateZoomHud();
    return;
  }
  const z = lerp(state.cam.zoomMin, state.cam.zoomMax, clamp(t01, 0, 1));
  setZoomAbsolute(z);
}

async function setZoomAbsolute(z) {
  const track = state.cam.track;
  if (!track?.applyConstraints) return;

  const zMin = state.cam.zoomMin ?? z;
  const zMax = state.cam.zoomMax ?? z;
  const next = clamp(z, zMin, zMax);

  try {
    await track.applyConstraints({ advanced: [{ zoom: next }] });
    state.cam.zoomCur = next;
    updateZoomHud();
  } catch (e) {
    // If iOS refuses zoom constraints, fallback to HUD scale
    state.cam.zoomMin = null;
    state.cam.zoomMax = null;
    state.cam.zoomCur = null;

    state.hudScale = 1;
    applyHudScale();
    updateZoomHud();
  }
}

/* ---------- Mapping + AR drawing ---------- */
function normToScreen(xN, yN) {
  // Map normalized camera coordinates to screen space with object-fit: cover style
  // We map into overlay canvas first (device px), then divide by DPR to get CSS px.
  const dpr = window.devicePixelRatio || 1;
  const W = els.overlay.width;
  const H = els.overlay.height;

  const vw = els.cam.videoWidth || 1280;
  const vh = els.cam.videoHeight || 720;

  const scale = Math.max(W / vw, H / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const offsetX = (W - drawW) / 2;
  const offsetY = (H - drawH) / 2;

  const xPx = (offsetX + (xN * vw) * scale) / dpr;
  const yPx = (offsetY + (yN * vh) * scale) / dpr;

  return { x: xPx, y: yPx };
}

function drawAR(ctx, W, H) {
  // Subtle overlay styling
  ctx.save();

  // reticle
  if (state.ar.reticle) {
    const cx = W / 2;
    const cy = H / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - 60, cy); ctx.lineTo(cx - 18, cy);
    ctx.moveTo(cx + 18, cy); ctx.lineTo(cx + 60, cy);
    ctx.moveTo(cx, cy - 60); ctx.lineTo(cx, cy - 18);
    ctx.moveTo(cx, cy + 18); ctx.lineTo(cx, cy + 60);
    ctx.stroke();
  }

  // grid
  if (state.ar.grid) {
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    const step = Math.floor(Math.min(W, H) / 6);
    for (let x = step; x < W; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = step; y < H; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  // horizon / level (uses pitch beta)
  if (state.ar.horizon && state.motionOn) {
    const pitch = clamp(state.beta, -90, 90); // degrees
    const cy = H / 2;
    const y = cy + (pitch * (H / 400)); // tuned drift

    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(W * 0.12, y);
    ctx.lineTo(W * 0.88, y);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "12px -apple-system, system-ui, Segoe UI, Roboto, Arial";
    ctx.fillText(`LEVEL ${Math.round(pitch)}°`, W * 0.12, Math.max(0, y - 18));
  }

  ctx.restore();
}

function drawCursor(ctx, W, H, xCss, yCss, pinching, pinch01) {
  const dpr = window.devicePixelRatio || 1;
  const x = xCss * dpr;
  const y = yCss * dpr;

  ctx.save();

  ctx.strokeStyle = pinching ? "rgba(68,255,175,0.85)" : "rgba(255,255,255,0.45)";
  ctx.fillStyle = pinching ? "rgba(68,255,175,0.18)" : "rgba(255,255,255,0.12)";
  ctx.lineWidth = 3;

  const r = pinching ? 18 - pinch01 * 6 : 18;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/* ---------- Overlay ---------- */
function clearOverlay() {
  if (!els.overlay) return;
  const ctx = els.overlay.getContext("2d");
  ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
}

/* ---------- utilities ---------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

let _z = 30;
function nextZ() { _z += 1; return _z; }

function clampPanelIntoView(panel) {
  const r = panel.getBoundingClientRect();
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;

  const left = clamp(r.left, 8, window.innerWidth - w - 8);
  const top = clamp(r.top, 8, window.innerHeight - h - 90);

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}