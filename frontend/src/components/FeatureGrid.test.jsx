import { render, screen } from "@testing-library/react";
import { FeatureGrid } from "./FeatureGrid.jsx";

describe("FeatureGrid", () => {
  it("shows all six features with their titles and text", () => {
    render(<FeatureGrid />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(6);
    expect(screen.getByText("Decoding-aware")).toBeTruthy();
    expect(screen.getByText("Zero dependencies")).toBeTruthy();
  });

  it("colours each feature icon by a distinct series slot, in a fixed order", () => {
    const { container } = render(<FeatureGrid />);
    const icons = [...container.querySelectorAll(".feature-icon")];
    const classes = icons.map((el) => el.className);
    expect(classes).toEqual(["feature-icon color-s1", "feature-icon color-s2", "feature-icon color-s3", "feature-icon color-s4", "feature-icon color-s5", "feature-icon color-s6"]);
  });
});
