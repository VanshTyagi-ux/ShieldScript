import { render } from "@testing-library/react";
import { BarChart } from "./BarChart.jsx";
import { GroupedBars } from "./GroupedBars.jsx";
import { Sparkline } from "./Sparkline.jsx";
import { StackedBar } from "./StackedBar.jsx";

const bar = <BarChart data={[{ key: "a", label: "A", value: 5, slot: 1 }]} />;
const grouped = <GroupedBars groups={[{ key: "g", label: "G", values: { s: 1 } }]} series={[{ key: "s", label: "S", slot: 1 }]} />;
const stacked = <StackedBar segments={[{ key: "a", label: "A", value: 5, slot: 1 }]} />;
const spark = <Sparkline points={[{ value: 1, label: "a" }, { value: 2, label: "b" }]} />;

// On a phone a 640-unit chart shrunk to the screen makes its 12px labels about 6px. Each chart keeps its
// SVG in a region that scrolls sideways instead; the tooltip layer stays outside it so it is never clipped.
describe("chart scrolling on small screens", () => {
  it.each([["BarChart", bar], ["GroupedBars", grouped], ["StackedBar", stacked], ["Sparkline", spark]])(
    "%s keeps its svg inside a scrollable region",
    (_, ui) => {
      const { container } = render(ui);
      expect(container.querySelector(".chart-wrap > .chart-scroll > svg")).not.toBeNull();
    },
  );

  it("keeps the tooltip layer outside the scrolling region so it cannot be clipped", () => {
    const { container } = render(bar);
    const group = container.querySelector(".mark-group");
    group.dispatchEvent(new Event("focusin", { bubbles: true }));
    const tip = container.querySelector(".chart-tip");
    if (tip) expect(tip.closest(".chart-scroll")).toBeNull();
    expect(container.querySelector(".chart-scroll .chart-tip")).toBeNull();
  });
});
