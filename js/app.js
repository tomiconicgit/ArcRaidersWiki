import { startCamera as camStart, stopCamera as camStop, captureToCanvas } from "./camera.js";
import { saveSnap, listSnaps, deleteSnap } from "./storage.js";
import { createPanel, setPanelBody, getPanelBody } from "./ui.js";
import { loadVisionModel, isVisionReady, detectFrame, drawDetections, pickDetectionAt } from "./vision.js";
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

  btnStart: $("#btnStart"),
  btnAI: $("#btnAI"),
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

  // gesture manipulation
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

  // Tap on video to snap
  els.cam?.addEventListener("pointerdown", (e) => {
    snapAt({ x: e.clientX, y: e.clientY });
  });

  setHudStatus("Idle — tap Start");
  setHudFps("--");
  setHudHeading("--");
  setHudPitch("--");
  setHudGestures("Off");
}

/* ---------- HUD helpers ---------- */
function setHudStatus(t) { if (els.hudStatus) els.hudStatus.textContent = t; }
function setHudFps(t) { if (els.hudFps) els.hudFps.textContent = `AI: ${t} fps`; }
function setHudHeading(deg) { if (els.hudHeading) els.hudHeading.textContent = `Heading: ${deg}°`; }
function setHudPitch(deg) { if (els.hudPitch) els.hudPitch.textContent = `Pitch: ${deg}°`; }
function setHudGestures(t) { if (els.hudGestures) els.hudGestures.textContent = `Gestures: ${t}`; }

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

  // Optional motion
  await enableMotion();

  // Optional gestures
  await enableGestures();
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
  els.btnAI.textContent = "AI: Off";
  els.btnAI.classList.remove("on");

  // stop gestures
  if (state.gestureTracker) {
    state.gestureTracker.stop();
    state.gestureTracker = null;
  }
  state.gesturesOn = false;
  setHudGestures("Off");

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

/* ---------- Gestures (pinch drag/resize + point snap) ---------- */
async function enableGestures() {
  if (!state.streaming || state.gesturesOn) return;

  try {
    setHudGestures("Loading…");
    state.gestureTracker = await createGestureTracker(els.cam, handleGesture);
    state.gesturesOn = true;
    setHudGestures("On");
  } catch (e) {
    console.warn("Gestures failed to start:", e);
    state.gesturesOn = false;
    setHudGestures("Off");
  }
}

function handleGesture(g) {
  // normalized 0..1 -> screen coords
  const sx = g.x * window.innerWidth;
  const sy = g.y * window.innerHeight;

  if (g.type === "pinchStart") {
    const panel = document.elementFromPoint(sx, sy)?.closest(".panel");
    if (!panel) return;

    // only allow pinch control if pinch begins on header area
    const header = panel.querySelector(".panelHeader");
    if (header) {
      const hr = header.getBoundingClientRect();
      const inHeader = sx >= hr.left && sx <= hr.right && sy >= hr.top && sy <= hr.bottom;
      if (!inHeader) return;
    }

    state.grabbedPanel = panel;

    // decide drag vs resize (near bottom-right corner)
    const pr = panel.getBoundingClientRect();
    const nearBR = (sx > pr.right - 60) && (sy > pr.bottom - 60);
    state.grabMode = nearBR ? "resize" : "drag";

    panel.style.zIndex = String(nextZ());

    if (state.grabMode === "drag") {
      state.grabOffset.x = sx - pr.left;
      state.grabOffset.y = sy - pr.top;
    } else {
      state.resizeStart.x = sx;
      state.resizeStart.y = sy;
      state.resizeStart.w = pr.width;
      state.resizeStart.h = pr.height;
    }
    return;
  }

  if (g.type === "pinchMove") {
    const p = state.grabbedPanel;
    if (!p) return;

    if (state.grabMode === "drag") {
      const w = p.offsetWidth;
      const h = p.offsetHeight;

      const left = clamp(sx - state.grabOffset.x, 8, window.innerWidth - w - 8);
      const top = clamp(sy - state.grabOffset.y, 8 + safeTopPx(), window.innerHeight - h - (safeBottomPx() + 90));
      p.style.left = `${left}px`;
      p.style.top = `${top}px`;
    } else if (state.grabMode === "resize") {
      const dx = sx - state.resizeStart.x;
      const dy = sy - state.resizeStart.y;

      const newW = clamp(state.resizeStart.w + dx, 220, Math.min(0.96 * window.innerWidth, 520));
      const newH = clamp(state.resizeStart.h + dy, 200, Math.min(0.62 * window.innerHeight, 620));

      p.style.width = `${newW}px`;
      p.style.height = `${newH}px`;
    }
    return;
  }

  if (g.type === "pinchEnd") {
    state.grabbedPanel = null;
    state.grabMode = null;
    return;
  }

  if (g.type === "point") {
    // point-to-snap (throttled)
    const now = performance.now();
    if (now - state.lastPointSnapTs < 900) return;
    state.lastPointSnapTs = now;

    snapAt({ x: sx, y: sy });
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

    drawDetections(els.overlay, dets, els.cam);

    // iPhone-friendly throttle
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

  // AI-aware pick nearest detection (if AI on)
  let picked = null;
  if (state.aiOn && state.detections?.length) {
    // overlay is device pixels
    const ox = (sx / window.innerWidth) * els.overlay.width;
    const oy = (sy / window.innerHeight) * els.overlay.height;
    picked = pickDetectionAt(ox, oy, state.detections, els.overlay, els.cam);
  }

  // map screen -> video coords
  const nx = (sx - rect.left) / rect.width;
  const ny = (sy - rect.top) / rect.height;
  const cx = Math.round(nx * vw);
  const cy = Math.round(ny * vh);

  // crop size (a bit larger if no AI pick)
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
        Tip: Point gesture triggers snapshots at your fingertip. Pinch on panel header to move it.
        Pinch near the bottom-right corner to resize.
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

  // keep inspect panel on screen
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
      <button class="dockBtn" id="pGallery">Gallery</button>
      <button class="dockBtn" id="pSnap">Snap</button>
      <button class="dockBtn" id="pGest">${state.gesturesOn ? "Gestures On" : "Gestures On"}</button>
    </div>

    <div class="notice" style="margin-top:10px;">
      Point gesture = snapshot. Pinch on panel header = drag. Pinch near bottom-right = resize.
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
  $("#pGest", body)?.addEventListener("click", async () => {
    if (!state.gesturesOn) await enableGestures();
  });
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
    setPanelBody(panel, `<div class="notice">No snapshots yet. Tap the camera, press Snap, or point gesture.</div>`);
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

/* ---------- Overlay ---------- */
function clearOverlay() {
  if (!els.overlay) return;
  const ctx = els.overlay.getContext("2d");
  ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
}

/* ---------- utilities ---------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function safeTopPx() { return 0; }
function safeBottomPx() { return 0; }

let _z = 30;
function nextZ() { _z += 1; return _z; }

function clampPanelIntoView(panel) {
  const r = panel.getBoundingClientRect();
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;

  const left = clamp(r.left, 8, window.innerWidth - w - 8);
  const top = clamp(r.top, 8 + safeTopPx(), window.innerHeight - h - (safeBottomPx() + 90));

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}