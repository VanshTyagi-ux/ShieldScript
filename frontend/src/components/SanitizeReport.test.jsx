import { render, screen, within } from "@testing-library/react";
import { SANITIZE_CLEAN_FIXTURE, SANITIZE_FIXTURE } from "../test/fixtures.js";
import { HtmlPreview } from "./HtmlPreview.jsx";
import { DetectorAlert, SanitizeReport } from "./SanitizeReport.jsx";

const report = (over = {}) => ({ ...SANITIZE_CLEAN_FIXTURE.report, ...over });

describe("SanitizeReport", () => {
  it("summarises what was removed, with singular and plural forms", () => {
    const { rerender } = render(<SanitizeReport report={SANITIZE_FIXTURE.report} changed />);
    expect(screen.getByText("Removed 3 tags, 2 attributes and 1 comment.")).toBeTruthy();
    rerender(<SanitizeReport report={report({ total_tags_removed: 1, total_attributes_removed: 1 })} changed />);
    expect(screen.getByText("Removed 1 tag, 1 attribute.")).toBeTruthy();
  });

  it("lists removed tags with counts and says whether the contents went too", () => {
    render(<SanitizeReport report={SANITIZE_FIXTURE.report} changed />);
    const table = screen.getByRole("table", { name: "Removed tags" });
    const rows = within(table).getAllByRole("row").slice(1).map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent));
    expect(rows).toEqual([
      ["<script>", "1", "Tag and everything inside it removed"],
      ["<div>", "2", "Tag removed, its text kept"],
    ]);
  });

  it("lists removed attributes with a plain-language reason", () => {
    render(<SanitizeReport report={SANITIZE_FIXTURE.report} changed />);
    const table = screen.getByRole("table", { name: "Removed attributes" });
    const rows = within(table).getAllByRole("row").slice(1).map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent));
    expect(rows[0]).toEqual(["onclick", "<p>", "1", "Event handler: runs script when triggered"]);
    expect(rows[1]).toEqual(["href", "<a>", "1", "URL scheme not allowed (javascript:, data:, ...)"]);
  });

  it("says nothing was removed, and explains a changed-but-harmless output", () => {
    const { rerender } = render(<SanitizeReport report={SANITIZE_CLEAN_FIXTURE.report} changed={false} />);
    expect(screen.getByText("Nothing was removed.")).toBeTruthy();
    expect(screen.queryByText(/only in formatting/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    rerender(<SanitizeReport report={SANITIZE_CLEAN_FIXTURE.report} changed />);
    expect(screen.getByText(/only in formatting/)).toBeTruthy();
  });

  it("does not pretend removal happened when only comments were dropped", () => {
    render(<SanitizeReport report={report({ comments_removed: 2 })} changed />);
    expect(screen.getByText("Removed 0 tags, 0 attributes and 2 comments.")).toBeTruthy();
  });

  it("notes when the lists were cut short", () => {
    render(<SanitizeReport report={report({ truncated: true, total_tags_removed: 150 })} changed />);
    expect(screen.getByText(/cut at 100 entries/)).toBeTruthy();
  });

  it("shows hostile tag and attribute names as literal text", () => {
    const hostile = report({
      removed_tags: [{ name: "img src=x onerror=alert(1)", count: 1, content_removed: false }],
      removed_attributes: [{ tag: "<b>", name: "<script>", count: 1, reason: "made_up_reason" }],
      total_tags_removed: 1, total_attributes_removed: 1,
    });
    const { container } = render(<SanitizeReport report={hostile} changed />);
    expect(container.querySelector("img, script, b")).toBeNull();
    expect(screen.getByText("made_up_reason")).toBeTruthy(); // an unknown reason is shown as it is
  });
});

describe("DetectorAlert", () => {
  it("shows level, score, ML probability and the matched rules, marked as alert only", () => {
    const { container } = render(<DetectorAlert detector={SANITIZE_FIXTURE.detector} />);
    expect(screen.getByText("Critical risk").className).toContain("level-critical");
    expect(screen.getByText("score 100/100")).toBeTruthy();
    expect(screen.getByText("ML: 100.0% malicious")).toBeTruthy();
    expect([...container.querySelectorAll(".rule-ids code")].map((c) => c.textContent)).toEqual(["XSS001", "XSS002"]);
    expect(screen.getByText(/never blocks HTML/)).toBeTruthy();
  });

  it("copes with no ML model and no matched rules", () => {
    render(<DetectorAlert detector={SANITIZE_CLEAN_FIXTURE.detector} />);
    expect(screen.getByText("ML model not loaded")).toBeTruthy();
    expect(screen.getByText("No detection rule matched the input.")).toBeTruthy();
    expect(screen.getByText("Safe")).toBeTruthy();
  });
});

describe("HtmlPreview", () => {
  it("is an iframe with an empty sandbox, so it may run nothing and reach nothing", () => {
    render(<HtmlPreview html="<p>hi</p>" />);
    const frame = document.querySelector("iframe");
    expect(frame.hasAttribute("sandbox")).toBe(true);
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.srcdoc).toBe("<p>hi</p>");
  });

  it("hands the HTML over as srcdoc and never puts it into this document", () => {
    const { container } = render(<HtmlPreview html={'<img src=x onerror="window.__pwned=1">'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(window.__pwned).toBeUndefined();
  });
});
