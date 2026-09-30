// Builds the site with esbuild and injects VITE_* variables as `import.meta.env`, like Vite would.
//
//   node scripts/build.mjs build   -> ../xss_detector/static/app.js   (production: minified; what the built-in server ships)
//   node scripts/build.mjs check   -> .tmp/app.js                     (same build, written elsewhere, to compare)
//   node scripts/build.mjs dist    -> dist/                           (a static site for a web server or container: app.js,
//                                                                      a generated index.html and favicon.svg; mode "docker")
//   node scripts/build.mjs dev     -> dev server on http://localhost:5173 (env DEV_PORT), rebuilds on change
//
// Variables come from the environment and .env files (see loadEnv.mjs and .env.example). The dev server sends no
// Content-Security-Policy, so the page may call an API on another origin (the FastAPI backend, which allows
// http://localhost:5173 through CORS). The built-in Python server's CSP allows only its own origin: use
// `build`, whose .env.production points at the same-origin API. `dist` (.env.docker) also uses a same-origin API,
// /api/v1, which the container's nginx forwards to the backend.
import { context, build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadViteEnv } from "./loadEnv.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [, , command = "build"] = process.argv;
const MODES = { build: "production", check: "production", dist: "docker", dev: "development" };
if (!(command in MODES)) {
  console.error(`usage: node scripts/build.mjs ${Object.keys(MODES).join("|")}`);
  process.exit(2);
}
const mode = MODES[command];

const { values, sources } = loadViteEnv(mode, root);
const apiUrl = values.VITE_API_URL;
console.log(`mode: ${mode}`);
console.log(`VITE_API_URL: ${apiUrl === undefined ? "(not set: the client falls back to its default)" : `${apiUrl}  [${sources.VITE_API_URL}]`}`);
console.log(`VITE_BACKEND_PAGES: ${values.VITE_BACKEND_PAGES ?? "(not set: on)"}${sources.VITE_BACKEND_PAGES ? `  [${sources.VITE_BACKEND_PAGES}]` : ""}`);
if (command === "build" && (sources.VITE_API_URL === "environment" || sources.VITE_BACKEND_PAGES === "environment")) {
  console.warn("warning: a VITE_* variable comes from the environment and overrides .env.production, so this bundle may not match the committed one");
}

const options = {
  entryPoints: [resolve(root, "src/main.jsx")],
  bundle: true,
  jsx: "automatic",
  logLevel: "info",
  // The whole object is defined (not one key), so `import.meta.env.X` and `import.meta.env?.X` both work.
  define: { "import.meta.env": JSON.stringify({ ...values, MODE: mode, DEV: command === "dev", PROD: command !== "dev" }) },
};

// The page shell, generated so the project keeps no hand-written HTML. Keep DESCRIPTION and FAVICON in step with
// the built-in server (DESCRIPTION and FAVICON_SVG in xss_detector/server.py).
const DESCRIPTION = "Detect cross-site scripting in user input: decoding-aware rules plus an ML second opinion, benchmarked honestly.";
const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
  + '<path d="M32 4 8 13v17c0 15 10 26 24 30 14-4 24-15 24-30V13L32 4z" fill="#0057ff"/>'
  + '<path d="m22 32 7 7 14-15" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>\n';

function shell({ dev }) {
  return [
    "<!doctype html>", '<html lang="en">', "<head>", '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>XSS Detector${dev ? " (dev)" : ""}</title>`,
    `<meta name="description" content="${DESCRIPTION}">`,
    '<meta name="theme-color" content="#f8fafc" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#0b1220" media="(prefers-color-scheme: dark)">',
    '<meta property="og:title" content="XSS Detector">', `<meta property="og:description" content="${DESCRIPTION}">`,
    '<meta property="og:type" content="website">', '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    "</head>", "<body>", "<noscript>This page needs JavaScript.</noscript>", '<div id="root"></div>',
    ...(dev ? ['<script src="/livereload.js"></script>'] : []),
    '<script src="/app.js"></script>', "</body>", "</html>", "",
  ].join("\n");
}

if (command === "build") {
  await build({ ...options, minify: true, outfile: resolve(root, "../xss_detector/static/app.js") });
} else if (command === "check") {
  await build({ ...options, minify: true, outfile: resolve(root, ".tmp/app.js") });
} else if (command === "dist") {
  const site = resolve(root, "dist");
  mkdirSync(site, { recursive: true });
  // { app: ... } names the output app.js (a bare entry point would be written as main.js).
  await build({ ...options, entryPoints: { app: resolve(root, "src/main.jsx") }, minify: true, outdir: site });
  writeFileSync(resolve(site, "index.html"), shell({ dev: false }));
  writeFileSync(resolve(site, "favicon.svg"), FAVICON);
} else {
  const site = resolve(root, ".tmp/dev");
  mkdirSync(site, { recursive: true });
  // Generated on every start and git-ignored.
  writeFileSync(resolve(site, "index.html"), shell({ dev: true }));
  writeFileSync(resolve(site, "favicon.svg"), FAVICON);
  writeFileSync(resolve(site, "livereload.js"), "new EventSource('/esbuild').addEventListener('change', () => location.reload());\n");

  const ctx = await context({ ...options, entryPoints: { app: resolve(root, "src/main.jsx") }, sourcemap: "inline", outdir: site });
  await ctx.watch();
  const port = Number(process.env.DEV_PORT) || 5173;
  // `fallback` serves index.html for unknown paths, so /payloads or /playground work on a reload.
  await ctx.serve({ servedir: site, port, host: "localhost", fallback: resolve(site, "index.html") });
  console.log(`\n  dev server: http://localhost:${port}/   (API: ${apiUrl ?? "default"})\n`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await ctx.dispose(); process.exit(0); });
}
