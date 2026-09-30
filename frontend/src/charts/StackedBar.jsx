import { VIEW_WIDTH as W, isNum, r2 } from "./frame.js";
import { formatPercent } from "./scale.js";
import { roundedEndBar, toneClass } from "./shapes.js";
import { useChartTooltip } from "./Tooltip.jsx";

const BAR = 24;
const GAP = 2; // surface-coloured gap between touching segments
const LABEL_CHAR = 6.5; // rough width of one label character at 12px
const LABEL_PAD = 16;

// One horizontal stacked bar for part-to-whole data: segments [{ key, label, value, slot | level }].
// `total` widens the track past the sum (unfilled space); a sum above `total` widens the domain instead.
// `markers` [{ value, label }] draw hairline reference ticks. Segment labels sit under the bar in muted text
// and only when they fit; the legend, tooltip and table view carry the rest.
export function StackedBar({ segments, format = String, total, markers = [], ariaLabel }) {
  const { wrapRef, layer, bindMark } = useChartTooltip();
  const drawn = segments.filter((s) => isNum(s.value) && s.value > 0);
  const sum = drawn.reduce((acc, s) => acc + s.value, 0);
  if (!sum) return <p className="muted">No data</p>;

  const domain = Math.max(total ?? sum, sum);
  const px = (value) => (value / domain) * W;
  const barY = markers.length ? 28 : 8;
  const labelY = barY + BAR + 16;
  const height = labelY + 8;

  let cursor = 0;
  const cells = drawn.map((segment, i) => {
    const width = px(segment.value);
    const cell = { segment, x: cursor, width, last: i === drawn.length - 1 };
    cursor += width;
    return cell;
  });

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div className="chart-scroll">
      <svg viewBox={`0 0 ${W} ${height}`} role="group" aria-label={ariaLabel || "Stacked bar"}>
        {cells.map(({ segment, x, width, last }) => {
          const drawWidth = last ? width : Math.max(0, width - GAP);
          const share = formatPercent(segment.value / sum, 0);
          const shown = format(segment.value);
          const fits = segment.label.length * LABEL_CHAR + LABEL_PAD < width;
          return (
            <g
              key={segment.key}
              className="mark-group"
              {...bindMark({
                label: `${segment.label}: ${shown} (${share})`,
                title: segment.label,
                rows: [{ label: "Value", value: shown, slot: segment.slot, level: segment.level }, { label: "Share", value: share }],
              })}
            >
              <rect className="hit" x={r2(x)} y="0" width={r2(width)} height={height} />
              <path
                className={`mark ${toneClass(segment, "fill")}`}
                d={roundedEndBar(x, barY, drawWidth, BAR, last ? 4 : 0)}
                data-x={r2(x)} data-y={r2(barY)} data-w={r2(drawWidth)} data-h={BAR}
              />
              {fits ? (
                <text className="axis-text seg-label" x={r2(x + width / 2)} y={labelY} textAnchor="middle">{segment.label}</text>
              ) : null}
            </g>
          );
        })}
        {markers.filter((m) => isNum(m.value) && m.value >= 0 && m.value <= domain).map((marker) => {
          const mx = px(marker.value);
          const anchor = mx < 80 ? "start" : mx > W - 80 ? "end" : "middle";
          return (
            <g key={`${marker.value}-${marker.label}`}>
              <line className="marker axis-line" x1={r2(mx)} x2={r2(mx)} y1={barY - 8} y2={barY + BAR + 4} data-x={r2(mx)} />
              <text className="axis-text" x={r2(mx)} y={barY - 14} textAnchor={anchor}>{marker.label}</text>
            </g>
          );
        })}
      </svg>
      </div>
      {layer}
    </div>
  );
}
