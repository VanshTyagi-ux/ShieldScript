// Design tokens. LIGHT and the fixed scales live in :root; DARK overrides are emitted twice from the
// same object - once for an explicit choice (data-theme="dark") and once for the OS preference, which an
// explicit light choice beats (:where(:not([data-theme="light"])) keeps the specificity low).
export const LIGHT = {
  /* neutrals (slate) */
  bg: "#f8fafc", surface: "#ffffff", "surface-2": "#f1f5f9", "input-bg": "#ffffff",
  border: "#e2e8f0", "border-strong": "#cbd5e1",
  text: "#0f172a", muted: "#566379", placeholder: "#64748b",
  /* the single accent */
  accent: "#0057ff", "accent-hover": "#0048d1", "accent-active": "#003aa6", "on-accent": "#ffffff",
  "accent-soft": "rgba(0, 87, 255, .08)",
  /* semantic status colours; level colours carry white text (amber carries dark text) */
  safe: "#177a42", low: "#4f7a12", medium: "#e0a800", high: "#c24d0c", critical: "#c81e3a", "on-medium": "#1e293b",
  "danger-text": "#b91c1c", "danger-soft": "rgba(200, 30, 58, .08)", "danger-border": "rgba(200, 30, 58, .3)",
  "ok-text": "#15803d", "ok-soft": "rgba(23, 122, 66, .1)",
  hit: "rgba(224, 168, 0, .3)", "hit-on": "rgba(200, 30, 58, .28)",
  /* elevation */
  "shadow-sm": "0 1px 2px rgba(15, 23, 42, .05), 0 1px 3px rgba(15, 23, 42, .06)",
  "shadow-md": "0 4px 12px rgba(15, 23, 42, .08)",
  /* chart series, in the fixed categorical order (validated with the dataviz validator, see the ledger) */
  "series-1": "#0057ff", "series-2": "#e8540a", "series-3": "#009688", "series-4": "#d68910", "series-5": "#c81a6e", "series-6": "#159c42",
  /* bold full-bleed section background (Home's hero and closing CTA); white text on it passes 4.5:1+ at every stop, both themes */
  "hero-gradient": "linear-gradient(135deg, #0057ff 0%, #003aa6 100%)",
};

// Theme-independent scales: spacing (8pt grid with a 4px half-step), radii, motion, type.
export const FIXED = {
  "space-1": "4px", "space-2": "8px", "space-3": "12px", "space-4": "16px", "space-5": "24px", "space-6": "32px", "space-7": "48px",
  "radius-sm": "4px", radius: "8px", "radius-lg": "12px", "radius-pill": "999px",
  "t-fast": "150ms ease-out", "t-base": "200ms ease-out",
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export const DARK = {
  bg: "#0b1220", surface: "#121a2b", "surface-2": "#1a2438", "input-bg": "#0e1526",
  border: "#243049", "border-strong": "#33425f",
  text: "#e5eaf3", muted: "#9aa7bd", placeholder: "#8b98ad",
  accent: "#5b93ff", "accent-hover": "#7aa8ff", "accent-active": "#9dbeff", "on-accent": "#0b1220",
  "accent-soft": "rgba(91, 147, 255, .16)",
  "danger-text": "#fca5a5", "danger-soft": "rgba(248, 113, 113, .12)", "danger-border": "rgba(248, 113, 113, .35)",
  "ok-text": "#86efac", "ok-soft": "rgba(74, 222, 128, .12)",
  "hit-on": "rgba(248, 113, 113, .4)",
  "shadow-sm": "0 1px 2px rgba(0, 0, 0, .4), 0 1px 3px rgba(0, 0, 0, .3)",
  "shadow-md": "0 4px 12px rgba(0, 0, 0, .5)",
  "series-1": "#3d7fe0", "series-2": "#d9601f", "series-3": "#12a390", "series-4": "#c07d0a", "series-5": "#e0588f", "series-6": "#178f4a",
  "hero-gradient": "linear-gradient(135deg, #1450c9 0%, #0b1220 100%)",
};

const declarations = (tokens) => Object.entries(tokens).map(([name, value]) => `--${name}: ${value};`).join("\n  ");

export const TOKENS_CSS = `
:root {
  color-scheme: light;
  ${declarations(LIGHT)}
  ${declarations(FIXED)}
}
:root[data-theme="dark"] {
  color-scheme: dark;
  ${declarations(DARK)}
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    ${declarations(DARK)}
  }
}
`;
