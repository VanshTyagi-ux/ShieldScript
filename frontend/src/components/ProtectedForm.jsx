import { useRef, useState } from "react";
import { post } from "../api.js";
import { tooLarge } from "../limits.js";
import { FORM_SAMPLES } from "../samples.js";

const FIELDS = [
  { name: "name", label: "Name", id: "f-name", multiline: false },
  { name: "email", label: "Email", id: "f-email", multiline: false },
  { name: "website", label: "Website", id: "f-website", multiline: false, placeholder: "https://" },
  { name: "comment", label: "Comment", id: "f-comment", multiline: true },
];
const EMPTY = { name: "", email: "", website: "", comment: "" };

function statusText(outcome) {
  if (outcome.kind === "failed") return "Could not submit";
  return `${outcome.kind === "accepted" ? "Accepted" : "Rejected"} (HTTP ${outcome.status})`;
}

function OutcomeBody({ outcome }) {
  if (outcome.kind === "failed") return <p>{`Server unreachable: ${outcome.message}`}</p>;
  const { data, fields } = outcome;
  if (outcome.kind === "accepted") {
    return (
      <div className="table-wrap">
        <table>
          <tbody>
            <tr><th>Field</th><th>You typed</th><th>Stored (HTML-escaped)</th></tr>
            {FIELDS.filter((f) => f.name in data.sanitized).map((f) => (
              <tr key={f.name}><td>{f.name}</td><td>{fields[f.name]}</td><td>{data.sanitized[f.name]}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const errors = (data && data.errors) || {};
  if (!Object.keys(errors).length) return <p>{(data && data.error) || "The server rejected the request."}</p>;
  return (
    <ul className="errors">
      {Object.entries(errors).map(([name, message]) => (
        <li key={name}><strong>{`${name}: `}</strong>{message}</li>
      ))}
    </ul>
  );
}

export function ProtectedForm({ onAnnounce }) {
  const [values, setValues] = useState(EMPTY);
  const [outcome, setOutcome] = useState(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false); // set synchronously so a second submit in the same tick is ignored

  async function submit(event) {
    event.preventDefault();
    if (busy.current) return;
    const fields = { ...values };
    if (tooLarge({ fields })) { // same wording and status the server would give, without uploading it
      const rejected = { kind: "rejected", status: 413, data: { error: "Input is too large to submit (limit 256 KiB)" }, fields };
      setOutcome(rejected);
      onAnnounce(statusText(rejected));
      return;
    }
    busy.current = true;
    setPending(true);
    let next;
    try {
      const { status, data } = await post("/submit", { fields });
      next = { kind: data && data.accepted ? "accepted" : "rejected", status, data, fields };
    } catch (err) {
      next = { kind: "failed", message: err.message || String(err) };
    } finally {
      busy.current = false;
      setPending(false);
    }
    setOutcome(next);
    onAnnounce(statusText(next));
  }

  const errors = (outcome && outcome.data && outcome.data.errors) || {};
  const results = (outcome && outcome.data && outcome.data.results) || {};

  return (
    <section className="card wide" aria-labelledby="form-title">
      <h2 id="form-title">Protected form</h2>
      <p className="hint">Every field is scanned server-side on submit. Risky input is rejected; clean input is returned HTML-escaped.</p>
      <div className="form-grid">
        <div>
          <form id="demo-form" noValidate onSubmit={submit}>
            {FIELDS.map((f) => {
              const Input = f.multiline ? "textarea" : "input";
              const r = results[f.name];
              return (
                <div key={f.name}>
                  <label htmlFor={f.id}>
                    {f.label}
                    {r ? <span className={`chip level-${r.level}`} data-chip={f.name}>{`${r.level} ${r.score}`}</span> : null}
                  </label>
                  <Input
                    id={f.id}
                    name={f.name}
                    autoComplete="off"
                    placeholder={f.placeholder}
                    aria-invalid={errors[f.name] ? "true" : undefined}
                    rows={f.multiline ? 3 : undefined}
                    value={values[f.name]}
                    onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                  />
                  <div className="err" data-for={f.name}>{errors[f.name] || ""}</div>
                </div>
              );
            })}
            <div className="row">
              <button type="submit" id="submit-btn" disabled={pending}>{pending ? "Submitting..." : "Submit"}</button>
              <span className="muted">Try:</span>
              <span className="samples" id="form-samples">
                {Object.entries(FORM_SAMPLES).map(([label, sample]) => (
                  <button type="button" className="sample" key={label} onClick={() => setValues({ ...sample })}>{label}</button>
                ))}
              </span>
            </div>
          </form>
        </div>
        {outcome ? (
          <div className="outcome" id="submit-result">
            <strong id="submit-status" role="status" className={outcome.kind === "accepted" ? "ok" : "bad"}>{statusText(outcome)}</strong>
            <div id="submit-body"><OutcomeBody outcome={outcome} /></div>
          </div>
        ) : (
          <p className="empty" id="submit-empty">Submit the form to see what the server accepts and how it escapes each field.</p>
        )}
      </div>
    </section>
  );
}
