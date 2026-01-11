// MediaPipe Hands gesture tracker
// Emits: pinchStart, pinchMove, pinchEnd, point, none

export async function createGestureTracker(videoEl, onGesture) {
  const { Hands } = await import("https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js");
  const { Camera } = await import("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");

  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 0,           // lighter for iPhone
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6
  });

  let pinchDown = false;
  let lastEmit = 0;

  hands.onResults((res) => {
    const now = performance.now();
    // Limit processing spam a bit
    if (now - lastEmit < 40) return; // ~25fps max
    lastEmit = now;

    const lm = res.multiHandLandmarks?.[0];
    if (!lm) {
      if (pinchDown) {
        pinchDown = false;
        onGesture({ type: "pinchEnd" });
      } else {
        onGesture({ type: "none" });
      }
      return;
    }

    const thumbTip = lm[4];
    const indexTip = lm[8];
    const indexPip = lm[6];

    const dx = thumbTip.x - indexTip.x;
    const dy = thumbTip.y - indexTip.y;
    const d = Math.sqrt(dx * dx + dy * dy);

    const isPinch = d < 0.055;

    // Point: index extended and NOT pinching
    const isPoint = (indexTip.y < indexPip.y - 0.02) && !isPinch;

    if (isPinch && !pinchDown) {
      pinchDown = true;
      onGesture({ type: "pinchStart", x: indexTip.x, y: indexTip.y });
      return;
    }

    if (isPinch && pinchDown) {
      onGesture({ type: "pinchMove", x: indexTip.x, y: indexTip.y });
      return;
    }

    if (!isPinch && pinchDown) {
      pinchDown = false;
      onGesture({ type: "pinchEnd" });
      return;
    }

    if (isPoint) {
      onGesture({ type: "point", x: indexTip.x, y: indexTip.y });
      return;
    }

    onGesture({ type: "none" });
  });

  const cam = new Camera(videoEl, {
    onFrame: async () => {
      await hands.send({ image: videoEl });
    },
    width: 640,
    height: 480
  });

  cam.start();

  return {
    stop() {
      cam.stop();
    }
  };
}