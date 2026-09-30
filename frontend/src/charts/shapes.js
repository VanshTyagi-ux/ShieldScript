const round2 = (n) => Math.round(n * 100) / 100;

// A horizontal bar: square at the baseline (left), rounded at the data end (right). Empty for w <= 0.
export function roundedEndBar(x, y, w, h, r = 4) {
  if (!(w > 0)) return "";
  const rr = Math.max(0, Math.min(r, w, h / 2));
  const [x1, x2, y1, y2] = [round2(x), round2(x + w), round2(y), round2(y + h)];
  return `M ${x1} ${y1} H ${round2(x2 - rr)} A ${rr} ${rr} 0 0 1 ${x2} ${round2(y1 + rr)} V ${round2(y2 - rr)} A ${rr} ${rr} 0 0 1 ${round2(x2 - rr)} ${y2} H ${x1} Z`;
}

// The CSS class that colours a mark. item: { slot } (categorical 1-6) or { level } (risk level).
// kind: "fill" and "stroke" for SVG marks, "bg" for HTML swatches. No slot or level -> no class.
export function toneClass(item, kind) {
  if (item.slot) return `${kind}-s${item.slot}`;
  if (item.level) return `${kind}-t-${item.level}`;
  return "";
}
