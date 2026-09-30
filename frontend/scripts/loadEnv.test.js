import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadViteEnv, parseEnv } from "./loadEnv.mjs";

describe("parseEnv", () => {
  it("reads KEY=value lines and ignores comments and blanks", () => {
    expect(parseEnv("# a comment\n\nVITE_A=1\n  VITE_B = two  \n#VITE_C=3\n")).toEqual({ VITE_A: "1", VITE_B: "two" });
  });

  it("strips one pair of matching quotes and keeps the rest of the value intact", () => {
    expect(parseEnv(`VITE_A="http://x/api/v1"\nVITE_B='it is'\nVITE_C="mixed'\nVITE_D=a=b=c`)).toEqual({
      VITE_A: "http://x/api/v1", VITE_B: "it is", VITE_C: `"mixed'`, VITE_D: "a=b=c",
    });
  });

  it("drops an inline comment from an unquoted value, but not a # inside a URL fragment", () => {
    expect(parseEnv("VITE_A=/api # same origin\nVITE_B=http://x/#frag")).toEqual({ VITE_A: "/api", VITE_B: "http://x/#frag" });
  });

  it("accepts export, CRLF line endings and empty values", () => {
    expect(parseEnv("export VITE_A=1\r\nVITE_B=\r\n")).toEqual({ VITE_A: "1", VITE_B: "" });
  });

  it("skips lines that are not assignments", () => {
    expect(parseEnv("just words\n=novalue\n1BAD=x\nVITE_OK=1")).toEqual({ VITE_OK: "1" });
  });
});

describe("loadViteEnv", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "vite-env-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  const write = (name, text) => writeFileSync(join(dir, name), text);

  it("returns nothing when there are no env files", () => {
    expect(loadViteEnv("production", dir, {})).toEqual({ values: {}, sources: {} });
  });

  it("layers .env < .env.local < .env.<mode> < .env.<mode>.local < the real environment", () => {
    write(".env", "VITE_A=base\nVITE_B=base\nVITE_C=base\nVITE_D=base\nVITE_E=base");
    write(".env.local", "VITE_B=local\nVITE_C=local\nVITE_D=local\nVITE_E=local");
    write(".env.production", "VITE_C=mode\nVITE_D=mode\nVITE_E=mode");
    write(".env.production.local", "VITE_D=modelocal\nVITE_E=modelocal");
    const { values, sources } = loadViteEnv("production", dir, { VITE_E: "process" });
    expect(values).toEqual({ VITE_A: "base", VITE_B: "local", VITE_C: "mode", VITE_D: "modelocal", VITE_E: "process" });
    expect(sources).toEqual({ VITE_A: ".env", VITE_B: ".env.local", VITE_C: ".env.production", VITE_D: ".env.production.local", VITE_E: "environment" });
  });

  it("treats an empty environment variable as unset, so it cannot wipe out the file's value", () => {
    // What `ARG VITE_API_URL` + `ENV VITE_API_URL=${VITE_API_URL}` gives a Docker build when no --build-arg is passed.
    write(".env.docker", "VITE_API_URL=/api/v1\nVITE_BACKEND_PAGES=true");
    const { values, sources } = loadViteEnv("docker", dir, { VITE_API_URL: "", VITE_BACKEND_PAGES: "" });
    expect(values).toEqual({ VITE_API_URL: "/api/v1", VITE_BACKEND_PAGES: "true" });
    expect(sources.VITE_API_URL).toBe(".env.docker");
  });

  it("still lets a real, non-empty environment variable override the file", () => {
    write(".env.docker", "VITE_API_URL=/api/v1");
    expect(loadViteEnv("docker", dir, { VITE_API_URL: "https://api.example.com/api/v1" }).values.VITE_API_URL).toBe("https://api.example.com/api/v1");
  });

  it("only reads the file of the mode it was asked for", () => {
    write(".env.development", "VITE_A=dev");
    write(".env.production", "VITE_A=prod");
    expect(loadViteEnv("production", dir, {}).values.VITE_A).toBe("prod");
    expect(loadViteEnv("development", dir, {}).values.VITE_A).toBe("dev");
  });

  it("never exposes a variable without the VITE_ prefix, from a file or from the environment", () => {
    write(".env", "SECRET_TOKEN=abc\nDATABASE_URL=postgres://u:p@h/db\nVITE_OK=1");
    const { values } = loadViteEnv("production", dir, { PATH: "/bin", AWS_SECRET_ACCESS_KEY: "x", VITE_FROM_ENV: "2" });
    expect(values).toEqual({ VITE_OK: "1", VITE_FROM_ENV: "2" });
  });
});
