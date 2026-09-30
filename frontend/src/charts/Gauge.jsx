import { arcPath, gaugeAngle, polar } from "./arc.js";
import { isNum } from "./frame.js";

const CX = 120;
const CY = 120;
const R = 90;
// Level bands on the 0..100 scale (the site's blocking threshold is the start of "medium").
const BANDS = [
  { from: 0, to: 25, level: "low" },
  { from: 25, to: 50, level: "medium" },
  { from: 50, to: 75, level: "high" },
  { from: 75, to: 100, level: "critical" },
];

// A semicircular meter: one hero number, a neutral banded track, and a fill in the level colour.
export function Gauge({ score, level }) {
  const valid = isNum(score);
  const clamped = valid ? Math.min(100, Math.max(0, score)) : 0;
  const end = gaugeAngle(clamped);
  const dot = polar(CX, CY, R, end);
  return (
    <svg className="gauge" viewBox="0 0 240 150" role="group" aria-label={`Risk score ${valid ? Math.round(clamped) : "unknown"} of 100, ${level}`}>
      {BANDS.map((band) => (
        <path key={band.level} className="gauge-band" d={arcPath(CX, CY, R, gaugeAngle(band.from), gaugeAngle(band.to))} />
      ))}
      {clamped > 0 ? <path className={`gauge-fill stroke-t-${level}`} d={arcPath(CX, CY, R, 180, end)} /> : null}
      {[25, 50, 75].map((tick) => {
        const p = polar(CX, CY, R + 20, gaugeAngle(tick));
        return <text key={tick} className="axis-text gauge-tick" x={Math.round(p.x)} y={Math.round(p.y)} textAnchor="middle" dominantBaseline="middle">{tick}</text>;
      })}
      {valid ? <circle className={`gauge-dot ring fill-t-${level}`} cx={Math.round(dot.x * 100) / 100} cy={Math.round(dot.y * 100) / 100} r="7" /> : null}
      <text className="gauge-score" x={CX} y="112" textAnchor="middle">{valid ? Math.round(clamped) : "n/a"}</text>
      <text className="axis-text" x={CX} y="136" textAnchor="middle">of 100</text>
    </svg>
  );
}
