function createSyntheticStream() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');

  const draw = () => {
    const t = performance.now() / 1000;
    const grad = ctx.createLinearGradient(0, 0, 0, 720);
    grad.addColorStop(0, '#1d2b3a');
    grad.addColorStop(1, '#0b1117');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1280, 720);

    ctx.fillStyle = '#2a3b4d';
    ctx.fillRect(0, 470, 1280, 250);

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const y = 470 + (i / 14) * 250;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1280, y + 60);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(53,224,127,0.25)';
    for (let i = 0; i < 6; i++) {
      const x = ((t * 40 + i * 220) % 1380) - 50;
      const y = 200 + (i % 3) * 130;
      ctx.strokeRect(x, y, 70, 70);
    }
  };

  draw();
  setInterval(draw, 1000 / 30);
  return canvas.captureStream(30);
}

async function getUserMediaSafe(constraints) {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    return null;
  }
}

function isRearMainCamera(device) {
  const label = (device.label || '').toLowerCase();
  if (!label) return false;
  if (!/(back|rear|environment|trasera|posterior)/.test(label)) return false;
  return !/(ultra.?wide|ultrawide|wide.?angle|gran angular|macro|telephoto|teleobjetivo|0\.5x|2x|3x)/.test(label);
}

export async function startCamera() {
  const video = document.getElementById('camera-video');

  // Never switch to the selfie or auxiliary rear camera: use the main rear camera at 1x.
  const baseConstraints = {
    audio: false,
    video: {
      facingMode: { exact: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
      resizeMode: { exact: 'none' },
      zoom: { ideal: 1 },
    },
  };

  let stream = await getUserMediaSafe(baseConstraints);
  let selectedDeviceId = '';

  // Once permission is granted, prefer a labelled rear main lens over ultra-wide/tele lenses.
  if (stream && navigator.mediaDevices?.enumerateDevices) {
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const rearCandidates = devices.filter((device) => device.kind === 'videoinput' && isRearMainCamera(device));
    const mainRear = rearCandidates.sort((a, b) => {
      const score = (device) => {
        const label = (device.label || '').toLowerCase();
        return (/(main|principal|back camera 0|rear camera 0|camera 0)/.test(label) ? 2 : 0)
          + (/(back|rear|environment|trasera|posterior)/.test(label) ? 1 : 0);
      };
      return score(b) - score(a);
    })[0];
    if (mainRear?.deviceId) {
      selectedDeviceId = mainRear.deviceId;
      const currentId = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
      if (currentId && currentId !== selectedDeviceId) {
        stream.getTracks().forEach((track) => track.stop());
        stream = await getUserMediaSafe({
          audio: false,
          video: {
            deviceId: { exact: selectedDeviceId },
            facingMode: { exact: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
            resizeMode: { exact: 'none' },
            zoom: { ideal: 1 },
          },
        });
      }
    }
  }

  if (!stream) {
    stream = await getUserMediaSafe({
      audio: false,
      video: {
        facingMode: { exact: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
        resizeMode: { exact: 'none' },
      },
    });
  }

  let facing = 'environment';
  let synthetic = false;

  if (!stream) {
    console.warn('Cámara trasera 1x no disponible, usando fuente sintética');
    stream = createSyntheticStream();
    synthetic = true;
    facing = 'synthetic';
  }

  if (video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
  }

  video.srcObject = stream;
  await video.play();

  await new Promise((resolve) => {
    if (video.videoWidth > 0) return resolve();
    video.addEventListener('loadedmetadata', resolve, { once: true });
    setTimeout(resolve, 1500);
  });

  const track = stream.getVideoTracks()[0];
  const capabilities = track?.getCapabilities?.();
  if (track?.applyConstraints && capabilities?.zoom && capabilities.zoom.min <= 1 && capabilities.zoom.max >= 1) {
    await track.applyConstraints({ advanced: [{ zoom: 1 }] }).catch(() => {});
  }

  return {
    video,
    facing,           // 'environment' | 'synthetic'
    synthetic,
    mirror: false,
    width: video.videoWidth,
    height: video.videoHeight,
  };
}
