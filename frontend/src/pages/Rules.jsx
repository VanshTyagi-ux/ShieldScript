import { useMemo, useState } from "react";
import { BarChart } from "../charts/BarChart.jsx";
import { ChartCard } from "../charts/ChartCard.jsx";
import { StackedBar } from "../charts/StackedBar.jsx";
import { PageHeading } from "../layout/PageHeading.jsx";
import { CATEGORY_SLOTS, categoryLabel, categorySlot } from "../lib/categories.js";
import { useApi } from "../lib/useApi.js";

const COLUMNS = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "category", label: "Category" },
  { key: "weight", label: "Weight" },
  { key: "description", label: "What it looks for", sortable: false },
];

const compareText = (a, b) => a.localeCompare(b, "en", { sensitivity: "base" });
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function sortRules(rules, { key, dir }) {
  const sign = dir === "asc" ? 1 : -1;
  const primary = key === "weight" ? (a, b) => a.weight - b.weight : (a, b) => compareText(String(a[key]), String(b[key]));
  return [...rules].sort((a, b) => sign * primary(a, b) || compareText(a.id, b.id));
}

// Known categories first, in their fixed colour order, then any unknown ones alphabetically.
function categoriesOf(rules) {
  const present = [...new Set(rules.map((r) => r.category))];
  const known = Object.keys(CATEGORY_SLOTS).filter((c) => present.includes(c));
  return [...known, ...present.filter((c) => !known.includes(c)).sort(compareText)];
}

function levelBands(levels, threshold) {
  const scored = levels.filter((l) => l.name !== "safe");
  const segments = scored.map((level, i) => {
    const from = i === 0 ? 0 : level.min;
    const to = scored[i + 1] ? scored[i + 1].min : 100;
    return { key: level.name, label: cap(level.name), value: to - from, level: level.name };
  });
  const rows = levels.map((level, i) => {
    const next = levels[i + 1];
    return [cap(level.name), next ? (next.min - 1 > level.min ? `${level.min}-${next.min - 1}` : String(level.min)) : `${level.min}-100`];
  });
  return { segments, rows, marker: { value: threshold, label: `Blocked from ${threshold}` } };
}

function Loading() {
  return (
    <div className="skeleton-block" role="status" aria-label="Loading rules" aria-busy="true">
      <span className="skeleton tall" />
      <span className="skeleton" />
      <span className="skeleton mid" />
      <span className="skeleton short" />
    </div>
  );
}

function RulesCharts({ rules, levels, threshold }) {
  const categories = categoriesOf(rules);
  const legend = categories.map((c) => ({ key: c, label: categoryLabel(c), slot: categorySlot(c) }));
  const byWeight = [...rules].sort((a, b) => b.weight - a.weight || compareText(a.id, b.id));
  const perCategory = (measure) => categories.map((c) => ({
    key: c, label: categoryLabel(c), slot: categorySlot(c),
    value: rules.filter((r) => r.category === c).reduce((sum, r) => sum + measure(r), 0),
  }));
  const counts = perCategory(() => 1);
  const points = perCategory((r) => r.weight);
  const bands = levelBands(levels, threshold);

  return (
    <div className="stack">
      <ChartCard
        title="Score weight by rule"
        description="How many points each rule adds when it fires. Colour shows the rule's category."
        legend={legend}
        table={{ columns: ["Rule", "Category", "Weight"], rows: byWeight.map((r) => [`${r.id} ${r.name}`, categoryLabel(r.category), r.weight]) }}
      >
        <BarChart
          data={byWeight.map((r) => ({ key: r.id, label: `${r.id} ${r.name}`, value: r.weight, slot: categorySlot(r.category) }))}
          valueLabel="Points"
          ariaLabel="Score weight by rule"
        />
      </ChartCard>
      <div className="grid-2">
        <ChartCard
          title="Rules by category"
          description="How many rules each category has."
          legend={legend}
          table={{ columns: ["Category", "Rules"], rows: counts.map((s) => [s.label, s.value]) }}
        >
          <StackedBar segments={counts} ariaLabel="Rules by category" />
        </ChartCard>
        <ChartCard
          title="Points by category"
          description="The total weight each category can contribute."
          legend={legend}
          table={{ columns: ["Category", "Points"], rows: points.map((s) => [s.label, s.value]) }}
        >
          <StackedBar segments={points} ariaLabel="Points by category" />
        </ChartCard>
      </div>
      <ChartCard
        title="Risk levels"
        description="The score bands. A score at or above the threshold is blocked."
        legend={bands.segments.map((s) => ({ key: s.key, label: s.label, level: s.level }))}
        table={{ columns: ["Level", "Score"], rows: bands.rows }}
      >
        <StackedBar segments={bands.segments} total={100} markers={[bands.marker]} ariaLabel="Risk level bands" />
      </ChartCard>
    </div>
  );
}

