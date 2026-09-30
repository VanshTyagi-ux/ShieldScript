import { STYLES } from "./styles.js";
import { applyStyles } from "./applyStyles.js";

const block = (re) => (STYLES.match(re) || [])[1] || "";
const tokens = (body) => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const LIGHT = tokens(block(/:root\s*\{([^}]*)\}/));
const DARK_SCOPE = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/;
const SYSTEM_DARK_SCOPE = /prefers-color-scheme:\s*dark\)\s*\{\s*:root:where\(:not\(\[data-theme="light"\]\)\)\s*\{([^}]*)\}/;
const DARK = { ...LIGHT, ...tokens(block(DARK_SCOPE)) };

const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("STYLES", () => {
  it("keeps the dark theme, responsive layout, highlight and reduced-motion rules", () => {
    for (const snippet of ["prefers-color-scheme: dark", "@media (min-width: 900px)", "mark.hit.on", "prefers-reduced-motion: reduce"]) {
      expect(STYLES).toContain(snippet);
    }
  });

  it("pulls nothing from the network", () => {
    expect(STYLES).not.toMatch(/@import|url\(\s*['"]?https?:/);
  });
});

describe("theme scopes", () => {
  it("applies the dark tokens identically under the system preference and the explicit dark choice", () => {
    const explicit = tokens(block(DARK_SCOPE));
    expect(Object.keys(explicit).length).toBeGreaterThan(10);
    expect(tokens(block(SYSTEM_DARK_SCOPE))).toEqual(explicit);
  });

  it("lets an explicit light choice beat the OS dark preference", () => {
    expect(STYLES).toContain(':where(:not([data-theme="light"]))');
  });

  it("puts the system-dark scope after the explicit scopes it must not override", () => {
    expect(STYLES.indexOf('prefers-color-scheme: dark')).toBeGreaterThan(STYLES.indexOf(':root {'));
  });
});

// Grids whose content is small and fixed, so an implicit column cannot overflow.
const ALLOWED_IMPLICIT_GRIDS = new Set([".skeleton-block", ".step-text", ".stat-skeleton", ".toasts"]);

describe("layout", () => {
  // A grid with no column template has one implicit `auto` column that grows to its widest content
  // (a legend, a chart), pushing the page wider than a phone. Every such grid must be able to shrink.
  it("gives every content grid a column template that can shrink to the screen", () => {
    const offenders = [];
    for (const [, selector, body] of STYLES.matchAll(/(?:^|\n)([^{}\n@]+)\{([^{}]*)\}/g)) {
      const name = selector.trim();
      if (/display:\s*grid/.test(body) && !/grid-template-columns/.test(body) && !ALLOWED_IMPLICIT_GRIDS.has(name)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});

describe("small screens", () => {
  it("scrolls charts sideways instead of shrinking their text", () => {
    expect(STYLES).toMatch(/\.chart-scroll \{[^}]*overflow-x: auto/);
    expect(STYLES).toMatch(/@media \(max-width: 719px\) \{[^@]*\.chart-scroll svg \{[^}]*min-width: 5\d\dpx/);
  });

  it("does not let table cells break inside words, which collapses columns to one letter per line", () => {
    expect(STYLES).not.toMatch(/(?:^|\n)th, td \{[^}]*overflow-wrap: anywhere/);
  });

  // Regression: a visually-hidden (position: absolute) header cell inside a scrolling table was not clipped by the
  // wrapper, so it sat in the scrolled-off part of the table and made the whole page scroll sideways on phones.
  it("makes a scrolling table wrapper the containing block of what is positioned inside it", () => {
    expect(STYLES).toMatch(/\.table-wrap \{[^}]*position: relative/);
    expect(STYLES).toMatch(/\.sr-only \{[^}]*position: absolute/); // the reason the rule above is needed
  });

  it("keeps wide tables at a readable minimum width so they scroll instead of collapsing", () => {
    expect(STYLES).toMatch(/\.outcome-table \{[^}]*min-width: \d+px/);
    expect(STYLES).toMatch(/\.rules-table \{[^}]*min-width: \d+px/);
  });
});

describe("design system", () => {
  it("defines the tokens for light and dark themes", () => {
    for (const name of ["bg", "surface", "surface-2", "border", "text", "muted", "accent", "shadow-sm", "shadow-md"]) {
      expect(LIGHT[name], `light --${name}`).toBeTruthy();
    }
    for (const name of ["bg", "surface", "surface-2", "border", "text", "muted", "accent", "shadow-sm"]) {
      expect(DARK[name] !== LIGHT[name], `dark --${name} is overridden`).toBe(true);
    }
  });

  it("defines six distinct hex series colours for both themes", () => {
    for (const [name, theme] of [["light", LIGHT], ["dark", DARK]]) {
      const series = [1, 2, 3, 4, 5, 6].map((n) => theme[`series-${n}`]);
      expect(series.every((c) => /^#[0-9a-f]{6}$/i.test(c || "")), `${name} series are hex`).toBe(true);
      expect(new Set(series).size, `${name} series are distinct`).toBe(6);
    }
  });

  it("gives every series and risk level a fill, stroke and background class for chart marks", () => {
    for (const name of ["s1", "s2", "s3", "s4", "s5", "s6", "t-safe", "t-low", "t-medium", "t-high", "t-critical"]) {
      for (const kind of ["fill", "stroke", "bg"]) expect(STYLES, `${kind}-${name}`).toContain(`.${kind}-${name} {`);
    }
  });

  it("uses an 8pt spacing scale with a 4px half-step", () => {
    const scale = Object.entries(LIGHT).filter(([k]) => k.startsWith("space-")).map(([, v]) => parseInt(v, 10));
    expect(scale).toEqual([4, 8, 12, 16, 24, 32, 48]);
  });

  it("keeps every padding, margin and gap on the 4px grid", () => {
    const spacing = /(?:^|[;{\s])((?:padding|margin)(?:-(?:top|right|bottom|left))?|(?:row-|column-)?gap)\s*:\s*([^;}]+)/g;
    const offenders = [];
    for (const [, prop, value] of STYLES.matchAll(spacing)) {
      for (const px of value.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
        if (Number(px[1]) % 4 !== 0) offenders.push(`${prop}: ${value.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses a normalised radius scale", () => {
    expect([LIGHT["radius-sm"], LIGHT.radius, LIGHT["radius-lg"], LIGHT["radius-pill"]]).toEqual(["4px", "8px", "12px", "999px"]);
    const allowed = new Set(["0", "var(--radius-sm)", "var(--radius)", "var(--radius-lg)", "var(--radius-pill)"]);
    const offenders = [];
    for (const [, value] of STYLES.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
      for (const part of value.trim().split(/\s+/)) if (!allowed.has(part)) offenders.push(value.trim());
    }
    expect(offenders).toEqual([]);
  });

  it("only transitions over 150ms or 200ms with ease-out", () => {
    expect(LIGHT["t-fast"]).toBe("150ms ease-out");
    expect(LIGHT["t-base"]).toBe("200ms ease-out");
    const offenders = [];
    for (const [, raw] of STYLES.matchAll(/(?:^|[;{\s])transition\s*:\s*([^;}]+)/g)) {
      const value = raw.replace(/!important/, "").trim();
      if (value === "none") continue;
      for (const part of value.split(",")) if (!/var\(--t-(fast|base)\)$/.test(part.trim())) offenders.push(value);
    }
    expect(offenders).toEqual([]);
  });

  it.each([
    "button:hover", "button:active", "button:focus-visible", "button:disabled",
    "button.sample:hover", "button.ghost:hover",
    "input:hover", "input:focus-visible", "input:disabled", "textarea:disabled",
    ".finding:hover", ".finding:focus-visible",
  ])("styles the %s state", (selector) => {
    expect(STYLES).toContain(selector);
  });

  it("has a loading skeleton that stops animating under reduced motion", () => {
    expect(STYLES).toContain("@keyframes shimmer");
    expect(STYLES).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^@]*animation:\s*none/);
  });

  it("keeps shadows soft", () => {
    for (const theme of [LIGHT, DARK]) {
      for (const name of ["shadow-sm", "shadow-md"]) {
        for (const [, rgba] of theme[name].matchAll(/rgba\(([^)]+)\)/g)) {
          expect(Number(rgba.split(",")[3])).toBeLessThanOrEqual(0.5);
        }
      }
    }
    for (const [, rgba] of LIGHT["shadow-md"].matchAll(/rgba\(([^)]+)\)/g)) expect(Number(rgba.split(",")[3])).toBeLessThanOrEqual(0.15);
  });

  it("has a descending heading scale above the body size", () => {
    const size = (tag) => Number((STYLES.match(new RegExp(`(?:^|\\n)${tag}\\s*\\{[^}]*?font-size:\\s*(\\d+)px`)) || [])[1]);
    expect(size("h1")).toBeGreaterThan(size("h2"));
    expect(size("h2")).toBeGreaterThan(size("h3"));
    expect(size("h3")).toBeGreaterThanOrEqual(14);
  });

  it("meets WCAG AA contrast (4.5:1) for text pairs in both themes", () => {
    const pairs = [
      ["--text", "--bg"], ["--text", "--surface"], ["--text", "--surface-2"],
      ["--muted", "--bg"], ["--muted", "--surface"], ["--muted", "--surface-2"],
      ["--placeholder", "--input-bg"],
      ["--on-accent", "--accent"], ["--on-accent", "--accent-hover"], ["--on-accent", "--accent-active"],
      ["--danger-text", "--surface"], ["--danger-text", "--surface-2"], ["--ok-text", "--surface"],
      ["#ffffff", "--safe"], ["#ffffff", "--low"], ["#ffffff", "--high"], ["#ffffff", "--critical"], ["--on-medium", "--medium"],
    ];
    const failures = [];
    for (const [themeName, theme] of [["light", LIGHT], ["dark", DARK]]) {
      const colour = (ref) => (ref.startsWith("--") ? theme[ref.slice(2)] : ref);
      for (const [fg, bg] of pairs) {
        const [a, b] = [colour(fg), colour(bg)];
        if (!/^#[0-9a-f]{6}$/i.test(a || "") || !/^#[0-9a-f]{6}$/i.test(b || "")) { failures.push(`${themeName} ${fg} on ${bg}: not a hex colour`); continue; }
        const ratio = contrast(a, b);
        if (ratio < 4.5) failures.push(`${themeName} ${fg} ${a} on ${bg} ${b}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("applyStyles", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.adoptedStyleSheets;
  });

  it("adds exactly one constructed stylesheet and no <style> element", () => {
    const replaceSync = vi.fn();
    vi.stubGlobal("CSSStyleSheet", class { constructor() { this.replaceSync = replaceSync; } });
    document.adoptedStyleSheets = [];
    expect(applyStyles(document)).toBe(true);
    expect(replaceSync).toHaveBeenCalledTimes(1);
    expect(replaceSync).toHaveBeenCalledWith(STYLES);
    expect(document.adoptedStyleSheets).toHaveLength(1);
    expect(document.querySelectorAll("style")).toHaveLength(0);
  });

  it("returns false without throwing when constructable stylesheets are missing", () => {
    vi.stubGlobal("CSSStyleSheet", undefined);
    document.adoptedStyleSheets = [];
    expect(applyStyles(document)).toBe(false);
    expect(document.querySelectorAll("style")).toHaveLength(0);
  });

  it("returns false without throwing when replaceSync is missing", () => {
    vi.stubGlobal("CSSStyleSheet", class {});
    document.adoptedStyleSheets = [];
    expect(applyStyles(document)).toBe(false);
  });

  it("returns false without throwing when the document has no adoptedStyleSheets", () => {
    vi.stubGlobal("CSSStyleSheet", class { replaceSync() {} });
    expect(applyStyles(document)).toBe(false);
  });
});
