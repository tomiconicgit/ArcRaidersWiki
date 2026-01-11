import { startCamera as camStart, stopCamera as camStop, captureToCanvas } from "./camera.js";
import { saveSnap, listSnaps, deleteSnap } from "./storage.js";
import { createPanel, setPanelBody, getPanelBody } from "./ui.js";
import {
  loadVisionModel, isVisionReady, detectFrame, drawDetections,
  pickDetectionAt, normPointToScreen, detToScreenRect
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
  hudMode: $("#hudMode"),

  btnStart: $("#btnStart"),
  btnAI: $("#btnAI"),
  btnGestures: $("#btnGestures"),
  btnSnap: $("#btnSnap"),
  btnGallery: $("#btnGallery"),
  btnPanels: $("#btnPanels"),

  sheet: $("#sheet"),
  btnPerms: $("#btnPerms"),
  btnCloseSheet: $("#btnCloseSheet"),

  toolWheel: $("#toolWheel")
};

const state = {
  stream: null,
  streaming: false,

  aiOn: false,
  aiLooping: false,
  detections: [],
  aiFps: 0,

  // freeze mode locks last detections so you can interact calmly
  frozen: false,
  frozenDetections: [],

  motionOn: false,
  alpha: 0,
  beta: 0,

  gesturesOn: false,
  gestureTracker: null,

  cursor: null,            // { sx, sy } overlay device pixels
  selectedIndex: -1,
  selectedLabel: "—",

  // panel pinch manipulation
  grabbedPanel: null,
  grabMode: null,
  grabOffset: { x: 0, y: 0 },
  resizeStart: { x: 0, y: 0, w: 0, h: 0 },

  // wheel state
  wheelOpen: false,
  wheelHotTool: null,
  lastPalmTs: 0,
  lastPointSnapTs: 0
};

boot().catch(console.error);

async function boot() {
  sizeOverlay();
  window.addEventListener("resize", sizeOverlay);

  // SW register (safe)
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js", { scope: "./" }); }
    catch (e) { console.warn("SW register failed:", e); }
  }

  els.btnStart?.addEventListener("click", onStartPressed);
  els.btnPerms?.addEventListener("click", grantPermissionsAndStart);
  els.btnCloseSheet?.addEventListener("click", () => hideSheet());

  els.btnAI?.addEventListener("click", toggleAI);
  els.btnGestures?.addEventListener("click", toggleGestures);

  els.btnSnap?.addEventListener("click", () => snapSelectedOrCenter());
  els.btnGallery?.addEventListener("click", openGalleryPanel);
  els.btnPanels?.addEventListener("click", openDashboardPanel);

  // Tap to snap
  els.cam?.addEventListener("pointerdown", (e) => snapAt({ x: e.clientX, y: e.clientY }));

  setHudStatus("Idle — tap Start");
  setHudFps("--");
  setHudHeading("--");
  setHudPitch("--");
  setHudGestures("Off");
  setHudSelect("—");
  setHudMode("Live");

  // Tool wheel click (finger/touch fallback)
  els.toolWheel?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".wheelItem");
    if (!btn) return;
    const tool = btn.getAttribute("data-tool");
    if (tool) runTool(tool);
  });
}

/* ---------- HUD helpers ---------- */
function setHudStatus(t) { if (els.hudStatus) els.hudStatus.textContent = t; }
function setHudFps(t) { if (els.hudFps) els.hudFps.textContent = `AI: ${t} fps`; }
function setHudHeading(deg) { if (els.hudHeading) els.hudHeading.textContent = `Heading: ${deg}°`; }
function setHudPitch(deg) { if (els.hudPitch) els.hudPitch.textContent = `Pitch: ${deg}°`; }
function setHudGestures(t) { if (els.hudGestures) els.hudGestures.textContent = `Gestures: ${t}`; }
function setHudSelect(t) { if (els.hudSelect) els.hudSelect.textContent = `Selected: ${t}`; }
function setHudMode(t) { if (els.hudMode) els.hudMode.textContent = `Mode: ${t}`; }

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

  state.aiOn = false;
  state.detections = [];
  state.frozenDetections = [];
  state.frozen = false;

  state.selectedIndex = -1;
  state.selectedLabel = "—";
  setHudSelect("—");

  els.btnAI.textContent = "AI: Off";
  els.btnAI.classList.remove("on");
  setHudFps("--");

  disableGestures();
  closeWheel();

  clearOverlay();
}

