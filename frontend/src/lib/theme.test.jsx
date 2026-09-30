import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "../layout/ThemeToggle.jsx";
import { THEME_KEY, ThemeProvider, useTheme } from "./theme.jsx";

const mount = () => render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
const toggle = () => screen.getByRole("button");
const applied = () => document.documentElement.dataset.theme;

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme", () => {
  it("defaults to the system theme with no attribute", () => {
    mount();
    expect(applied()).toBeUndefined();
    expect(toggle().getAttribute("aria-label")).toBe("Theme: system. Switch to light");
  });

  it("applies a stored explicit theme on load", () => {
    window.localStorage.setItem(THEME_KEY, "dark");
    mount();
    expect(applied()).toBe("dark");
    expect(toggle().getAttribute("aria-label")).toBe("Theme: dark. Switch to system");
  });

  it.each(["purple", "{bad json", ""])("falls back to system for the stored value %j", (stored) => {
    window.localStorage.setItem(THEME_KEY, stored);
    mount();
    expect(applied()).toBeUndefined();
    expect(toggle().getAttribute("aria-label")).toBe("Theme: system. Switch to light");
  });

  it("cycles system -> light -> dark -> system, setting and removing the attribute", () => {
    mount();
    fireEvent.click(toggle());
    expect([applied(), toggle().getAttribute("aria-label")]).toEqual(["light", "Theme: light. Switch to dark"]);
    fireEvent.click(toggle());
    expect([applied(), toggle().getAttribute("aria-label")]).toEqual(["dark", "Theme: dark. Switch to system"]);
    fireEvent.click(toggle());
    expect([applied(), toggle().getAttribute("aria-label")]).toEqual([undefined, "Theme: system. Switch to light"]);
  });

  it("persists the choice", () => {
    mount();
    fireEvent.click(toggle());
    expect(window.localStorage.getItem(THEME_KEY)).toBe("light");
  });

  it("keeps working in memory when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    mount();
    expect(applied()).toBeUndefined();
    fireEvent.click(toggle());
    expect(applied()).toBe("light");
  });

  it("ignores an invalid theme passed to setTheme", () => {
    let api;
    const Grab = () => { api = useTheme(); return null; };
    render(<ThemeProvider><Grab /></ThemeProvider>);
    api.setTheme("neon");
    expect(api.theme).toBe("system");
  });

  it("refuses to be used outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ThemeToggle />)).toThrow(/ThemeProvider/);
    spy.mockRestore();
  });
});
