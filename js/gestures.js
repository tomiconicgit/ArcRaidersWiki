// gestures.js (Tasks Vision - HandLandmarker)
// Emits a simple hand state for your app to interpret:
// { ok, xN, yN, pinching, pinch01 }
//
// Why this works on iPhone Safari:
// - No camera_utils conflict (you already own the camera stream)
// - Tasks Vision is designed for VIDEO mode and ESM imports  [oai_citation:2‡codepen.io](https://codepen.io/mediapipe-preview/pen/zYamdVd)

const TASKS_VER = "0.10.3";
const TASKS_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VER}`;
const WASM_PATH = `${TASKS_URL}/wasm`;

// Official model bundle location (Google AI Edge docs)  [oai_citation:3‡Google AI for Developers](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

let landmarker = null;

export async function initHandGestures(setStatus = () => {}) {
  if (landmarker) return landmarker;

  setStatus("Gestures: loading…");

  const mp = await import(TASKS_URL);
  const { FilesetResolver, HandLandmarker } = mp;

  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

  landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  setStatus("Gestures: ready");
  return landmarker;
}

export function gesturesReady() {
  return !!landmarker;
}

export function estimateHand(videoEl, nowMs) {
  if (!landmarker) return { ok: false };

  const res = landmarker.detectForVideo(videoEl, nowMs);
  const lm = res?.landmarks?.[0];
  if (!lm || lm.length < 10) return { ok: false };

  const thumbTip = lm[4];
  const indexTip = lm[8];
  const wrist = lm[0];
  const midMcp = lm[9];

  // Normalize pinch distance to hand size so it works across near/far hands
  const handSize = dist(wrist, midMcp) || 0.25;
  const pinchDist = dist(thumbTip, indexTip);
  const pinchNorm = pinchDist / handSize;

  // Tune thresholds for phone cam
  const pinching = pinchNorm < 0.45;

  // 1 = strong pinch, 0 = open
  const pinch01 = clamp(1 - (pinchNorm - 0.25) / 0.35, 0, 1);

  return {
    ok: true,
    xN: indexTip.x,
    yN: indexTip.y,
    pinching,
    pinch01
  };
}

function dist(a, b) {
  const dx = (a.x - b.x);
  const dy = (a.y - b.y);
  return Math.hypot(dx, dy);
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }