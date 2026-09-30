// Shared constants and helpers for the SVG charts. Charts draw in a 640-wide coordinate space and scale
// to their container (the SVG has a viewBox and width: 100%).
export const VIEW_WIDTH = 640;

export const isNum = (value) => typeof value === "number" && Number.isFinite(value);
export const r2 = (n) => Math.round(n * 100) / 100;

// Axis labels never overflow their column: long text is cut with an ellipsis (the full text stays in the
// mark's accessible name and the tooltip).
export const truncate = (text, max = 34) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
