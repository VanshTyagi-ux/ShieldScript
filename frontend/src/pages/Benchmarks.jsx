import { BarChart } from "../charts/BarChart.jsx";
import { ChartCard } from "../charts/ChartCard.jsx";
import { GroupedBars } from "../charts/GroupedBars.jsx";
import { Legend } from "../charts/Legend.jsx";
import { formatCount, formatPercent } from "../charts/scale.js";
import { StatTile } from "../charts/StatTile.jsx";
import { PageHeading } from "../layout/PageHeading.jsx";
import { detectorSlots } from "../lib/detectors.js";
import { useApi } from "../lib/useApi.js";

const pct0 = (v) => formatPercent(v, 0);
const pct1 = (v) => formatPercent(v, 1);
const pct2 = (v) => formatPercent(v, 2);
const SAMPLE_LIMIT = 12;

function Loading() {
  return (
    <div className="skeleton-block" role="status" aria-label="Loading benchmark" aria-busy="true">
      <span className="skeleton tall" />
      <span className="skeleton" />
      <span className="skeleton mid" />
      <span className="skeleton short" />
    </div>
  );
}

// One small-multiple chart: a single metric across every detector, on its own scale.
function MetricChart({ title, description, footnote, detectors, slots, metric, format, tickFormat, domain, valueLabel }) {
  const data = detectors.map((d) => ({ key: d.name, label: d.name, value: d[metric], slot: slots[d.name] }));
  return (
    <ChartCard
      title={title}
      description={description}
      footnote={footnote}
      table={{ columns: ["Detector", title], rows: detectors.map((d) => [d.name, format(d[metric])]) }}
    >
      <BarChart data={data} format={format} tickFormat={tickFormat} domain={domain} valueLabel={valueLabel} ariaLabel={title} />
    </ChartCard>
  );
}

function UnseenSources({ sources, weighted }) {
  if (!sources.length) {
    return <p className="empty">The unseen-source test was not run. <code>python -m xss_detector evaluate</code> includes it.</p>;
  }
  const byMl = [...sources].sort((a, b) => b.ml_recall - a.ml_recall || a.source.localeCompare(b.source, "en", { sensitivity: "base" }));
  const label = (name, n) => `${name.replace(/\.txt$/, "")} (n=${formatCount(n)})`;
  const groups = [
    ...(weighted ? [{ key: "__all", label: `All lists, weighted (n=${formatCount(weighted.payloads)})`, values: { rules: weighted.rules_recall, ml: weighted.ml_recall } }] : []),
    ...byMl.map((s) => ({ key: s.source, label: label(s.source, s.payloads), values: { rules: s.rules_recall, ml: s.ml_recall } })),
  ];
  const series = [{ key: "rules", label: "Rules recall", slot: 2 }, { key: "ml", label: "ML recall", slot: 3 }];
  return (
    <ChartCard
      title="Recall on payload lists the model never saw"
      description="The ML model is retrained without one payload list and scored on that list only. This is the fairer estimate."
      legend={series}
      table={{
        columns: ["List", "Payloads", "Rules recall", "ML recall", "ML false-positive rate"],
        rows: [
          ...(weighted ? [["All lists (weighted)", formatCount(weighted.payloads), pct1(weighted.rules_recall), pct1(weighted.ml_recall), "-"]] : []),
          ...byMl.map((s) => [s.source, formatCount(s.payloads), pct1(s.rules_recall), pct1(s.ml_recall), pct2(s.ml_fpr)]),
        ],
      }}
    >
      <GroupedBars groups={groups} series={series} format={pct1} tickFormat={pct0} domain={[0, 1]} ariaLabel="Recall on unseen payload lists" />
    </ChartCard>
  );
}

