import { LEVEL_LABEL } from "../format.js";

const REASONS = {
  event_handler: "Event handler: runs script when triggered",
  unsafe_url: "URL scheme not allowed (javascript:, data:, ...)",
  tag_not_allowed: "Was on a tag that was removed",
  attribute_not_allowed: "Not an allowed attribute for this tag",
};

const plural = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

// What the sanitizer took out: a one-line summary, then the removed tags and attributes with counts and reasons.
export function SanitizeReport({ report, changed }) {
  const removedAnything = report.total_tags_removed + report.total_attributes_removed + report.comments_removed > 0;
  return (
    <div className="sanitize-report">
      {removedAnything ? (
        <p className="report-summary warn">
          {`Removed ${plural(report.total_tags_removed, "tag")}, ${plural(report.total_attributes_removed, "attribute")}`}
          {report.comments_removed ? ` and ${plural(report.comments_removed, "comment")}` : ""}.
        </p>
      ) : (
        <p className="report-summary ok">Nothing was removed.</p>
      )}
      {changed && !removedAnything ? (
        <p className="muted">The text still differs from the input, but only in formatting, for example <code>rel="noopener noreferrer"</code> added to links.</p>
      ) : null}

      {report.removed_tags.length > 0 ? (
        <div className="table-wrap">
          <table className="report-table">
            <caption className="sr-only">Removed tags</caption>
            <thead><tr><th scope="col">Tag</th><th scope="col">Removed</th><th scope="col">What happened</th></tr></thead>
            <tbody>
              {report.removed_tags.map((t) => (
                <tr key={t.name}>
                  <td><code>{`<${t.name}>`}</code></td>
                  <td>{t.count}</td>
                  <td className="muted">{t.content_removed ? "Tag and everything inside it removed" : "Tag removed, its text kept"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {report.removed_attributes.length > 0 ? (
        <div className="table-wrap">
          <table className="report-table">
            <caption className="sr-only">Removed attributes</caption>
            <thead><tr><th scope="col">Attribute</th><th scope="col">On</th><th scope="col">Removed</th><th scope="col">Why</th></tr></thead>
            <tbody>
              {report.removed_attributes.map((a) => (
                <tr key={`${a.tag}/${a.name}`}>
                  <td><code>{a.name}</code></td>
                  <td><code>{`<${a.tag}>`}</code></td>
                  <td>{a.count}</td>
                  <td className="muted">{REASONS[a.reason] || a.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {report.truncated ? <p className="muted">The lists are cut at 100 entries; the totals above are exact.</p> : null}
    </div>
  );
}

// The detector's opinion of the raw input, clearly marked as advice only.
export function DetectorAlert({ detector }) {
  const ml = detector.ml_probability;
  return (
    <div className="detector-alert">
      <div className="chip-row">
        <span className={`chip level-${detector.level}`}>{LEVEL_LABEL[detector.level] || detector.level}</span>
        <span className="chip">{`score ${detector.score}/100`}</span>
        <span className="chip">{ml === null || ml === undefined ? "ML model not loaded" : `ML: ${(ml * 100).toFixed(1)}% malicious`}</span>
      </div>
      {detector.rule_ids.length > 0 ? (
        <p className="rule-ids">Rules matched: {detector.rule_ids.map((id) => <code key={id}>{id}</code>)}</p>
      ) : <p className="muted">No detection rule matched the input.</p>}
      <p className="muted">Alert only: the detector never blocks HTML here. Use the sanitized output above, not the input.</p>
    </div>
  );
}
