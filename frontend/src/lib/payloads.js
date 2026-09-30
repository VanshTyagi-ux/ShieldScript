// Pure helpers for the payload browser: the list's state lives in the URL (?category=&source_file=&page=&size=),
// so a filtered page can be bookmarked, shared and reached with the back button.
export const PAGE_SIZES = [25, 50, 100];
export const DEFAULT_SIZE = 50;
const MAX_PAGE = 100000; // far beyond any real data set; keeps a hand-edited URL from asking for absurd offsets

// Category -> chart series slot, for the colour dot next to its name (the name is always shown too).
const SLOTS = { standard: 1, polyglot: 2, bypass: 3, encoded: 4 };
export const categorySlot = (name) => SLOTS[name] || 5;

const positiveInt = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_PAGE) : fallback;
};

// "?category=bypass&page=2" -> { category, sourceFile, page, size }. Anything unusable falls back to the default.
export function readQuery(search) {
  const params = new URLSearchParams(search);
  const size = positiveInt(params.get("size"), DEFAULT_SIZE);
  return {
    category: (params.get("category") || "").trim(),
    sourceFile: (params.get("source_file") || "").trim(),
    page: positiveInt(params.get("page"), 1),
    size: PAGE_SIZES.includes(size) ? size : DEFAULT_SIZE,
  };
}

// The inverse of readQuery, leaving out defaults so the common URL stays short. "" or "?a=b".
export function buildSearch({ category, sourceFile, page, size }) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (sourceFile) params.set("source_file", sourceFile);
  if (page > 1) params.set("page", String(page));
  if (size !== DEFAULT_SIZE) params.set("size", String(size));
  const text = params.toString();
  return text ? `?${text}` : "";
}

// The API path for one page of the list.
export function listPath({ category, sourceFile, page, size }) {
  const params = new URLSearchParams({ skip: String((page - 1) * size), limit: String(size) });
  if (category) params.set("category", category);
  if (sourceFile) params.set("source_file", sourceFile);
  return `/payloads?${params}`;
}

// -> { from, to, pages }: rows "from-to" of `total` are on this page (from is 0 when the page is empty).
export function pageWindow({ page, size }, total, shown) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = shown === 0 ? 0 : (page - 1) * size + 1;
  return { from, to: shown === 0 ? 0 : from + shown - 1, pages };
}

// One line for a table cell. Cut on a code point boundary, so an emoji is never split in half.
export function truncate(text, max = 140) {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join("")}…`;
}

// "2026-09-28T14:33:00" -> "2026-09-28 14:33 UTC". SQLite hands back UTC times without a zone marker, which
// JavaScript would read as local time, so a missing zone is taken as UTC.
export function formatCreated(iso) {
  if (typeof iso !== "string") return "";
  const date = new Date(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? iso : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
