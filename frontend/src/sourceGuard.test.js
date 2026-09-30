import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The server CSP and the "untrusted text is never parsed as HTML" rule are enforced here on SOURCE
// (the built bundle legitimately contains these words inside React itself), so comments count too.
const BANNED = ["dangerouslySetInnerHTML", "innerHTML", "outerHTML", "insertAdjacentHTML", "eval(", "new Function", "document.write"];
const SRC = resolve(process.cwd(), "src");

// Shipped source only: test files and the src/test/ support directory (fixtures hold real rule
// descriptions that mention these APIs) are skipped; the last test below proves none of it is imported.
const TEST_SUPPORT_DIR = join(SRC, "test");

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return path === TEST_SUPPORT_DIR ? [] : sourceFiles(path);
    return /\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("source guard", () => {
  const files = sourceFiles(SRC);

  it("finds the app's source files", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.endsWith("App.jsx"))).toBe(true);
  });

  it("never imports test support code into the shipped app", () => {
    const offenders = files.filter((f) => /from\s+["'][^"']*\/test\//.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it.each(BANNED)("no non-test source contains %s", (banned) => {
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes(banned));
    expect(offenders).toEqual([]);
  });
});
