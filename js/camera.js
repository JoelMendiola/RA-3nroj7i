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

export async function startCamera() {
  const video = document.getElementById('camera-video');

  // Prefer the environment camera without forcing a particular lens or zoom.
  const baseConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
  };

  let stream = await getUserMediaSafe(baseConstraints);

  if (!stream) {
    stream = await getUserMediaSafe({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    });
  }

  let facing = 'environment';
  let synthetic = false;

  if (!stream) {
    console.warn('Cámara del entorno no disponible, usando fuente sintética');
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

  return {
    video,
    facing,           // camera selected by the browser | 'synthetic'
    synthetic,
    mirror: false,
    width: video.videoWidth,
    height: video.videoHeight,
  };
}
