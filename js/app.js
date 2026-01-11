import { startCamera, stopCamera, captureToCanvas, getVideoSize } from "./camera.js";
import { loadVisionModel, detectFrame, drawDetections, pickDetectionAt, isVisionReady } from "./vision.js";
import { createPanel, setPanelBody, getPanelBody } from "./ui.js";
import { saveSnap, listSnaps, deleteSnap } from "./storage.js";

const video = document.getElementById("cam");
const overlay = document.getElementById("overlay");

const hudStatus = document.getElementById("hudStatus");
const hudFps = document.getElementById("hudFps");
const hudHeading = document.getElementById("hudHeading");
const hudPitch = document.getElementById("hudPitch");

const btnStart = document.getElementById("btnStart");
const btnAI = document.getElementById("btnAI");
const btnSnap = document.getElementById("btnSnap");
const btnGallery = document.getElementById("btnGallery");
const btnPanels = document.getElementById("btnPanels");

const sheet = document.getElementById("sheet");
const btnPerms = document.getElementById("btnPerms");
const btnCloseSheet = document.getElementById("btnCloseSheet");

let stream = null;
let aiOn = false;
let running = false;

let lastDetections = [];
let lastAiTick = 0;
let aiFrames = 0;
let aiFps = 0;

let dashPanel = null;
let snapPanel = null;
let galleryPanel = null;

const scratchCanvas = document.createElement("canvas");

function setStatus(text) {
  hudStatus.textContent = text;
}

function resizeOverlay() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  overlay.width = Math.floor(window.innerWidth * dpr);
  overlay.height = Math.floor(window.innerHeight * dpr);
  overlay.style.width = "100%";
  overlay.style.height = "100%";
}
window.addEventListener("resize", resizeOverlay);

async function requestMotionPermissionIfNeeded() {
  // iOS needs user gesture for motion permission.
  if (typeof DeviceOrientationEvent?.requestPermission === "function") {
    const res = await DeviceOrientationEvent.requestPermission();
    if (res !== "granted") throw new Error("Motion permission denied.");
  }
}

function attachMotionHud() {
  window.addEventListener("deviceorientation", (e) => {
    // alpha: compass heading-ish (0-360) on iOS can be weird; we still show it.
    const heading = (e.webkitCompassHeading ?? e.alpha);
    const pitch = e.beta;

    if (typeof heading === "number") hudHeading.textContent = `Heading: ${heading.toFixed(0)}°`;
    if (typeof pitch === "number") hudPitch.textContent = `Pitch: ${pitch.toFixed(0)}°`;
  }, { passive: true });
}

function clickSound() {
  // tiny synthetic click via WebAudio (no asset files)
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "square";
  o.frequency.value = 880;
  g.gain.value = 0.04;
  o.connect(g);
  g.connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.03);
  o.onended = () => ctx.close();
}

async function startAll() {
  resizeOverlay();
  attachMotionHud();

  try {
    await requestMotionPermissionIfNeeded();
  } catch {
    // okay, we still run without motion
  }

  stream = await startCamera(video);
  setStatus("Camera Live");
  running = true;

  ensurePanels();
  loop();
}

function stopAll() {
  running = false;
  aiOn = false;
  btnAI.textContent = "AI: Off";
  btnAI.classList.remove("on");
  stopCamera(video);
  setStatus("Stopped");
}

function ensurePanels() {
  if (!dashPanel) {
    dashPanel = createPanel({
      title: "Dashboard",
      x: 16,
      y: 88,
      w: 340,
      h: 260,
      bodyHTML: dashboardHTML()
    });
    document.body.appendChild(dashPanel);
  }

  if (!snapPanel) {
    snapPanel = createPanel({
      title: "Snapshot",
      x: 16,
      y: 360,
      w: 340,
      h: 280,
      bodyHTML: snapshotHTML(null)
    });
    document.body.appendChild(snapPanel);
  }
}

