import { useId, useState } from "react";
import { DataTable } from "./DataTable.jsx";
import { Legend } from "./Legend.jsx";

// The frame every chart lives in: title, description, legend (2+ series), a "View as table" toggle
// (when `table` = { columns, rows } is given) and an optional footnote.
export function ChartCard({ title, description, legend = [], table, footnote, children }) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  const showTable = asTable && table;
  return (
    <figure className="card chart-card" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-desc` : undefined}>
      <div className="chart-head">
        <div>
          <h3 id={`${id}-title`}>{title}</h3>
          {description ? <p id={`${id}-desc`} className="muted">{description}</p> : null}
        </div>
        {table ? (
          <button type="button" className="ghost" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>View as table</button>
        ) : null}
      </div>
      {legend.length >= 2 && !showTable ? <Legend items={legend} /> : null}
      <div className="chart-body">{showTable ? <DataTable {...table} caption={title} /> : children}</div>
      {footnote ? <figcaption className="muted chart-foot">{footnote}</figcaption> : null}
    </figure>
  );
}
