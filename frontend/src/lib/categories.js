// Rule categories keep one colour on every chart (colour follows the entity, never its rank).
export const CATEGORY_SLOTS = { markup: 1, uri: 2, javascript: 3, css: 4, template: 5, evasion: 6 };

const LABELS = { uri: "URI", css: "CSS", javascript: "JavaScript" };

export function categoryLabel(name) {
  return LABELS[name] || name.charAt(0).toUpperCase() + name.slice(1);
}

// Unknown categories get no slot, so their marks stay neutral rather than borrowing another colour.
export function categorySlot(name) {
  return CATEGORY_SLOTS[name];
}
