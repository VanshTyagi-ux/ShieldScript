import { LEVEL_LABEL, verdictText } from "../format.js";

export function Verdict({ result }) {
  return (
    <div id="verdict-box" className={`verdict border-${result.level}`}>
      <span id="level" className={`badge level-${result.level}`}>{LEVEL_LABEL[result.level] || result.level}</span>
      <strong id="verdict">{verdictText(result)}</strong>
      <span id="score" className="score">{`risk score ${result.score}/100`}</span>
    </div>
  );
}
