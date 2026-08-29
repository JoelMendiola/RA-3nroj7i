import { HAND_CONNECTIONS } from './hands.js';

function coverDraw(ctx, video, w, h, mirror) {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;

  ctx.save();
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, dx, dy, dw, dh);
  ctx.restore();

  return { scale, dx, dy };
}

function drawHand(ctx, lm, cover, width, height, mirror) {
  const { scale, dx, dy } = cover;
  const mx = (x) => (mirror ? 1 - x : x);
  ctx.lineWidth = Math.max(2, width / 480);
  ctx.lineCap = 'round';

  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = lm[a];
    const pb = lm[b];
    ctx.beginPath();
    ctx.moveTo(mx(pa.x) * width * scale + dx, pa.y * height * scale + dy);
    ctx.lineTo(mx(pb.x) * width * scale + dx, pb.y * height * scale + dy);
    ctx.stroke();
  }

  ctx.fillStyle = '#ffd166';
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(mx(p.x) * width * scale + dx, p.y * height * scale + dy, Math.max(2, width / 520), 0, Math.PI * 2);
    ctx.fill();
  }
}

export function createVideoPanels(video, getHands) {
  const left = document.getElementById('video-left');
  const right = document.getElementById('video-right');
  const lctx = left.getContext('2d');
  const rctx = right.getContext('2d');

  let mirror = false;

  const panelW = () => window.innerWidth / 2;
  const panelH = () => window.innerHeight;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(panelW() * dpr);
    const h = Math.round(panelH() * dpr);
    for (const c of [left, right]) {
      c.width = w;
      c.height = h;
    }
  }

  function draw() {
    if (video.readyState < 2) return;
    const w = left.width;
    const h = left.height;

    const coverL = coverDraw(lctx, video, w, h, mirror);
    const coverR = coverDraw(rctx, video, w, h, mirror);

    const hands = getHands();
    if (hands) {
      for (let i = 0; i < 2; i++) {
        const state = hands[i];
        if (!state.tracked || !state.landmarks) continue;

        lctx.strokeStyle = state.pinch ? '#35e07f' : '#ff5a5a';
        rctx.strokeStyle = state.pinch ? '#35e07f' : '#ff5a5a';

        drawHand(lctx, state.landmarks, coverL, w, h, mirror);
        drawHand(rctx, state.landmarks, coverR, w, h, mirror);
      }
    }
  }

  function setMirror(v) {
    mirror = v;
  }

  function setVisible(v) {
    left.parentElement.style.display = v ? '' : 'none';
  }

  window.addEventListener('resize', resize);
  resize();

  return { draw, resize, setMirror, setVisible };
}