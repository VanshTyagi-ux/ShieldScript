import { toneClass } from "../charts/shapes.js";

// Small line icons (decorative: the title carries the meaning).
const ICONS = {
  decode: <><path d="M8 7l-5 5 5 5M16 7l5 5-5 5" /><path d="M14 5l-4 14" /></>,
  rules: <><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="19" cy="18" r="1.5" /></>,
  model: <><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 11l8-4M8 13l8 4" /></>,
  explain: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>,
  bench: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  box: <><path d="M12 3l9 5v8l-9 5-9-5V8l9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
};

const FEATURES = [
  { icon: "decode", title: "Decoding-aware", text: "Repeatedly decodes URL escapes, HTML entities and unicode before matching, so encoding tricks do not hide a payload.", slot: 1 },
  { icon: "rules", title: "Weighted rules", text: "Rules for script tags, event handlers, dangerous URLs, JavaScript sinks, CSS tricks and template injection, each with a weight.", slot: 2 },
  { icon: "model", title: "ML second opinion", text: "A small model over character n-grams can escalate input the rules only half-recognise. It never blocks on its own.", slot: 3 },
  { icon: "explain", title: "Explainable findings", text: "Every finding names the rule, the matched text and its weight, so a block is never a mystery.", slot: 4 },
  { icon: "bench", title: "Honest benchmarks", text: "Measured on held-out data and on payload lists the model never saw, with the caveats stated next to the numbers.", slot: 5 },
  { icon: "box", title: "Zero dependencies", text: "The detector, the model and the server use only the Python standard library. Nothing to install.", slot: 6 },
];

export function FeatureGrid() {
  return (
    <ul className="feature-grid">
      {FEATURES.map((feature) => (
        <li className="card feature" key={feature.title}>
          <span className={`feature-icon ${toneClass(feature, "color")}`}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {ICONS[feature.icon]}
            </svg>
          </span>
          <h3>{feature.title}</h3>
          <p className="muted">{feature.text}</p>
        </li>
      ))}
    </ul>
  );
}
