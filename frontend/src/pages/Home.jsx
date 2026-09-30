import { formatCount, formatPercent } from "../charts/scale.js";
import { StatTile } from "../charts/StatTile.jsx";
import { CodeBlock } from "../components/CodeBlock.jsx";
import { FeatureGrid } from "../components/FeatureGrid.jsx";
import { HeroDemo } from "../components/HeroDemo.jsx";
import { Reveal } from "../components/Reveal.jsx";
import { ENDPOINTS, curlFor } from "../data/apiDocs.js";
import { Link } from "../lib/router.jsx";
import { useApi } from "../lib/useApi.js";

const PYTHON_SAMPLE = `from xss_detector import scan

result = scan(user_input)
if result.is_malicious:
    reject(result.level, [f.rule_id for f in result.findings])`;

const isCount = (n) => Number.isFinite(n);

// Headline numbers: the shipped detector's benchmark, the rule count, and how much was tested.
function Stats({ benchmark, health }) {
  const data = benchmark.data;
  const usable = data && Array.isArray(data.detectors) && data.detectors.length && data.dataset;
  if (!usable) {
    if (benchmark.status === "loading" && !data) {
      return (
        <div className="stat-grid" role="status" aria-label="Loading statistics" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => <div className="card stat-skeleton" key={i}><span className="skeleton short" /><span className="skeleton" /></div>)}
        </div>
      );
    }
    return <p className="muted">Benchmark numbers are not available yet.</p>;
  }
  const headline = data.detectors.find((d) => d.shipped) || data.detectors[0];
  const tested = data.dataset.malicious_test + data.dataset.benign_test + data.dataset.hard_negatives;
  const rules = health.data && health.data.rules;
  return (
    <div className="stat-grid">
      {isCount(headline.recall) ? <StatTile label="Recall" countUp={headline.recall} format={(v) => formatPercent(v, 1)} note="held-out attacks caught" tone={{ slot: 1 }} /> : null}
      {isCount(headline.precision) ? <StatTile label="Precision" countUp={headline.precision} format={(v) => formatPercent(v, 1)} note="flags that were attacks" tone={{ slot: 2 }} /> : null}
      {isCount(headline.fpr) ? <StatTile label="False-positive rate" countUp={headline.fpr} format={(v) => formatPercent(v, 2)} note="harmless inputs blocked" tone={{ slot: 3 }} /> : null}
      {isCount(rules) ? <StatTile label="Rules" countUp={rules} format={formatCount} note="weighted regex rules" tone={{ slot: 4 }} /> : null}
      {isCount(tested) ? <StatTile label="Payloads tested" countUp={tested} format={formatCount} note="attacks, benign and hard negatives" tone={{ slot: 5 }} /> : null}
    </div>
  );
}

export function HomePage() {
  const benchmark = useApi("/benchmark");
  const health = useApi("/health");
  return (
    <div className="page home">
      <section className="hero-block bleed">
        <div className="bleed-inner hero">
          <div className="hero-copy">
            <h1 className="hero-title" tabIndex={-1}>Catch XSS in user input before it reaches your page.</h1>
            <p className="lede">A decoding-aware rule engine with an ML second opinion - explainable, honestly benchmarked, and free of dependencies.</p>
            <div className="row">
              <Link className="button-link" to="/scanner">Try the scanner</Link>
              <Link className="button-link secondary" to="/how-it-works">See how it works</Link>
            </div>
          </div>
          <HeroDemo />
        </div>
      </section>

      <Reveal>
        <section className="stats-block bleed" aria-labelledby="stats-title">
          <div className="bleed-inner">
            <h2 id="stats-title" className="section-title">Key numbers</h2>
            <Stats benchmark={benchmark} health={health} />
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="features-block bleed" aria-labelledby="features-title">
          <div className="bleed-inner">
            <h2 id="features-title" className="section-title">Why it works</h2>
            <FeatureGrid />
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="code-block-section bleed" aria-labelledby="use-title">
          <div className="bleed-inner">
            <h2 id="use-title" className="section-title">Use it in your app</h2>
            <div className="grid-2">
              <CodeBlock label="Python library" code={PYTHON_SAMPLE} />
              <CodeBlock label="curl" code={curlFor(ENDPOINTS[0], window.location.origin)} />
            </div>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="cta-block bleed" aria-labelledby="cta-title">
          <div className="bleed-inner">
            <h2 id="cta-title" className="section-title">See it on your own input</h2>
            <p className="lede">Paste something into the scanner, then check how the detector holds up on data it has never seen.</p>
            <div className="row">
              <Link className="button-link" to="/benchmarks">Read the benchmarks</Link>
              <Link className="button-link secondary" to="/rules">Browse the rules</Link>
            </div>
          </div>
        </section>
      </Reveal>
    </div>
  );
}
