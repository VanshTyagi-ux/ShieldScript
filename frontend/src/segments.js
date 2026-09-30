// The server reports `position` in code points; JS strings are indexed in UTF-16 units.
const toUtf16 = (text, codePoints) => [...text].slice(0, codePoints).join("").length;

// Splits `decoded` into runs of text, each tagged with the ids of the rules whose match covers it.
// Ranges can overlap, so the text is cut at every range edge.
export function segments(decoded, findings) {
  const ranges = [];
  for (const f of findings) {
    if (f.category === "evasion" || !f.match) continue; // the obfuscation finding has no text match
    const start = decoded.indexOf(f.match, toUtf16(decoded, f.position));
    if (start >= 0) ranges.push({ id: f.rule_id, start, end: start + f.match.length });
  }
  const cuts = [...new Set([0, decoded.length, ...ranges.flatMap((r) => [r.start, r.end])])].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    out.push({
      text: decoded.slice(a, b),
      rules: ranges.filter((r) => r.start <= a && r.end >= b).map((r) => r.id),
    });
  }
  return out;
}
