// Pure chart maths: scales, tick rounding and number formatting. Nothing here touches the DOM.

const roundAway = (v) => Math.round(v * 1e10) / 1e10; // 0.6000000000000001 -> 0.6

// Ticks at a clean step (1, 2 or 5 x 10^n): the smallest step that gives at most `count` intervals,
// starting at or below `min` and ending at or above `max`.
export function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw - 1e-12);
  const first = Math.floor(min / step + 1e-9);
  const last = Math.ceil(max / step - 1e-9);
  const ticks = [];
  for (let i = first; i <= last; i++) ticks.push(roundAway(i * step));
  return ticks;
}

// value -> position. A degenerate domain maps everything to the middle of the range (never NaN).
export function linearScale([d0, d1], [r0, r1]) {
  if (d0 === d1) return () => (r0 + r1) / 2;
  const k = (r1 - r0) / (d1 - d0);
  return (value) => r0 + (value - d0) * k;
}

// Evenly spaced bands for categories: start(key) is the band's leading edge, centred in its slot.
export function bandScale(keys, [r0, r1], { padding = 0.2 } = {}) {
  const n = keys.length;
  const step = n ? (r1 - r0) / n : 0;
  const bandwidth = step * (1 - padding);
  return {
    step,
    bandwidth,
    start(key) {
      const i = keys.indexOf(key);
      return i < 0 ? undefined : r0 + i * step + (step - bandwidth) / 2;
    },
  };
}

export function formatPercent(fraction, digits = 1) {
  return Number.isFinite(fraction) ? `${(fraction * 100).toFixed(digits)}%` : "n/a";
}

export function formatCount(n) {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "n/a";
}
