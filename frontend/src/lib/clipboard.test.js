import { copyText } from "./clipboard.js";

const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const setClipboard = (value) => Object.defineProperty(navigator, "clipboard", { value, configurable: true });

afterEach(() => {
  if (original) Object.defineProperty(navigator, "clipboard", original);
  else delete navigator.clipboard;
  delete document.execCommand;
});

describe("copyText", () => {
  it("uses the async clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue();
    setClipboard({ writeText });
    expect(await copyText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to a temporary textarea when the API rejects", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    document.execCommand = vi.fn(() => true);
    expect(await copyText("hello")).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull(); // cleaned up
  });

  it("falls back when there is no clipboard API", async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn(() => true);
    expect(await copyText("x")).toBe(true);
  });

  it("returns false when every route fails", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    document.execCommand = vi.fn(() => false);
    expect(await copyText("x")).toBe(false);
  });

  it("returns false, without throwing, when execCommand does not exist", async () => {
    setClipboard(undefined);
    expect(await copyText("x")).toBe(false);
  });
});
