import { segments } from "./segments.js";

const finding = (rule_id, match, position, category = "markup") => ({ rule_id, match, position, category });

describe("segments", () => {
  it("returns one plain segment when there are no findings", () => {
    expect(segments("hello", [])).toEqual([{ text: "hello", rules: [] }]);
  });

  it("returns nothing for an empty string", () => {
    expect(segments("", [finding("XSS002", "x", 0)])).toEqual([]);
  });

  it("marks a single match between plain text", () => {
    const decoded = "<img src=x onerror=alert(1)>";
    expect(segments(decoded, [finding("XSS002", "onerror=", 11)])).toEqual([
      { text: "<img src=x ", rules: [] },
      { text: "onerror=", rules: ["XSS002"] },
      { text: "alert(1)>", rules: [] },
    ]);
  });

  it("splits overlapping matches at every edge", () => {
    expect(segments("abcdef", [finding("A", "abcd", 0), finding("B", "cdef", 2)])).toEqual([
      { text: "ab", rules: ["A"] },
      { text: "cd", rules: ["A", "B"] },
      { text: "ef", rules: ["B"] },
    ]);
  });

  it("ignores a match that is not in the decoded text", () => {
    expect(segments("hello", [finding("XSS001", "world", 0)])).toEqual([{ text: "hello", rules: [] }]);
  });

  it("ignores the evasion finding, which has no text match", () => {
    const evasion = finding("XSS099", "1 decoding layer(s)", 0, "evasion");
    expect(segments("<script>", [evasion])).toEqual([{ text: "<script>", rules: [] }]);
  });

  it("uses the position hint to pick the right occurrence", () => {
    expect(segments("aa aa", [finding("R", "aa", 3)])).toEqual([
      { text: "aa ", rules: [] },
      { text: "aa", rules: ["R"] },
    ]);
  });

  it("maps the server's code-point position to a UTF-16 offset (an earlier duplicate must not win)", () => {
    // 10 emoji = 10 code points but 20 UTF-16 units. The server's position of the SECOND "onerror="
    // is 19 (code points); used unconverted it lands before the FIRST occurrence and marks that one.
    const decoded = `${"😀".repeat(10)}onerror= onerror=`;
    const out = segments(decoded, [finding("XSS002", "onerror=", 19)]);
    expect(out.map((s) => s.text)).toEqual([`${"😀".repeat(10)}onerror= `, "onerror="]);
    expect(out.map((s) => s.rules)).toEqual([[], ["XSS002"]]);
  });

  it("still finds the match when astral characters precede it (code points vs UTF-16 units)", () => {
    // Python reports position 2 (two code points); in JS the emoji take 4 units.
    const out = segments("😀😀<img onerror=x>", [finding("XSS002", "onerror=", 2)]);
    expect(out.filter((s) => s.rules.length).map((s) => s.text)).toEqual(["onerror="]);
    expect(out.map((s) => s.text).join("")).toBe("😀😀<img onerror=x>");
  });
});
