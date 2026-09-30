import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { copyText } from "../lib/clipboard.js";
import { RouterProvider } from "../lib/router.jsx";
import { ToastProvider } from "../lib/toast.jsx";
import { useApi } from "../lib/useApi.js";
import { FACETS_FIXTURE, PAYLOADS_FIXTURE, PAYLOAD_ROWS } from "../test/fixtures.js";
import { PayloadsPage } from "./Payloads.jsx";

vi.mock("../lib/useApi.js", () => ({ useApi: vi.fn() }));
vi.mock("../lib/clipboard.js", () => ({ copyText: vi.fn() }));

const reload = vi.fn();
const listCalls = () => useApi.mock.calls.map(([path]) => path).filter((p) => p.startsWith("/payloads?"));
const lastList = () => listCalls().at(-1);

// The list and the facets are two useApi calls; answer each by path.
function respond({ list = { status: "ok", data: PAYLOADS_FIXTURE, error: null }, facets = { status: "ok", data: FACETS_FIXTURE, error: null } } = {}) {
  useApi.mockImplementation((path) => ({ reload, ...(path === "/payloads/facets" ? facets : list) }));
}

const routes = [{ path: "/payloads", title: "Payloads", component: PayloadsPage }];
function mount(url = "/payloads") {
  window.history.pushState(null, "", url);
  return render(
    <ToastProvider>
      <RouterProvider routes={routes} notFound={{ title: "x", component: () => null }}><PayloadsPage /></RouterProvider>
    </ToastProvider>,
  );
}
const rows = () => [...document.querySelectorAll(".payload-table tbody tr:not(.payload-detail)")];
const cellText = (row, i) => row.querySelectorAll("td")[i].textContent;

beforeEach(() => { useApi.mockReset(); reload.mockReset(); copyText.mockReset(); respond(); });

