// js/app.js — WORKING with YOUR index.html + css/styles.css
// - Start camera (iPhone Safari)
// - Optional motion (heading/pitch)
// - AI toggle (COCO-SSD via vision.js)
// - Tap-to-snap + Snap button
// - Gallery panel + Inspect panel (uses ui.js + storage.js)

import { startCamera as camStart, stopCamera as camStop, captureToCanvas } from "./camera.js";
import { saveSnap, listSnaps, deleteSnap } from "./storage.js";
import { createPanel, setPanelBody, getPanelBody } from "./ui.js";
import { loadVisionModel, isVisionReady, detectFrame, drawDetections, pickDetectionAt } from "./vision.js";

const $ = (sel, root = document) => root.querySelector(sel);

const els = {
  app: $("#app"),
  cam: $("#cam"),
  overlay: $("#overlay"),

  hudStatus: $("#hudStatus"),
  hudFps: $("#hudFps"),
  hudHeading: $("#hudHeading"),
  hudPitch: $("#hudPitch"),

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
  lastAiTs: 0,
  aiFps: 0,

  motionOn: false,
  beta: 0,   // pitch-ish
  alpha: 0,  // heading-ish (not true compass on all iPhones)
};

boot().catch(console.error);

async function boot() {
  // Canvas size
  sizeOverlay();
  window.addEventListener("resize", sizeOverlay);

  // SW register (safe)
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    } catch (e) {
      console.warn("SW register failed:", e);
    }
  }

  // Wire UI
  els.btnStart?.addEventListener("click", onStartPressed);
  els.btnPerms?.addEventListener("click", grantPermissionsAndStart);
  els.btnCloseSheet?.addEventListener("click", () => hideSheet());

  els.btnAI?.addEventListener("click", toggleAI);
  els.btnSnap?.addEventListener("click", () => snapAt("center"));
  els.btnGallery?.addEventListener("click", openGalleryPanel);
  els.btnPanels?.addEventListener("click", openDashboardPanel);

  // Tap on camera to snap at tap point
  els.cam?.addEventListener("pointerdown", (e) => {
    // Don’t block scroll; we’re full-screen anyway.
    snapAt({ x: e.clientX, y: e.clientY });
  });

  setHudStatus("Idle — tap Start");
  setHudFps("--");
  setHudHeading("--");
  setHudPitch("--");
}

// ---------- UI helpers ----------
function setHudStatus(t) {
  if (els.hudStatus) els.hudStatus.textContent = t;
}
function setHudFps(t) {
  if (els.hudFps) els.hudFps.textContent = `AI: ${t} fps`;
}
function setHudHeading(deg) {
  if (els.hudHeading) els.hudHeading.textContent = `Heading: ${deg}°`;
}
function setHudPitch(deg) {
  if (els.hudPitch) els.hudPitch.textContent = `Pitch: ${deg}°`;
}

function showSheet() {
  els.sheet?.classList.remove("hidden");
}
function hideSheet() {
  els.sheet?.classList.add("hidden");
}

function sizeOverlay() {
  if (!els.overlay) return;
  const dpr = window.devicePixelRatio || 1;
  els.overlay.width = Math.floor(window.innerWidth * dpr);
  els.overlay.height = Math.floor(window.innerHeight * dpr);
  els.overlay.style.width = "100%";
  els.overlay.style.height = "100%";
}

// ---------- Start / Permissions ----------
async function onStartPressed() {
  // iOS Safari usually wants user gesture before camera + motion perms
  showSheet();
}

async function grantPermissionsAndStart() {
  hideSheet();
  await startStream();
  await enableMotion(); // optional; if denied, app still works
  setHudStatus("Camera live");
}

async function startStream() {
  if (state.streaming) return;
  if (!els.cam) throw new Error("Missing #cam video element");

  try {
    state.stream = await camStart(els.cam);
    state.streaming = true;
    setHudStatus("Camera live");

    // Clear overlay once camera is live
    clearOverlay();
  } catch (e) {
    console.error(e);
    setHudStatus("Camera blocked — allow permissions in Safari");
    throw e;
  }
}

function stopStream() {
  if (!state.streaming) return;
  camStop(els.cam);
  state.streaming = false;
  state.stream = null;
  state.detections = [];
  clearOverlay();
  setHudStatus("Camera stopped");
}

function clearOverlay() {
  if (!els.overlay) return;
  const ctx = els.overlay.getContext("2d");
  ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
}

// ---------- Motion ----------
async function enableMotion() {
  // If iOS requires permission, request it inside a user gesture (we are in button click)
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
  // alpha can approximate heading on some devices; not guaranteed
  state.alpha = ev.alpha ?? 0;
  state.beta = ev.beta ?? 0;

  setHudHeading(Math.round(state.alpha));
  setHudPitch(Math.round(state.beta));
}

// ---------- AI ----------
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

    // Update fps estimate
    const dt = Math.max(1, t1 - t0);
    const fps = 1000 / dt;
    state.aiFps = Math.round(fps);
    setHudFps(String(state.aiFps));

    // Draw boxes
    drawDetections(els.overlay, dets, els.cam);

    // Throttle to keep iPhone smooth
    await sleep(140);
  }

  state.aiLooping = false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Snap / Inspect ----------
