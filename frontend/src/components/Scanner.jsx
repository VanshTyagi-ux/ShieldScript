import { useRef } from "react";
import { SCANNER_SAMPLES } from "../samples.js";

export function Scanner({ text, onChange }) {
  const probe = useRef(null);
  return (
    <section className="card" aria-labelledby="scanner-title">
      <h2 id="scanner-title">Live scanner</h2>
      <label htmlFor="probe">Type or paste any input</label>
      <textarea
        id="probe"
        ref={probe}
        rows={6}
        spellCheck={false}
        placeholder="e.g. <img src=x onerror=alert(1)>"
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="row">
        <button
          type="button"
          id="clear"
          className="ghost"
          onClick={() => { onChange(""); probe.current.focus(); }}
        >
          Clear
        </button>
        <span className="muted">Scanned automatically as you type.</span>
      </div>
      <div className="samples" id="samples" aria-label="Sample inputs">
        {Object.entries(SCANNER_SAMPLES).map(([group, samples]) => (
          <div className="sample-group" key={group}>
            <span className="group-label">{group}</span>
            {Object.entries(samples).map(([label, payload]) => (
              <button type="button" className="sample" key={label} onClick={() => onChange(payload)}>{label}</button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
