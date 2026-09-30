import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useSanitize } from "../hooks/useSanitize.js";
import { AnnounceProvider } from "../lib/announce.jsx";
import { copyText } from "../lib/clipboard.js";
import { RouterProvider } from "../lib/router.jsx";
import { encodeShare } from "../lib/share.js";
import { ToastProvider } from "../lib/toast.jsx";
import { DEFAULT_SANITIZE_SAMPLE, SANITIZE_SAMPLES } from "../data/sanitizeSamples.js";
import { MAX_HTML_CHARS } from "../limits.js";
import { SANITIZE_CLEAN_FIXTURE, SANITIZE_FIXTURE } from "../test/fixtures.js";
import { PlaygroundPage } from "./Playground.jsx";

vi.mock("../hooks/useSanitize.js", () => ({ useSanitize: vi.fn() }));
vi.mock("../lib/clipboard.js", () => ({ copyText: vi.fn() }));

const IDLE = { status: "idle", result: null, error: null, httpStatus: null };
const ok = (result = SANITIZE_FIXTURE) => ({ status: "ok", result, error: null, httpStatus: null });
const routes = [{ path: "/playground", title: "Sanitizer playground", component: PlaygroundPage }];

function mount(url = "/playground") {
  window.history.pushState(null, "", url);
  return render(
    <ToastProvider>
      <AnnounceProvider>
        <RouterProvider routes={routes} notFound={{ title: "x", component: () => null }}><PlaygroundPage /></RouterProvider>
      </AnnounceProvider>
    </ToastProvider>,
  );
}
const input = () => screen.getByLabelText("HTML to sanitize");
const lastInput = () => useSanitize.mock.calls.at(-1)[0];

beforeEach(() => { useSanitize.mockReset(); copyText.mockReset(); useSanitize.mockReturnValue(ok()); });

describe("PlaygroundPage: input", () => {
  it("has a single h1 and starts with a demonstration input", () => {
    mount();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(input().value).toBe(DEFAULT_SANITIZE_SAMPLE);
    expect(lastInput()).toBe(DEFAULT_SANITIZE_SAMPLE);
  });

  it("sanitizes what is typed", () => {
    mount();
    fireEvent.change(input(), { target: { value: "<b>mine</b>" } });
    expect(input().value).toBe("<b>mine</b>");
    expect(lastInput()).toBe("<b>mine</b>");
  });

  it("offers every sample, and clicking one fills the input", () => {
    mount();
    const groups = document.querySelectorAll("#sanitize-samples .sample-group");
    expect([...groups].map((g) => g.querySelector(".group-label").textContent)).toEqual(Object.keys(SANITIZE_SAMPLES));
    expect(document.querySelectorAll("#sanitize-samples .sample")).toHaveLength(9);
    fireEvent.click(screen.getByRole("button", { name: "javascript: link" }));
    expect(input().value).toBe('<a href="javascript:alert(1)">click me</a>');
  });

  it("clears the input", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(input().value).toBe("");
    expect(lastInput()).toBe("");
  });

  it("preloads a shared input from ?t=", () => {
    mount(`/playground?t=${encodeShare("<i>shared</i>")}`);
    expect(input().value).toBe("<i>shared</i>");
    expect(lastInput()).toBe("<i>shared</i>");
  });

  it("ignores a malformed ?t= and starts with the demonstration input", () => {
    mount("/playground?t=!!!not-base64!!!");
    expect(input().value).toBe(DEFAULT_SANITIZE_SAMPLE);
  });

  it("counts characters against the limit and flags going over it", () => {
    mount();
    fireEvent.change(input(), { target: { value: "abc" } });
    expect(screen.getByText("3 / 64,000 characters")).toBeTruthy();
    expect(input().getAttribute("aria-invalid")).toBeNull();
    fireEvent.change(input(), { target: { value: "a".repeat(MAX_HTML_CHARS + 1) } });
    expect(screen.getByText("64,001 / 64,000 characters").className).toContain("over");
    expect(input().getAttribute("aria-invalid")).toBe("true");
  });
});

