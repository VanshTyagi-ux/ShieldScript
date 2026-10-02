import { useEffect, useState } from "react";
import { apiUrl } from "../api.js";
import { PageHeading } from "../layout/PageHeading.jsx";
import { PAGE_SIZE, useHistory } from "../lib/useHistory.js";

const FILTERS = [["all", "All"], ["blocked", "Blocked"], ["allowed", "Allowed"]];
const CONFIRM_MS = 4000;
const timeOf = (ts) => String(ts).slice(11, 19); // "HH:MM:SS", UTC, the same for everyone

// All stored text is untrusted input, so it is only ever rendered as text.
function ScanRow({ scan }) {
  return (
    <tr>
      <td>{timeOf(scan.ts)}</td>
      <td>{scan.source || "-"}</td>
      <td>{scan.field}</td>
      <td><span className={`chip ${scan.blocked ? "bad" : "ok"}`}>{scan.blocked ? "Blocked" : "Allowed"}</span></td>
      <td>{`${scan.score} ${scan.level}`}</td>
      <td>{scan.rules.length ? scan.rules.join(" ") : "none"}</td>
      <td className="live-text">{scan.text}</td>
    </tr>
  );
}

export function HistoryPage() {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const { status, data, error, reload, clear } = useHistory({ filter, page });

  useEffect(() => {
    if (!confirming) return undefined;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  const choose = (next) => { setFilter(next); setPage(0); setConfirming(false); };
  const onClear = () => {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    setPage(0);
    clear();
  };

  let body;
  if (!data) {
    body = status === "error" ? (
      <p className="callout" role="alert">
        {`Can't load the history (${error}). `}
        <button type="button" className="ghost" onClick={reload}>Retry</button>
      </p>
    ) : <section className="card"><p>Loading…</p></section>;
  } else if (!data.enabled) {
    body = (
      <section className="card">
        <p>Saving scans is off on this server. It is on by default only for local runs; set STORE_SCANS=1 to turn it on.</p>
      </section>
    );
  } else {
    const { counts, items, total } = data;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    body = (
      <>
        {status === "error" ? (
          <p className="callout" role="alert">
            {`Can't reach the server (${error}). Showing the last scans received. `}
            <button type="button" className="ghost" onClick={reload}>Retry</button>
          </p>
        ) : null}
        <div className="stat-grid">
          {[["Total", counts.all], ["Blocked", counts.blocked], ["Allowed", counts.allowed]].map(([label, value]) => (
            <div className="card stat-tile" key={label}>
              <div className="stat-label">{label}</div>
              <div className="stat-value">{value}</div>
            </div>
          ))}
        </div>
        <div className="history-toolbar">
          <div className="chip-row">
            {FILTERS.map(([key, label]) => (
              <button type="button" className="chip-button" key={key} aria-pressed={filter === key} onClick={() => choose(key)}>{label}</button>
            ))}
          </div>
          <button type="button" className="ghost" onClick={reload}>Refresh</button>
          <a className="history-link" href={apiUrl("/history/export?format=csv")} download>Export CSV</a>
          <a className="history-link" href={apiUrl("/history/export?format=json")} download>Export JSON</a>
          <button type="button" className="ghost" disabled={counts.all === 0} onClick={onClear}>
            {confirming ? "Click again to confirm" : "Clear history"}
          </button>
        </div>
        {counts.all === 0 ? (
          <section className="card"><p>No scans stored yet. Try the Scanner.</p></section>
        ) : items.length === 0 ? (
          <section className="card"><p>No scans match this filter.</p></section>
        ) : (
          <div className="table-wrap" role="region" aria-label="Stored scans" tabIndex={0}>
            <table className="live-table">
              <thead>
                <tr>
                  <th>Time (UTC)</th><th>Source</th><th>Field</th><th>Verdict</th><th>Score</th><th>Rules</th><th>Input</th>
                </tr>
              </thead>
              <tbody>{items.map((scan) => <ScanRow scan={scan} key={scan.id} />)}</tbody>
            </table>
          </div>
        )}
        {total > 0 ? (
          <div className="history-pager">
            <button type="button" className="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="muted">{`Page ${page + 1} of ${pages}`}</span>
            <button type="button" className="ghost" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="page">
      <PageHeading description="Every scan this server has answered, kept across restarts. Stored input is shown as plain text.">
        History
      </PageHeading>
      {body}
    </div>
  );
}
