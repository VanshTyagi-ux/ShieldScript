import { BACKEND_PAGES, parseFlag } from "./features.js";

describe("parseFlag", () => {
  it("reads the usual spellings of true and false, ignoring case and spaces", () => {
    for (const on of ["1", "true", "TRUE", " yes ", "On"]) expect(parseFlag(on, false), on).toBe(true);
    for (const off of ["0", "false", "False", " no ", "OFF"]) expect(parseFlag(off, true), off).toBe(false);
  });

  it("uses the fallback for anything else, including an unset variable", () => {
    for (const other of [undefined, null, "", "maybe", 1, {}]) {
      expect(parseFlag(other, true)).toBe(true);
      expect(parseFlag(other, false)).toBe(false);
    }
    expect(parseFlag(undefined)).toBe(true); // on by default
  });
});

describe("BACKEND_PAGES", () => {
  it("follows VITE_BACKEND_PAGES, and is on when it is not set", () => {
    expect(BACKEND_PAGES).toBe(parseFlag(import.meta.env?.VITE_BACKEND_PAGES));
  });
});
