import { Legend } from "../charts/Legend.jsx";
import { StackedBar } from "../charts/StackedBar.jsx";
import { categorySlot } from "../lib/categories.js";

// Which rules produced the score: one segment per rule that fired, sized by weight, coloured by category.
// The track is the 100-point scale; weights above 100 widen it and mark where the score is capped.
export function ScoreBreakdown({ findings, threshold = 25 }) {
  const parts = findings.filter((f) => Number.isFinite(f.weight) && f.weight > 0);
  const total = parts.reduce((sum, f) => sum + f.weight, 0);

  let chart = <p className="muted">No rules fired.</p>;
  if (findings.length) {
    const markers = [{ value: threshold, label: `Blocked from ${threshold}` }];
    if (total > 100) markers.push({ value: 100, label: "Capped at 100" });
    const slotOf = (f) => categorySlot(f.category);
    chart = (
      <>
        <StackedBar
          segments={parts.map((f) => ({ key: f.rule_id, label: f.rule_id, value: f.weight, slot: slotOf(f) }))}
          total={100}
          markers={markers}
          ariaLabel="Where the score comes from"
        />
        {parts.length >= 2 ? <Legend items={parts.map((f) => ({ key: f.rule_id, label: `${f.rule_id} ${f.name}`, slot: slotOf(f) }))} /> : null}
        <p className="muted">{`${total} points from the rules${total > 100 ? ", capped at 100" : ""}.`}</p>
      </>
    );
  }
  return (
    <div className="breakdown">
      <h3>Where the score comes from</h3>
      {chart}
    </div>
  );
}