function RulesTable({ rules }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(null);
  const [sort, setSort] = useState({ key: "weight", dir: "desc" });
  const categories = useMemo(() => categoriesOf(rules), [rules]);
  const maxWeight = Math.max(1, ...rules.map((r) => r.weight));

  const needle = query.trim().toLowerCase();
  const shown = sortRules(
    rules.filter((r) => (!category || r.category === category)
      && (!needle || [r.id, r.name, r.description, r.category, categoryLabel(r.category)].some((field) => field.toLowerCase().includes(needle)))),
    sort,
  );

  const chooseSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "weight" ? "desc" : "asc" }));

  return (
    <>
      <div className="controls">
        <label htmlFor="rule-search" className="sr-only">Search rules</label>
        <input id="rule-search" type="search" placeholder="Search rules" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="chip-row">
          <button type="button" className="chip-button" aria-pressed={category === null} onClick={() => setCategory(null)}>All</button>
          {categories.map((c) => (
            <button key={c} type="button" className="chip-button" aria-pressed={category === c} onClick={() => setCategory(c)}>{categoryLabel(c)}</button>
          ))}
        </div>
      </div>
      <p className="muted" aria-live="polite">{`Showing ${shown.length} of ${rules.length} rules`}</p>
      {shown.length === 0 ? (
        <p className="empty">No rules match your search.</p>
      ) : (
        <div className="table-wrap">
          <table className="rules-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} scope="col" aria-sort={col.sortable === false ? undefined : sort.key === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    {col.sortable === false ? col.label : <button type="button" className="th-sort" onClick={() => chooseSort(col.key)}>{col.label}</button>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.id}</code></td>
                  <td>{r.name}{r.derived ? <span className="chip tag">derived</span> : null}</td>
                  <td><span className="cat"><i className={`cat-dot bg-s${categorySlot(r.category) || 0}`} aria-hidden="true" />{categoryLabel(r.category)}</span></td>
                  <td>
                    <div className="weight-cell">
                      <span>{r.weight}</span>
                      <div className="wbar"><div style={{ width: `${(r.weight / maxWeight) * 100}%` }} /></div>
                    </div>
                  </td>
                  <td className="muted">{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rules.some((r) => r.derived) ? (
        <p className="muted">Derived rules are added when decoding changed the input, on top of the pattern rules.</p>
      ) : null}
    </>
  );
}

export function RulesPage() {
  const { status, data, error, reload } = useApi("/rules");
  let body;
  if (!data) {
    body = status === "error" ? (
      <div className="error-box" role="alert">
        {`Could not load the rules: ${error}`}{" "}
        <button type="button" className="ghost" onClick={reload}>Retry</button>
      </div>
    ) : <Loading />;
  } else {
    const rules = data.rules.map((r) => ({ ...r, weight: Number.isFinite(r.weight) ? r.weight : 0 }));
    body = rules.length === 0 ? (
      <p className="empty">The server returned no rules.</p>
    ) : (
      <div className="stack">
        <section aria-labelledby="weights-title">
          <h2 id="weights-title">Score weights</h2>
          <RulesCharts rules={rules} levels={data.levels} threshold={data.block_threshold} />
        </section>
        <section className="card" aria-labelledby="all-rules-title">
          <h2 id="all-rules-title">All rules</h2>
          <RulesTable rules={rules} />
        </section>
      </div>
    );
  }
  return (
    <div className="page">
      <PageHeading description="Every rule the detector runs, what it looks for, and how many points it adds to the score.">Rules</PageHeading>
      {body}
    </div>
  );
}
