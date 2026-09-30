import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "./toast.jsx";

function Trigger({ message = "Copied", options }) {
  const { toast } = useToast();
  return <button onClick={() => toast(message, options)}>fire</button>;
}
const region = () => screen.getByRole("status");

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("toasts", () => {
  it("always renders a polite live region, empty until something is shown", () => {
    render(<ToastProvider><div /></ToastProvider>);
    expect(region().getAttribute("aria-live")).toBe("polite");
    expect(region().textContent).toBe("");
  });

  it("shows a message and dismisses it after the default 3 seconds", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText("fire"));
    expect(region().textContent).toBe("Copied");
    act(() => { vi.advanceTimersByTime(2900); });
    expect(region().textContent).toBe("Copied");
    act(() => { vi.advanceTimersByTime(200); });
    expect(region().textContent).toBe("");
  });

  it("honours a custom duration", () => {
    render(<ToastProvider><Trigger options={{ duration: 500 }} /></ToastProvider>);
    fireEvent.click(screen.getByText("fire"));
    act(() => { vi.advanceTimersByTime(600); });
    expect(region().textContent).toBe("");
  });

  it("stacks messages in order and dismisses each on its own timer", () => {
    render(<ToastProvider><Trigger message="one" /><Trigger message="two" options={{ duration: 6000 }} /></ToastProvider>);
    const [a, b] = screen.getAllByText("fire");
    fireEvent.click(a);
    fireEvent.click(b);
    expect([...region().children].map((el) => el.textContent)).toEqual(["one", "two"]);
    act(() => { vi.advanceTimersByTime(3100); });
    expect([...region().children].map((el) => el.textContent)).toEqual(["two"]);
  });

  it("marks error toasts", () => {
    render(<ToastProvider><Trigger message="Nope" options={{ kind: "error" }} /></ToastProvider>);
    fireEvent.click(screen.getByText("fire"));
    expect(region().firstChild.className).toContain("toast-error");
  });

  it("renders the message as text, never as markup", () => {
    render(<ToastProvider><Trigger message="<b>bold</b>" /></ToastProvider>);
    fireEvent.click(screen.getByText("fire"));
    expect(region().querySelector("b")).toBeNull();
    expect(region().textContent).toBe("<b>bold</b>");
  });

  it("refuses to be used outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