describe("PayloadsPage: data", () => {
  it("asks for the first page and for the filter options", () => {
    mount();
    expect(lastList()).toBe("/payloads?skip=0&limit=50");
    expect(useApi).toHaveBeenCalledWith("/payloads/facets");
  });

  it("has a single h1", () => {
    mount();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows a row per payload with its id, category, source and content", () => {
    mount();
    expect(rows()).toHaveLength(3);
    expect(rows().map((r) => cellText(r, 0))).toEqual(["1", "2", "3"]);
    expect(cellText(rows()[1], 1)).toBe("Bypass");
    expect(cellText(rows()[1], 2)).toBe("XSS-Bypass-Strings-BruteLogic.txt");
    expect(cellText(rows()[1], 3)).toBe("javascript:alert(1)");
  });

  it("summarises the page and the total", () => {
    mount();
    expect(screen.getByText("Showing 1-3 of 8,562 payloads")).toBeTruthy();
  });

  it("shows a skeleton while the first load is pending", () => {
    respond({ list: { status: "loading", data: null, error: null } });
    mount();
    expect(screen.getByRole("status", { name: "Loading payloads" })).toBeTruthy();
    expect(document.querySelector(".payload-table")).toBeNull();
  });

  it("shows the reason and a working Retry button when loading failed", () => {
    respond({ list: { status: "error", data: null, error: "network down" } });
    mount();
    expect(screen.getByRole("alert").textContent).toContain("Could not load the payloads: network down");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("explains how to reach the FastAPI backend when the API has no /payloads (a 404)", () => {
    respond({ list: { status: "error", data: null, error: "Not found" } });
    mount();
    expect(screen.getByRole("note").textContent).toContain("This API does not provide /payloads");
    expect(screen.getByRole("note").textContent).toContain("VITE_API_URL");
  });

  it("keeps the previous page on screen, dimmed, while the next one loads", () => {
    const { rerender } = mount();
    respond({ list: { status: "loading", data: null, error: null } });
    rerender(
      <ToastProvider>
        <RouterProvider routes={routes} notFound={{ title: "x", component: () => null }}><PayloadsPage /></RouterProvider>
      </ToastProvider>,
    );
    expect(rows()).toHaveLength(3);
    expect(document.querySelector(".dimmed .payload-table")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading payloads" })).toBeNull();
  });
});

describe("PayloadsPage: rendering safety", () => {
  it("shows hostile payload text literally and never as markup", () => {
    const hostile = [{ id: 9, content: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>', source_file: "<b>f</b>.txt", category: "<i>c</i>", created_at: "2026-09-28T14:33:00" }];
    respond({ list: { status: "ok", data: { ...PAYLOADS_FIXTURE, items: hostile, total: 1 }, error: null } });
    const { container } = mount();
    expect(container.querySelector("img, script, b, i:not(.cat-dot)")).toBeNull(); // .cat-dot is the app's own colour swatch
    expect(window.__pwned).toBeUndefined();
    expect(rows()[0].textContent).toContain('<img src=x onerror="window.__pwned=1">');
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(container.querySelector("img, script")).toBeNull();
  });

  it("cuts long content in the table and shows all of it in the details", () => {
    const long = "A".repeat(500);
    respond({ list: { status: "ok", data: { ...PAYLOADS_FIXTURE, items: [{ ...PAYLOAD_ROWS[0], content: long }], total: 1 }, error: null } });
    mount();
    expect(rows()[0].querySelector(".payload-code").textContent).toBe(`${"A".repeat(140)}…`);
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(document.querySelector(".payload-full").textContent).toBe(long);
  });
});

describe("PayloadsPage: filters", () => {
  it("offers a chip per category with its count, and the source files with counts", () => {
    mount();
    const group = screen.getByRole("group", { name: "Category" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(
      ["All", "Standard (8,027)", "Encoded (415)", "Polyglot (61)", "Bypass (59)"]);
    expect(within(group).getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    const options = [...screen.getByLabelText("Source file").querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["All files", "XSS-Cheat-Sheet-PortSwigger.txt (6,042)", "XSS-BruteLogic.txt (113)"]);
  });

  it("picking a category puts it in the URL, starts at page 1 and asks the API for it", () => {
    mount("/payloads?page=4");
    fireEvent.click(screen.getByRole("button", { name: "Bypass (59)" }));
    expect(window.location.search).toBe("?category=bypass");
    expect(lastList()).toBe("/payloads?skip=0&limit=50&category=bypass");
    expect(screen.getByRole("button", { name: "Bypass (59)" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("picking a source file filters by it, and combines with the category", () => {
    mount("/payloads?category=standard");
    fireEvent.change(screen.getByLabelText("Source file"), { target: { value: "XSS-BruteLogic.txt" } });
    expect(window.location.search).toBe("?category=standard&source_file=XSS-BruteLogic.txt");
    expect(lastList()).toBe("/payloads?skip=0&limit=50&category=standard&source_file=XSS-BruteLogic.txt");
  });

  it("reads its whole state from the URL, so a bookmark or reload restores the view", () => {
    mount("/payloads?category=encoded&source_file=XSS-EnDe-h4k.txt&page=3&size=25");
    expect(lastList()).toBe("/payloads?skip=50&limit=25&category=encoded&source_file=XSS-EnDe-h4k.txt");
    expect(screen.getByLabelText("Source file").value).toBe("XSS-EnDe-h4k.txt");
    expect(screen.getByLabelText("Per page").value).toBe("25");
  });

  it("keeps a source file from the URL selectable even when the options do not list it", () => {
    mount("/payloads?source_file=mystery.txt");
    expect(screen.getByLabelText("Source file").value).toBe("mystery.txt");
  });

  it("changing the page size resets to page 1", () => {
    mount("/payloads?page=3");
    fireEvent.change(screen.getByLabelText("Per page"), { target: { value: "100" } });
    expect(window.location.search).toBe("?size=100");
  });

  it("shows Clear filters only when a filter is active, and it clears them all", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bypass (59)" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(window.location.search).toBe("");
  });

  it("ignores junk in the URL rather than failing", () => {
    mount("/payloads?page=abc&size=7&category=");
    expect(lastList()).toBe("/payloads?skip=0&limit=50");
  });

  it("still works while the filter options are loading or failed", () => {
    respond({ facets: { status: "error", data: null, error: "boom" } });
    mount();
    expect(rows()).toHaveLength(3);
    expect(within(screen.getByRole("group", { name: "Category" })).getAllByRole("button")).toHaveLength(1);
  });
});

describe("PayloadsPage: paging", () => {
  const twoPages = { ...PAYLOADS_FIXTURE, total: 120 };
  beforeEach(() => respond({ list: { status: "ok", data: twoPages, error: null } }));

  it("shows the position, and disables First and Previous on the first page", () => {
    mount();
    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(pager).getByText("Page 1 of 3")).toBeTruthy(); // 120 payloads, 50 per page
    expect(within(pager).getByRole("button", { name: "First" }).disabled).toBe(true);
    expect(within(pager).getByRole("button", { name: "Previous" }).disabled).toBe(true);
    expect(within(pager).getByRole("button", { name: "Next" }).disabled).toBe(false);
  });

  it("Next, Previous, First and Last move through the pages via the URL", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(window.location.search).toBe("?page=2");
    expect(lastList()).toBe("/payloads?skip=50&limit=50");
    fireEvent.click(screen.getByRole("button", { name: "Last" }));
    expect(window.location.search).toBe("?page=3");
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(window.location.search).toBe("?page=2");
    fireEvent.click(screen.getByRole("button", { name: "First" }));
    expect(window.location.search).toBe("");
  });

  it("disables Next and Last on the last page", () => {
    mount("/payloads?page=3");
    expect(screen.getByRole("button", { name: "Next" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Last" }).disabled).toBe(true);
  });

  it("has no pager when everything fits on one page", () => {
    respond({ list: { status: "ok", data: { ...PAYLOADS_FIXTURE, total: 3 }, error: null } });
    mount();
    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("the browser's back button restores the previous page", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    act(() => { window.history.back(); });
    return vi.waitFor(() => expect(window.location.search).toBe(""));
  });
});

describe("PayloadsPage: empty states", () => {
  it("says so, and offers to clear the filters, when nothing matches them", () => {
    respond({ list: { status: "ok", data: { items: [], total: 0, skip: 0, limit: 50 }, error: null } });
    mount("/payloads?category=bypass");
    expect(screen.getByText("No payloads match these filters.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" }).at(-1));
    expect(window.location.search).toBe("");
  });

  it("tells you how to load the data when the table is empty", () => {
    respond({ list: { status: "ok", data: { items: [], total: 0, skip: 0, limit: 50 }, error: null } });
    mount();
    expect(document.querySelector(".empty").textContent).toContain("python -m scripts.seed_payloads");
  });

  it("offers the first page when the URL points past the end", () => {
    respond({ list: { status: "ok", data: { items: [], total: 60, skip: 500, limit: 50 }, error: null } });
    mount("/payloads?page=11");
    expect(screen.getByText("There are no payloads on page 11.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to the first page" }));
    expect(window.location.search).toBe("");
  });
});

describe("PayloadsPage: details", () => {
  it("opens one payload at a time, with aria-expanded kept in step", () => {
    mount();
    const [first, second] = screen.getAllByRole("button", { name: "Details" });
    fireEvent.click(first);
    expect(screen.getByRole("button", { name: "Hide" }).getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll(".payload-detail")).toHaveLength(1);
    fireEvent.click(second);
    expect(document.querySelectorAll(".payload-detail")).toHaveLength(1);
    expect(document.querySelector(".payload-full").textContent).toBe("javascript:alert(1)");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(document.querySelectorAll(".payload-detail")).toHaveLength(0);
  });

  it("shows when it was stored, in UTC", () => {
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    expect(screen.getByText("Stored 2026-09-28 14:33 UTC")).toBeTruthy();
  });

  it("copies the payload and confirms", async () => {
    copyText.mockResolvedValue(true);
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy" })); });
    expect(copyText).toHaveBeenCalledWith("<svg onload=alert(1)>");
    expect(screen.getByText("Copied the payload")).toBeTruthy();
  });

  it("says when copying failed", async () => {
    copyText.mockResolvedValue(false);
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy" })); });
    expect(screen.getByText("Could not copy")).toBeTruthy();
  });

  it("links to the scanner and the sanitizer playground with the payload in the URL", () => {
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    const detail = document.querySelector(".payload-detail");
    const scan = within(detail).getByRole("link", { name: "Scan it" });
    const sanitize = within(detail).getByRole("link", { name: "Sanitize it" });
    const encoded = new URL(scan.href).searchParams.get("t");
    expect(new URL(scan.href).pathname).toBe("/scanner");
    expect(new URL(sanitize.href).pathname).toBe("/playground");
    expect(new URL(sanitize.href).searchParams.get("t")).toBe(encoded);
    expect(encoded).toBeTruthy();
  });

  it("does not offer links for a payload too long to fit in one", () => {
    respond({ list: { status: "ok", data: { ...PAYLOADS_FIXTURE, items: [{ ...PAYLOAD_ROWS[0], content: "x".repeat(2500) }], total: 1 }, error: null } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.queryByRole("link", { name: "Scan it" })).toBeNull();
    expect(screen.getByText("Too long to open in the scanner or playground.")).toBeTruthy();
  });
});
