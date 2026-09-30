// A small stand-in for Vite's env loading, so `import.meta.env.VITE_*` works with plain esbuild.
//
// Files, lowest priority first: .env, .env.local, .env.<mode>, .env.<mode>.local. Real environment variables
// beat all of them. Only names starting with VITE_ are ever exposed to the browser bundle: anything else in
// these files (or in the environment) stays out of it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PREFIX = "VITE_";

// KEY=value lines; `#` comments, an optional `export `, and one pair of matching quotes around the value.
// Unquoted values end at " #". No variable expansion.
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trimStart().startsWith("#")) continue;
    let [, key, value] = match;
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    out[key] = value;
  }
  return out;
}

// -> { values: { VITE_X: "..." }, sources: { VITE_X: ".env.production" | "environment" } }
export function loadViteEnv(mode, dir, processEnv = process.env) {
  const values = {};
  const sources = {};
  for (const name of [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`]) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
      if (!key.startsWith(PREFIX)) continue;
      values[key] = value;
      sources[key] = name;
    }
  }
  for (const [key, value] of Object.entries(processEnv)) {
    // An empty variable counts as unset. Docker turns an unset `ARG X` into `ENV X=""`, which must not wipe out
    // the value from the .env files (and the client treats a blank VITE_API_URL as unset anyway).
    if (!key.startsWith(PREFIX) || value === undefined || value === "") continue;
    values[key] = value;
    sources[key] = "environment";
  }
  return { values, sources };
}
