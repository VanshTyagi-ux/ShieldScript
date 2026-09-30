import { fireEvent, render, screen } from "@testing-library/react";
import { Scanner } from "./Scanner.jsx";

describe("Scanner", () => {
  it("reports what the user types", () => {
    const onChange = vi.fn();
    render(<Scanner text="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Type or paste any input"), { target: { value: "<b>hi" } });
    expect(onChange).toHaveBeenCalledWith("<b>hi");
  });

  it("shows the current text in the input", () => {
    render(<Scanner text="abc" onChange={() => {}} />);
    expect(document.querySelector("#probe").value).toBe("abc");
  });

  it("groups the samples under Attacks and Harmless", () => {
    const { container } = render(<Scanner text="" onChange={() => {}} />);
    expect([...container.querySelectorAll(".group-label")].map((e) => e.textContent)).toEqual(["Attacks", "Harmless"]);
    expect(container.querySelectorAll("#samples button.sample")).toHaveLength(9);
  });

  it("puts a sample's payload into the input", () => {
    const onChange = vi.fn();
    render(<Scanner text="" onChange={onChange} />);
    fireEvent.click(screen.getByText("Event handler"));
    expect(onChange).toHaveBeenCalledWith("<img src=x onerror=alert(1)>");
  });

  it("clears the input and focuses it", () => {
    const onChange = vi.fn();
    render(<Scanner text="abc" onChange={onChange} />);
    fireEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenCalledWith("");
    expect(document.activeElement).toBe(document.querySelector("#probe"));
  });
});
