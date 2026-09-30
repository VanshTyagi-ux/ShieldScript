import { toneClass } from "./shapes.js";
import { useCountUp } from "../lib/useCountUp.js";
import { useReveal } from "../lib/useReveal.js";

// A headline number: label, value, optional note. With `countUp` (a number) the value counts up when the
// tile scrolls into view (instantly under reduced motion) and is shown through `format`. `tone` ({ slot })
// draws a coloured accent bar - the value text itself always stays in the normal ink.
export function StatTile({ label, value, note, countUp, format = String, tone }) {
  const [ref, visible] = useReveal();
  const counted = useCountUp(countUp ?? 0, { active: countUp !== undefined && visible });
  const shown = countUp === undefined ? value : format(counted);
  return (
    <div className="card stat-tile" ref={ref}>
      {tone ? <span className={`stat-accent ${toneClass(tone, "bg")}`} /> : null}
      <div className="stat-label">{label}</div>
      <div className="stat-value">{shown}</div>
      {note ? <div className="stat-note muted">{note}</div> : null}
    </div>
  );
}
