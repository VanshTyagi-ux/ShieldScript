import { useEffect, useState } from "react";
import { ApiHint } from "../components/ApiHint.jsx";
import { HtmlPreview } from "../components/HtmlPreview.jsx";
import { DetectorAlert, SanitizeReport } from "../components/SanitizeReport.jsx";
import { DEFAULT_SANITIZE_SAMPLE, SANITIZE_SAMPLES } from "../data/sanitizeSamples.js";
import { useSanitize } from "../hooks/useSanitize.js";
import { PageHeading } from "../layout/PageHeading.jsx";
import { useAnnounce } from "../lib/announce.jsx";
import { copyText } from "../lib/clipboard.js";
import { useRoute } from "../lib/router.jsx";
import { buildShareUrl, decodeShare } from "../lib/share.js";
import { useToast } from "../lib/toast.jsx";
import { MAX_HTML_CHARS } from "../limits.js";

const fmt = (n) => n.toLocaleString("en-US");

function Input({ html, onChange }) {
  const over = html.length > MAX_HTML_CHARS;
  const { toast } = useToast();

  async function share() {
    const url = buildShareUrl(html, window.location.origin, "/playground");
    if (!url) {
      toast("Too long to share", { kind: "error" });
      return;
    }
    const copied = await copyText(url);
    toast(copied ? "Copied the share link" : "Could not copy", { kind: copied ? "info" : "error" });
  }

  return (
    <section className="card" aria-labelledby="playground-input-title">
      <h2 id="playground-input-title">HTML input</h2>
      <p className="hint">Type or paste rich text. It is sanitized on the server as you type.</p>
      <label htmlFor="html-input" className="sr-only">HTML to sanitize</label>
      <textarea
        id="html-input"
        rows={10}
        spellCheck={false}
        value={html}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={over ? "true" : undefined}
        aria-describedby="html-count"
        placeholder={'e.g. <p onclick="x()">Hello <b>world</b></p>'}
      />
      <div className="row">
        <span id="html-count" className={`count-note${over ? " over" : ""}`}>{`${fmt(html.length)} / ${fmt(MAX_HTML_CHARS)} characters`}</span>
        <button type="button" className="ghost" onClick={() => onChange("")}>Clear</button>
        <button type="button" className="ghost" onClick={share} disabled={!html}>Copy share link</button>
      </div>
      <div className="samples" id="sanitize-samples">
        {Object.entries(SANITIZE_SAMPLES).map(([group, items]) => (
          <div className="sample-group" key={group}>
            <span className="group-label">{group}</span>
            {Object.entries(items).map(([label, value]) => (
              <button type="button" className="sample" key={label} onClick={() => onChange(value)}>{label}</button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Output({ state }) {
  const { toast } = useToast();
  const { status, result, error, httpStatus } = state;

  if (status === "idle") {
    return <p className="empty">Type or paste some HTML, or pick a sample, to see it sanitized.</p>;
  }
  if (status === "error") {
    return (
      <>
        <div className="error-box" role="alert">{`Could not sanitize: ${error}`}</div>
        {httpStatus === 404 ? <ApiHint what="/sanitize" /> : null}
      </>
    );
  }
  if (!result) return <div className="skeleton-block" role="status" aria-label="Sanitizing" aria-busy="true"><span className="skeleton tall" /><span className="skeleton" /><span className="skeleton mid" /></div>;

  async function copy() {
    const copied = await copyText(result.clean);
    toast(copied ? "Copied the sanitized HTML" : "Could not copy", { kind: copied ? "info" : "error" });
  }

  return (
    <div className="stack" aria-busy={status === "loading"}>
      <section aria-labelledby="clean-title">
        <div className="section-head">
          <h3 id="clean-title">Sanitized HTML</h3>
          <button type="button" className="ghost" onClick={copy}>Copy</button>
        </div>
        <pre id="sanitized-output"><code>{result.clean === "" ? "(empty: nothing safe was left)" : result.clean}</code></pre>
      </section>
      <section aria-labelledby="preview-title">
        <h3 id="preview-title">Rendered preview</h3>
        <HtmlPreview html={result.clean} />
        <p className="muted">Shown in a sandboxed frame with scripts disabled.</p>
      </section>
      <section aria-labelledby="report-title">
        <h3 id="report-title">What was removed</h3>
        <SanitizeReport report={result.report} changed={result.changed} />
      </section>
      <section aria-labelledby="detector-title">
        <h3 id="detector-title">Detector alert</h3>
        <DetectorAlert detector={result.detector} />
      </section>
    </div>
  );
}

export function PlaygroundPage() {
  const { search } = useRoute();
  const [html, setHtml] = useState(() => decodeShare(new URLSearchParams(search).get("t")) ?? DEFAULT_SANITIZE_SAMPLE);
  const state = useSanitize(html);
  const announce = useAnnounce();

  useEffect(() => {
    if (state.status !== "ok") return;
    const r = state.result.report;
    announce(`Sanitized. Removed ${r.total_tags_removed} tags and ${r.total_attributes_removed} attributes.`);
  }, [state.status, state.result, announce]);

  return (
    <div className="page">
      <PageHeading description="Try the HTML sanitizer: see what it keeps, what it removes, and why. Only the sanitized output is safe to render.">
        Sanitizer playground
      </PageHeading>
      <div className="page-grid">
        <Input html={html} onChange={setHtml} />
        <section className="card result-card" aria-labelledby="playground-result-title">
          <h2 id="playground-result-title">Result</h2>
          <Output state={state} />
        </section>
      </div>
    </div>
  );
}
