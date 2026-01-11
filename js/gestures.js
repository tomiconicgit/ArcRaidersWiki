// Google MediaPipe Tasks Vision (Gesture Recognizer) for Web
// - DOES NOT start its own camera
// - Reads frames from your existing <video>
// Emits events:
//   cursor {x,y,pinch,gesture}  (x,y are normalized to the video image)
//   pinchStart / pinchMove / pinchEnd (x,y on start/move)
//   point (throttled)
//   none

export async function createGestureTracker(videoEl, onGesture) {
  if (!videoEl) throw new Error("createGestureTracker: missing videoEl");

  const pkgVer = "0.10.22-rc.20250304";
  const { FilesetResolver, GestureRecognizer } =
    await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${pkgVer}`);

  // Load WASM runtime
  const vision = await FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${pkgVer}/wasm`
  );

  // Model hosted by Google
  const modelAssetPath =
    "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

  const recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
  });

  let running = true;
  let raf = 0;

  let pinchDown = false;
  let lastCursorEmit = 0;
  let lastPointEmit = 0;

  const PINCH_DIST = 0.060;        // tune: smaller = stricter pinch
  const CURSOR_FPS_MS = 45;        // ~22fps
  const POINT_THROTTLE_MS = 350;   // point snapshots not spammy

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function frame(now) {
    if (!running) return;

    try {
      if (videoEl.readyState >= 2) {
        const res = recognizer.recognizeForVideo(videoEl, now);
        const lm = res?.landmarks?.[0] || null;
        const gestureName = res?.gestures?.[0]?.[0]?.categoryName || null;

        if (!lm) {
          if (pinchDown) {
            pinchDown = false;
            onGesture({ type: "pinchEnd" });
          }
          onGesture({ type: "none" });
        } else {
          const thumbTip = lm[4];
          const indexTip = lm[8];
          const indexPip = lm[6];

          const d = dist(thumbTip, indexTip);
          const isPinch = d < PINCH_DIST;

          // Cursor feed
          if (now - lastCursorEmit >= CURSOR_FPS_MS) {
            lastCursorEmit = now;
            onGesture({
              type: "cursor",
              x: indexTip.x,
              y: indexTip.y,
              pinch: isPinch,
              gesture: gestureName,
            });
          }

          // Pinch transitions
          if (isPinch && !pinchDown) {
            pinchDown = true;
            onGesture({ type: "pinchStart", x: indexTip.x, y: indexTip.y });
          } else if (isPinch && pinchDown) {
            onGesture({ type: "pinchMove", x: indexTip.x, y: indexTip.y });
          } else if (!isPinch && pinchDown) {
            pinchDown = false;
            onGesture({ type: "pinchEnd" });
          }

          // Point gesture (either from classifier or fallback heuristic)
          const heuristicPoint = (indexTip.y < indexPip.y - 0.02) && !isPinch;
          const isPointingUp = (gestureName === "Pointing_Up") || heuristicPoint;

          if (isPointingUp && (now - lastPointEmit >= POINT_THROTTLE_MS)) {
            lastPointEmit = now;
            onGesture({ type: "point", x: indexTip.x, y: indexTip.y });
          }
        }
      }
    } catch (e) {
      // If something fails mid-stream, don't hard-crash the app
      onGesture({ type: "none" });
      // console.warn("Gesture frame error:", e);
    }

    raf = requestAnimationFrame(frame);
  }

  raf = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      try { recognizer.close?.(); } catch {}
    }
  };
}