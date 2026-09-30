// Real API response shapes, shared by page tests. Later tasks append BENCHMARK_FIXTURE, ...
export const HEALTH_FIXTURE = { status: "ok", rules: 23, ml_loaded: true };

// The real benchmark numbers (reports/benchmark.md), built from the confusion counts.
const detector = (name, [tp, fn, fp, tn], hardFps, samples = {}, shipped = false) => {
  const recall = tp / (tp + fn);
  const precision = tp + fp ? tp / (tp + fp) : 0;
  return {
    name, shipped, recall, precision, f1: (2 * precision * recall) / (precision + recall), fpr: fp / (fp + tn),
    accuracy: (tp + tn) / (tp + fn + fp + tn), tp, fn, fp, tn, hard_fps: hardFps, hard_total: 49,
    samples: { misses: [], false_positives: [], hard_false_positives: [], ...samples },
  };
};
const source = (name, payloads, rules_recall, ml_recall, ml_fpr) => ({ source: name, payloads, rules_recall, ml_recall, ml_fpr });

export const BENCHMARK_FIXTURE = {
  generated: "2026-09-28",
  dataset: { malicious_test: 2640, benign_test: 2716, hard_negatives: 49 },
  detectors: [
    detector("Rules", [2488, 152, 0, 2716], 1, { misses: ["<br><br><br><br>", "a=alert,a(1)", "top['al\\145rt'](1)"], hard_false_positives: ["onset = 3 days after symptoms"] }),
    detector("ML alone", [2632, 8, 2, 2714], 2, { misses: ["navigator.vibrate(500)", "top."], false_positives: ["'left<<<<<<<<<<<<'", "'Hook'"], hard_false_positives: ["C:\\users\\public\\documents", "5 < 10"] }),
    detector("Naive hybrid (rules OR ML)", [2634, 6, 2, 2714], 3, { misses: ["navigator.vibrate(500)"], false_positives: ["'Hook'"], hard_false_positives: ["5 < 10", "onset = 3 days after symptoms"] }),
    detector("Hybrid (rules; ML escalates)", [2512, 128, 0, 2716], 1, { misses: ["<br><br><br>", "top['al\\145rt'](1)", "eval("], hard_false_positives: ["onset = 3 days after symptoms"] }, true),
  ],
  unseen_sources: [
    source("XSS-BruteLogic.txt", 113, 0.947, 1, 0.0015),
    source("XSS-Cheat-Sheet-PortSwigger.txt", 6042, 1, 1, 0.0015),
    source("XSS-EnDe-evation.txt", 161, 0.565, 0.758, 0.0007),
    source("XSS-EnDe-h4k.txt", 204, 0.623, 0.926, 0.0011),
    source("XSS-innerht-ml.txt", 48, 1, 1, 0.0015),
    source("XSS-Jhaddix.txt", 107, 1, 1, 0.0011),
    source("XSS-OFJAAAH.txt", 1616, 0.843, 0.99, 0.0004),
    source("XSS-Vectors-Mario.txt", 134, 0.873, 1, 0.0007),
  ],
  unseen_weighted: { payloads: 8425, rules_recall: 0.9497, ml_recall: 0.9917 },
  notes: [
    "Many lines in public payload lists are fragments rather than working attacks, so recall below 100% is expected.",
    "Treat the ML false-positive rate as optimistic for real-world input such as rich-text comments.",
    "The random-split numbers are optimistic; the unseen-source table is the fairer estimate.",
  ],
};

const rule = (id, name, category, weight, description, derived = false) => ({ id, name, category, weight, description, derived });

// A subset of the real catalog covering every category, plus the derived obfuscation rule.
export const RULES_FIXTURE = {
  rules: [
    rule("XSS001", "Script tag", "markup", 70, "Opening or closing <script> tag."),
    rule("XSS002", "Inline event handler (known)", "markup", 60, "HTML event-handler attribute such as onerror=, onload=, onclick=."),
    rule("XSS020", "javascript: URI in URL attribute", "uri", 70, "javascript:/vbscript: used as the value of href/src/action/etc."),
    rule("XSS031", "DOM write sink", "javascript", 40, "document.write, innerHTML/outerHTML assignment, insertAdjacentHTML."),
    rule("XSS033", "Popup probe", "javascript", 20, "alert/prompt/confirm call - the classic XSS proof-of-concept."),
    rule("XSS040", "CSS script vector", "css", 50, "expression(), -moz-binding, behavior:url(), url(javascript:)."),
    rule("XSS041", "Template expression injection", "template", 45, "{{ ... constructor ... }} style sandbox escapes (AngularJS, Vue, etc.)."),
    rule("XSS099", "Encoded / obfuscated payload", "evasion", 15, "The dangerous content only appears after decoding URL/HTML/unicode escapes.", true),
  ],
  levels: [{ name: "safe", min: 0 }, { name: "low", min: 1 }, { name: "medium", min: 25 }, { name: "high", min: 50 }, { name: "critical", min: 75 }],
  block_threshold: 25,
};

// Real API shapes for the payload browser and the sanitizer playground.
export const PAYLOAD_ROWS = [
  { id: 1, content: "<svg onload=alert(1)>", source_file: "XSS-BruteLogic.txt", category: "standard", created_at: "2026-09-28T14:33:00" },
  { id: 2, content: "javascript:alert(1)", source_file: "XSS-Bypass-Strings-BruteLogic.txt", category: "bypass", created_at: "2026-09-28T14:33:00" },
  { id: 3, content: "%3Cscript%3Ealert(1)%3C/script%3E", source_file: "XSS-EnDe-h4k.txt", category: "encoded", created_at: "2026-09-28T14:34:10" },
];

export const PAYLOADS_FIXTURE = { items: PAYLOAD_ROWS, total: 8562, skip: 0, limit: 50 };

export const FACETS_FIXTURE = {
  total: 8562,
  categories: [{ name: "standard", count: 8027 }, { name: "encoded", count: 415 }, { name: "polyglot", count: 61 }, { name: "bypass", count: 59 }],
  sources: [{ name: "XSS-Cheat-Sheet-PortSwigger.txt", count: 6042 }, { name: "XSS-BruteLogic.txt", count: 113 }],
};

export const SANITIZE_FIXTURE = {
  clean: '<p>Hi <b>there</b> <a rel="noopener noreferrer">click</a></p>',
  changed: true,
  report: {
    removed_tags: [{ name: "script", count: 1, content_removed: true }, { name: "div", count: 2, content_removed: false }],
    removed_attributes: [
      { tag: "p", name: "onclick", count: 1, reason: "event_handler" },
      { tag: "a", name: "href", count: 1, reason: "unsafe_url" },
    ],
    comments_removed: 1, total_tags_removed: 3, total_attributes_removed: 2, truncated: false,
  },
  detector: { score: 100, level: "critical", is_malicious: true, ml_probability: 1, rule_ids: ["XSS001", "XSS002"] },
};

export const SANITIZE_CLEAN_FIXTURE = {
  clean: "<p>Hello</p>", changed: false,
  report: { removed_tags: [], removed_attributes: [], comments_removed: 0, total_tags_removed: 0, total_attributes_removed: 0, truncated: false },
  detector: { score: 0, level: "safe", is_malicious: false, ml_probability: null, rule_ids: [] },
};
