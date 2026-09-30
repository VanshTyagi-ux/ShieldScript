import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { copyText } from "../lib/clipboard.js";
import { ToastProvider } from "../lib/toast.jsx";
import { CodeBlock } from "./CodeBlock.jsx";

vi.mock("../lib/clipboard.js", () => ({ copyText: vi.fn() }));

const mount = (props) => render(<ToastProvider><CodeBlock label="curl" code={"curl http://x\n# <b>not bold</b>"} {...props} /></ToastProvider>);

beforeEach(() => { copyText.mockReset(); });

describe("CodeBlock", () => {
  it("shows the label and the code as literal text", () => {
    const { container } = mount();
    expect(screen.getByText("curl")).toBeTruthy();
    expect(container.querySelector("pre code").textContent).toBe("curl http://x\n# <b>not bold</b>");
    expect(container.querySelector("pre b")).toBeNull();
  });

  it("copies the code and confirms with a toast", async () => {
    copyText.mockResolvedValue(true);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(copyText).toHaveBeenCalledWith("curl http://x\n# <b>not bold</b>");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Copied to clipboard"));
  });

  it("says so, as an error, when copying fails", async () => {
    copyText.mockResolvedValue(false);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Could not copy"));
    expect(screen.getByRole("status").firstChild.className).toContain("toast-error");
  });
});
