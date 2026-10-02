import { VIEW_WIDTH as W, isNum, r2 } from "./frame.js";
import { bandScale, linearScale, niceTicks } from "./scale.js";
import { toneClass } from "./shapes.js";
import { useChartTooltip } from "./Tooltip.jsx";

const LEFT = 44; // room for the value-axis labels
const RIGHT = 8;
const TOP = 8;
const PLOT = 180;
const AXIS = 28;
const MAX_COLUMN = 28; // columns are never wider than this
const LABELS = 6; // about this many x labels, so they never collide
const MIN_TOP = 4; // an all-zero chart still gets a 0-4 axis
const MIN_SEGMENT = 4; // a non-zero segment is never thinner than this, so a single scan beside a burst stays visible

// A column that is square at the baseline and rounded at its top (the data end).
function roundedTop(x, y, w, h, r = 4) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M ${r2(x)} ${r2(y + h)} V ${r2(y + rr)} A ${rr} ${rr} 0 0 1 ${r2(x + rr)} ${r2(y)} H ${r2(x + w - rr)} A ${rr} ${rr} 0 0 1 ${r2(x + w)} ${r2(y + rr)} V ${r2(y + h)} Z`;
}

// Stacked columns, one per bucket: columns [{ key, label, values: { [seriesKey]: number } }] x series
// [{ key, label, slot | level }], stacked bottom to top in series order on one shared scale. Segments are
// separated by a surface-coloured stroke (the 2px gap), the top segment is rounded, and every column's tooltip lists
// all its series. The x axis labels only some columns; the card's table view carries every value.
export function StackedColumns({ columns, series, format = String, tickFormat = String, ariaLabel }) {
  const { wrapRef, layer, bindMark } = useChartTooltip();
  if (!columns.length || !series.length) return <p className="muted">No data</p>;

  const valueOf = (column, s) => (isNum(column.values[s.key]) && column.values[s.key] > 0 ? column.values[s.key] : 0);
  const totals = columns.map((c) => series.reduce((sum, s) => sum + valueOf(c, s), 0));
  const ticks = niceTicks(0, Math.max(MIN_TOP, ...totals));
  const baseline = TOP + PLOT;
  const height = baseline + AXIS;
  const y = linearScale([0, ticks[ticks.length - 1]], [baseline, TOP]);
  const band = bandScale(columns.map((c) => c.key), [LEFT, W - RIGHT], { padding: 0.25 });
  const width = Math.min(band.bandwidth, MAX_COLUMN);
  const every = Math.ceil(columns.length / LABELS);

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${W} ${height}`} role="group" aria-label={ariaLabel || "Stacked column chart"}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="grid-line" x1={LEFT} x2={W - RIGHT} y1={r2(y(tick))} y2={r2(y(tick))} />
              <text className="axis-text tick-text" x={LEFT - 8} y={r2(y(tick))} textAnchor="end" dominantBaseline="middle">{tickFormat(tick)}</text>
            </g>
          ))}
          <line className="axis-line" x1={LEFT} x2={W - RIGHT} y1={baseline} y2={baseline} />
          {columns.map((column, i) => {
            const slot = band.start(column.key);
            const x = slot + (band.bandwidth - width) / 2;
            const nonZero = series.filter((s) => valueOf(column, s) > 0);
            const topKey = nonZero.length ? nonZero[nonZero.length - 1].key : null;
            let cumulative = 0;
            const segments = nonZero.map((s) => {
              const value = valueOf(column, s);
              const bottom = y(cumulative);
              const h = Math.max(bottom - y(cumulative + value), MIN_SEGMENT);
              const segment = { s, y: bottom - h, h };
              cumulative += value;
              return segment;
            });
            const rows = [...series].reverse().map((s) => ({ label: s.label, value: format(valueOf(column, s)), slot: s.slot, level: s.level }));
            const summary = series.map((s) => `${s.label} ${format(valueOf(column, s))}`).join(", ");
            return (
              <g key={column.key} className="mark-group" {...bindMark({ label: `${column.label}: ${summary}`, title: column.label, rows })}>
                <rect className="hit" x={r2(slot - (band.step - band.bandwidth) / 2)} y={TOP} width={r2(band.step)} height={PLOT} />
                {segments.map(({ s, y: top, h }) => (
                  <path
                    key={s.key}
                    className={`mark segment ${toneClass(s, "fill")}`}
                    d={s.key === topKey ? roundedTop(x, top, width, h) : `M ${r2(x)} ${r2(top)} H ${r2(x + width)} V ${r2(top + h)} H ${r2(x)} Z`}
                    data-x={r2(x)} data-y={r2(top)} data-w={r2(width)} data-h={r2(h)}
                  />
                ))}
                {i % every === 0 ? (
                  <text className="axis-text x-label" x={r2(slot + band.bandwidth / 2)} y={height - 8} textAnchor="middle">{column.label}</text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      {layer}
    </div>
  );
}
