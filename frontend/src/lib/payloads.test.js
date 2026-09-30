import { DEFAULT_SIZE, PAGE_SIZES, buildSearch, categorySlot, formatCreated, listPath, pageWindow, readQuery, truncate } from "./payloads.js";

describe("readQuery", () => {
  it("has defaults for an empty query", () => {
    expect(readQuery("")).toEqual({ category: "", sourceFile: "", page: 1, size: 50 });
  });

  it("reads every parameter", () => {
    expect(readQuery("?category=bypass&source_file=XSS-Somdev.txt&page=3&size=25"))
      .toEqual({ category: "bypass", sourceFile: "XSS-Somdev.txt", page: 3, size: 25 });
  });

  it("falls back on junk instead of failing", () => {
    for (const search of ["?page=abc", "?page=0", "?page=-4", "?page=", "?page=1.9x"]) {
      expect(readQuery(search).page, search).toBe(1); // "1.9x" reads as 1, like parseInt
    }
    expect(readQuery("?size=7").size).toBe(DEFAULT_SIZE); // only the offered sizes
    expect(readQuery("?size=100000").size).toBe(DEFAULT_SIZE);
    expect(PAGE_SIZES).toContain(readQuery("?size=100").size);
  });

  it("caps an absurd page number", () => {
    expect(readQuery("?page=99999999999999999999").page).toBe(100000);
  });

  it("trims filters and treats blank ones as unset", () => {
    expect(readQuery("?category=%20bypass%20&source_file=%20")).toMatchObject({ category: "bypass", sourceFile: "" });
  });
});

describe("buildSearch", () => {
  it("leaves out the defaults", () => {
    expect(buildSearch({ category: "", sourceFile: "", page: 1, size: 50 })).toBe("");
    expect(buildSearch({ category: "bypass", sourceFile: "", page: 2, size: 25 })).toBe("?category=bypass&page=2&size=25");
  });

  it("round-trips through readQuery, including characters that need escaping", () => {
    const query = { category: "bypass", sourceFile: "a b&c=d#e.txt", page: 7, size: 100 };
    expect(readQuery(buildSearch(query))).toEqual(query);
  });
});

describe("listPath", () => {
  it("turns a page into skip and limit", () => {
    expect(listPath({ category: "", sourceFile: "", page: 1, size: 50 })).toBe("/payloads?skip=0&limit=50");
    expect(listPath({ category: "", sourceFile: "", page: 3, size: 25 })).toBe("/payloads?skip=50&limit=25");
  });

  it("adds the filters, encoded", () => {
    expect(listPath({ category: "encoded", sourceFile: "XSS EnDe&x.txt", page: 2, size: 25 }))
      .toBe("/payloads?skip=25&limit=25&category=encoded&source_file=XSS+EnDe%26x.txt");
  });

  it("stays within the backend's skip limit even for the largest page and size", () => {
    const { page, size } = readQuery("?page=99999999&size=100");
    expect(Number(new URLSearchParams(listPath({ category: "", sourceFile: "", page, size }).split("?")[1]).get("skip"))).toBeLessThanOrEqual(2147483647);
  });
});

describe("pageWindow", () => {
  it("describes a full, a last and an empty page", () => {
    expect(pageWindow({ page: 1, size: 50 }, 8562, 50)).toEqual({ from: 1, to: 50, pages: 172 });
    expect(pageWindow({ page: 172, size: 50 }, 8562, 12)).toEqual({ from: 8551, to: 8562, pages: 172 });
    expect(pageWindow({ page: 9, size: 50 }, 60, 0)).toEqual({ from: 0, to: 0, pages: 2 });
    expect(pageWindow({ page: 1, size: 50 }, 0, 0)).toEqual({ from: 0, to: 0, pages: 1 });
  });
});

describe("truncate", () => {
  it("leaves short text alone and cuts long text with an ellipsis", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("x".repeat(20), 10)).toBe(`${"x".repeat(10)}…`);
  });

  it("never splits an emoji", () => {
    const cut = truncate("😀".repeat(6), 4);
    expect(cut).toBe(`${"😀".repeat(4)}…`);
    expect(cut).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});

describe("formatCreated", () => {
  it("reads a time without a zone as UTC, whatever the local zone", () => {
    expect(formatCreated("2026-09-28T14:33:00")).toBe("2026-09-28 14:33 UTC");
  });

  it("converts an explicit zone to UTC", () => {
    expect(formatCreated("2026-09-28T14:33:00Z")).toBe("2026-09-28 14:33 UTC");
    expect(formatCreated("2026-09-28T16:33:00+02:00")).toBe("2026-09-28 14:33 UTC");
  });

  it("returns unparseable or missing values as they are", () => {
    expect(formatCreated("not a date")).toBe("not a date");
    expect(formatCreated(null)).toBe("");
  });
});

describe("categorySlot", () => {
  it("gives the known categories distinct colours and everything else a neutral one", () => {
    const slots = ["standard", "polyglot", "bypass", "encoded"].map(categorySlot);
    expect(new Set(slots).size).toBe(4);
    expect(categorySlot("anything else")).toBe(5);
  });
});
