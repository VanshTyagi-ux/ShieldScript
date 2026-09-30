import { fireEvent, render, screen } from "@testing-library/react";
import { ChartCard } from "./ChartCard.jsx";
import { DataTable } from "./DataTable.jsx";
import { Legend } from "./Legend.jsx";

const table = { columns: ["Detector", "Recall"], rows: [["Rules", "94.2%"], ["<i>ML</i>", "99.7%"]] };
const two = [{ key: "a", label: "Rules", slot: 2 }, { key: "b", label: "ML alone", slot: 3 }];

describe("ChartCard", () => {
  it("shows the title as an h3, the description, and the chart", () => {
    render(<ChartCard title="Recall" description="Share of attacks caught."><p>chart body</p></ChartCard>);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Recall");
    expect(screen.getByText("Share of attacks caught.")).toBeTruthy();
    expect(screen.getByText("chart body")).toBeTruthy();
    expect(screen.getByRole("figure", { name: "Recall" })).toBeTruthy();
  });

  it("offers no table toggle when there is no table", () => {
    render(<ChartCard title="Recall"><p>chart</p></ChartCard>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("swaps the chart for its data table and back", () => {
    render(<ChartCard title="Recall" table={table}><p>chart body</p></ChartCard>);
    const toggle = screen.getByRole("button", { name: "View as table" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("chart body")).toBeNull();
    expect(screen.getByRole("table", { name: "Recall" })).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByText("chart body")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a legend for two or more series, not for one, and not in table view", () => {
    const { rerender } = render(<ChartCard title="t" legend={two} table={table}><p>c</p></ChartCard>);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(screen.queryByRole("list")).toBeNull();
    rerender(<ChartCard title="t" legend={[two[0]]}><p>c</p></ChartCard>);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows a footnote", () => {
    render(<ChartCard title="t" footnote="Lower is better."><p>c</p></ChartCard>);
    expect(screen.getByText("Lower is better.")).toBeTruthy();
  });
});

describe("Legend", () => {
  it("keys each item with a decorative swatch in the series or level colour and a text label", () => {
    const { container } = render(<Legend items={[...two, { key: "c", label: "Critical", level: "critical" }]} />);
    const keys = [...container.querySelectorAll(".legend-key")];
    expect(keys.map((k) => k.className.split(" ").pop())).toEqual(["bg-s2", "bg-s3", "bg-t-critical"]);
    expect(keys.every((k) => k.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(screen.getByText("ML alone")).toBeTruthy();
  });
});

describe("DataTable", () => {
  it("renders a captioned table with a header row", () => {
    render(<DataTable caption="Recall by detector" {...table} />);
    expect(screen.getByRole("table", { name: "Recall by detector" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Detector", "Recall"]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("renders cells as literal text", () => {
    const { container } = render(<DataTable caption="c" {...table} />);
    expect(container.querySelector("i")).toBeNull();
    expect(screen.getByText("<i>ML</i>")).toBeTruthy();
  });
});
