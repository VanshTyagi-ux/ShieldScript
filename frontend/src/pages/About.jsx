import { PageHeading } from "../layout/PageHeading.jsx";
import { Link } from "../lib/router.jsx";

export function AboutPage() {
  return (
    <div className="page">
      <PageHeading description="What this tool does, where it stops, and what comes next.">About</PageHeading>
      <div className="stack prose">
        <section className="card">
          <h2>What it is</h2>
          <p>
            XSS Detector flags likely cross-site scripting payloads in user input. It decodes the input the way a browser
            might, runs weighted rules over the result, and lets an ML model escalate cases the rules only half-recognise.
            Every finding says which rule fired and why.
          </p>
          <p>
            <Link to="/scanner">Try the scanner</Link> or <Link to="/benchmarks">See the benchmarks</Link>.
          </p>
        </section>

        <section className="card">
          <h2>Limitations</h2>
          <ul>
            <li>Detection is heuristic. Always HTML-encode output and use a Content Security Policy; treat this as an extra layer.</li>
            <li>Text that merely discusses XSS, such as a security blog comment, will be flagged.</li>
            <li>Rare prose like <code>onset = 3</code> can score medium through the generic event-handler rule.</li>
            <li>It only sees what is sent to it, so DOM-based XSS that never reaches the server is out of reach.</li>
          </ul>
          <aside className="callout">
            <strong>Not a substitute for encoding.</strong> A detector decides whether to block or alert. Output encoding and a
            CSP are what actually stop a payload from running.
          </aside>
        </section>

        <section className="card">
          <h2>How it is built</h2>
          <ul>
            <li>The detector, ML model and server use only the Python standard library.</li>
            <li>The site is a React app served by that same server, with hand-drawn SVG charts and no charting library.</li>
            <li>Benchmarks use public payload lists (SecLists, MIT licence) plus benign text and hand-written hard negatives.</li>
            <li>The built-in server is not production-grade; put it behind a reverse proxy for anything public.</li>
          </ul>
        </section>

        <section className="card">
          <h2>Roadmap</h2>
          <ul>
            <li><strong>Rich-text sanitizer</strong> - planned: an allow-list sanitizer for HTML fields, with the detector as an alert-only signal.</li>
            <li><strong>Fewer prose false positives</strong> - planned: tune the generic rules against realistic text.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
