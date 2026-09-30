import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { get, post } from "../api.js";
import { ENDPOINTS } from "../data/apiDocs.js";
import { TryIt } from "./TryIt.jsx";

vi.mock("../api.js", () => ({ get: vi.fn(), post: vi.fn() }));

const scan = ENDPOINTS.find((e) => e.id === "scan");
const health = ENDPOINTS.find((e) => e.id === "health");
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const body = () => screen.getByRole("textbox");
const send = () => screen.getByRole("button", { name: /Send request|Sending/ });

beforeEach(() => { get.mockReset(); post.mockReset(); });

describe("TryIt", () => {
  it("prefills a POST body with the example, editable", () => {
    render(<TryIt endpoint={scan} />);
    expect(JSON.parse(body().value)).toEqual(scan.requestExample);
  });

  it("sends the edited body and shows the status and pretty JSON", async () => {
    post.mockResolvedValue({ status: 200, ok: true, data: { score: 5 } });
    render(<TryIt endpoint={scan} />);
    fireEvent.change(body(), { target: { value: '{"text":"hello"}' } });
    fireEvent.click(send());
    await waitFor(() => expect(screen.getByText("HTTP 200")).toBeTruthy());
    expect(post).toHaveBeenCalledWith("/scan", { text: "hello" });
    expect(screen.getByText(/"score": 5/)).toBeTruthy();
  });

  it("sends a GET with no body and no textarea", async () => {
    get.mockResolvedValue({ status: 200, ok: true, data: { status: "ok" } });
    render(<TryIt endpoint={health} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(send());
    await waitFor(() => expect(screen.getByText("HTTP 200")).toBeTruthy());
    expect(get).toHaveBeenCalledWith("/health");
  });

  it("disables the button while a request is pending", async () => {
    const pending = deferred();
    post.mockReturnValue(pending.promise);
    render(<TryIt endpoint={scan} />);
    fireEvent.click(send());
    expect(send().disabled).toBe(true);
    expect(send().textContent).toBe("Sending…");
    await act(async () => { pending.resolve({ status: 200, ok: true, data: {} }); });
    expect(send().disabled).toBe(false);
  });

  it("explains invalid JSON without sending anything", () => {
    render(<TryIt endpoint={scan} />);
    fireEvent.change(body(), { target: { value: "{not json" } });
    fireEvent.click(send());
    expect(screen.getByRole("alert").textContent).toBe("The body must be valid JSON.");
    expect(post).not.toHaveBeenCalled();
  });

  it("blocks a body over the size limit without sending it", () => {
    render(<TryIt endpoint={scan} />);
    fireEvent.change(body(), { target: { value: JSON.stringify({ text: "x".repeat(300 * 1024) }) } });
    fireEvent.click(send());
    expect(screen.getByRole("alert").textContent).toBe("Input is too large to send (limit 256 KiB).");
    expect(post).not.toHaveBeenCalled();
  });

  it("shows a non-JSON response as such", async () => {
    post.mockResolvedValue({ status: 502, ok: false, data: null });
    render(<TryIt endpoint={scan} />);
    fireEvent.click(send());
    await waitFor(() => expect(screen.getByText("HTTP 502")).toBeTruthy());
    expect(screen.getByText("(no JSON body)")).toBeTruthy();
  });

  it("shows a network failure and recovers the button", async () => {
    post.mockImplementation(() => Promise.reject(new Error("network down")));
    render(<TryIt endpoint={scan} />);
    fireEvent.click(send());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Request failed: network down"));
    expect(send().disabled).toBe(false);
  });
});
