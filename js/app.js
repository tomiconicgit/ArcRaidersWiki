import { startCamera as camStart, stopCamera as camStop, captureToCanvas } from "./camera.js";
import { saveSnap, listSnaps, deleteSnap } from "./storage.js";
import { createPanel, setPanelBody, getPanelBody } from "./ui.js";
import {
  loadVisionModel, isVisionReady, detectFrame, drawDetections,
  pickDetectionAt, normPointToScreen
} from "./vision.js";
import { createGestureTracker } from "./gestures.js";

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
  hudSelect: $("#hudSelect"),

  btnStart: $("#btnStart"),
  btnAI: $("#btnAI"),
  btnGestures: $("#btnGestures"),
  btnSnap: $("#btnSnap"),
  btnGallery: $("#btnGallery"),
  btnPanels: $("#btnPanels"),

  sheet: $("#sheet"),
  btnPerms: $("#btnPerms"),
  btnCloseSheet: $("#btnCloseSheet"),
};

const state = {
  stream: null,
  streaming: false,

  aiOn: false,
  aiLooping: false,
  detections: [],
  aiFps: 0,

  motionOn: false,
  alpha: 0,
  beta: 0,

  gesturesOn: false,
  gestureTracker: null,

  // gesture cursor + selection
  cursor: null,            // { sx, sy } in overlay device pixels
  selectedIndex: -1,
  selectedLabel: "—",

  // panel manipulation via pinch
  grabbedPanel: null,
  grabMode: null, // "drag" | "resize"
  grabOffset: { x: 0, y: 0 },
  resizeStart: { x: 0, y: 0, w: 0, h: 0 },

  lastPointSnapTs: 0,
};

boot().catch(console.error);

async function boot() {
  sizeOverlay();
  window.addEventListener("resize", sizeOverlay);

  // Service worker register (safe)
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js", { scope: "./" }); }
    catch (e) { console.warn("SW register failed:", e); }
  }

  els.btnStart?.addEventListener("click", onStartPressed);
  els.btnPerms?.addEventListener("click", grantPermissionsAndStart);
  els.btnCloseSheet?.addEventListener("click", () => hideSheet());

  els.btnAI?.addEventListener("click", toggleAI);
  els.btnGestures?.addEventListener("click", toggleGestures);

  els.btnSnap?.addEventListener("click", () => snapAt("center"));
  els.btnGallery?.addEventListener("click", openGalleryPanel);
  els.btnPanels?.addEventListener("click", openDashboardPanel);

  // Tap to snap (finger, not hand-gesture)
  els.cam?.addEventListener("pointerdown", (e) => snapAt({ x: e.clientX, y: e.clientY }));

  setHudStatus("Idle — tap Start");
  setHudFps("--");
  setHudHeading("--");
  setHudPitch("--");
  setHudGestures("Off");
  setHudSelect("—");
}

/* ---------- HUD helpers ---------- */
function setHudStatus(t) { if (els.hudStatus) els.hudStatus.textContent = t; }
function setHudFps(t) { if (els.hudFps) els.hudFps.textContent = `AI: ${t} fps`; }
function setHudHeading(deg) { if (els.hudHeading) els.hudHeading.textContent = `Heading: ${deg}°`; }
function setHudPitch(deg) { if (els.hudPitch) els.hudPitch.textContent = `Pitch: ${deg}°`; }
function setHudGestures(t) { if (els.hudGestures) els.hudGestures.textContent = `Gestures: ${t}`; }
function setHudSelect(t) { if (els.hudSelect) els.hudSelect.textContent = `Selected: ${t}`; }

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
  if (state.streaming) {
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
  await enableMotion(); // optional
}

async function startStream() {
  if (state.streaming) return;
  if (!els.cam) throw new Error("Missing #cam element");
  state.stream = await camStart(els.cam);
  state.streaming = true;
  clearOverlay();
}

