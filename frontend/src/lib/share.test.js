import { MAX_SHARE_CHARS, buildShareUrl, decodeShare, encodeShare } from "./share.js";

describe("share links", () => {
  it("round-trips unicode, markup and quotes", () => {
    const text = '😀 <script>alert("é & q")</script> \n tab\t';
    const encoded = encodeShare(text);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/); // url-safe, no padding
    expect(decodeShare(encoded)).toBe(text);
  });

  it("refuses empty text and text over the cap", () => {
    expect(encodeShare("")).toBeNull();
    expect(encodeShare("x".repeat(MAX_SHARE_CHARS))).not.toBeNull();
    expect(encodeShare("x".repeat(MAX_SHARE_CHARS + 1))).toBeNull();
  });

  it("returns null for anything that is not a valid encoded share", () => {
    expect(decodeShare(null)).toBeNull();
    expect(decodeShare("")).toBeNull();
    expect(decodeShare("!!!")).toBeNull();
    expect(decodeShare("a")).toBeNull(); // impossible base64 length
    expect(decodeShare("__4")).toBeNull(); // valid base64 of bytes FF FE: not UTF-8
  });

  it("refuses an oversized parameter without decoding it", () => {
    expect(decodeShare("A".repeat(20000))).toBeNull();
  });

  it("builds a scanner URL, or null when the text cannot be shared", () => {
    const url = buildShareUrl("<b>hi</b>", "https://example.com");
    expect(url.startsWith("https://example.com/scanner?t=")).toBe(true);
    expect(decodeShare(url.split("t=")[1])).toBe("<b>hi</b>");
    expect(buildShareUrl("x".repeat(MAX_SHARE_CHARS + 1), "https://example.com")).toBeNull();
  });
});
