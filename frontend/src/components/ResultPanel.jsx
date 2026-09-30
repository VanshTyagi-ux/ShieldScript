import { useState } from "react";
import { Gauge } from "../charts/Gauge.jsx";
import { Chips } from "./Chips.jsx";
import { DecodedView } from "./DecodedView.jsx";
import { Findings } from "./Findings.jsx";
import { ScoreBreakdown } from "./ScoreBreakdown.jsx";
import { Verdict } from "./Verdict.jsx";

// scan = { status: "idle" | "loading" | "ok" | "error", result, error } from useScan.
// `footer` is shown under the result (and only when there is one).
export function ResultPanel({ scan, footer }) {
  const [hoveredRule, setHoveredRule] = useState(null);
  const { status, result, error } = scan;

  let body;
  if (status === "error") {
    body = <div id="scan-error" className="error-box" role="alert">{`Could not scan: ${error}`}</div>;
  } else if (result) {
    body = (
      <div id="scan-result" aria-busy={status === "loading"}>
        <Verdict result={result} />
        <Gauge score={result.score} level={result.level} />
        <Chips result={result} />
        <ScoreBreakdown findings={result.findings} />
        <h3>Findings</h3>
        <Findings findings={result.findings} onHover={setHoveredRule} />
        <h3>Decoded view <small>(what the detector actually analysed; hover a finding to see its match)</small></h3>
        <DecodedView decoded={result.decoded} findings={result.findings} hoveredRule={hoveredRule} />
        <p className="muted" id="decoded-note">
          {result.decode_layers ? `${result.decode_layers} decoding layer(s) removed before scanning.` : "Input needed no decoding."}
        </p>
        {footer}
      </div>
    );
  } else if (status === "loading") {
    body = (
      <div id="scan-loading" className="skeleton-block" role="status" aria-label="Scanning" aria-busy="true">
        <span className="skeleton tall" />
        <span className="skeleton" />
        <span className="skeleton mid" />
        <span className="skeleton short" />
      </div>
    );
  } else {
    body = <p id="scan-empty" className="empty">Type or paste some input, or pick a sample, to see how it scores.</p>;
  }

  return (
    <section className="card result-card" aria-labelledby="result-title">
      <h2 id="result-title">Result</h2>
      {body}
    </section>
  );
}
