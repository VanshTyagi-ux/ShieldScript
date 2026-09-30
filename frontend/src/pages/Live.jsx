import { PageHeading } from "../layout/PageHeading.jsx";
import { summarize } from "../lib/liveSummary.js";
import { useEvents } from "../lib/useEvents.js";

const timeOf = (ts) => String(ts).slice(11, 19); // "HH:MM:SS", UTC, the same for everyone

// All event text is untrusted input, so it is only ever rendered as text.
function EventRow({ event }) {
  return (
    <tr>
      <td>{timeOf(event.ts)}</td>
      <td>{event.source}</td>
      <td>{event.field}</td>
      <td><span className={`chip ${event.blocked ? "bad" : "ok"}`}>{event.blocked ? "Blocked" : "Allowed"}</span></td>
      <td>{`${event.score} ${event.level}`}</td>
      <td>{event.rules.length ? event.rules.join(" ") : "none"}</td>
      <td className="live-text">{event.text}</td>
    </tr>
  );
}

function Empty({ loading }) {
  return (
    <section className="card">
      {loading ? <p>Loading…</p> : (
        <p>Nothing yet. Start the dummy site with <code>python -m xss_detector demo</code> and use its protected pages.</p>
      )}
    </section>
  );
}

export function LivePage() {
  const { status, events, enabled, error, clear } = useEvents();
  const { scanned, blocked, allowed, topRules } = summarize(events);
  return (
    <div className="page">
      <PageHeading description="Scans that other apps, such as the dummy blog, send to this detector, as they happen.">
        Live feed
      </PageHeading>
      {status === "error" ? (
        <p className="callout" role="alert">Can't reach the server ({error}). Showing the last events received.</p>
      ) : null}
      {!enabled ? (
        <section className="card">
          <p>The live feed is off on this server. It is on by default only for local runs; set <code>LIVE_FEED=1</code> to turn it on.</p>
        </section>
      ) : (
        <>
          <div className="stat-grid">
            {[["Scanned", scanned], ["Blocked", blocked], ["Allowed", allowed]].map(([label, value]) => (
              <div className="card stat-tile" key={label}>
                <div className="stat-label">{label}</div>
                <div className="stat-value">{value}</div>
              </div>
            ))}
          </div>
          <p>
            <button type="button" className="ghost" disabled={events.length === 0} onClick={clear}>Clear feed</button>
          </p>
          {topRules.length ? (
            <section className="card top-rules">
              <h2>Most triggered rules</h2>
              <ul className="chip-row">
                {topRules.map((t) => <li className="chip" key={t.rule}>{`${t.rule} × ${t.count}`}</li>)}
              </ul>
            </section>
          ) : null}
          {events.length === 0 ? <Empty loading={status === "loading"} /> : (
            <div className="table-wrap" role="region" aria-label="Recent scans" tabIndex={0}>
              <table className="live-table">
                <thead>
                  <tr>
                    <th>Time (UTC)</th><th>Source</th><th>Field</th><th>Verdict</th><th>Score</th><th>Rules</th><th>Input</th>
                  </tr>
                </thead>
                <tbody>{events.map((event) => <EventRow event={event} key={event.id} />)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
