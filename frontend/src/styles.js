// The whole stylesheet as one string, built from the modules in ./styles. applyStyles() installs it as a
// constructable stylesheet, because the server CSP (default-src 'self') blocks <style> elements and
// style= attributes.
//
// Design system: slate neutrals, ONE accent (indigo), an 8pt spacing scale with a 4px half-step, a
// 4 / 8 / 12 / pill radius scale, and 150ms / 200ms ease-out transitions. The risk-level colours
// (safe .. critical) are semantic status colours, not part of the chrome accent. styles.test.js enforces
// the grid, radii, transitions, interactive states and WCAG contrast. Order matters: MOTION must be last.
import { BASE } from "./styles/base.js";
import { CHARTS } from "./styles/charts.js";
import { COMPONENTS } from "./styles/components.js";
import { LAYOUT } from "./styles/layout.js";
import { MOTION } from "./styles/motion.js";
import { PAGES } from "./styles/pages.js";
import { SITE } from "./styles/site.js";
import { TOKENS_CSS } from "./styles/tokens.js";
import { TOOLS } from "./styles/tools.js";

export const STYLES = [TOKENS_CSS, BASE, LAYOUT, COMPONENTS, SITE, PAGES, TOOLS, CHARTS, MOTION].join("\n");
