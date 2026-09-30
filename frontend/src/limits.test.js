import { MAX_BODY_BYTES, tooLarge } from "./limits.js";

// `{"text":""}` is 11 bytes of JSON, so a text of 262133 ASCII characters is exactly at the limit.
const JSON_OVERHEAD = JSON.stringify({ text: "" }).length;

describe("limits", () => {
  it("matches the server's 256 KiB request limit", () => {
    expect(MAX_BODY_BYTES).toBe(256 * 1024);
  });

  it("accepts a body of exactly the limit and rejects one byte more", () => {
    expect(tooLarge({ text: "a".repeat(MAX_BODY_BYTES - JSON_OVERHEAD) })).toBe(false);
    expect(tooLarge({ text: "a".repeat(MAX_BODY_BYTES - JSON_OVERHEAD + 1) })).toBe(true);
  });

  it("counts UTF-8 bytes, not characters", () => {
    // an emoji is 2 UTF-16 units but 4 UTF-8 bytes: 70000 of them are 140000 units yet 280000 bytes
    expect(tooLarge({ text: "😀".repeat(70000) })).toBe(true);
  });

  it("counts the JSON escaping the server will actually receive", () => {
    // 200000 quotes are 200000 characters but 400000 bytes once escaped as \"
    expect(tooLarge({ text: '"'.repeat(200000) })).toBe(true);
  });
});