describe("PlaygroundPage: share link", () => {
  it("copies a link to the playground with the input in it", async () => {
    copyText.mockResolvedValue(true);
    mount();
    fireEvent.change(input(), { target: { value: "<b>x</b>" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy share link" })); });
    const url = new URL(copyText.mock.calls[0][0]);
    expect(url.pathname).toBe("/playground");
    expect(url.searchParams.get("t")).toBe(encodeShare("<b>x</b>"));
    expect(screen.getByText("Copied the share link")).toBeTruthy();
  });

  it("refuses, with a message, when the input is too long for a link", async () => {
    mount();
    fireEvent.change(input(), { target: { value: "a".repeat(2500) } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy share link" })); });
    expect(copyText).not.toHaveBeenCalled();
    expect(screen.getByText("Too long to share")).toBeTruthy();
  });

  it("is disabled with nothing to share", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("button", { name: "Copy share link" }).disabled).toBe(true);
  });
});

describe("PlaygroundPage: result", () => {
  it("prompts for input when there is none", () => {
    useSanitize.mockReturnValue(IDLE);
    mount();
    expect(screen.getByText("Type or paste some HTML, or pick a sample, to see it sanitized.")).toBeTruthy();
  });

  it("shows a skeleton while the first result is pending", () => {
    useSanitize.mockReturnValue({ status: "loading", result: null, error: null, httpStatus: null });
    mount();
    expect(screen.getByRole("status", { name: "Sanitizing" })).toBeTruthy();
  });

  it("marks the result busy, but keeps showing it, while a newer one loads", () => {
    useSanitize.mockReturnValue({ ...ok(), status: "loading" });
    mount();
    expect(document.querySelector(".result-card .stack").getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector("#sanitized-output").textContent).toBe(SANITIZE_FIXTURE.clean);
  });

  it("shows the sanitized HTML as text, exactly", () => {
    mount();
    expect(document.querySelector("#sanitized-output code").textContent).toBe(SANITIZE_FIXTURE.clean);
  });

  it("says so when nothing is left", () => {
    useSanitize.mockReturnValue(ok({ ...SANITIZE_CLEAN_FIXTURE, clean: "" }));
    mount();
    expect(document.querySelector("#sanitized-output").textContent).toBe("(empty: nothing safe was left)");
  });

  it("copies the sanitized HTML", async () => {
    copyText.mockResolvedValue(true);
    mount();
    const section = screen.getByRole("heading", { name: "Sanitized HTML" }).closest("section");
    await act(async () => { fireEvent.click(within(section).getByRole("button", { name: "Copy" })); });
    expect(copyText).toHaveBeenCalledWith(SANITIZE_FIXTURE.clean);
    expect(screen.getByText("Copied the sanitized HTML")).toBeTruthy();
  });

  it("previews the result in a sandboxed frame with scripts disabled", () => {
    mount();
    const frame = document.querySelector("iframe.html-preview");
    expect(frame.getAttribute("sandbox")).toBe(""); // empty: nothing is allowed, in particular no allow-scripts
    expect(frame.srcdoc).toBe(SANITIZE_FIXTURE.clean);
    expect(frame.title).toBeTruthy();
  });

  it("shows the report and the detector alert", () => {
    mount();
    expect(screen.getByText("Removed 3 tags, 2 attributes and 1 comment.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Detector alert" })).toBeTruthy();
    expect(screen.getByText("Critical risk")).toBeTruthy();
    expect(screen.getByText(/Alert only/)).toBeTruthy();
  });

  it("never turns hostile output into live markup in the page", () => {
    useSanitize.mockReturnValue(ok({ ...SANITIZE_FIXTURE, clean: '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>' }));
    const { container } = mount();
    expect(container.querySelector("img, script")).toBeNull();
    expect(window.__pwned).toBeUndefined();
    expect(document.querySelector("#sanitized-output").textContent).toContain('<img src=x onerror="window.__pwned=1">');
  });

  it("announces the outcome for screen readers", () => {
    mount();
    expect(document.querySelector("#announce").textContent).toBe("Sanitized. Removed 3 tags and 2 attributes.");
  });
});

describe("PlaygroundPage: errors", () => {
  it("shows the server's message", () => {
    useSanitize.mockReturnValue({ status: "error", result: null, error: "HTML sanitizer unavailable", httpStatus: 503 });
    mount();
    expect(screen.getByRole("alert").textContent).toBe("Could not sanitize: HTML sanitizer unavailable");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("explains how to reach the FastAPI backend when the API has no /sanitize", () => {
    useSanitize.mockReturnValue({ status: "error", result: null, error: "Not found", httpStatus: 404 });
    mount();
    expect(screen.getByRole("note").textContent).toContain("This API does not provide /sanitize");
  });

  it("shows a network failure", () => {
    useSanitize.mockReturnValue({ status: "error", result: null, error: "Failed to fetch", httpStatus: null });
    mount();
    expect(screen.getByRole("alert").textContent).toContain("Failed to fetch");
  });
});
