import { act, fireEvent, render, screen } from "@testing-library/react";
import { post } from "../api.js";
import { ProtectedForm } from "./ProtectedForm.jsx";

vi.mock("../api.js", () => ({ post: vi.fn() }));

const results = (over = {}) => ({
  name: { level: "safe", score: 0 }, email: { level: "safe", score: 0 },
  website: { level: "safe", score: 0 }, comment: { level: "safe", score: 0 }, ...over,
});
const REJECTED = {
  status: 422, ok: false,
  data: {
    accepted: false,
    errors: {
      email: "Invalid email address",
      website: "Potential XSS detected (high, score 70)",
      comment: "Potential XSS detected (critical, score 95)",
    },
    results: results({ website: { level: "high", score: 70 }, comment: { level: "critical", score: 95 } }),
  },
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const $ = (selector) => document.querySelector(selector);
const type = (id, value) => fireEvent.change($(id), { target: { value } });
const submit = () => fireEvent.submit($("#demo-form"));
const flush = () => act(async () => { await Promise.resolve(); });

// Block body on purpose: an arrow that returns the mock would be run by vitest as a teardown hook.
beforeEach(() => { post.mockReset(); });

describe("ProtectedForm", () => {
  it("shows an empty state beside the form until something is submitted", async () => {
    post.mockResolvedValue(REJECTED);
    render(<ProtectedForm onAnnounce={() => {}} />);
    expect($("#submit-empty").textContent).toBe("Submit the form to see what the server accepts and how it escapes each field.");
    expect($("#submit-result")).toBeNull();
    submit();
    expect(await screen.findByText("Rejected (HTTP 422)")).toBeTruthy();
    expect($("#submit-empty")).toBeNull();
  });

  it("fills every field from a sample button", () => {
    render(<ProtectedForm onAnnounce={() => {}} />);
    fireEvent.click(screen.getByText("attack"));
    expect($("#f-name").value).toBe("Mallory");
    expect($("#f-website").value).toBe("javascript:alert(1)");
    expect($("#f-comment").value).toBe("<img src=x onerror=alert(1)>");
  });

  it("shows inline errors, level chips and an error list when rejected", async () => {
    post.mockResolvedValue(REJECTED);
    const onAnnounce = vi.fn();
    render(<ProtectedForm onAnnounce={onAnnounce} />);
    type("#f-name", "Mallory");
    type("#f-comment", "<img src=x onerror=alert(1)>");
    submit();
    expect(await screen.findByText("Rejected (HTTP 422)")).toBeTruthy();
    expect(post).toHaveBeenCalledWith("/submit", {
      fields: { name: "Mallory", email: "", website: "", comment: "<img src=x onerror=alert(1)>" },
    });
    expect($('.err[data-for="email"]').textContent).toBe("Invalid email address");
    expect($('.err[data-for="comment"]').textContent).toBe("Potential XSS detected (critical, score 95)");
    expect($('.err[data-for="name"]').textContent).toBe("");
    const chip = $('[data-chip="comment"]');
    expect(chip.textContent).toBe("critical 95");
    expect(chip.className).toContain("level-critical");
    expect($('[data-chip="website"]').textContent).toBe("high 70");
    expect(document.querySelectorAll(".errors li")).toHaveLength(3);
    expect($("#submit-status").className).toBe("bad");
    expect(onAnnounce).toHaveBeenCalledWith("Rejected (HTTP 422)");
    // only the fields with an error are marked invalid
    expect([...document.querySelectorAll('[aria-invalid="true"]')].map((el) => el.id)).toEqual(["f-email", "f-website", "f-comment"]);
  });

  it("shows what was typed next to what is stored, as literal text", async () => {
    post.mockResolvedValue({
      status: 200, ok: true,
      data: { accepted: true, results: results(), sanitized: { name: "Ada", email: "", website: "", comment: "&lt;b&gt;&amp;amp;&lt;/b&gt;" } },
    });
    render(<ProtectedForm onAnnounce={() => {}} />);
    type("#f-name", "Ada");
    type("#f-comment", "<b>&amp;</b>");
    submit();
    expect(await screen.findByText("Accepted (HTTP 200)")).toBeTruthy();
    const rows = [...document.querySelectorAll("#submit-body tr")].map((r) => [...r.children].map((c) => c.textContent));
    expect(rows[0]).toEqual(["Field", "You typed", "Stored (HTML-escaped)"]);
    expect(rows).toContainEqual(["comment", "<b>&amp;</b>", "&lt;b&gt;&amp;amp;&lt;/b&gt;"]);
    expect($("#submit-body b")).toBeNull();
    expect($("#submit-body .table-wrap table")).not.toBeNull();
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    expect($("#submit-status").className).toBe("ok");
  });

  it("disables the button while pending and restores it afterwards", async () => {
    const pending = deferred();
    post.mockReturnValue(pending.promise);
    render(<ProtectedForm onAnnounce={() => {}} />);
    submit();
    expect($("#submit-btn").disabled).toBe(true);
    expect($("#submit-btn").textContent).toBe("Submitting...");
    await act(async () => { pending.resolve(REJECTED); });
    expect($("#submit-btn").disabled).toBe(false);
    expect($("#submit-btn").textContent).toBe("Submit");
  });

  it("sends one request when Submit is triggered twice before the first finishes", async () => {
    const pending = deferred();
    post.mockReturnValue(pending.promise);
    render(<ProtectedForm onAnnounce={() => {}} />);
    submit();
    submit();
    await act(async () => { pending.resolve(REJECTED); });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("shows a network error and recovers the button", async () => {
    post.mockRejectedValue(new Error("network down"));
    render(<ProtectedForm onAnnounce={() => {}} />);
    submit();
    expect(await screen.findByText("Could not submit")).toBeTruthy();
    expect(screen.getByText("Server unreachable: network down")).toBeTruthy();
    expect($("#submit-btn").disabled).toBe(false);
    expect($("#submit-btn").textContent).toBe("Submit");
  });

  it("does not send a form over the size limit and shows why, as a 413 rejection", async () => {
    const onAnnounce = vi.fn();
    render(<ProtectedForm onAnnounce={onAnnounce} />);
    type("#f-comment", "x".repeat(300 * 1024));
    submit();
    expect(await screen.findByText("Rejected (HTTP 413)")).toBeTruthy();
    expect(screen.getByText("Input is too large to submit (limit 256 KiB)")).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    expect($("#submit-btn").disabled).toBe(false);
    expect(onAnnounce).toHaveBeenCalledWith("Rejected (HTTP 413)");
  });

  it("shows the server's message when there are no field errors (e.g. a 400)", async () => {
    post.mockResolvedValue({ status: 400, ok: false, data: { error: "Body must be valid JSON" } });
    render(<ProtectedForm onAnnounce={() => {}} />);
    submit();
    expect(await screen.findByText("Rejected (HTTP 400)")).toBeTruthy();
    expect(screen.getByText("Body must be valid JSON")).toBeTruthy();
    await flush();
  });
});
