import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { get } from "./api.js";
import { App } from "./App.jsx";
import { clearApiCache } from "./lib/useApi.js";
import { HEALTH_FIXTURE } from "./test/fixtures.js";

vi.mock("./api.js", async (importOriginal) => ({ ...(await importOriginal()), get: vi.fn(), post: vi.fn() }));

beforeEach(() => {
  get.mockReset();
  clearApiCache();
  get.mockResolvedValue({ status: 200, ok: true, data: HEALTH_FIXTURE });
});

const at = (path) => {
  window.history.pushState(null, "", path);
  return render(<App />);
};

describe("App shell", () => {
  it("renders the scanner page with a titled h1, header, main and footer", async () => {
    at("/scanner");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Scanner");
    expect(document.title).toBe("Scanner · ScriptShield");
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(document.querySelector("main#main")).not.toBeNull();
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(await screen.findByText("Operational · ML model loaded")).toBeTruthy();
  });

  it("has a skip link and a polite live region", () => {
    at("/scanner");
    expect(document.querySelector("a.skip-link").getAttribute("href")).toBe("#main");
    expect(document.querySelector("#announce").getAttribute("aria-live")).toBe("polite");
  });

  it("offers the theme toggle in the header", () => {
    at("/scanner");
    expect(within(screen.getByRole("banner")).getByRole("button", { name: /^Theme: system/ })).toBeTruthy();
  });

  it("shows a 404 page, with its own title, for an unknown path", () => {
    at("/definitely/not/here");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Page not found");
    expect(document.title).toBe("Page not found · ScriptShield");
    expect(screen.getByRole("link", { name: "Go to the home page" }).getAttribute("href")).toBe("/");
  });

  it("moves focus to the new page's heading and announces the navigation", async () => {
    at("/definitely/not/here");
    fireEvent.click(screen.getByRole("link", { name: "Go to the home page" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Catch XSS in user input before it reaches your page."));
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
    expect(document.querySelector("#announce").textContent).toBe("Navigated to Home");
  });
});
