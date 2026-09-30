// Drives the dev site against the FastAPI backend in headless Chrome (CDP) and checks the payload browser, the
// sanitizer playground and the existing pages end to end, across origins (the site on :5173, the API on :8000).
//   1. cd backend && python -m scripts.seed_payloads && uvicorn app.main:app --port 8000
//   2. cd frontend && npm run dev
//   3. node scripts/browser-backend.mjs      env: BASE_URL (http://localhost:5173), API_URL (http://localhost:8000/api/v1), CHROME, SHOTS
// Exits 1 if a check fails, or if Chrome logs a CORS/CSP problem, a JS exception or an unexpected console error.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const API = process.env.API_URL || "http://localhost:8000/api/v1";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = resolve(process.env.SHOTS || ".tmp/shots-backend");
const PORT = 9336;
mkdirSync(SHOTS, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "xss-backend-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60 && !targets?.length; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(250); }
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });

let nextId = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") problems.push("JS exception: " + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
  if (d.method === "Log.entryAdded") {
    const { level, text, url = "" } = d.params.entry;
    if (level === "error" && !/status of 404/.test(text)) problems.push("console error: " + text.slice(0, 200) + " " + url);
  }
};
const send = (method, params = {}) => new Promise((res) => { const id = ++nextId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result.result.value;
};
const until = async (expression, what, timeout = 8000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await js(expression)) return true; await sleep(50); }
  throw new Error("timed out waiting for " + what);
};
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const qa = (sel) => `document.querySelectorAll(${JSON.stringify(sel)})`;
const text = (sel) => js(`${q(sel)}?.textContent ?? null`);
const count = (sel) => js(`${qa(sel)}.length`);
const exists = (sel) => js(`!!${q(sel)}`);
const click = (sel) => js(`${q(sel)}.click()`);
const clickText = (selector, label) => js(`[...${qa(selector)}].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
const setValue = (sel, value) => js(`(() => { const el = ${q(sel)};
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); })()`);
const viewport = (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
const media = (scheme) => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
const shot = async (name) => {
  await sleep(300);
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
};
const visit = async (path, ready = "main h1") => {
  await send("Page.navigate", { url: BASE + path });
  await until(`!!${q(ready)}`, `${path} to render`);
  await sleep(200);
};
const overflows = () => js("document.documentElement.scrollWidth > document.documentElement.clientWidth");
// The widest elements that are wider than the page, outermost first, so a failing overflow check says what to fix.
// (Fixed-position elements are skipped: on a phone Chrome widens the layout viewport to fit overflowing content,
// which makes every fixed element look as wide as the overflow.)
const overflowers = () => js(`(() => {
  const de = document.documentElement;
  const name = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.split(" ").join(".") : "");
  const outside = [...document.querySelectorAll("body *")].filter((e) => getComputedStyle(e).position !== "fixed" && !e.closest(".table-wrap, pre")
    && (e.getBoundingClientRect().right > de.clientWidth + 1 || e.getBoundingClientRect().width > de.clientWidth + 1));
  return {
    inner: innerWidth, client: de.clientWidth, scroll: de.scrollWidth, bodyScroll: document.body.scrollWidth, visual: visualViewport?.width,
    wraps: [...document.querySelectorAll(".table-wrap")].map((w) => name(w.parentElement) + " > wrap width=" + Math.round(w.getBoundingClientRect().width) + " scroll=" + w.scrollWidth),
    outsideTables: outside.slice(0, 6).map((e) => name(e) + " left=" + Math.round(e.getBoundingClientRect().left) + " right=" + Math.round(e.getBoundingClientRect().right)),
  };
})()`);
const location = () => js("location.pathname + location.search");

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); };
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
const fmt = (n) => n.toLocaleString("en-US");

try {
  await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");
  await media("light"); await viewport(1280, 900);

  // ---- the API, from outside the browser --------------------------------------------------------
  const facets = await (await fetch(`${API}/payloads/facets`)).json();
  check("api: payloads are seeded", facets.total > 8000, `total ${facets.total}`);
  const pre = await fetch(`${API}/payloads`, { method: "OPTIONS", headers: { Origin: BASE, "Access-Control-Request-Method": "GET" } });
  eq("api: CORS allows the dev site's origin", pre.headers.get("access-control-allow-origin"), BASE);
  const inCategory = (name) => facets.categories.find((c) => c.name === name)?.count;

  // ---- payload browser --------------------------------------------------------------------------
  await visit("/payloads", ".payload-table");
  eq("payloads: first page shows 50 rows", await js(`${qa(".payload-table tbody tr")}.length`), 50);
  eq("payloads: summary line", await text(".card p[aria-live]"), `Showing 1-50 of ${fmt(facets.total)} payloads`);
  eq("payloads: category chips come from the facets", await js(`[...${qa("[aria-label='Category'] button")}].map((b) => b.textContent)`),
    ["All", ...facets.categories.map((c) => `${c.name[0].toUpperCase()}${c.name.slice(1)} (${fmt(c.count)})`)]);
  eq("payloads: nav marks Payloads", await js(`[...${qa("header nav a[aria-current='page']")}].map((a) => a.textContent)`), ["Payloads"]);
  for (const w of [1280, 390, 320]) {
    await viewport(w, 900);
    await sleep(150);
    check(`payloads: no horizontal overflow at ${w}px`, !(await overflows()), JSON.stringify(await overflowers()));
  }
  await viewport(1280, 900);
  await shot("payloads-light");

  await clickText("[aria-label='Category'] button", `Bypass (${inCategory("bypass")})`);
  await until(`document.querySelector(".card p[aria-live]")?.textContent.includes("of ${inCategory("bypass")} payloads")`, "the bypass filter");
  eq("payloads: choosing a category updates the URL", await location(), "/payloads?category=bypass");
  eq("payloads: every visible row is in that category", await js(`[...${qa(".payload-table tbody tr td:nth-child(2)")}].every((c) => c.textContent === "Bypass")`), true);
  eq("payloads: the pager shows two pages for 59 rows", await text(".pager .muted"), "Page 1 of 2");
  await clickText(".pager button", "Next");
  // The label follows the URL at once; the table keeps the old page (dimmed) until the new one arrives.
  await until(`${q(".pager .muted")}?.textContent === "Page 2 of 2" && ${qa(".payload-table tbody tr")}.length === ${inCategory("bypass") - 50}`, "page 2 to load");
  eq("payloads: page 2 holds the remaining rows", await js(`${qa(".payload-table tbody tr")}.length`), inCategory("bypass") - 50);
  eq("payloads: the URL has the page", await location(), "/payloads?category=bypass&page=2");
  await js("history.back()");
  await until(`${q(".pager .muted")}?.textContent === "Page 1 of 2"`, "back to page 1");
  check("payloads: the back button returns to page 1", (await location()) === "/payloads?category=bypass", await location());

  await clickText(".controls button", "Clear filters");
  await setValue("#payload-source", "XSS-Jhaddix.txt");
  const jhaddix = facets.sources.find((s) => s.name === "XSS-Jhaddix.txt").count;
  await until(`document.querySelector(".card p[aria-live]")?.textContent.includes("of ${jhaddix} payloads")`, "the source filter");
  eq("payloads: filtering by source file", await location(), "/payloads?source_file=XSS-Jhaddix.txt");

  await visit("/payloads?category=encoded&page=2&size=25", ".payload-table");
  eq("payloads: a deep link restores category, page and size", [await js(`${q("#payload-size")}.value`), await text(".pager .muted"), await js(`${qa(".payload-table tbody tr")}.length`)],
    ["25", `Page 2 of ${Math.ceil(inCategory("encoded") / 25)}`, 25]);

  await visit("/payloads?page=9999", ".empty");
  check("payloads: a page past the end says so and offers the first page", (await text(".empty")).includes("There are no payloads on page 9,999"));

  await visit("/payloads", ".payload-table");
  await click(".payload-table tbody tr button");
  await until(`!!${q(".payload-full")}`, "the details");
  const firstContent = await text(".payload-full");
  eq("payloads: details show the full payload and two links", [firstContent.length > 0, await count(".payload-detail a")], [true, 2]);
  await click(".payload-detail a[href*='/playground']");
  await until(`!!${q("#html-input")}`, "the playground");
  eq("payloads: 'Sanitize it' opens the playground with that payload", await js(`${q("#html-input")}.value`), firstContent);
  await until(`!!${q("#sanitized-output")}`, "the sanitized result");

  // ---- sanitizer playground ---------------------------------------------------------------------
  await visit("/playground", "#html-input");
  await until(`!!${q("#sanitized-output")}`, "the first result");
  eq("playground: the demo input is cleaned", await text("#sanitized-output"), '<p>Hi <b>there</b>, <a rel="noopener noreferrer">click me</a></p>');
  check("playground: the report lists the script tag and the onclick handler", (await text(".sanitize-report")).includes("<script>") && (await text(".sanitize-report")).includes("onclick"));
  check("playground: the report summary counts removals", (await text(".report-summary")).startsWith("Removed 1 tag, 2 attributes and 1 comment"), await text(".report-summary"));
  eq("playground: the preview frame is sandboxed with nothing allowed", await js(`${q("iframe.html-preview")}.getAttribute("sandbox")`), "");
  eq("playground: the preview shows the sanitized markup", await js(`${q("iframe.html-preview")}.srcdoc`), '<p>Hi <b>there</b>, <a rel="noopener noreferrer">click me</a></p>');
  eq("playground: the page cannot reach into the sandboxed frame", await js(`${q("iframe.html-preview")}.contentDocument === null`), true);
  check("playground: the detector alert is shown", (await text(".detector-alert")).includes("Alert only"));

  await setValue("#html-input", '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><b>ok</b>');
  await until(`${q("#sanitized-output")}?.textContent === '<img src="x"><b>ok</b>'`, "the hostile input to be cleaned");
  eq("playground: hostile input never executes", await js("window.__pwned === undefined"), true);
  eq("playground: no live img or script in the page itself", await js(`${qa("main img, main script")}.length`), 0);

  await clickText("#sanitize-samples .sample", "Embeds");
  await until(`${q("#sanitized-output")}?.textContent.startsWith("(empty")`, "the embeds sample");
  check("playground: iframe/object/svg are all removed", (await text(".sanitize-report")).includes("<iframe>"));

  await setValue("#html-input", "a".repeat(64001));
  await until(`!!${q(".error-box")}`, "the length error");
  check("playground: over-long input is refused before sending, with the reason", (await text(".error-box")).includes("64,000"), await text(".error-box"));
  check("playground: the counter turns to its error state", (await js(`${q("#html-count")}.className`)).includes("over"));

  await setValue("#html-input", "<b>after</b>");
  await until(`${q("#sanitized-output")}?.textContent === "<b>after</b>"`, "recovery after an error");
  await js("window.__realFetch = window.fetch; window.fetch = () => Promise.reject(new TypeError('Failed to fetch'))");
  await setValue("#html-input", "<b>offline</b>");
  await until(`!!${q(".error-box")}`, "the network error");
  check("playground: an unreachable API is shown as an error", (await text(".error-box")).includes("Failed to fetch"), await text(".error-box"));
  await js("window.fetch = window.__realFetch");
  await clickText("#html-input ~ .row button", "Clear");
  await until(`!!${q(".empty")}`, "the empty state");
  check("playground: clearing returns to the empty state", (await text(".empty")).includes("Type or paste some HTML"));

  await visit("/playground", "#sanitized-output");
  await viewport(390, 900);
  await sleep(200);
  check("playground: no horizontal overflow at 390px", !(await overflows()), JSON.stringify(await overflowers()));
  await shot("playground-mobile");
  await viewport(1280, 900);
  await shot("playground-light");
  await media("dark"); await sleep(200);
  await shot("playground-dark");
  await visit("/payloads", ".payload-table");
  await shot("payloads-dark");
  await media("light");

  // ---- the existing pages, now served by FastAPI --------------------------------------------------
  await visit("/scanner", "#probe");
  await clickText("#samples .sample", "Event handler");
  await until(`!!${q("#scan-result")} && !${q("#scan-result")}.hidden`, "the scan result", 8000).catch(() => {});
  await until(`document.body.textContent.includes("Critical risk")`, "the scanner verdict");
  check("scanner: scans through the FastAPI backend", true);
  await visit("/rules", ".rules-table");
  eq("rules: 24 rules from GET /rules", await js(`${qa(".rules-table tbody tr")}.length`), 24);
  await visit("/benchmarks");
  await until(`document.body.textContent.includes("Recall")`, "the benchmark KPIs");
  check("benchmarks: loads from GET /benchmark", !(await text("main")).includes("Could not load"));
  await visit("/");
  await until(`document.body.textContent.includes("Operational")`, "the status badge");
  check("footer: health shows the ML model is loaded", (await text(".status-badge")).includes("ML model loaded"), await text(".status-badge"));
  await visit("/api-docs");
  check("api docs: show the FastAPI base URL", (await text(".api-base code")) === API, await text(".api-base code"));
  check("api docs: document the new endpoints", (await js(`[...${qa("h2.endpoint-head")}].map((h) => h.textContent).join(" ")`)).includes("/sanitize"));
} catch (err) {
  problems.push("script error: " + err.message);
} finally {
  ws.close(); chrome.kill(); await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold files */ }
}

for (const p of problems) console.log("PROBLEM  " + p);
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed, ${problems.length} problem(s); screenshots in ${SHOTS}`);
process.exit(failed || problems.length ? 1 : 0);