function OutcomeTable({ detectors }) {
  const maxFn = Math.max(1, ...detectors.map((d) => d.fn));
  const maxFp = Math.max(1, ...detectors.map((d) => d.fp));
  const cell = (value, max) => (
    <td>
      <div className="bar-cell">
        <span>{formatCount(value)}</span>
        <div className="wbar"><div style={{ width: `${(value / max) * 100}%` }} /></div>
      </div>
    </td>
  );
  return (
    <div className="table-wrap">
      <table className="outcome-table">
        <thead>
          <tr>
            <th scope="col">Detector</th><th scope="col">Caught (TP)</th><th scope="col">Missed (FN)</th>
            <th scope="col">False alarms (FP)</th><th scope="col">Correctly passed (TN)</th><th scope="col">Hard-negative FPs</th>
          </tr>
        </thead>
        <tbody>
          {detectors.map((d) => (
            <tr key={d.name}>
              <th scope="row">{d.name}</th>
              <td>{formatCount(d.tp)}</td>
              {cell(d.fn, maxFn)}
              {cell(d.fp, maxFp)}
              <td>{formatCount(d.tn)}</td>
              <td>{`${d.hard_fps}/${d.hard_total}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Examples({ detectors }) {
  const list = (title, items) => (
    <div>
      <h4>{title}</h4>
      {items.length ? <ul className="examples">{items.slice(0, SAMPLE_LIMIT).map((item, i) => <li key={i}><code>{item}</code></li>)}</ul> : <p className="muted">(none)</p>}
    </div>
  );
  return (
    <div className="stack">
      {detectors.map((d) => (
        <details className="card" key={d.name}>
          <summary>{d.name}</summary>
          {list("Attacks it missed", d.samples.misses)}
          {list("False alarms on benign text", d.samples.false_positives)}
          {list("False alarms on hard negatives", d.samples.hard_false_positives)}
        </details>
      ))}
    </div>
  );
}

function Report({ data }) {
  const slots = detectorSlots(data.detectors.map((d) => d.name));
  const detectors = [...data.detectors].sort((a, b) => slots[a.name] - slots[b.name]);
  const headline = data.detectors.find((d) => d.shipped) || data.detectors[0];
  const legend = detectors.map((d) => ({ key: d.name, label: d.name, slot: slots[d.name] }));
  const maxFpr = Math.max(0.0005, ...detectors.map((d) => d.fpr));
  const chart = { detectors, slots };
  const { malicious_test: mal, benign_test: ben, hard_negatives: hard } = data.dataset;

  return (
    <div className="stack">
      <p className="muted">
        {`Held-out test split: ${formatCount(mal)} malicious payloads, ${formatCount(ben)} benign inputs and ${formatCount(hard)} hard negatives. Generated ${data.generated}.`}
      </p>
      <div className="stat-grid">
        <StatTile label="Recall" value={pct1(headline.recall)} note="attacks caught" />
        <StatTile label="Precision" value={pct1(headline.precision)} note="flags that were attacks" />
        <StatTile label="False-positive rate" value={pct2(headline.fpr)} note="benign inputs blocked" />
        <StatTile label="F1" value={pct1(headline.f1)} note="recall and precision together" />
        <StatTile label="Hard-negative false positives" value={`${headline.hard_fps}/${headline.hard_total}`} note="tricky harmless inputs" />
      </div>

      <section aria-labelledby="compare-title">
        <h2 id="compare-title">Detector comparison</h2>
        <Legend items={legend} />
        <div className="stack">
          <MetricChart {...chart} title="Recall" description="Share of attacks each detector catches. Higher is better." metric="recall" format={pct1} tickFormat={pct0} domain={[0, 1]} valueLabel="Recall" />
          <MetricChart {...chart} title="Precision" description="Share of flagged inputs that really were attacks. Higher is better." metric="precision" format={pct1} tickFormat={pct0} domain={[0, 1]} valueLabel="Precision" />
          <MetricChart {...chart} title="False-positive rate" description="Share of harmless inputs wrongly flagged." footnote="Lower is better. This chart has its own scale, because the rates are tiny next to recall." metric="fpr" format={pct2} tickFormat={pct2} domain={[0, maxFpr]} valueLabel="False-positive rate" />
        </div>
      </section>

      <section aria-labelledby="unseen-title">
        <h2 id="unseen-title">Unseen-source test</h2>
        <UnseenSources sources={data.unseen_sources} weighted={data.unseen_weighted} />
      </section>

      <section aria-labelledby="outcomes-title">
        <h2 id="outcomes-title">Outcomes</h2>
        <OutcomeTable detectors={detectors} />
      </section>

      <section aria-labelledby="examples-title">
        <h2 id="examples-title">Examples</h2>
        <Examples detectors={detectors} />
      </section>

      <aside className="callout">
        <strong>Read this first</strong>
        <ul>{data.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
      </aside>
    </div>
  );
}

export function BenchmarksPage() {
  const { status, data, error, reload } = useApi("/benchmark");
  let body;
  if (!data) {
    body = status === "error" ? (
      <div className="error-box" role="alert">
        {`Could not load the benchmark: ${error}`}{" "}
        <span>Generate it with <code>python -m xss_detector evaluate</code>.</span>{" "}
        <button type="button" className="ghost" onClick={reload}>Retry</button>
      </div>
    ) : <Loading />;
  } else if (!data.detectors.length) {
    body = <p className="empty">The benchmark contains no detectors.</p>;
  } else {
    body = <Report data={data} />;
  }
  return (
    <div className="page">
      <PageHeading description="How each detector performs on held-out data, and how it holds up on payload lists it never saw.">Benchmarks</PageHeading>
      {body}
    </div>
  );
}
