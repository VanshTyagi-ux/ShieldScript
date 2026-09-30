import { copyText } from "../lib/clipboard.js";
import { useToast } from "../lib/toast.jsx";

// A labelled code sample with a Copy button. The code is shown as literal text.
export function CodeBlock({ code, label }) {
  const { toast } = useToast();

  async function copy() {
    const copied = await copyText(code);
    toast(copied ? "Copied to clipboard" : "Could not copy", { kind: copied ? "info" : "error" });
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="muted">{label}</span>
        <button type="button" className="ghost" onClick={copy}>Copy</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}
