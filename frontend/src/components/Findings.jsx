// Findings grouped by category (in order of first, highest-weight appearance).
// onHover(ruleId | null) reports which finding is hovered or focused.
export function Findings({ findings, onHover }) {
  if (!findings.length) {
    return <div id="findings" className="findings"><p className="muted">No indicators found.</p></div>;
  }
  const groups = new Map();
  for (const f of findings) {
    if (!groups.has(f.category)) groups.set(f.category, []);
    groups.get(f.category).push(f);
  }
  return (
    <div id="findings" className="findings">
      {[...groups].map(([category, items]) => (
        <section className="group" key={category}>
          <h4>{category}</h4>
          <ul>
            {items.map((f) => (
              <li
                className="finding"
                key={f.rule_id}
                tabIndex={0}
                onMouseEnter={() => onHover(f.rule_id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(f.rule_id)}
                onBlur={() => onHover(null)}
              >
                <div className="finding-head">
                  <span className="rule">{f.rule_id}</span>
                  <strong>{f.name}</strong>
                  {f.count > 1 ? <span className="muted">{`×${f.count}`}</span> : null}
                  <span className="w">{`+${f.weight}`}</span>
                </div>
                <div className="wbar"><div style={{ width: `${Math.min(100, f.weight)}%` }} /></div>
                <div className="muted">{f.description}</div>
                <code>{f.match}</code>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