/* ---------- Motion ---------- */
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
  if (!state.streaming) {
    setHudStatus("Start camera first");
    return;
  }
  if (state.gesturesOn) { disableGestures(); return; }
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
    state.gesturesOn = false;
    setHudGestures("Off");
    els.btnGestures.classList.remove("on");
    setHudStatus("Gestures failed (reload + good light)");
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
  closeWheel();
}

/* --- Gesture events --- */
function handleGesture(g) {
  if (!state.streaming) return;

  // Cursor updates (selection + wheel hover)
  if (g.type === "cursor" && typeof g.x === "number" && typeof g.y === "number") {
    const { sx, sy } = normPointToScreen(g.x, g.y, els.overlay, els.cam);
    state.cursor = { sx, sy, gesture: g.gesture || null };

    if (state.aiOn) updateSelectionFromCursor();

    // Open palm => tool wheel (debounced)
    if (g.gesture === "Open_Palm") {
      const now = performance.now();
      if (now - state.lastPalmTs > 450 && !state.wheelOpen) {
        state.lastPalmTs = now;
        const css = deviceToCss(sx, sy);
        openWheel(css.x, css.y);
      }
    }

    if (state.wheelOpen) updateWheelHotFromCursor();

    redrawOverlay();
    return;
  }

  // Pinch: panel drag/resize OR activate wheel OR snap selected object
  if (g.type === "pinchStart") {
    if (!state.cursor) return;

    // If wheel open: pinch selects hovered tool
    if (state.wheelOpen) {
      if (state.wheelHotTool) runTool(state.wheelHotTool);
      closeWheel();
      return;
    }

    const css = deviceToCss(state.cursor.sx, state.cursor.sy);

    // If pinching on a panel: grab it
    const hitPanel = document.elementFromPoint(css.x, css.y)?.closest(".panel");
    if (hitPanel) {
      beginPanelGrab(hitPanel, css.x, css.y);
      return;
    }

    // Otherwise: pinch snaps the selected object (object-accurate)
    if (state.aiOn && state.selectedIndex >= 0) {
      snapSelectedObject();
      return;
    }

    // Fallback: snap at finger position
    snapAt({ x: css.x, y: css.y });
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

  // Optional point gesture snaps (throttled)
  if (g.type === "point") {
    const now = performance.now();
    if (now - state.lastPointSnapTs < 900) return;
    state.lastPointSnapTs = now;

    if (!state.aiOn) return;
    if (state.selectedIndex >= 0) snapSelectedObject();
  }
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
    state.frozenDetections = [];
    state.frozen = false;
    state.selectedIndex = -1;
    state.selectedLabel = "—";
    setHudSelect("—");
    setHudMode("Live");
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

    // If frozen, skip detection update
    if (!state.frozen) {
      const t0 = performance.now();
      const dets = await detectFrame(els.cam, 0.55);
      const t1 = performance.now();

      state.detections = dets;
      const dt = Math.max(1, t1 - t0);
      state.aiFps = Math.round(1000 / dt);
      setHudFps(String(state.aiFps));
    } else {
      setHudFps("—");
    }

    redrawOverlay();
    await sleep(140);
  }

  state.aiLooping = false;
}

/* ---------- Selection / Overlay ---------- */
function currentDetections() {
  return state.frozen ? state.frozenDetections : state.detections;
}

function redrawOverlay() {
  if (!state.aiOn) {
    clearOverlay();
    return;
  }
  const dets = currentDetections();
  drawDetections(els.overlay, dets, els.cam, {
    selectedIndex: state.selectedIndex,
    cursor: state.gesturesOn && state.cursor ? { sx: state.cursor.sx, sy: state.cursor.sy } : null
  });

  // Add a subtle pulse ring when selected
  if (state.selectedIndex >= 0 && dets[state.selectedIndex]) {
    drawSelectionPulse(dets[state.selectedIndex]);
  }
}

function updateSelectionFromCursor() {
  const dets = currentDetections();
  if (!state.cursor || !dets.length) {
    state.selectedIndex = -1;
    state.selectedLabel = "—";
    setHudSelect("—");
    return;
  }

  const best = pickDetectionAt(state.cursor.sx, state.cursor.sy, dets, els.overlay, els.cam);
  if (!best) {
    state.selectedIndex = -1;
    state.selectedLabel = "—";
    setHudSelect("—");
    return;
  }

  // Require cursor close enough so it doesn’t auto-select across the whole screen
  const maxDist = (150 * (window.devicePixelRatio || 1)) ** 2;
  const dx = state.cursor.sx - best.rect.cx;
  const dy = state.cursor.sy - best.rect.cy;
  if (dx*dx + dy*dy > maxDist) {
    state.selectedIndex = -1;
    state.selectedLabel = "—";
    setHudSelect("—");
    return;
  }

  state.selectedIndex = best.index;
  state.selectedLabel = best.det?.class || "—";
  setHudSelect(state.selectedLabel);
}

