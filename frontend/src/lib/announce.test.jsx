import { act, render, screen } from "@testing-library/react";
import { AnnounceProvider, useAnnounce } from "./announce.jsx";

let announce;
const Grab = () => { announce = useAnnounce(); return null; };

describe("announcer", () => {
  it("renders an empty polite live region", () => {
    render(<AnnounceProvider><Grab /></AnnounceProvider>);
    const region = document.querySelector("#announce");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.className).toContain("sr-only");
    expect(region.textContent).toBe("");
  });

  it("shows the latest message", () => {
    render(<AnnounceProvider><Grab /></AnnounceProvider>);
    act(() => announce("Navigated to Rules"));
    expect(document.querySelector("#announce").textContent).toBe("Navigated to Rules");
    act(() => announce("Copied"));
    expect(document.querySelector("#announce").textContent).toBe("Copied");
  });

  it("refuses to be used outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Grab />)).toThrow(/AnnounceProvider/);
    spy.mockRestore();
    expect(screen.queryByText("Copied")).toBeNull();
  });
});
