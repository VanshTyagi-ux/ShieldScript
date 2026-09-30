import { useRef, useState } from "react";
import { Gauge } from "../charts/Gauge.jsx";
import { DecodedView } from "../components/DecodedView.jsx";
import { Findings } from "../components/Findings.jsx";
import { ScoreBreakdown } from "../components/ScoreBreakdown.jsx";
import { EXAMPLES, STEPS } from "../data/walkthrough.js";
import { verdictText } from "../format.js";
import { useScan } from "../hooks/useScan.js";
import { PageHeading } from "../layout/PageHeading.jsx";
import { Link } from "../lib/router.jsx";

function NormalizePanel({ text, result }) {
  const layers = result.decode_layers;
  return (
    <>
      <p>
        Browsers decode URL escapes, HTML entities and unicode escapes before they run anything, so an attacker can hide a
        payload behind them. The detector decodes the input repeatedly (up to five passes) before it looks at it.
      </p>
      <div className="compare">
        <div>
          <h4>You typed</h4>
          <pre><code>{text}</code></pre>
        </div>
        <div>
          <h4>What the detector analysed</h4>
          <pre><code>{result.decoded}</code></pre>
        </div>
      </div>
      {layers
        ? <p><span className="chip">{`encoded: ${layers} decoding layer${layers > 1 ? "s" : ""}`}</span> Payloads that only turn dangerous after decoding get an extra finding.</p>
        : <p className="muted">No decoding was needed - the text is analysed exactly as typed.</p>}
    </>
  );
}

function MatchPanel({ result }) {
  const [hovered, setHovered] = useState(null);
  return (
    <>
      <p>
        Weighted rules look for script and markup injection, dangerous URLs, JavaScript sinks, CSS tricks and template
        injection. Every match is a finding with its own rule id and weight. Hover one to see where it matched.
      </p>
      {result.findings.length === 0 ? <p className="muted">No rules matched.</p> : null}
      <DecodedView decoded={result.decoded} findings={result.findings} hoveredRule={hovered} />
      {result.findings.length ? <Findings findings={result.findings} onHover={setHovered} /> : null}
    </>
  );
}

function ScorePanel({ result }) {
  return (
    <>
      <p>
        The weights of the distinct rules that fired are added up and capped at 100. A score of 25 or more is blocked by
        default; the ML model can escalate input the rules only half-recognise.
      </p>
      <Gauge score={result.score} level={result.level} />
      <p className="verdict-line"><strong>{verdictText(result)}</strong></p>
      <ScoreBreakdown findings={result.findings} />
    </>
  );
}

export function HowItWorksPage() {
  const [text, setText] = useState(EXAMPLES[0].text);
  const [active, setActive] = useState(STEPS[0].id);
  const tabRefs = useRef([]);
  const { status, result, error } = useScan(text);

  function onKeyDown(event) {
    const index = STEPS.findIndex((s) => s.id === active);
    const last = STEPS.length - 1;
    let next;
    if (event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    setActive(STEPS[next].id);
    tabRefs.current[next].focus();
  }

  let body;
  if (status === "error") {
    body = <div className="error-box" role="alert">{`Could not analyse: ${error}`}</div>;
  } else if (result) {
    body = (
      <div aria-busy={status === "loading"}>
        {active === "normalize" ? <NormalizePanel text={text} result={result} /> : null}
        {active === "match" ? <MatchPanel result={result} /> : null}
        {active === "score" ? <ScorePanel result={result} /> : null}
      </div>
    );
  } else if (status === "loading") {
    body = (
      <div className="skeleton-block" role="status" aria-label="Analysing" aria-busy="true">
        <span className="skeleton tall" />
        <span className="skeleton" />
        <span className="skeleton mid" />
      </div>
    );
  } else {
    body = <p className="empty">Choose an example or type your own input to watch it move through the three steps.</p>;
  }

  return (
    <div className="page">
      <PageHeading description="Every scan is three steps. Pick an input and watch what each step does to it - this runs on the live detector.">
        How it works
      </PageHeading>
      <div className="stack">
        <section className="card" aria-labelledby="input-title">
          <h2 id="input-title">Choose an input</h2>
          <div className="example-picker chip-row">
            {EXAMPLES.map((example) => (
              <button key={example.id} type="button" className="chip-button" aria-pressed={text === example.text} onClick={() => setText(example.text)}>
                {example.label}
              </button>
            ))}
          </div>
          <label htmlFor="walk-input">Or try your own input</label>
          <textarea id="walk-input" rows={3} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        </section>

        <section aria-labelledby="steps-title">
          <h2 id="steps-title" className="sr-only">The three steps</h2>
          <div className="steps" role="tablist" aria-label="Detection steps" onKeyDown={onKeyDown}>
            {STEPS.map((step, i) => (
              <button
                key={step.id}
                ref={(el) => { tabRefs.current[i] = el; }}
                type="button"
                role="tab"
                id={`tab-${step.id}`}
                className="step"
                aria-selected={active === step.id}
                aria-controls={`panel-${step.id}`}
                tabIndex={active === step.id ? 0 : -1}
                onClick={() => setActive(step.id)}
              >
                <span className="step-num" aria-hidden="true">{i + 1}</span>
                <span className="step-text"><strong>{step.title}</strong><span>{step.blurb}</span></span>
              </button>
            ))}
          </div>
          <div className="card step-panel" role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`}>
            {body}
          </div>
        </section>

        <p className="muted">
          Want the details? <Link to="/rules">See every rule</Link> or <Link to="/benchmarks">See how accurate it is</Link>.
        </p>
      </div>
    </div>
  );
}
