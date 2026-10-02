import { useState } from "react";
import { BarChart } from "../charts/BarChart.jsx";
import { ChartCard } from "../charts/ChartCard.jsx";
import { GroupedBars } from "../charts/GroupedBars.jsx";
import { formatPercent } from "../charts/scale.js";
import { StackedBar } from "../charts/StackedBar.jsx";
import { StackedColumns } from "../charts/StackedColumns.jsx";
import { StatTile } from "../charts/StatTile.jsx";
import { LEVEL_LABEL } from "../format.js";
import { PageHeading } from "../layout/PageHeading.jsx";
import { categoryLabel, categorySlot } from "../lib/categories.js";
import { useAnalytics } from "../lib/useAnalytics.js";
import { useApi } from "../lib/useApi.js";

const RANGES = [["1h", "Last hour"], ["24h", "Last 24 hours"], ["7d", "Last 7 days"], ["all", "All"]];
const LEVELS = ["safe", "low", "medium", "high", "critical"];
const QUALITY_NOTE = "Live traffic has no labels, so a block rate is not accuracy. Recall and precision come from the benchmark.";
const timeOf = (ts) => String(ts).slice(11, 19); // "HH:MM:SS", UTC
const bucketLabel = (t, bucket) => (bucket === "day" ? String(t).slice(5, 10) : String(t).slice(11, 16));
const BUCKET_NAME = { "5min": "5 minutes", hour: "hour", day: "day" };

const ALLOWED = { key: "allowed", label: "Allowed", level: "safe" };
const BLOCKED = { key: "blocked", label: "Blocked", level: "critical" };
const SCANS = { key: "scans", label: "Scans", slot: 1 };

function Charts({ data }) {
  const { timeline, bucket, rules, categories, levels, sources, fields, scores } = data;
  const ruleCategories = [...new Set(rules.map((r) => r.category))];
  return (
    <div className="stack">
      <ChartCard
        title="Threats over time"
        description={`Scans per ${BUCKET_NAME[bucket] || bucket}, blocked and allowed (UTC).`}
        legend={[ALLOWED, BLOCKED]}
        table={{ columns: ["Time (UTC)", "Allowed", "Blocked"], rows: timeline.map((b) => [b.t.slice(0, 16).replace("T", " "), b.allowed, b.blocked]) }}
      >
        <StackedColumns
          columns={timeline.map((b) => ({ key: b.t, label: bucketLabel(b.t, bucket), values: { allowed: b.allowed, blocked: b.blocked } }))}
          series={[ALLOWED, BLOCKED]}
          ariaLabel="Scans over time"
        />
      </ChartCard>
      <div className="grid-2">
        <ChartCard
          title="Most triggered rules"
          description="Scans in which each rule fired. Colour shows the rule's category."
          legend={ruleCategories.map((c) => ({ key: c, label: categoryLabel(c), slot: categorySlot(c) }))}
          table={{ columns: ["Rule", "Category", "Scans"], rows: rules.map((r) => [`${r.rule_id} ${r.name}`, categoryLabel(r.category), r.count]) }}
        >
          <BarChart
            data={rules.map((r) => ({ key: r.rule_id, label: `${r.rule_id} ${r.name}`, value: r.count, slot: categorySlot(r.category) }))}
            valueLabel="Scans"
            ariaLabel="Most triggered rules"
          />
        </ChartCard>
        <ChartCard
          title="Rules by category"
          description="Scans in which at least one rule of the category fired. A scan can count in several."
          table={{ columns: ["Category", "Scans"], rows: categories.map((c) => [categoryLabel(c.category), c.count]) }}
        >
          <BarChart
            data={categories.map((c) => ({ key: c.category, label: categoryLabel(c.category), value: c.count, slot: categorySlot(c.category) }))}
            valueLabel="Scans"
            ariaLabel="Rules by category"
          />
        </ChartCard>
      </div>
      <ChartCard
        title="Risk levels"
        description="How the scans in this range were rated."
        legend={LEVELS.filter((l) => levels[l] > 0).map((l) => ({ key: l, label: LEVEL_LABEL[l], level: l }))}
        table={{ columns: ["Level", "Scans"], rows: LEVELS.map((l) => [LEVEL_LABEL[l], levels[l]]) }}
      >
        <StackedBar segments={LEVELS.filter((l) => levels[l] > 0).map((l) => ({ key: l, label: LEVEL_LABEL[l], value: levels[l], level: l }))} ariaLabel="Risk levels" />
      </ChartCard>
      <div className="grid-2">
        <ChartCard
          title="Scans by source"
          description="Which apps send scans, and how many were blocked."
          legend={[SCANS, BLOCKED]}
          table={{ columns: ["Source", "Scans", "Blocked"], rows: sources.map((s) => [s.source, s.scans, s.blocked]) }}
        >
          <GroupedBars groups={sources.map((s) => ({ key: s.source, label: s.source, values: { scans: s.scans, blocked: s.blocked } }))} series={[SCANS, BLOCKED]} labelWidth={140} ariaLabel="Scans by source" />
        </ChartCard>
        <ChartCard
          title="Scans by field"
          description="Which form fields get the most scans and the most blocks."
          legend={[SCANS, BLOCKED]}
          table={{ columns: ["Field", "Scans", "Blocked"], rows: fields.map((f) => [f.field, f.scans, f.blocked]) }}
        >
          <GroupedBars groups={fields.map((f) => ({ key: f.field, label: f.field, values: { scans: f.scans, blocked: f.blocked } }))} series={[SCANS, BLOCKED]} labelWidth={140} ariaLabel="Scans by field" />
        </ChartCard>
      </div>
      <ChartCard
        title="Score distribution"
        description="How many scans fall in each score band (blocked from 25)."
        table={{ columns: ["Score", "Scans"], rows: scores.map((b) => [b.label, b.count]) }}
      >
        <BarChart data={scores.map((b) => ({ key: b.label, label: b.label, value: b.count, slot: 1 }))} valueLabel="Scans" labelWidth={80} ariaLabel="Score distribution" />
      </ChartCard>
    </div>
  );
}