async function snapAt(where) {
  if (!state.streaming) {
    setHudStatus("Start camera first");
    return;
  }

  // Capture full frame
  const full = captureToCanvas(els.cam, document.createElement("canvas"));
  const vw = full.width, vh = full.height;

  // Choose point on screen
  const rect = els.cam.getBoundingClientRect();
  let sx = rect.left + rect.width / 2;
  let sy = rect.top + rect.height / 2;

  if (where && typeof where === "object") {
    sx = where.x;
    sy = where.y;
  }

  // Normalize screen point to video space
  const nx = (sx - rect.left) / rect.width;
  const ny = (sy - rect.top) / rect.height;
  const cx = Math.round(nx * vw);
  const cy = Math.round(ny * vh);

  // If AI is on, prefer the nearest detection to tap point (looks “smart”)
  let picked = null;
  if (state.aiOn && state.detections?.length) {
    const dpr = window.devicePixelRatio || 1;
    // overlay canvas is in device pixels
    const ox = (sx / window.innerWidth) * els.overlay.width;
    const oy = (sy / window.innerHeight) * els.overlay.height;
    picked = pickDetectionAt(ox, oy, state.detections, els.overlay, els.cam);
  }

  // Crop region
  const crop = document.createElement("canvas");
  crop.width = 900;
  crop.height = 900;
  const ctx = crop.getContext("2d");

  let cropBox;

  if (picked?.rect) {
    // Use picked detection box mapped back to video via vision.js mapping
    // We don't have direct video-space bbox here, so use a reasonable “inspect” crop around the center point.
    cropBox = { size: Math.round(Math.min(vw, vh) * 0.22) };
  } else {
    cropBox = { size: Math.round(Math.min(vw, vh) * 0.22) };
  }

  const size = cropBox.size;
  const x0 = clamp(cx - Math.floor(size / 2), 0, vw - size);
  const y0 = clamp(cy - Math.floor(size / 2), 0, vh - size);

  ctx.drawImage(full, x0, y0, size, size, 0, 0, crop.width, crop.height);

  const dataUrl = crop.toDataURL("image/jpeg", 0.92);

  // Save to IndexedDB
  const meta = picked?.det ? { label: picked.det.class, score: picked.det.score } : null;
  const saved = await saveSnap({ dataUrl, meta });

  // Open inspect panel
  openInspectPanel(saved);

  setHudStatus(meta?.label ? `Snapped: ${meta.label}` : "Snapped");
}

// ---------- Panels ----------
function openDashboardPanel() {
  const html = `
    <div class="kv"><small>Camera</small><div>${state.streaming ? "Live" : "Off"}</div></div>
    <div class="kv"><small>AI</small><div>${state.aiOn ? "On" : "Off"}</div></div>
    <div class="kv"><small>Motion</small><div>${state.motionOn ? "On" : "Off"}</div></div>

    <div class="grid" style="margin-top:10px;">
      <button class="dockBtn" id="pStart">${state.streaming ? "Restart" : "Start"}</button>
      <button class="dockBtn" id="pStop">Stop</button>
      <button class="dockBtn" id="pAI">${state.aiOn ? "AI Off" : "AI On"}</button>
      <button class="dockBtn" id="pGallery">Gallery</button>
    </div>

    <div class="notice" style="margin-top:10px;">
      iPhone Safari doesn’t expose true LiDAR world-mesh + anchored AR UI like Apple Vision.
      This uses camera + on-device AI + motion overlays.
    </div>
  `;

  const panel = createPanel({ title: "Dashboard", x: 16, y: 110, w: 360, h: 300, bodyHTML: html });
  els.app.appendChild(panel);

  const body = getPanelBody(panel);

  $("#pStart", body)?.addEventListener("click", async () => {
    if (!state.streaming) await startStream();
    else { stopStream(); await startStream(); }
    setHudStatus("Camera live");
  });

  $("#pStop", body)?.addEventListener("click", () => stopStream());
  $("#pAI", body)?.addEventListener("click", () => toggleAI());
  $("#pGallery", body)?.addEventListener("click", () => openGalleryPanel());
}

async function openGalleryPanel() {
  const panel = createPanel({ title: "Gallery", x: 16, y: 430, w: 360, h: 360, bodyHTML: `<div class="notice">Loading…</div>` });
  els.app.appendChild(panel);

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
    <div style="margin-top:10px" class="notice">Tap a shot to inspect. Long press not required.</div>
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
  const label = snap.meta?.label ? `${snap.meta.label} (${Math.round((snap.meta.score || 0) * 100)}%)` : "Snapshot";
  const panel = createPanel({
    title: "Inspect",
    x: 380,
    y: 110,
    w: 360,
    h: 520,
    bodyHTML: `
      <div class="thumb" style="aspect-ratio: 1/1; margin-bottom:10px;">
        <img src="${snap.dataUrl}" alt="inspect"/>
      </div>
      <div class="kv"><small>Detected</small><div>${label}</div></div>
      <div class="grid" style="margin-top:10px;">
        <a class="dockBtn" href="${snap.dataUrl}" download="snapshot.jpg" style="text-decoration:none; display:flex; align-items:center; justify-content:center;">Download</a>
        <button class="dockBtn" id="del">Delete</button>
      </div>
      <div class="notice" style="margin-top:10px;">
        If Download opens a new tab on iOS Safari, add to Home Screen for a smoother “app” feel.
      </div>
    `
  });

  els.app.appendChild(panel);

  const body = getPanelBody(panel);
  $("#del", body)?.addEventListener("click", async () => {
    await deleteSnap(snap.id);
    panel.remove();
    setHudStatus("Deleted");
  });
}

// ---------- utils ----------
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}