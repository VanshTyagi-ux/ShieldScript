import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { copyText } from "../lib/clipboard.js";
import { decodeShare } from "../lib/share.js";
import { ToastProvider } from "../lib/toast.jsx";
import { ResultActions } from "./ResultActions.jsx";

vi.mock("../lib/clipboard.js", () => ({ copyText: vi.fn() }));

const RESULT = { score: 95, level: "critical", is_malicious: true, findings: [] };
const mount = (props) => render(<ToastProvider><ResultActions result={RESULT} text="<script>x</script>" {...props} /></ToastProvider>);
const toast = () => screen.getByRole("status");

beforeEach(() => { copyText.mockReset(); copyText.mockResolvedValue(true); });

describe("ResultActions", () => {
  it("copies the result as pretty JSON and confirms", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    expect(copyText).toHaveBeenCalledWith(JSON.stringify(RESULT, null, 2));
    await waitFor(() => expect(toast().textContent).toBe("Copied the result as JSON"));
  });

  it("copies a share link that carries the text, and confirms", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
    const url = copyText.mock.calls[0][0];
    expect(url.startsWith(`${window.location.origin}/scanner?t=`)).toBe(true);
    expect(decodeShare(url.split("t=")[1])).toBe("<script>x</script>");
    await waitFor(() => expect(toast().textContent).toBe("Copied the share link"));
  });

  it("refuses to share text that is too long, saying why, without copying", async () => {
    mount({ text: "x".repeat(2001) });
    fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
    await waitFor(() => expect(toast().textContent).toBe("Too long to share"));
    expect(toast().firstChild.className).toContain("toast-error");
    expect(copyText).not.toHaveBeenCalled();
  });

  it("reports a failed copy as an error", async () => {
    copyText.mockResolvedValue(false);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => expect(toast().textContent).toBe("Could not copy"));
    expect(toast().firstChild.className).toContain("toast-error");
  });

  it("warns that a shared link contains the text", () => {
    mount();
    expect(screen.getByText(/text is included in the link/i)).toBeTruthy();
  });
});
