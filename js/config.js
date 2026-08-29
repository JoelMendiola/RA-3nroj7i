export const CONFIG = {
  V_FOV_DEG: 65,
  GRAVITY: -9.82,
  KNOWN_HAND_SIZE: 0.09,
  GRAB_RADIUS: 0.4,
  GRAB_PIXEL_FRAC: 0.10,
  SPAWN_DEPTH: 1.4,
  MAX_SPEED: 14,
  FLOOR_MIN: -2.5,
  FLOOR_MAX: -0.2,
  WALL_MIN: -6,
  WALL_MAX: -0.5,
  INITIAL_FLOOR_Y: -0.75,
  INITIAL_WALL_Z: -2.0,
  INITIAL_IPD: 0.064,
  OBJECT_COUNT: 6,
  SURFACE_COLOR: 0x35e07f,
  BOUNDARY_DEFAULT_HALF: 1.0,
  BOUNDARY_MIN: 0.3,
  BOUNDARY_MAX: 1.6,
  BOUNDARY_HEIGHT: 0.8,
  BOUNDARY_SAFE_COLOR: 0x35e07f,
  BOUNDARY_WARN_COLOR: 0xff3b3b,
  VR_BG_COLOR: 0x0a0e14,
  GUARDIAN_TRACE_COLOR: 0xff3b3b,
  GUARDIAN_DONE_COLOR: 0x35e07f,
  GUARDIAN_FENCE_HEIGHT: 1.0,
  TRACER_MIN_DIST: 0.04,
  TRACER_TURN_ANGLE: 1.0,
  TRACER_CLOSE_DIST: 0.18,
  TRACER_MAX_POINTS: 300,
};

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

export function randomColorHex() {
  return hslToHex(Math.random() * 360, 85, 55);
}

export function fmt(v) {
  return v.toFixed(2);
}