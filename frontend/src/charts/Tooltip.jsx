import { useCallback, useRef, useState } from "react";
import { toneClass } from "./shapes.js";

// One tooltip per chart. Attach `wrapRef` to the element that wraps the SVG (position: relative), spread
// `bindMark({ label, title, rows })` onto every mark, and render `layer` inside the wrapper.
//   label: the mark's accessible name; title: heading; rows: [{ label, value, slot | level }].
// The tooltip shows on hover AND keyboard focus, hides on leave, blur and Escape, and is never the only
// route to a value (charts also offer a table view). All text is rendered as React text.
export function useChartTooltip() {
  const wrapRef = useRef(null);
  const [tip, setTip] = useState(null);

  const show = useCallback((content, element) => {
    const wrap = wrapRef.current;
    if (!wrap || !element) return;
    const box = wrap.getBoundingClientRect();
    const mark = element.getBoundingClientRect();
    setTip({ ...content, x: mark.left - box.left + mark.width / 2, y: mark.top - box.top });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  const bindMark = useCallback((content) => ({
    tabIndex: 0,
    "aria-label": content.label,
    onPointerEnter: (event) => show(content, event.currentTarget),
    onPointerMove: (event) => show(content, event.currentTarget),
    onPointerLeave: hide,
    onFocus: (event) => show(content, event.currentTarget),
    onBlur: hide,
    onKeyDown: (event) => { if (event.key === "Escape") hide(); },
  }), [show, hide]);

  const layer = tip ? (
    <div className="chart-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
      {tip.title ? <span className="tip-title">{tip.title}</span> : null}
      {tip.rows.map((row, i) => (
        <div className="tip-row" key={i}>
          <i className={`tip-key ${toneClass(row, "bg")}`} aria-hidden="true" />
          <strong>{row.value}</strong>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  ) : null;

  return { wrapRef, layer, bindMark, show, hide }; // show/hide let a chart drive the tooltip itself (keyboard)
}
