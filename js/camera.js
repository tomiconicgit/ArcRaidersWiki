let stream = null;
let currentFacingMode = "environment"; // environment = rear, user = selfie

export function getFacingMode() {
  return currentFacingMode;
}

export function setFacingMode(mode) {
  currentFacingMode = mode;
}

export async function startCamera(videoEl, { facingMode = currentFacingMode } = {}) {
  stopCamera();

  const constraints = {
    audio: false,
    video: {
      facingMode,
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  };

  stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream;
  await videoEl.play();

  currentFacingMode = facingMode;
  return stream;
}

export function stopCamera() {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
  stream = null;
}

export function hasCameraStream() {
  return !!stream;
}