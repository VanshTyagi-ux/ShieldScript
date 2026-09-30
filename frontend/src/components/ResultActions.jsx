import { copyText } from "../lib/clipboard.js";
import { buildShareUrl } from "../lib/share.js";
import { useToast } from "../lib/toast.jsx";

export function ResultActions({ result, text }) {
  const { toast } = useToast();

  async function copy(value, confirmation) {
    const copied = await copyText(value);
    toast(copied ? confirmation : "Could not copy", { kind: copied ? "info" : "error" });
  }

  function share() {
    const url = buildShareUrl(text, window.location.origin);
    if (!url) {
      toast("Too long to share", { kind: "error" });
      return;
    }
    copy(url, "Copied the share link");
  }

  return (
    <div className="result-actions">
      <button type="button" className="ghost" onClick={() => copy(JSON.stringify(result, null, 2), "Copied the result as JSON")}>Copy JSON</button>
      <button type="button" className="ghost" onClick={share}>Copy share link</button>
      <p className="muted">The text is included in the link, so anyone who has it can read the input.</p>
    </div>
  );
}
