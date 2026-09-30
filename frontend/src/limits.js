// Keep in step with MAX_BODY in xss_detector/server.py. The server answers 413 above this, but a
// body far above it can get a connection reset instead, so the UI refuses to send it at all.
export const MAX_BODY_BYTES = 256 * 1024;

// True if `body`, serialised as JSON (what the server actually receives), exceeds the limit.
export function tooLarge(body) {
  return new Blob([JSON.stringify(body)]).size > MAX_BODY_BYTES;
}

// Keep in step with MAX_HTML_LENGTH in backend/app/core/config.py. POST /sanitize answers 413 above this many
// characters (sanitizing deeply nested markup gets slow), so the playground refuses to send more.
export const MAX_HTML_CHARS = 64000;
