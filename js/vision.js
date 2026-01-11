// MediaPipe Tasks Vision (WASM) – object detection
// Note: CDN version can be changed if needed.
const TASKS_VERSION = "0.10.14";
const TASKS_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}`;

// A lightweight general detector (not brand-specific).
// You can swap this later for a custom model.
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";

export async function createVision() {
  // Dynamically import so your app still loads if vision fails
  const mod = await import(`${TASKS_CDN}`);
  const { ObjectDetector, FilesetResolver } = mod;

  const filesetResolver = await FilesetResolver.forVisionTasks(`${TASKS_CDN}/wasm`);

  const detector = await ObjectDetector.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      // Try GPU delegate when available; falls back automatically.
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    maxResults: 6,
    scoreThreshold: 0.35
  });

  return {
    async detect(videoEl, nowMs) {
      // Returns MediaPipe detections; we normalize them in main.js
      return detector.detectForVideo(videoEl, nowMs);
    },
    close() {
      try { detector.close(); } catch {}
    }
  };
}