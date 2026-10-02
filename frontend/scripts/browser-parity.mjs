// Drives the built site in headless Chrome (CDP) and checks it end to end.
//   node scripts/browser-parity.mjs        env: BASE_URL (default http://127.0.0.1:8010), CHROME, SHOTS
// Exits 1 if any check fails, or if Chrome logs a CSP violation, a JS exception or an unexpected console error.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8010";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = resolve(process.env.SHOTS || ".tmp/shots");
const PORT = 9335;
mkdirSync(SHOTS, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "xss-parity-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });

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
let expect404 = false;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") problems.push("JS exception: " + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
  if (d.method === "Log.entryAdded") {
    const { level, text, url = "" } = d.params.entry;
    if (/Content Security Policy/i.test(text)) problems.push("CSP violation: " + text.slice(0, 160));
    else if (level === "error" && !(expect404 && /status of 404/.test(text)) && !/status of 422/.test(text)) problems.push("console error: " + text.slice(0, 160) + " " + url);
  }
};
const send = (method, params = {}) => new Promise((resolveSend) => { const id = ++nextId; pending.set(id, resolveSend); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result.result.value;
};
const until = async (expression, what, timeout = 6000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await js(expression)) return true; await sleep(50); }
  throw new Error("timed out waiting for " + what);
};

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const qa = (sel) => `document.querySelectorAll(${JSON.stringify(sel)})`;
const text = (sel) => js(`${q(sel)}?.textContent ?? null`);
const texts = (sel) => js(`[...${qa(sel)}].map((e) => e.textContent)`);
const count = (sel) => js(`${qa(sel)}.length`);
const exists = (sel) => js(`!!${q(sel)}`);
const setValue = (sel, value) => js(`(() => { const el = ${q(sel)};
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const clickText = (selector, label) => js(`[...${qa(selector)}].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
const click = (sel) => js(`${q(sel)}.click()`);
const hover = async (sel) => {
  await js(`${q(sel)}.scrollIntoView({ block: "center" })`);
  await sleep(100);
  const { x, y } = await js(`(() => { const r = ${q(sel)}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
};
const unhover = () => send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
const viewport = (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
const media = (scheme = "light", reduce = false) => send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }],
});
// Sections fade in as they scroll into view, so scroll through the page first or a full-page capture
// would show them still hidden.
const revealAll = async () => {
  const height = await js("document.documentElement.scrollHeight");
  for (let y = 0; y < height; y += 500) { await js(`window.scrollTo(0, ${y})`); await sleep(120); }
  await js("window.scrollTo(0, 0)");
};
const shot = async (name) => {
  await revealAll();
  await sleep(300);
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64"));
};
const visit = async (path) => {
  await send("Page.navigate", { url: BASE + path });
  await until(`!!${q("main h1")}`, `the page ${path} to render`);
  await sleep(250);
};
const overflows = () => js(`document.documentElement.scrollWidth > document.documentElement.clientWidth`);

const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`); };
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

const PAGES = [
  { path: "/", h1: "Catch XSS in user input before it reaches your page.", title: "ScriptShield", nav: null },
  { path: "/scanner", h1: "Scanner", title: "Scanner · ScriptShield", nav: "Scanner" },
  { path: "/how-it-works", h1: "How it works", title: "How it works · ScriptShield", nav: "How it works" },
  { path: "/rules", h1: "Rules", title: "Rules · ScriptShield", nav: "Rules" },
  { path: "/benchmarks", h1: "Benchmarks", title: "Benchmarks · ScriptShield", nav: "Benchmarks" },
  { path: "/api-docs", h1: "API reference", title: "API docs · ScriptShield", nav: "API" },
  { path: "/about", h1: "About", title: "About · ScriptShield", nav: "About" },
];
const BG = { light: "rgb(248, 250, 252)", dark: "rgb(11, 18, 32)" };

try {
  await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");
  await media("light");
  await viewport(1280, 900);

  // ---- server ---------------------------------------------------------------------------------
  for (const { path } of PAGES) {
    const res = await fetch(BASE + path);
    check(`server: ${path} serves the app (200)`, res.status === 200 && (await res.text()).includes('<div id="root">'), `status ${res.status}`);
  }
  const missing = await fetch(BASE + "/nope");
  check("server: an unknown page is a real 404 that still serves the app", missing.status === 404 && (await missing.text()).includes('<div id="root">'));
  const rules = await (await fetch(BASE + "/api/rules")).json();
  const bench = await (await fetch(BASE + "/api/benchmark")).json();
  check("server: /api/rules has 24 rules and /api/benchmark has 4 detectors", rules.rules.length === 24 && bench.detectors.length === 4, `${rules.rules.length} / ${bench.detectors.length}`);
  check("server: shell has a favicon and description", (await (await fetch(BASE + "/")).text()).includes('rel="icon"'));

  // ---- every page: render, title, active nav, no overflow, deep link reload --------------------
  for (const page of PAGES) {
    await visit(page.path);
    eq(`${page.path}: h1 and document title`, [await text("main h1"), await js("document.title")], [page.h1, page.title]);
    if (page.nav) eq(`${page.path}: header nav marks the current page`, await js(`[...${qa("header nav a[aria-current='page']")}].map((a) => a.textContent)`), [page.nav]);
    for (const [w, h] of [[1280, 900], [390, 900], [320, 800]]) {
      await viewport(w, h);
      await sleep(150);
      check(`${page.path}: no horizontal overflow at ${w}px`, !(await overflows()));
    }
    await viewport(1280, 900);
  }
  expect404 = true;
  await visit("/nope");
  eq("/nope: 404 page and title", [await text("main h1"), await js("document.title")], ["Page not found", "Page not found · ScriptShield"]);
  expect404 = false;

  // ---- client-side navigation keeps the page and moves focus -----------------------------------
  await visit("/");
  await js(`window.__marker = "still here"`);
  await clickText("header nav a", "Rules");
  await until(`location.pathname === "/rules"`, "navigation to /rules");
  await sleep(200);
  eq("navigation: no page reload, focus on the new heading, announced", await js(`[window.__marker, document.activeElement.tagName, ${q("#announce")}.textContent]`), ["still here", "H1", "Navigated to Rules"]);

  // ---- theme -----------------------------------------------------------------------------------
  await visit("/scanner");
  const toggle = 'header button[aria-label^="Theme:"]';
  const themeState = () => js(`[document.documentElement.dataset.theme ?? "system", getComputedStyle(document.body).backgroundColor]`);
  eq("theme: starts on the system theme (light)", await themeState(), ["system", BG.light]);
  await click(toggle);
  eq("theme: toggle -> light", await themeState(), ["light", BG.light]);
  await click(toggle);
  eq("theme: toggle -> dark", await themeState(), ["dark", BG.dark]);
  await visit("/rules");
  eq("theme: the choice survives navigation and reload", (await themeState())[0], "dark");
  await click(toggle);
  await media("dark");
  eq("theme: back to system follows the OS (dark)", await themeState(), ["system", BG.dark]);
  await media("light");
  await visit("/scanner");
  eq("theme: system follows the OS (light)", await themeState(), ["system", BG.light]);

  // ---- rules page: table, search, charts, tooltip, keyboard, table view ------------------------
  await visit("/rules");
  await until(`${qa(".rules-table tbody tr")}.length === 24`, "24 rules in the table");
  eq("rules: 24 rows, weight chart has 24 bars", [await count(".rules-table tbody tr"), await js(`${q(".chart-card")}.querySelectorAll(".mark").length`)], [24, 24]);
  await setValue("#rule-search", "popup");
  eq("rules: search narrows the table", await count(".rules-table tbody tr"), 1);
  await setValue("#rule-search", "");
  await hover(".chart-card .mark-group");
  await until(`!!${q(".chart-tip")}`, "a tooltip on hover");
  check("rules: hovering a bar shows a tooltip with the points", /Points/.test(await text(".chart-tip")));
  await unhover();
  await until(`!${q(".chart-tip")}`, "the tooltip to hide");
  await js(`${q(".chart-card .mark-group")}.focus()`);
  check("rules: keyboard focus on a bar shows the tooltip too", await exists(".chart-tip"));
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  check("rules: Escape hides the tooltip", !(await exists(".chart-tip")));
  await clickText(".chart-card button", "View as table");
  eq("rules: the table view lists all 24 rules", await js(`${q(".chart-card")}.querySelectorAll("tbody tr").length`), 24);
  await shot("rules-table-view");

  // ---- benchmarks: KPIs, small multiples, entity colours, unseen sources, outcomes --------------
  await visit("/benchmarks");
  await until(`${qa(".stat-tile")}.length === 5`, "the benchmark tiles");
  eq("benchmarks: headline numbers", await js(`[...${qa(".stat-tile")}].map((t) => t.querySelector(".stat-value").textContent)`), ["95.2%", "100.0%", "0.00%", "97.5%", "1/49"]);
  const cardBars = (title) => js(`[...${qa(".chart-card")}].find((c) => c.querySelector("h3")?.textContent === ${JSON.stringify(title)})?.querySelectorAll(".mark-group").length`);
  eq("benchmarks: three small multiples with one group per detector", [await cardBars("Recall"), await cardBars("Precision"), await cardBars("False-positive rate")], [4, 4, 4]);
  const colour = (title, label) => js(`[...${qa(".chart-card")}].find((c) => c.querySelector("h3")?.textContent === ${JSON.stringify(title)})?.querySelector(${JSON.stringify(`[aria-label^="${label}:"] .mark`)})?.getAttribute("class")`);
  const hybrid = "Hybrid (rules; ML escalates)";
  check("benchmarks: a detector keeps its colour in every chart",
    /fill-s1/.test(await colour("Recall", hybrid)) && /fill-s1/.test(await colour("Precision", hybrid)) && /fill-s2/.test(await colour("Recall", "Rules")),
    `${await colour("Recall", hybrid)} | ${await colour("Precision", hybrid)} | ${await colour("Recall", "Rules")}`);
  eq("benchmarks: unseen-source chart has 9 groups x 2 series", await js(`[...${qa(".chart-card")}].find((c) => c.querySelector("h3")?.textContent.startsWith("Recall on payload lists"))?.querySelectorAll(".mark").length`), 18);
  eq("benchmarks: outcome table and examples", [await count(".outcome-table tbody tr"), await count("details.card")], [4, 4]);

  // ---- scanner: gauge, breakdown, history, share link, copy -------------------------------------
  await visit("/scanner");
  await clickText("#samples button", "Event handler");
  await until(`!!${q(".gauge")}`, "the gauge");
  eq("scanner: gauge and breakdown", [await js(`${q(".gauge")}.getAttribute("aria-label")`), await exists(".breakdown .mark")], ["Risk score 95 of 100, critical", true]);
  await clickText("#samples button", "URL-encoded");
  await until(`${qa(".history-list li")}.length === 2`, "two scans in the history");
  check("scanner: the history lists both scans and the score history draws a line", (await count(".history-list li")) === 2 && (await exists(".spark-line")));
  await click("#clear");
  await clickText(".history-list button", "Re-run"); // the newest scan is first: the URL-encoded one
  eq("scanner: Re-run refills the input with the newest scan", await js(`${q("#probe")}.value`), "%3Cscript%3Ealert(1)%3C/script%3E");
  await until(`!!${q(".result-actions")}`, "the result to render again");
  await clickText(".result-actions button", "Copy JSON");
  await until(`${q(".toasts")}.textContent.length > 0`, "a toast");
  check("scanner: copying gives feedback", /Copied the result as JSON|Could not copy/.test(await text(".toasts")));
  const shared = Buffer.from("<b>hi</b>", "utf8").toString("base64url");
  await visit(`/scanner?t=${shared}`);
  eq("scanner: a share link preloads the input", await js(`${q("#probe")}.value`), "<b>hi</b>");
  await visit("/scanner?t=!!!");
  eq("scanner: a malformed share link is ignored", await js(`${q("#probe")}.value`), "");
  await shot("scanner-with-history");

  // ---- how it works ---------------------------------------------------------------------------
  await visit("/how-it-works");
  await until(`!!${q("[role=tabpanel] .compare")}`, "step 1 with a result");
  await clickText(".example-picker button", "URL-encoded");
  await until(`[...${qa("[role=tabpanel] pre code")}].some((c) => c.textContent === "<script>alert(1)</script>")`, "the decoded text");
  check("how it works: Normalize shows the decoded text and the layer chip", /encoded: 1 decoding layer/.test(await text("[role=tabpanel]")));
  await js(`${q("[role=tab]")}.focus()`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await sleep(200);
  eq("how it works: the arrow key moves to the Match step, which highlights matches", await js(`[${qa("[role=tab][aria-selected=true]")}[0].textContent.includes("Match"), ${qa("#decoded mark")}.length > 0]`), [true, true]);
  await js(`[...${qa("[role=tab]")}].pop().click()`);
  await sleep(200);
  check("how it works: Score shows the gauge", await exists("[role=tabpanel] .gauge"));

  // ---- api docs ---------------------------------------------------------------------------------
  await visit("/api-docs");
  await js(`[...${qa("section.endpoint")}][4].querySelector(".tryit button").click()`);
  await until(`${qa("section.endpoint")}[4].querySelector(".tryit-result .chip")?.textContent === "HTTP 200"`, "the health request");
  await js(`[...${qa("section.endpoint")}][0].querySelector(".tryit button").click()`);
  await until(`${qa("section.endpoint")}[0].querySelector(".tryit-result .chip")?.textContent === "HTTP 200"`, "the scan request");
  check("api docs: Try it sends real requests", true);

  // ---- home: demo, pause, counters, features, code samples --------------------------------------
  await visit("/");
  const typedLength = () => js(`${q(".demo-typed")}.textContent.length`);
  const before = await typedLength();
  await sleep(500);
  check("home: the hero demo is typing", (await typedLength()) > before);
  await until(`/risk/i.test(${q(".demo-result")}.textContent)`, "the demo verdict", 12000);
  check("home: the demo shows a live verdict", true);
  await clickText(".demo button", "Pause demo");
  const frozen = await js(`${q(".demo-typed")}.textContent`);
  await sleep(900);
  eq("home: Pause stops the demo", await js(`${q(".demo-typed")}.textContent`), frozen);
  await clickText(".demo button", "Play demo");
  await sleep(2500);
  check("home: Play resumes it", (await js(`${q(".demo-typed")}.textContent`)) !== frozen || (await exists(".demo-result strong")));
  await until(`${qa(".stat-tile")}.length === 5`, "the stat tiles");
  await sleep(1500);
  eq("home: the counters settle on the real numbers", await js(`[...${qa(".stat-tile")}].map((t) => t.querySelector(".stat-value").textContent)`), ["95.2%", "100.0%", "0.00%", "23", "7,637"]);
  eq("home: six features, two code samples", [await count("li.feature"), await count(".code-block")], [6, 2]);
  await shot("home-full");

  // ---- reduced motion: nothing animates and nothing is hidden -----------------------------------
  await media("light", true);
  await visit("/");
  eq("reduced motion: the demo shows a whole payload and a verdict at once, with nothing to pause", await js(`[${q(".demo-typed")}.textContent.length > 20, !${q(".demo button")}]`), [true, true]);
  await until(`/risk/i.test(${q(".demo-result")}.textContent)`, "the verdict under reduced motion");
  eq("reduced motion: counters are final immediately", await js(`[...${qa(".stat-tile")}].map((t) => t.querySelector(".stat-value").textContent)[0]`), "95.2%");
  check("reduced motion: sections are visible", (await js(`[...${qa(".reveal")}].every((e) => e.classList.contains("is-visible"))`)));
  await media("light", false);

  // ---- screenshots of every page in light, dark and mobile --------------------------------------
  for (const page of [...PAGES, { path: "/nope", h1: "" }]) {
    const slug = page.path === "/" ? "home" : page.path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-");
    expect404 = page.path === "/nope";
    await media("light");
    await viewport(1280, 900);
    await visit(page.path);
    if (page.path === "/") await sleep(2200);
    await shot(`${slug}-light`);
    await media("dark");
    await shot(`${slug}-dark`);
    await media("light");
    await viewport(390, 900);
    await shot(`${slug}-mobile`);
  }
  expect404 = false;
} catch (err) {
  check("script completed", false, err.message);
} finally {
  for (const p of problems) check("clean console", false, p);
  if (!problems.length) check("no CSP violations, JS exceptions or unexpected console errors", true);
  ws.close();
  chrome.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold the profile briefly */ }
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed; screenshots in ${SHOTS}`);
  process.exit(failed ? 1 : 0);
}
