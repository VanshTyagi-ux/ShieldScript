import { Fragment, useRef, useState } from "react";
import { formatCount } from "../charts/scale.js";
import { ApiHint } from "../components/ApiHint.jsx";
import { PageHeading } from "../layout/PageHeading.jsx";
import { copyText } from "../lib/clipboard.js";
import { PAGE_SIZES, buildSearch, categorySlot, formatCreated, listPath, pageWindow, readQuery, truncate } from "../lib/payloads.js";
import { Link, useRoute } from "../lib/router.jsx";
import { encodeShare } from "../lib/share.js";
import { useToast } from "../lib/toast.jsx";
import { useApi } from "../lib/useApi.js";

const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function Category({ name }) {
  return <span className="cat"><i className={`cat-dot bg-s${categorySlot(name)}`} aria-hidden="true" />{cap(name)}</span>;
}

function Filters({ query, facets, go }) {
  const active = query.category || query.sourceFile;
  return (
    <div className="controls payload-filters">
      <div className="chip-row" role="group" aria-label="Category">
        <button type="button" className="chip-button" aria-pressed={!query.category} onClick={() => go({ category: "", page: 1 })}>All</button>
        {(facets?.categories ?? []).map((c) => (
          <button key={c.name} type="button" className="chip-button" aria-pressed={query.category === c.name}
            onClick={() => go({ category: c.name, page: 1 })}>{`${cap(c.name)} (${formatCount(c.count)})`}</button>
        ))}
      </div>
      <label htmlFor="payload-source" className="filter-label">Source file</label>
      <select id="payload-source" value={query.sourceFile} onChange={(e) => go({ sourceFile: e.target.value, page: 1 })}>
        <option value="">All files</option>
        {(facets?.sources ?? []).map((s) => <option key={s.name} value={s.name}>{`${s.name} (${formatCount(s.count)})`}</option>)}
        {/* A file in the URL that the facets do not list still needs an option, or the select would misreport it. */}
        {query.sourceFile && !(facets?.sources ?? []).some((s) => s.name === query.sourceFile)
          ? <option value={query.sourceFile}>{query.sourceFile}</option> : null}
      </select>
      <label htmlFor="payload-size" className="filter-label">Per page</label>
      <select id="payload-size" value={query.size} onChange={(e) => go({ size: Number(e.target.value), page: 1 })}>
        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      {active ? <button type="button" className="ghost" onClick={() => go({ category: "", sourceFile: "", page: 1 })}>Clear filters</button> : null}
    </div>
  );
}

function Details({ payload }) {
  const { toast } = useToast();
  const encoded = encodeShare(payload.content); // null when the payload is too long for a link
  async function copy() {
    const copied = await copyText(payload.content);
    toast(copied ? "Copied the payload" : "Could not copy", { kind: copied ? "info" : "error" });
  }
  return (
    <div className="payload-details">
      <pre className="payload-full"><code>{payload.content}</code></pre>
      <p className="muted">{`Stored ${formatCreated(payload.created_at)}`}</p>
      <div className="row">
        <button type="button" className="ghost" onClick={copy}>Copy</button>
        {encoded ? (
          <>
            <Link to={`/scanner?t=${encoded}`}>Scan it</Link>
            <Link to={`/playground?t=${encoded}`}>Sanitize it</Link>
          </>
        ) : <span className="muted">Too long to open in the scanner or playground.</span>}
      </div>
    </div>
  );
}

