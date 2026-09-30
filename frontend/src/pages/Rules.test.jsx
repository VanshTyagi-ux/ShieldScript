import { fireEvent, render, screen, within } from "@testing-library/react";
import { useApi } from "../lib/useApi.js";
import { RULES_FIXTURE } from "../test/fixtures.js";
import { RulesPage } from "./Rules.jsx";

vi.mock("../lib/useApi.js", () => ({ useApi: vi.fn() }));

const reload = vi.fn();
const respond = (over = {}) => useApi.mockReturnValue({ status: "ok", data: RULES_FIXTURE, error: null, reload, ...over });
const mount = () => render(<RulesPage />);
const withRules = (rules) => ({ ...RULES_FIXTURE, rules });
const tableIds = () => [...document.querySelectorAll(".rules-table tbody tr")].map((row) => row.querySelector("code").textContent);
const sortButton = (name) => screen.getByRole("button", { name });

beforeEach(() => { useApi.mockReset(); reload.mockReset(); respond(); });

describe("RulesPage: data", () => {
  it("reads GET /rules", () => {
    mount();
    expect(useApi).toHaveBeenCalledWith("/rules");
  });

  it("has a single h1", () => {
    mount();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows a skeleton while the first load is pending", () => {
    respond({ status: "loading", data: null });
    mount();
    expect(screen.getByRole("status", { name: "Loading rules" })).toBeTruthy();
    expect(document.querySelector(".rules-table")).toBeNull();
  });

  it("shows the reason and a Retry button when loading failed", () => {
    respond({ status: "error", data: null, error: "network down" });
    mount();
    expect(screen.getByRole("alert").textContent).toContain("Could not load the rules: network down");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps showing the rules while they reload", () => {
    respond({ status: "loading" });
    mount();
    expect(tableIds()).toHaveLength(8);
  });

  it("says so when the server returns no rules", () => {
    respond({ data: withRules([]) });
    mount();
    expect(screen.getByText("The server returned no rules.")).toBeTruthy();
  });
});

describe("RulesPage: table", () => {
  it("lists every rule, heaviest first, with ties in id order", () => {
    mount();
    expect(tableIds()).toEqual(["XSS001", "XSS020", "XSS002", "XSS040", "XSS041", "XSS031", "XSS033", "XSS099"]);
  });

  it("filters by a search over id, name, description and category", () => {
    mount();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search rules" }), { target: { value: "popup" } });
    expect(tableIds()).toEqual(["XSS033"]);
    expect(screen.getByText("Showing 1 of 8 rules")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search rules" }), { target: { value: "XSS04" } });
    expect(tableIds()).toEqual(["XSS040", "XSS041"]);
  });

  it("says so when nothing matches", () => {
    mount();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search rules" }), { target: { value: "zzzz" } });
    expect(screen.getByText("No rules match your search.")).toBeTruthy();
    expect(tableIds()).toEqual([]);
  });

  it("filters by category chip and shows which chip is pressed", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "JavaScript" }));
    expect(tableIds()).toEqual(["XSS031", "XSS033"]);
    expect(screen.getByRole("button", { name: "JavaScript" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(tableIds()).toHaveLength(8);
  });

  it("sorts by a column and toggles direction, reporting aria-sort", () => {
    mount();
    const header = () => screen.getByRole("columnheader", { name: /Name/ });
    expect(screen.getByRole("columnheader", { name: /Weight/ }).getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(sortButton("Name"));
    expect(header().getAttribute("aria-sort")).toBe("ascending");
    // names, case-insensitively: CSS, DOM, Encoded, Inline, javascript, Popup, Script, Template
    const byName = ["XSS040", "XSS031", "XSS099", "XSS002", "XSS020", "XSS033", "XSS001", "XSS041"];
    expect(tableIds()).toEqual(byName);
    fireEvent.click(sortButton("Name"));
    expect(header().getAttribute("aria-sort")).toBe("descending");
    expect(tableIds()).toEqual([...byName].reverse());
    fireEvent.click(sortButton("Weight"));
    expect(screen.getByRole("columnheader", { name: /Weight/ }).getAttribute("aria-sort")).toBe("descending");
    expect(tableIds()[0]).toBe("XSS001");
    expect(header().getAttribute("aria-sort")).toBe("none");
  });

  it("tags the derived rule and explains it", () => {
    mount();
    const row = [...document.querySelectorAll(".rules-table tbody tr")].find((r) => r.querySelector("code").textContent === "XSS099");
    expect(within(row).getByText("derived")).toBeTruthy();
    expect(screen.getByText(/added when decoding changed the input/i)).toBeTruthy();
  });

  it("renders rule text as literal text and copes with zero and huge weights", () => {
    respond({ data: withRules([
      { id: "X1", name: "<img src=x onerror=alert(1)>", category: "markup", weight: 0, description: "d", derived: false },
      { id: "X2", name: "Big", category: "mystery", weight: 500, description: "d", derived: false },
    ]) });
    const { container } = mount();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText("<img src=x onerror=alert(1)>").length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("copes when every weight is zero", () => {
    respond({ data: withRules([{ id: "X1", name: "Zero", category: "markup", weight: 0, description: "d", derived: false }]) });
    const { container } = mount();
    expect(container.innerHTML).not.toContain("NaN");
  });
});

describe("RulesPage: charts", () => {
  it("draws one weight bar per rule, coloured by its category, consistently", () => {
    const { container } = mount();
    const barFor = (label) => container.querySelector(`[aria-label="${label}"] .mark`);
    expect(container.querySelectorAll(".chart-card")[0].querySelectorAll(".mark")).toHaveLength(8);
    expect(barFor("XSS001 Script tag: 70").getAttribute("class")).toContain("fill-s1");
    expect(barFor("XSS020 javascript: URI in URL attribute: 70").getAttribute("class")).toContain("fill-s2");
    expect(barFor("XSS033 Popup probe: 20").getAttribute("class")).toContain("fill-s3");
    expect(barFor("XSS099 Encoded / obfuscated payload: 15").getAttribute("class")).toContain("fill-s6");
  });

  it("shows how many rules and how many points each category has", () => {
    mount();
    expect(screen.getByLabelText("Markup: 2 (25%)")).toBeTruthy();
    expect(screen.getByLabelText("Markup: 130 (35%)")).toBeTruthy();
  });

  it("shows the level bands with the blocking threshold", () => {
    const { container } = mount();
    expect(screen.getByText("Blocked from 25")).toBeTruthy();
    const card = [...container.querySelectorAll(".chart-card")].find((c) => within(c).queryByRole("heading", { name: "Risk levels" }));
    expect([...card.querySelectorAll(".seg-label")].map((t) => t.textContent)).toEqual(["Low", "Medium", "High", "Critical"]);
    expect(card.querySelector(".fill-t-critical")).not.toBeNull();
  });

  it("offers a legend for the categories and a table view for every chart", () => {
    mount();
    expect(screen.getAllByRole("list", { name: "Legend" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "View as table" })).toHaveLength(4);
    fireEvent.click(screen.getAllByRole("button", { name: "View as table" })[0]);
    expect(screen.getAllByRole("table", { name: "Score weight by rule" })[0].querySelectorAll("tbody tr")).toHaveLength(8);
  });
});
