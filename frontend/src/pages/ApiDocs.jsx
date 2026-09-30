import { absoluteApiBase } from "../api.js";
import { CodeBlock } from "../components/CodeBlock.jsx";
import { TryIt } from "../components/TryIt.jsx";
import { curlFor, endpointsFor } from "../data/apiDocs.js";
import { PageHeading } from "../layout/PageHeading.jsx";

const ERRORS = [
  ["400", "The body is not valid JSON, a field has the wrong type, or a query parameter is out of range."],
  ["404", "Unknown endpoint, no payload with that id, or the benchmark has not been generated yet."],
  ["411", "The Content-Length header is missing."],
  ["413", "The request body is larger than 256 KiB, or the HTML given to /sanitize is longer than 64,000 characters."],
  ["422", "POST /submit rejected one or more fields; the response lists the errors."],
  ["503", "POST /sanitize: the sanitizer library is not installed on the server, so nothing is returned rather than unsanitized input."],
];

export function ApiDocsPage() {
  const origin = window.location.origin;
  const base = absoluteApiBase({ origin });
  return (
    <div className="page">
      <PageHeading description="A small JSON API. Every endpoint below can be tried in place; paths are relative to the base URL.">
        API reference
      </PageHeading>
      <p className="api-base">Base URL <code>{base}</code></p>
      <div className="stack">
        {endpointsFor().map((endpoint) => (
          <section className="card endpoint" id={endpoint.id} key={endpoint.id}>
            <h2 className="endpoint-head">
              <span className={`method method-${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>{" "}
              <code>{endpoint.path}</code>
            </h2>
            <p className="muted">{endpoint.summary}</p>
            {endpoint.requestExample ? <CodeBlock label="Request body (JSON)" code={JSON.stringify(endpoint.requestExample, null, 2)} /> : null}
            <CodeBlock label="Example response" code={JSON.stringify(endpoint.responseExample, null, 2)} />
            <CodeBlock label="curl" code={curlFor(endpoint, origin)} />
            <h3>Try it</h3>
            <TryIt endpoint={endpoint} />
          </section>
        ))}
        <section className="card">
          <h2>Errors</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr><th>Status</th><th>Meaning</th></tr>
                {ERRORS.map(([status, meaning]) => <tr key={status}><td>{status}</td><td>{meaning}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
