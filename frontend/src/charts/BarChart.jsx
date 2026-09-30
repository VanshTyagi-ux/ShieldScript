import { VIEW_WIDTH as W, isNum, r2, truncate } from "./frame.js";
import { linearScale, niceTicks } from "./scale.js";
import { roundedEndBar, toneClass } from "./shapes.js";
import { useChartTooltip } from "./Tooltip.jsx";

const ROW = 32;
const THICKNESS = 24; // bars are never thicker than this
const TOP = 8;
const AXIS = 28;
const VALUE_ROOM = 64; // space right of the plot for the value label at each bar tip

// Horizontal bars, one per item: { key, label, value, slot | level }. The value is labelled at the tip;
// everything else lives in the tooltip and the card's table view.
export function BarChart({ data, format = String, tickFormat = String, domain, valueLabel = "Value", labelWidth = 220, ariaLabel }) {
  const { wrapRef, layer, bindMark } = useChartTooltip();
  if (!data.length) return <p className="muted">No data</p>;

  const values = data.map((d) => d.value).filter(isNum);
  const [d0, d1] = domain || [0, Math.max(0, ...values)];
  const ticks = niceTicks(d0, d1 > d0 ? d1 : d0 + 1);
  const plotRight = W - VALUE_ROOM;
  const x = linearScale([ticks[0], ticks[ticks.length - 1]], [labelWidth, plotRight]);
  const height = TOP + data.length * ROW + AXIS;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div className="chart-scroll">
      <svg viewBox={`0 0 ${W} ${height}`} role="group" aria-label={ariaLabel || "Bar chart"}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="grid-line" x1={r2(x(tick))} x2={r2(x(tick))} y1={TOP} y2={height - AXIS} />
            <text className="axis-text tick-text" x={r2(x(tick))} y={height - AXIS + 16} textAnchor="middle">{tickFormat(tick)}</text>
          </g>
        ))}
        <line className="axis-line" x1={labelWidth} x2={labelWidth} y1={TOP} y2={height - AXIS} />
        {data.map((item, i) => {
          const rowY = TOP + i * ROW;
          const barY = rowY + (ROW - THICKNESS) / 2;
          const hasValue = isNum(item.value);
          const barWidth = hasValue ? Math.max(0, Math.min(x(item.value), plotRight) - labelWidth) : 0;
          const shown = hasValue ? format(item.value) : "n/a";
          return (
            <g
              key={item.key}
              className="mark-group"
              {...bindMark({ label: `${item.label}: ${shown}`, title: item.label, rows: [{ label: valueLabel, value: shown, slot: item.slot, level: item.level }] })}
            >
              <rect className="hit" x="0" y={rowY} width={W} height={ROW} />
              {barWidth > 0 ? (
                <path
                  className={`mark ${toneClass(item, "fill")}`}
                  d={roundedEndBar(labelWidth, barY, barWidth, THICKNESS)}
                  data-x={r2(labelWidth)} data-y={r2(barY)} data-w={r2(barWidth)} data-h={THICKNESS}
                />
              ) : null}
              <text className="axis-text" x={labelWidth - 12} y={rowY + ROW / 2} textAnchor="end" dominantBaseline="middle">{truncate(item.label)}</text>
              <text className="value-text" x={r2(labelWidth + barWidth + 8)} y={rowY + ROW / 2} dominantBaseline="middle">{shown}</text>
            </g>
          );
        })}
      </svg>
      </div>
      {layer}
    </div>
  );
}
