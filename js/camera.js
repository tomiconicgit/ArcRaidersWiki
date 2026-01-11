export async function startCamera(videoEl) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("getUserMedia not supported in this browser.");
  }

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream;

  await new Promise((res) => {
    if (videoEl.readyState >= 2) return res();
    videoEl.onloadedmetadata = () => res();
  });

  await videoEl.play();

  const track = stream.getVideoTracks?.()[0] || null;
  const capabilities = track?.getCapabilities ? track.getCapabilities() : {};
  const settings = track?.getSettings ? track.getSettings() : {};

  return { stream, track, capabilities, settings };
}

export function stopCamera(videoEl) {
  const stream = videoEl.srcObject;
  if (stream?.getTracks) {
    for (const t of stream.getTracks()) t.stop();
  }
  videoEl.srcObject = null;
}

export function getVideoSize(videoEl) {
  const vw = videoEl.videoWidth || 1280;
  const vh = videoEl.videoHeight || 720;
  return { vw, vh };
}

export function captureToCanvas(videoEl, canvas) {
  const { vw, vh } = getVideoSize(videoEl);
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, vw, vh);
  return canvas;
}