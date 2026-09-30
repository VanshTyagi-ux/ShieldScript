import { VIEW_WIDTH as W, isNum, r2, truncate } from "./frame.js";
import { linearScale, niceTicks } from "./scale.js";
import { roundedEndBar, toneClass } from "./shapes.js";
import { useChartTooltip } from "./Tooltip.jsx";

const BAR = 16;
const GAP = 2; // between bars of one group
const GROUP_GAP = 16;
const TOP = 8;
const AXIS = 28;
const VALUE_ROOM = 64;

// Grouped horizontal bars: groups [{ key, label, values: { [seriesKey]: number } }] x series
// [{ key, label, slot | level }]. Every bar's tooltip lists the whole group.
export function GroupedBars({ groups, series, format = String, tickFormat = String, domain, labelWidth = 220, ariaLabel }) {
  const { wrapRef, layer, bindMark } = useChartTooltip();
  if (!groups.length || !series.length) return <p className="muted">No data</p>;

  const all = groups.flatMap((g) => series.map((s) => g.values[s.key])).filter(isNum);
  const [d0, d1] = domain || [0, Math.max(0, ...all)];
  const ticks = niceTicks(d0, d1 > d0 ? d1 : d0 + 1);
  const plotRight = W - VALUE_ROOM;
  const x = linearScale([ticks[0], ticks[ticks.length - 1]], [labelWidth, plotRight]);
  const groupHeight = series.length * BAR + (series.length - 1) * GAP;
  const step = groupHeight + GROUP_GAP;
  const height = TOP + groups.length * step + AXIS - GROUP_GAP / 2;
  const gridBottom = height - AXIS;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div className="chart-scroll">
      <svg viewBox={`0 0 ${W} ${height}`} role="group" aria-label={ariaLabel || "Grouped bar chart"}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="grid-line" x1={r2(x(tick))} x2={r2(x(tick))} y1={TOP} y2={gridBottom} />
            <text className="axis-text tick-text" x={r2(x(tick))} y={gridBottom + 16} textAnchor="middle">{tickFormat(tick)}</text>
          </g>
        ))}
        <line className="axis-line" x1={labelWidth} x2={labelWidth} y1={TOP} y2={gridBottom} />
        {groups.map((group, gi) => {
          const groupY = TOP + gi * step;
          const rows = series.map((s) => ({
            label: s.label,
            value: isNum(group.values[s.key]) ? format(group.values[s.key]) : "n/a",
            slot: s.slot,
            level: s.level,
          }));
          return (
            <g key={group.key}>
              <text className="axis-text" x={labelWidth - 12} y={groupY + groupHeight / 2} textAnchor="end" dominantBaseline="middle">{truncate(group.label)}</text>
              {series.map((s, si) => {
                const value = group.values[s.key];
                const hasValue = isNum(value);
                const y = groupY + si * (BAR + GAP);
                const barWidth = hasValue ? Math.max(0, Math.min(x(value), plotRight) - labelWidth) : 0;
                const shown = rows[si].value;
                return (
                  <g
                    key={s.key}
                    className="mark-group"
                    {...bindMark({ label: `${group.label}, ${s.label}: ${shown}`, title: group.label, rows })}
                  >
                    <rect className="hit" x="0" y={y} width={W} height={BAR + GAP} />
                    {barWidth > 0 ? (
                      <path
                        className={`mark ${toneClass(s, "fill")}`}
                        d={roundedEndBar(labelWidth, y, barWidth, BAR)}
                        data-x={r2(labelWidth)} data-y={r2(y)} data-w={r2(barWidth)} data-h={BAR}
                      />
                    ) : null}
                    <text className="value-text" x={r2(labelWidth + barWidth + 8)} y={y + BAR / 2} dominantBaseline="middle">{shown}</text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      </div>
      {layer}
    </div>
  );
}
