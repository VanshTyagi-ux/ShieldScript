import { useState } from "react";
import { ChartCard } from "../charts/ChartCard.jsx";
import { Sparkline } from "../charts/Sparkline.jsx";
import { StackedBar } from "../charts/StackedBar.jsx";
import { LEVEL_LABEL } from "../format.js";

const LEVELS = ["safe", "low", "medium", "high", "critical"];
const RECENT = 8;
const PLOTTED = 30;
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const shorten = (text, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const timeOf = (ts) => new Date(ts).toLocaleTimeString();

// What this tab's scans looked like: score history, level mix, and a list you can re-run from.
// entries: newest first (as the history hook returns them).
export function SessionInsights({ entries, onRerun, onClear }) {
  const [showAll, setShowAll] = useState(false);

  if (!entries.length) {
    return (
      <section className="card" aria-labelledby="insights-title">
        <h2 id="insights-title">Session insights</h2>
        <p className="empty">Your scans this session will appear here.</p>
      </section>
    );
  }

  const plotted = entries.slice(0, PLOTTED).reverse(); // oldest to newest, left to right
  const mix = LEVELS
    .map((level) => ({ key: level, label: cap(level), level, value: entries.filter((e) => e.level === level).length }))
    .filter((segment) => segment.value > 0);
  const shown = showAll ? entries : entries.slice(0, RECENT);

  return (
    <section aria-labelledby="insights-title">
      <h2 id="insights-title">Session insights</h2>
      <div className="stack">
        <div className="grid-2">
          <ChartCard
            title="Score history"
            description="Your latest scans, oldest to newest."
            table={{ columns: ["Time", "Score"], rows: plotted.map((e) => [timeOf(e.ts), e.score]) }}
          >
            <Sparkline
              points={plotted.map((e) => ({ value: e.score, label: timeOf(e.ts) }))}
              reference={{ value: 25, label: "Blocked from 25" }}
              ariaLabel="Score history"
              tone={{ slot: 1 }}
              area
            />
          </ChartCard>
          <ChartCard
            title="Level mix"
            description="How the scans this session were rated."
            legend={mix}
            table={{ columns: ["Level", "Scans"], rows: mix.map((s) => [s.label, s.value]) }}
          >
            <StackedBar segments={mix} ariaLabel="Level mix" />
          </ChartCard>
        </div>
        <div className="card">
          <div className="history-head">
            <h3>Recent scans</h3>
            <button type="button" className="ghost" onClick={onClear}>Clear history</button>
          </div>
          <ul className="history-list">
            {shown.map((e) => (
              <li key={e.id}>
                <span className={`chip level-${e.level}`}>{LEVEL_LABEL[e.level] || e.level}</span>
                <span className="muted">{`score ${e.score}`}</span>
                <code>{shorten(e.text)}</code>
                <span className="muted">{timeOf(e.ts)}</span>
                <button type="button" className="ghost" aria-label={`Re-run: ${shorten(e.text, 30)}`} onClick={() => onRerun(e.text)}>Re-run</button>
              </li>
            ))}
          </ul>
          {entries.length > RECENT ? (
            <button type="button" className="ghost" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show all (${entries.length})`}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