function dashboardHTML() {
  const aiState = aiOn ? "On" : "Off";
  const { vw, vh } = getVideoSize(video);

  return `
    <div class="kv"><small>Status</small><div>${escape(aiState)} / ${escape(hudStatus.textContent)}</div></div>
    <div class="kv"><small>Camera</small><div>${vw}×${vh}</div></div>

    <div class="grid">
      <div class="tile">
        <div class="tileTitle">Detections</div>
        <div class="tileValue">${lastDetections.length}</div>
      </div>
      <div class="tile">
        <div class="tileTitle">AI FPS</div>
        <div class="tileValue">${aiOn ? aiFps.toFixed(1) : "—"}</div>
      </div>
      <div class="tile">
        <div class="tileTitle">Tap</div>
        <div class="notice">Tap a box to auto-crop + save a zoomed snap.</div>
      </div>
      <div class="tile">
        <div class="tileTitle">Tip</div>
        <div class="notice">Move panels around while scanning—like a spatial desktop.</div>
      </div>
    </div>
  `;
}

function snapshotHTML(item) {
  if (!item) {
    return `
      <div class="notice">
        Use <b>AI On</b> and tap an object box, or hit <b>Snap</b> to capture the full frame.
        <br/><br/>
        Your snaps are stored on-device in the Gallery.
      </div>
    `;
  }

  const meta = item.meta || {};
  const label = meta.label ? `<div class="kv"><small>Target</small><div>${escape(meta.label)}</div></div>` : "";
  const score = (typeof meta.score === "number") ? `<div class="kv"><small>Confidence</small><div>${(meta.score*100).toFixed(0)}%</div></div>` : "";

  return `
    ${label}
    ${score}
    <div style="border-radius:16px; overflow:hidden; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.15);">
      <img src="${item.dataUrl}" style="width:100%; display:block;" />
    </div>
    <div style="display:flex; gap:10px; margin-top:10px;">
      <button class="dockBtn" id="btnShareSnap" style="flex:1;">Share</button>
      <button class="dockBtn" id="btnSaveImg" style="flex:1;">Save Image</button>
    </div>
  `;
}

async function renderGallery() {
  const snaps = await listSnaps(60);

  if (!galleryPanel) {
    galleryPanel = createPanel({
      title: "Gallery",
      x: Math.max(16, window.innerWidth - 16 - 340),
      y: 88,
      w: 340,
      h: 360,
      bodyHTML: `<div class="notice">Loading…</div>`
    });
    document.body.appendChild(galleryPanel);
  }

  if (snaps.length === 0) {
    setPanelBody(galleryPanel, `<div class="notice">No snaps yet. Turn on AI and tap an object box.</div>`);
    return;
  }

  const thumbs = snaps.map(s => `
    <div class="thumb" data-id="${s.id}">
      <img src="${s.dataUrl}" alt="snap"/>
    </div>
  `).join("");

  setPanelBody(galleryPanel, `
    <div class="gallery">${thumbs}</div>
    <div class="notice" style="margin-top:10px;">Tap a thumbnail to open. Long-press to delete.</div>
  `);

  // tap to open
  getPanelBody(galleryPanel).querySelectorAll(".thumb").forEach(el => {
    const id = el.getAttribute("data-id");

    el.addEventListener("click", async () => {
      const all = await listSnaps(60);
      const item = all.find(x => x.id === id);
      if (!item) return;
      setPanelBody(snapPanel, snapshotHTML(item));
      wireSnapButtons(item);
      clickSound();
    });

    // long-press delete (touch)
    let pressTimer = null;
    el.addEventListener("touchstart", () => {
      pressTimer = setTimeout(async () => {
        await deleteSnap(id);
        clickSound();
        renderGallery();
      }, 650);
    }, { passive: true });

    el.addEventListener("touchend", () => {
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = null;
    }, { passive: true });
  });
}

function wireSnapButtons(item) {
  const shareBtn = document.getElementById("btnShareSnap");
  const saveBtn = document.getElementById("btnSaveImg");

  if (shareBtn) {
    shareBtn.onclick = async () => {
      clickSound();
      try {
        const res = await fetch(item.dataUrl);
        const blob = await res.blob();
        const file = new File([blob], "snap.jpg", { type: blob.type || "image/jpeg" });

        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: "Spatial HUD Snap" });
        } else {
          alert("Share not supported here. Use Save Image.");
        }
      } catch {
        alert("Share failed.");
      }
    };
  }

  if (saveBtn) {
    saveBtn.onclick = () => {
      clickSound();
      const a = document.createElement("a");
      a.href = item.dataUrl;
      a.download = "spatial-hud-snap.jpg";
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
  }
}

async function fullFrameSnap() {
  if (!stream) return