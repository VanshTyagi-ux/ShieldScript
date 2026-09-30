import { useEffect, useRef, useState } from "react";
import { VIEW_WIDTH as W, isNum, r2 } from "./frame.js";
import { linearScale, niceTicks } from "./scale.js";
import { toneClass } from "./shapes.js";
import { useChartTooltip } from "./Tooltip.jsx";

const PAD = { left: 36, right: 16, top: 12, bottom: 12 };
const HIT_RADIUS = 12; // hover target, larger than the 4px marker

// A single-series line (2px) or area (line + fill to the baseline), accent-coloured unless tone is set
// ({ slot } picks a categorical series colour instead). The chart is one tab stop: focus it, then use the
// arrow keys, Home and End to step through the points; hovering a point works too. points: [{ value, label }].
export function Sparkline({ points, domain = [0, 100], reference, height = 120, valueLabel = "Score", ariaLabel = "Line chart", area = false, tone }) {
  const { wrapRef, layer, bindMark, show, hide } = useChartTooltip();
  const pointRefs = useRef([]);
  const [active, setActive] = useState(null);
  const data = points.filter((p) => isNum(p.value));
  const last = data.length - 1;

  const describe = (p) => ({ label: `${p.label}: ${p.value}`, title: p.label, rows: [{ label: valueLabel, value: String(p.value) }] });

  useEffect(() => {
    if (active !== null && data[active] && pointRefs.current[active]) show(describe(data[active]), pointRefs.current[active]);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data.length) return <p className="muted">No data</p>;

  const [d0, d1] = domain;
  const y = linearScale([d0, d1], [height - PAD.bottom, PAD.top]);
  const yOf = (value) => y(Math.min(d1, Math.max(d0, value)));
  const xOf = (i) => (data.length === 1 ? W / 2 : PAD.left + (i * (W - PAD.left - PAD.right)) / (data.length - 1));
  const ticks = niceTicks(d0, d1, 4);
  const path = data.map((p, i) => `${i ? "L" : "M"} ${r2(xOf(i))} ${r2(yOf(p.value))}`).join(" ");
  const baseline = height - PAD.bottom;
  const areaPath = area && data.length > 1
    ? `${path} L ${r2(xOf(last))} ${baseline} L ${r2(xOf(0))} ${baseline} Z`
    : "";
  const strokeClass = tone ? toneClass(tone, "stroke") : "";
  const fillClass = tone ? toneClass(tone, "fill") : "";

  function onKeyDown(event) {
    let next;
    if (event.key === "ArrowLeft") next = Math.max(0, (active ?? last) - 1);
    else if (event.key === "ArrowRight") next = Math.min(last, (active ?? last) + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "Escape") { hide(); setActive(null); return; }
    else return;
    event.preventDefault();
    setActive(next);
  }

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div className="chart-scroll">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="group"
        tabIndex={0}
        aria-label={`${ariaLabel}. Use the arrow keys to move between points.`}
        onKeyDown={onKeyDown}
        onFocus={() => { if (active === null) setActive(last); }}
        onBlur={() => { hide(); setActive(null); }}
      >
        {ticks.filter((t) => t >= d0 && t <= d1).map((tick) => (
          <g key={tick}>
            <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={r2(y(tick))} y2={r2(y(tick))} />
            <text className="axis-text" x={PAD.left - 8} y={r2(y(tick))} textAnchor="end" dominantBaseline="middle">{tick}</text>
          </g>
        ))}
        {reference && isNum(reference.value) ? (
          <g>
            <line className="ref-line axis-line" x1={PAD.left} x2={W - PAD.right} y1={r2(yOf(reference.value))} y2={r2(yOf(reference.value))} data-y={r2(yOf(reference.value))} />
            <text className="axis-text" x={W - PAD.right} y={r2(yOf(reference.value)) - 6} textAnchor="end">{reference.label}</text>
          </g>
        ) : null}
        {areaPath ? <path className={`spark-area ${fillClass}`.trim()} d={areaPath} /> : null}
        {data.length > 1 ? <path className={`spark-line ${strokeClass}`.trim()} d={path} /> : null}
        <circle className={`spark-end ring ${fillClass}`.trim()} cx={r2(xOf(last))} cy={r2(yOf(data[last].value))} r="4" />
        {data.map((p, i) => (
          <circle
            key={i}
            ref={(el) => { pointRefs.current[i] = el; }}
            className="hit spark-point"
            cx={r2(xOf(i))} cy={r2(yOf(p.value))} r={HIT_RADIUS}
            data-x={r2(xOf(i))} data-y={r2(yOf(p.value))}
            {...bindMark(describe(p))}
            tabIndex={-1}
          />
        ))}
      </svg>
      </div>
      {layer}
    </div>
  );
}
