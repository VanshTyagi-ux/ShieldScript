import { segments } from "../segments.js";

// The text the detector analysed, with each rule's match wrapped in <mark>.
// React escapes every string, so the decoded input can never become markup.
export function DecodedView({ decoded, findings, hoveredRule }) {
  return (
    <pre id="decoded">
      {segments(decoded, findings).map((s, i) => (s.rules.length
        ? (
          <mark key={i} className={`hit${hoveredRule && s.rules.includes(hoveredRule) ? " on" : ""}`} data-rules={s.rules.join(" ")}>
            {s.text}
          </mark>
        )
        : s.text))}
    </pre>
  );
}
