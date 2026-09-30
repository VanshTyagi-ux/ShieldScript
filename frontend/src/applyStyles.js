import { STYLES } from "./styles.js";

// Installs STYLES as a constructable stylesheet. Returns false (page stays unstyled but usable)
// on browsers without constructable stylesheets; a <style> fallback would be blocked by the CSP.
export function applyStyles(doc = document) {
  if (!("adoptedStyleSheets" in doc)) return false;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLES);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    return true;
  } catch (_) {
    return false;
  }
}