function drawSelectionPulse(det) {
  const ctx = els.overlay.getContext("2d");
  const r = detToScreenRect(det, els.overlay, els.cam);

  const t = performance.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  const pad = 10 + pulse * 10;

  ctx.save();
  ctx.globalAlpha = 0.18 + pulse * 0.12;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(r.sx - pad, r.sy - pad, r.sw + pad*2, r.sh + pad*2, 16);
  ctx.stroke();
  ctx.restore();
}

/* ---------- Tool wheel ---------- */
function openWheel(xCss, yCss) {
  if (!els.toolWheel) return;
  state.wheelOpen = true;
  els.toolWheel.classList.remove("hidden");
  els.toolWheel.style.left = `${xCss}px`;
  els.toolWheel.style.top = `${yCss}px`;
  els.toolWheel.setAttribute("aria-hidden", "false");
  state.wheelHotTool = null;
  updateWheelHotFromCursor();
  setHudStatus("Tool wheel");
}

function closeWheel() {
  if (!els.toolWheel) return;
  state.wheelOpen = false;
  els.toolWheel.classList.add("hidden");
  els.toolWheel.setAttribute("aria-hidden", "true");
  state.wheelHotTool = null;
  els.toolWheel.querySelectorAll(".wheelItem").forEach(b => b.classList.remove("hot"));
}

function updateWheelHotFromCursor() {
  if (!state.cursor || !els.toolWheel) return;

  const css = deviceToCss(state.cursor.sx, state.cursor.sy);
  let hot = null;

  els.toolWheel.querySelectorAll(".wheelItem").forEach(btn => {
    const r = btn.getBoundingClientRect();
    const inside = css.x >= r.left && css.x <= r.right && css.y >= r.top && css.y <= r.bottom;
    btn.classList.toggle("hot", inside);
    if (inside) hot = btn.getAttribute("data-tool");
  });

  state.wheelHotTool = hot;
}

function runTool(tool) {
  if (tool === "snap") snapSelectedOrCenter();
  if (tool === "freeze") toggleFreeze();
  if (tool === "clear") { state.selectedIndex = -1; setHudSelect("—"); redrawOverlay(); }
  if (tool === "gallery") openGalleryPanel();
}

/* ---------- Freeze ---------- */
function toggleFreeze() {
  if (!state.aiOn) return;

  state.frozen = !state.frozen;
  if (state.frozen) {
    state.frozenDetections = [...state.detections];
    setHudMode("Freeze");
    setHudStatus("Frozen");
  } else {
    state.frozenDetections = [];
    setHudMode("Live");
    setHudStatus("Live");
  }
  redrawOverlay();
}

/* ---------- Snap (object-accurate) ---------- */
async function snapSelectedObject() {
  const dets = currentDetections();
  const det = dets[state.selectedIndex];
  if (!det) return;
  await snapDetection(det);
}

async function snapSelectedOrCenter() {
  if (state.aiOn && state.selectedIndex >= 0) {
    await snapSelectedObject();
  } else {
    await snapAt("center");
  }
}

async function snapDetection(det) {
  if (!state.streaming) return;

  const full = captureToCanvas(els.cam, document.createElement("canvas"));
  const vw = full.width, vh = full.height;

  const [x, y, w, h] = det.bbox; // VIDEO SPACE
  const pad = 0.18;              // padding around bbox
  const cx = x + w / 2;
  const cy = y + h / 2;

  // Make a square crop around bbox with padding
  const size = Math.min(
    Math.max(w, h) * (1 + pad * 2),
    Math.min(vw, vh)
  );

  const x0 = clamp(Math.round(cx - size / 2), 0, vw - size);
  const y0 = clamp(Math.round(cy - size / 2), 0, vh - size);

  const crop = document.createElement("canvas");
  crop.width = 900;
  crop.height = 900;
  const ctx = crop.getContext("2d");
  ctx.drawImage(full, x0, y0, size, size, 0, 0, crop.width, crop.height);

  const dataUrl = crop.toDataURL("image/jpeg", 0.92);
  const meta = { label: det.class, score: det.score };

  const saved = await saveSnap({ dataUrl, meta });
  openInspectPanel(saved);
  setHudStatus(`Snapped: ${det.class}`);
}