function stopStream() {
  if (!state.streaming) return;

  camStop(els.cam);
  state.streaming = false;
  state.stream = null;

  // stop ai
  state.aiOn = false;
  state.detections = [];
  state.selectedIndex = -1;
  state.selectedLabel = "—";
  setHudSelect("—");
  els.btnAI.textContent = "AI: Off";
  els.btnAI.classList.remove("on");
  setHudFps("--");

  // stop gestures
  if (state.gestureTracker) {
    state.gestureTracker.stop();
    state.gestureTracker = null;
  }
  state.gesturesOn = false;
  setHudGestures("Off");
  els.btnGestures.classList.remove("on");

  state.cursor = null;
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

/* ---------- Gestures (Google Tasks Vision) ---------- */
async function toggleGestures() {
  if (!state.streaming) {
    setHudStatus("Start camera first");
    return;
  }

  if (state.gesturesOn) {
    disableGestures();
    return;
  }
  await enableGestures();
}

async function enableGestures() {
  if (!state.streaming || state.gesturesOn) return;

  try {
    setHudGestures("Loading…");
    state.gestureTracker = await createGestureTracker(els.cam, handleGesture);
    state.gesturesOn = true;
    setHudGestures("On");
    els.btnGestures.classList.add("on");
    setHudStatus("Gestures ready");
  } catch (e) {
    console.warn("Gestures failed:", e);
    state.gesturesOn = false;
    setHudGestures("Off");
    els.btnGestures.classList.remove("on");
    setHudStatus("Gestures failed (try reload + good light)");
  }
}

function disableGestures() {
  if (state.gestureTracker) {
    state.gestureTracker.stop();
    state.gestureTracker = null;
  }
  state.gesturesOn = false;
  setHudGestures("Off");
  els.btnGestures.classList.remove("on");
  state.cursor = null;

  // redraw (keep AI boxes but remove cursor highlight)
  if (state.aiOn) {
    drawDetections(els.overlay, state.detections, els.cam, { selectedIndex: state.selectedIndex, cursor: null });
  } else {
    clearOverlay();
  }
}

/* --- Gesture logic: cursor selects nearest detection, pinch snaps --- */
function handleGesture(g) {
  if (!state.streaming) return;

  // Convert normalized (video) to overlay screen coords (device pixels)
  if (g.type === "cursor" && typeof g.x === "number" && typeof g.y === "number") {
    const { sx, sy } = normPointToScreen(g.x, g.y, els.overlay, els.cam);
    state.cursor = { sx, sy };

    if (state.aiOn && state.detections.length) {
      updateSelectionFromCursor();
    }

    // redraw overlay when AI on (so cursor is visible)
    if (state.aiOn) {
      drawDetections(els.overlay, state.detections, els.cam, { selectedIndex: state.selectedIndex, cursor: state.cursor });
    }
    return;
  }

  // Pinch: panel drag/resize OR snap selected detection
  if (g.type === "pinchStart") {
    if (!state.cursor) return;

    const css = deviceToCss(state.cursor.sx, state.cursor.sy);
    const hitPanel = document.elementFromPoint(css.x, css.y)?.closest(".panel");

    if (hitPanel) {
      beginPanelGrab(hitPanel, css.x, css.y);
      return;
    }

    // If not grabbing panel: pinch snaps selected object (requires AI)
    if (state.aiOn && state.selectedIndex >= 0) {
      snapSelected();
    }
    return;
  }

  if (g.type === "pinchMove") {
    if (!state.grabbedPanel || !state.cursor) return;
    const css = deviceToCss(state.cursor.sx, state.cursor.sy);
    updatePanelGrab(css.x, css.y);
    return;
  }

  if (g.type === "pinchEnd") {
    endPanelGrab();
    return;
  }

  // Optional point to snap (throttled)
  if (g.type === "point") {
    const now = performance.now();
    if (now - state.lastPointSnapTs < 900) return;
    state.lastPointSnapTs = now;

    if (!state.aiOn) return; // keep it clean: point works with selection/AI
    if (state.selectedIndex >= 0) snapSelected();
  }
}

function updateSelectionFromCursor() {
  if (!state.cursor || !state.detections.length) {
    state.selectedIndex = -1;
    state.selectedLabel = "—";
    setHudSelect("—");
    return;
  }

  const best = pickDetectionAt(state.cursor.sx, state.cursor.sy, state.detections, els.overlay, els.cam);
  if (!best) {
    state.selectedIndex = -1;
    state.selectedLabel = "—";
    setHudSelect("—");
    return;
  }

  // Require cursor to be “near enough” to avoid random selecting across the screen
  const dpr = window.devicePixelRatio || 1;
  const maxDist = (140 * dpr) ** 2;
  const dx = state.cursor.sx - best.rect.cx;
  const dy = state.cursor.sy - best.rect.cy;
  const dist2 = dx*dx + dy*dy;

  if (dist2 > maxDist) {
    state.selectedIndex = -1;
    state.selectedLabel = "—";
    setHudSelect("—");
    return;
  }

  state.selectedIndex = best.index;
  const label = best.det?.class || "—";
  state.selectedLabel = label;
  setHudSelect(label);
}

async function snapSelected() {
  if (state.selectedIndex < 0) return;
  const det = state.detections[state.selectedIndex];
  if (!det) return;

  // Snap at the center of the selected box in CSS pixels
  const rect = detCenterCss(det);
  await snapAt({ x: rect.x, y: rect.y });
}

/* ---------- AI ---------- */
async function toggleAI() {
  if (!state.streaming) {
    setHudStatus("Start camera first");
    return;
  }

  state.aiOn = !state.aiOn;
  els.btnAI.textContent = state.aiOn ? "AI: On" : "AI: Off";
  els.btnAI.classList.toggle("on", state.aiOn);

  if (state.aiOn) {
    setHudStatus("Loading AI…");
    await loadVisionModel((t) => setHudStatus(t));
    setHudStatus("AI Ready");
    if (!state.aiLooping) aiLoop();
  } else {
    state.detections = [];
    state.selectedIndex = -1;
    state.selectedLabel = "—";
    setHudSelect("—");
    clearOverlay();
    setHudStatus("AI Off");
    setHudFps("--");
  }
}

async function aiLoop() {
  if (state.aiLooping) return;
  state.aiLooping = true;

  while (state.aiOn) {
    if (!state.streaming || !isVisionReady()) break;

    const t0 = performance.now();
    const dets = await detectFrame(els.cam, 0.55);
    const t1 = performance.now();

    state.detections = dets;

    const dt = Math.max(1, t1 - t0);
    state.aiFps = Math.round(1000 / dt);
    setHudFps(String(state.aiFps));

    // Keep selection sane
    if (state.selectedIndex >= dets.length) {
      state.selectedIndex = -1;
      state.selectedLabel = "—";
      setHudSelect("—");
    }

    drawDetections(els.overlay, dets, els.cam, {
      selectedIndex: state.selectedIndex,
      cursor: state.gesturesOn ? state.cursor : null
    });

    await sleep(140);
  }

  state.aiLooping = false;
}

/* ---------- Snap / Inspect ---------- */
async function snapAt(where) {
  if (!state.streaming) {
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

  // map screen -> video coords
  const nx = (sx - rect.left) / rect.width;
  const ny = (sy - rect.top) / rect.height;
  const cx = Math.round(nx * vw);
  const cy = Math.round(ny * vh);

  const base = Math.min(vw, vh);
  const size = Math.round(base * 0.26);

  const x0 = clamp(cx - Math.floor(size / 2), 0, vw - size);
  const y0 = clamp(cy - Math.floor(size / 2), 0, vh - size);

  const crop = document.createElement("canvas");
  crop.width = 900;
  crop.height = 900;
  const ctx = crop.getContext("2d");
  ctx.drawImage(full, x0, y0, size, size, 0, 0, crop.width, crop.height);

  const dataUrl = crop.toDataURL("image/jpeg", 0.92);

  const meta = (state.selectedIndex >= 0 && state.detections[state.selectedIndex])
    ? { label: state.detections[state.selectedIndex].class, score: state.detections[state.selectedIndex].score }
    : null;

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
        Hand mode: move your finger cursor to select a box → pinch to snap it.
        Pinch on panel header to move. Pinch near bottom-right to resize.
      </div>
    `
  });

  els.app.appendChild(panel);

  const body = getPanelBody(panel);
  $("#delSnap", body)?.addEventListener("click", async () => {
    await deleteSnap(snap.id);
    panel.remove();
    setHudStatus("Deleted");
  });

  clampPanelIntoView(panel);
}

/* ---------- Panels ---------- */
function openDashboardPanel() {
  const html = `
    <div class="kv"><small>Camera</small><div>${state.streaming ? "Live" : "Off"}</div></div>
    <div class="kv"><small>AI</small><div>${state.aiOn ? "On" : "Off"}</div></div>
    <div class="kv"><small>Motion</small><div>${state.motionOn ? "On" : "Off"}</div></div>
    <div class="kv"><small>Gestures</small><div>${state.gesturesOn ? "On" : "Off"}</div></div>

    <div class="grid" style="margin-top:10px;">
      <button class="dockBtn" id="pAI">${state.aiOn ? "AI Off" : "AI On"}</button>
      <button class="dockBtn" id="pGest">${state.gesturesOn ? "Gestures Off" : "Gestures On"}</button>
      <button class="dockBtn" id="pGallery">Gallery</button>
      <button class="dockBtn" id="pSnap">Snap</button>
    </div>

    <div class="notice" style="margin-top:10px;">
      Best workflow: Start → AI On → Gestures On → move finger to highlight → pinch to snap.
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
  $("#pGest", body)?.addEventListener("click", () => toggleGestures());
  $("#pGallery", body)?.addEventListener("click", () => openGalleryPanel());
  $("#pSnap", body)?.addEventListener("click", () => snapAt("center"));
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
    setPanelBody(panel, `<div class="notice">No snapshots yet. Tap Snap or pinch-snap a selected object.</div>`);
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

/* ---------- Panel pinch-drag/resize helpers ---------- */
function beginPanelGrab(panel, cssX, cssY) {
  state.grabbedPanel = panel;

  const pr = panel.getBoundingClientRect();
  const nearBR = (cssX > pr.right - 60) && (cssY > pr.bottom - 60);
  state.grabMode = nearBR ? "resize" : "drag";

  panel.style.zIndex = String(nextZ());

  if (state.grabMode === "drag") {
    state.grabOffset.x = cssX - pr.left;
    state.grabOffset.y = cssY - pr.top;
  } else {
    state.resizeStart.x = cssX;
    state.resizeStart.y = cssY;
    state.resizeStart.w = pr.width;
    state.resizeStart.h = pr.height;
  }
}

function updatePanelGrab(cssX, cssY) {
  const p = state.grabbedPanel;
  if (!p) return;

  if (state.grabMode === "drag") {
    const w = p.offsetWidth;
    const h = p.offsetHeight;

    const left = clamp(cssX - state.grabOffset.x, 8, window.innerWidth - w - 8);
    const top = clamp(cssY - state.grabOffset.y, 8, window.innerHeight - h - 90);
    p.style.left = `${left}px`;
    p.style.top = `${top}px`;
  } else {
    const dx = cssX - state.resizeStart.x;
    const dy = cssY - state.resizeStart.y;

    const newW = clamp(state.resizeStart.w + dx, 220, Math.min(0.96 * window.innerWidth, 520));
    const newH = clamp(state.resizeStart.h + dy, 200, Math.min(0.62 * window.innerHeight, 620));
    p.style.width = `${newW}px`;
    p.style.height = `${newH}px`;
  }
}

function endPanelGrab() {
  state.grabbedPanel = null;
  state.grabMode = null;
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

// Convert overlay device pixels -> CSS pixels
function deviceToCss(dx, dy) {
  const dpr = window.devicePixelRatio || 1;
  return { x: dx / dpr, y: dy / dpr };
}

// Center of detection in CSS pixels (for snapping)
function detCenterCss(det) {
  // Use bbox in video coords -> screen mapping via overlay transform helper
  const { sx, sy } = normPointToScreen(
    (det.bbox[0] + det.bbox[2] / 2) / (els.cam.videoWidth || 1280),
    (det.bbox[1] + det.bbox[3] / 2) / (els.cam.videoHeight || 720),
    els.overlay, els.cam
  );
  return deviceToCss(sx, sy);
}