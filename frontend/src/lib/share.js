// Share links: /scanner?t=<base64url(UTF-8 text)>. The text is capped, and decoding never throws.
export const MAX_SHARE_CHARS = 2000;
const MAX_PARAM_CHARS = 12000; // base64 of the worst case (2000 chars x 3 bytes) is 8000; refuse anything far beyond

export function encodeShare(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_SHARE_CHARS) return null;
  let binary = "";
  new TextEncoder().encode(text).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShare(param) {
  if (typeof param !== "string" || param.length === 0 || param.length > MAX_PARAM_CHARS) return null;
  try {
    const base64 = param.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.length > 0 && text.length <= MAX_SHARE_CHARS ? text : null;
  } catch (_) {
    return null;
  }
}

// `path` is the page that reads ?t= back: the scanner by default, or e.g. "/playground".
export function buildShareUrl(text, origin, path = "/scanner") {
  const encoded = encodeShare(text);
  return encoded ? `${origin}${path}?t=${encoded}` : null;
}
