import { useState } from "react";
import { get, post } from "../api.js";
import { tooLarge } from "../limits.js";

// Sends a real request to an endpoint and shows the status and the JSON that came back.
export function TryIt({ endpoint }) {
  const isPost = endpoint.method === "POST";
  const [text, setText] = useState(isPost ? JSON.stringify(endpoint.requestExample, null, 2) : "");
  const [result, setResult] = useState(null);
  const [problem, setProblem] = useState(null);
  const [pending, setPending] = useState(false);

  async function send() {
    setProblem(null);
    let payload;
    if (isPost) {
      try {
        payload = JSON.parse(text);
      } catch (_) {
        setProblem("The body must be valid JSON.");
        return;
      }
      if (tooLarge(payload)) {
        setProblem("Input is too large to send (limit 256 KiB).");
        return;
      }
    }
    setPending(true);
    try {
      setResult(isPost ? await post(endpoint.path, payload) : await get(endpoint.path));
    } catch (err) {
      setResult(null);
      setProblem(`Request failed: ${err.message || err}`);
    } finally {
      setPending(false);
    }
  }

  const id = `tryit-${endpoint.id}`;
  return (
    <div className="tryit">
      {isPost ? (
        <>
          <label htmlFor={id}>Request body</label>
          <textarea id={id} rows={6} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        </>
      ) : null}
      <div className="row">
        <button type="button" onClick={send} disabled={pending}>{pending ? "Sending…" : "Send request"}</button>
      </div>
      {problem ? <div className="error-box" role="alert">{problem}</div> : null}
      {result ? (
        <div className="tryit-result">
          <span className={`chip ${result.ok ? "ok" : "bad"}`}>{`HTTP ${result.status}`}</span>
          <pre><code>{result.data === null ? "(no JSON body)" : JSON.stringify(result.data, null, 2)}</code></pre>
        </div>
      ) : null}
    </div>
  );
}