function RecentCritical({ items }) {
  return (
    <section className="card">
      <h2>Recent critical attacks</h2>
      {items.length === 0 ? <p className="muted">No critical attacks in this range.</p> : (
        <div className="table-wrap" role="region" aria-label="Recent critical attacks" tabIndex={0}>
          <table className="live-table">
            <thead><tr><th>Time (UTC)</th><th>Source</th><th>Field</th><th>Score</th><th>Rules</th><th>Input</th></tr></thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={`${item.ts}-${i}`}>
                  <td>{timeOf(item.ts)}</td>
                  <td>{item.source || "-"}</td>
                  <td>{item.field}</td>
                  <td>{item.score}</td>
                  <td>{item.rules.length ? item.rules.join(" ") : "none"}</td>
                  <td className="live-text">{item.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Quality({ benchmark, blockRate }) {
  const detectors = benchmark.data && Array.isArray(benchmark.data.detectors) ? benchmark.data.detectors : [];
  const headline = detectors.find((d) => d.shipped) || detectors[0];
  return (
    <section className="card">
      <h2>Detector quality</h2>
      {headline ? (
        <div className="stat-grid">
          <StatTile label="Recall" value={formatPercent(headline.recall, 1)} note="benchmark: attacks caught" />
          <StatTile label="Precision" value={formatPercent(headline.precision, 1)} note="benchmark: flags that were attacks" />
          <StatTile label="False-positive rate" value={formatPercent(headline.fpr, 2)} note="benchmark: harmless inputs blocked" />
          <StatTile label="Hard negatives blocked" value={`${headline.hard_fps}/${headline.hard_total}`} note="benchmark: tricky harmless inputs" />
          <StatTile label="Live block rate" value={formatPercent(blockRate, 1)} note="this range, not accuracy" />
        </div>
      ) : <p className="muted">Benchmark numbers are not available yet.</p>}
      <p className="muted">{QUALITY_NOTE}</p>
    </section>
  );
}

export function DashboardPage() {
  const [range, setRange] = useState("24h");
  const { status, data, error, reload } = useAnalytics({ range });
  const benchmark = useApi("/benchmark");
  const showChips = !data || data.enabled; // saving off: nothing to range over
  const busy = Boolean(data) && status === "loading"; // the previous data stays up while a new range loads

  let body;
  if (!data) {
    body = status === "error" ? (
      <p className="callout" role="alert">
        {`Can't load the dashboard (${error}). `}
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
    const { totals } = data;
    body = (
      <div className={`stack${busy ? " is-busy" : ""}`} aria-busy={busy ? "true" : "false"}>
        {status === "error" ? (
          <p className="callout" role="alert">
            {`Can't reach the server (${error}). Showing the last data received. `}
            <button type="button" className="ghost" onClick={reload}>Retry</button>
          </p>
        ) : null}
        {totals.scans === 0 ? (
          <section className="card"><p>No scans in this range yet. Try the Scanner.</p></section>
        ) : (
          <>
            <div className="stat-grid">
              <StatTile label="Total scans" value={String(totals.scans)} />
              <StatTile label="Blocked" value={String(totals.blocked)} />
              <StatTile label="Allowed" value={String(totals.allowed)} />
              <StatTile label="Block rate" value={formatPercent(totals.block_rate, 1)} />
              <StatTile label="Critical" value={String(totals.critical)} />
              <StatTile label="ML escalations" value={String(totals.ml_escalations)} note="blocked although the rules scored under 25" />
            </div>
            <Charts data={data} />
            <RecentCritical items={data.recent_critical} />
            <Quality benchmark={benchmark} blockRate={totals.block_rate} />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeading description="What is being scanned and blocked, how, and from where, from the stored scan history. Refreshes every few seconds.">
        Dashboard
      </PageHeading>
      <div className="stack">
        {showChips ? (
          <div className="chip-row">
            {RANGES.map(([key, label]) => (
              <button type="button" className="chip-button" key={key} aria-pressed={range === key} onClick={() => setRange(key)}>{label}</button>
            ))}
          </div>
        ) : null}
        {showChips && range === "all" ? <p className="muted">All covers at most the 10,000 most recent stored scans.</p> : null}
        {body}
      </div>
    </div>
  );
}