async function snapAt(where) {
  if (!state.streaming) return;

  const full = captureToCanvas(els.cam, document.createElement("canvas"));
  const vw = full.width, vh = full.height;

  const rect = els.cam.getBoundingClientRect();
  let sx = rect.left + rect.width / 2;
  let sy = rect.top + rect.height / 2;

  if (where && typeof where === "object") { sx = where.x; sy = where.y; }

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

  const meta = (state.aiOn && state.selectedIndex >= 0 && currentDetections()[state.selectedIndex])
    ? { label: currentDetections()[state.selectedIndex].class, score: currentDetections()[state.selectedIndex].score }
    : null;

  const saved = await saveSnap({ dataUrl, meta });
  openInspectPanel(saved);
  setHudStatus(meta?.label ? `Snapped: ${meta.label}` : "Snapped");
}

/* ---------- Panels ---------- */
function openDashboardPanel() {
  const html = `
    <div class="kv"><small>Camera</small><div>${state.streaming ? "Live" : "Off"}</div></div>
    <div class="kv"><small>AI</small><div>${state.aiOn ? "On" : "Off"}</div></div>
    <div class="kv"><small>Gestures</small><div>${state.gesturesOn ? "On" : "Off"}</div></div>
    <div class="kv"><small>Mode</small><div>${state.frozen ? "Freeze" : "Live"}</div></div>

    <div class="grid" style="margin-top:10px;">
      <button class="dockBtn" id="pAI">${state.aiOn ? "AI Off" : "AI On"}</button>
      <button class="dockBtn" id="pGest">${state.gesturesOn ? "Gestures Off" : "Gestures On"}</button>
      <button class="dockBtn" id="pFreeze">${state.frozen ? "Unfreeze" : "Freeze"}</button>
      <button class="dockBtn" id="pSnap">Snap</button>
    </div>

    <div class="notice" style="margin-top:10px;">
      Open palm = tool wheel. Pinch = snap selected object (bbox crop).
    </div>
  `;

  const panel = createPanel({
    title: "Dashboard",
    x: 12,
    y: 110,
    w: Math.min(360, Math.floor(window.innerWidth * 0.92)),
    h: Math.min(380, Math.floor(window.innerHeight * 0.48)),
    bodyHTML: html
  });

  els.app.appendChild(panel);
  clampPanelIntoView(panel);

  const body = getPanelBody(panel);
  $("#pAI", body)?.addEventListener("click", () => toggleAI());
  $("#pGest", body)?.addEventListener("click", () => toggleGestures());
  $("#pFreeze", body)?.addEventListener("click", () => toggleFreeze());
  $("#pSnap", body)?.addEventListener("click", () => snapSelectedOrCenter());
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
    setPanelBody(panel, `<div class="notice">No snapshots yet. Use pinch-snap on a selected object.</div>`);
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

function openInspectPanel(snap) {
  const label = snap.meta?.label ? `${snap.meta.label} (${Math.round((snap.meta.score || 0) * 100)}%)` : "—";

  const panel = createPanel({
    title: "Inspect",
    x: 12,
    y: 120,
    w: Math.min(360, Math.floor(window.innerWidth * 0.92)),
    h: Math.min(540, Math.floor(window.innerHeight * 0.60)),
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
        This crop is object-accurate using the detection box.
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

/* ---------- Panel pinch drag/resize ---------- */
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
    const newH = clamp(state.resizeStart.h + dy, 200, Math.min(0.62 * window.innerHeight, 650));
    p.style.width = `${newW}px`;
    p.style.height = `${newH}px`;
  }
}
function endPanelGrab() {
  state.grabbedPanel = null;
  state.grabMode = null;
}

/* ---------- utilities ---------- */
function clearOverlay() {
  const ctx = els.overlay.getContext("2d");
  ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

let _z = 30;
function nextZ() { _z += 1; return _z; }

function clampPanelIntoView(panel) {
  const r = panel.getBoundingClientRect();
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  panel.style.left = `${clamp(r.left, 8, window.innerWidth - w - 8)}px`;
  panel.style.top = `${clamp(r.top, 8, window.innerHeight - h - 90)}px`;
}

// Convert overlay device pixels -> CSS pixels
function deviceToCss(dx, dy) {
  const dpr = window.devicePixelRatio || 1;
  return { x: dx / dpr, y: dy / dpr };
}