function Table({ items }) {
  const [openId, setOpenId] = useState(null);
  return (
    <div className="table-wrap">
      <table className="payload-table">
        <caption className="sr-only">Stored test payloads</caption>
        <thead>
          <tr>
            <th scope="col">ID</th><th scope="col">Category</th><th scope="col">Source file</th>
            <th scope="col">Payload</th><th scope="col"><span className="sr-only">Details</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => {
            const open = openId === p.id;
            return (
              <Fragment key={p.id}>
                <tr className={open ? "open" : undefined}>
                  <td><code>{p.id}</code></td>
                  <td><Category name={p.category} /></td>
                  <td className="muted source-cell">{p.source_file}</td>
                  <td><code className="payload-code">{truncate(p.content)}</code></td>
                  <td>
                    <button type="button" className="ghost" aria-expanded={open} aria-controls={`payload-${p.id}`}
                      onClick={() => setOpenId(open ? null : p.id)}>{open ? "Hide" : "Details"}</button>
                  </td>
                </tr>
                {open ? <tr className="payload-detail" id={`payload-${p.id}`}><td colSpan={5}><Details payload={p} /></td></tr> : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Pager({ query, window: win, go }) {
  return (
    <nav className="pager" aria-label="Pagination">
      <button type="button" className="ghost" disabled={query.page <= 1} onClick={() => go({ page: 1 })}>First</button>
      <button type="button" className="ghost" disabled={query.page <= 1} onClick={() => go({ page: query.page - 1 })}>Previous</button>
      <span className="muted">{`Page ${formatCount(query.page)} of ${formatCount(win.pages)}`}</span>
      <button type="button" className="ghost" disabled={query.page >= win.pages} onClick={() => go({ page: query.page + 1 })}>Next</button>
      <button type="button" className="ghost" disabled={query.page >= win.pages} onClick={() => go({ page: win.pages })}>Last</button>
    </nav>
  );
}

function Loading() {
  return (
    <div className="skeleton-block" role="status" aria-label="Loading payloads" aria-busy="true">
      <span className="skeleton tall" /><span className="skeleton" /><span className="skeleton mid" /><span className="skeleton short" />
    </div>
  );
}

export function PayloadsPage() {
  const { search, path, navigate } = useRoute();
  const query = readQuery(search);
  const list = useApi(listPath(query));
  const facets = useApi("/payloads/facets");

  // Keep the last page on screen (dimmed) while the next one loads, instead of flashing a skeleton.
  const previous = useRef(null);
  if (list.data) previous.current = list.data;
  const data = list.data ?? previous.current;
  const loading = list.status === "loading";

  const go = (patch) => navigate(`${path}${buildSearch({ ...query, ...patch })}`);

  let body;
  if (!data) {
    body = list.status === "error" ? (
      <>
        <div className="error-box" role="alert">
          {`Could not load the payloads: ${list.error}`}{" "}
          <button type="button" className="ghost" onClick={list.reload}>Retry</button>
        </div>
        {list.error === "Not found" ? <ApiHint what="/payloads" /> : null}
      </>
    ) : <Loading />;
  } else {
    const win = pageWindow(query, data.total, data.items.length);
    const filtered = query.category || query.sourceFile;
    body = (
      <div className="stack" aria-busy={loading}>
        <p className="muted" aria-live="polite">
          {data.total === 0 ? "No payloads" : `Showing ${formatCount(win.from)}-${formatCount(win.to)} of ${formatCount(data.total)} payloads`}
        </p>
        {data.items.length === 0 ? (
          <div className="empty">
            {data.total > 0 ? (
              <>
                <p>{`There are no payloads on page ${formatCount(query.page)}.`}</p>
                <button type="button" onClick={() => go({ page: 1 })}>Go to the first page</button>
              </>
            ) : filtered ? (
              <>
                <p>No payloads match these filters.</p>
                <button type="button" onClick={() => go({ category: "", sourceFile: "", page: 1 })}>Clear filters</button>
              </>
            ) : (
              <p>No payloads are stored yet. Load them with <code>python -m scripts.seed_payloads</code> in <code>backend/</code>.</p>
            )}
          </div>
        ) : (
          <div className={loading ? "dimmed" : undefined}><Table items={data.items} /></div>
        )}
        {win.pages > 1 ? <Pager query={query} window={win} go={go} /> : null}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeading description="The XSS test payloads stored in the database. Filter by category or source file, open one to copy it or try it in the scanner or the sanitizer.">
        Payloads
      </PageHeading>
      <section className="card" aria-labelledby="payload-list-title">
        <h2 id="payload-list-title" className="sr-only">Payload list</h2>
        <Filters query={query} facets={facets.data} go={go} />
        {body}
      </section>
    </div>
  );
}
