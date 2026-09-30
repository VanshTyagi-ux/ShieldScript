import { fireEvent, render, screen, within } from "@testing-library/react";
import { useApi } from "../lib/useApi.js";
import { RULES_FIXTURE } from "../test/fixtures.js";
import { RulesPage } from "./Rules.jsx";

vi.mock("../lib/useApi.js", () => ({ useApi: vi.fn() }));

const reload = vi.fn();
const respond = (over = {}) => useApi.mockReturnValue({ status: "ok", data: RULES_FIXTURE, error: null, reload, ...over });
const mount = () => render(<RulesPage />);
const withRules = (rules) => ({ ...RULES_FIXTURE, rules });
const search = (value) => fireEvent.change(screen.getByRole("searchbox", { name: "Search rules" }), { target: { value } });
const groups = () => [...document.querySelectorAll(".rules-group")];
const groupNames = () => groups().map((g) => g.querySelector(".group-toggle .cat").textContent);
const groupHeader = (name) => groups().find((g) => g.querySelector(".group-toggle .cat").textContent === name).querySelector(".group-toggle");
const idsIn = (name) => [...groups().find((g) => g.querySelector(".group-toggle .cat").textContent === name).querySelectorAll("tbody tr")]
  .map((row) => row.querySelector("code").textContent);
const allIds = () => groups().flatMap((g) => [...g.querySelectorAll("tbody tr")].map((row) => row.querySelector("code").textContent));

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
    expect(allIds()).toHaveLength(8);
  });

  it("says so when the server returns no rules", () => {
    respond({ data: withRules([]) });
    mount();
    expect(screen.getByText("The server returned no rules.")).toBeTruthy();
  });
});

describe("RulesPage: groups", () => {
  it("groups the rules by category, in the fixed category order, all open at first", () => {
    mount();
    expect(groupNames()).toEqual(["Markup", "URI", "JavaScript", "CSS", "Template", "Evasion"]);
    for (const g of groups()) expect(g.querySelector(".group-toggle").getAttribute("aria-expanded")).toBe("true");
  });

  it("says in each group's header how many rules and points it has", () => {
    mount();
    const text = (name) => groupHeader(name).textContent;
    expect(text("Markup")).toBe("Markup · 2 rules · 130 points");
    expect(text("URI")).toBe("URI · 1 rule · 70 points");
    expect(text("JavaScript")).toBe("JavaScript · 2 rules · 60 points");
    expect(text("Evasion")).toBe("Evasion · 1 rule · 15 points");
  });

  it("lists each group's rules heaviest first, with ties in id order", () => {
    mount();
    expect(idsIn("Markup")).toEqual(["XSS001", "XSS002"]);
    expect(idsIn("JavaScript")).toEqual(["XSS031", "XSS033"]);
    expect(allIds()).toHaveLength(8);
  });

  it("has no Category column, since the group header says it", () => {
    mount();
    const heads = [...groups()[0].querySelectorAll("thead th")].map((th) => th.textContent);
    expect(heads).toEqual(["ID", "Name", "Weight", "What it looks for"]);
  });

  it("no longer offers category chips or column sorting", () => {
    const { container } = mount();
    expect(screen.queryByRole("button", { name: "All" })).toBeNull();
    expect(container.querySelector(".th-sort")).toBeNull();
    expect(container.querySelector(".chip-button")).toBeNull();
  });

  it("collapses and expands a group from its header, and reports it with aria-expanded", () => {
    mount();
    fireEvent.click(groupHeader("Markup"));
    expect(groupHeader("Markup").getAttribute("aria-expanded")).toBe("false");
    expect(idsIn("Markup")).toEqual([]);
    expect(idsIn("URI")).toEqual(["XSS020"]);
    fireEvent.click(groupHeader("Markup"));
    expect(groupHeader("Markup").getAttribute("aria-expanded")).toBe("true");
    expect(idsIn("Markup")).toEqual(["XSS001", "XSS002"]);
  });

  it("collapses and expands every group with Collapse all and Expand all", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(allIds()).toEqual([]);
    for (const g of groups()) expect(g.querySelector(".group-toggle").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(allIds()).toHaveLength(8);
  });

  it("filters by a search over id, name, description and category, and hides groups with no match", () => {
    mount();
    search("popup");
    expect(groupNames()).toEqual(["JavaScript"]);
    expect(idsIn("JavaScript")).toEqual(["XSS033"]);
    expect(screen.getByText("Showing 1 of 8 rules")).toBeTruthy();
    expect(groupHeader("JavaScript").textContent).toBe("JavaScript · 1 rule · 20 points");
    search("XSS04");
    expect(groupNames()).toEqual(["CSS", "Template"]);
    search("uri");
    expect(groupNames()).toContain("URI");
  });

  it("opens the groups that match a search even if they were collapsed, and restores that when the search is cleared", () => {
    mount();
    fireEvent.click(groupHeader("Markup"));
    search("Script tag");
    expect(groupNames()).toEqual(["Markup"]);
    expect(groupHeader("Markup").getAttribute("aria-expanded")).toBe("true");
    expect(idsIn("Markup")).toEqual(["XSS001"]);
    search("");
    expect(groupHeader("Markup").getAttribute("aria-expanded")).toBe("false");
    expect(idsIn("Markup")).toEqual([]);
  });

  it("says so when nothing matches", () => {
    mount();
    search("zzzz");
    expect(screen.getByText("No rules match your search.")).toBeTruthy();
    expect(groups()).toHaveLength(0);
  });

  it("tags the derived rule and explains it", () => {
    mount();
    const row = [...document.querySelectorAll(".rules-group tbody tr")].find((r) => r.querySelector("code").textContent === "XSS099");
    expect(within(row).getByText("derived")).toBeTruthy();
    expect(screen.getByText(/added when decoding changed the input/i)).toBeTruthy();
  });

  it("puts an unknown category in its own group after the known ones", () => {
    respond({ data: withRules([
      { id: "X1", name: "Known", category: "markup", weight: 10, description: "d", derived: false },
      { id: "X2", name: "Odd", category: "mystery", weight: 5, description: "d", derived: false },
    ]) });
    mount();
    expect(groupNames()).toEqual(["Markup", "Mystery"]);
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
