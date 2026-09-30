// Arc geometry for the gauge. Angles are in degrees: 0 = 3 o'clock, 90 = 12 o'clock, counter-clockwise.
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function polar(cx, cy, r, degrees) {
  const radians = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.cos(radians), y: cy - r * Math.sin(radians) };
}

// SVG path for an arc drawn clockwise on screen from angle a0 down to angle a1.
export function arcPath(cx, cy, r, a0, a1) {
  const start = polar(cx, cy, r, a0);
  const end = polar(cx, cy, r, a1);
  const large = Math.abs(a0 - a1) > 180 ? 1 : 0;
  return `M ${round2(start.x)} ${round2(start.y)} A ${r} ${r} 0 ${large} 1 ${round2(end.x)} ${round2(end.y)}`;
}

// A 0..100 score on a semicircle running from 180 degrees (left, 0) to 0 degrees (right, 100).
export function gaugeAngle(value) {
  return 180 - 1.8 * clamp(value, 0, 100);
}
