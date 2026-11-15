import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const DATABASE_NAME = process.env.STUDY_DECK_DB ?? "study-deck";

// Keep in sync with the devDependency pin. If the local install is missing the
// CLI falls back to exactly this version through npx (never "latest").
const WRANGLER_VERSION = "4.162.0";

function runWrangler(args) {
  const localBin = path.join(
    PROJECT_ROOT,
    "node_modules",
    "wrangler",
    "bin",
    "wrangler.js",
  );
  const useLocal = existsSync(localBin);
  const command = useLocal
    ? process.execPath
    : process.platform === "win32"
      ? "npx.cmd"
      : "npx";
  const argv = useLocal
    ? [localBin, ...args]
    : ["--yes", `wrangler@${WRANGLER_VERSION}`, ...args];

  const result = spawnSync(command, argv, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `wrangler ${args.slice(0, 3).join(" ")} failed (exit ${result.status}):\n${message}`,
    );
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function d1Execute(sql, { remote = false } = {}) {
  const args = [
    "d1",
    "execute",
    DATABASE_NAME,
    remote ? "--remote" : "--local",
    "--command",
    sql,
  ];
  return runWrangler(args).stdout;
}

function parseJsonRows(stdout) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end <= start) {
    throw new Error(`could not parse wrangler --json output:\n${stdout}`);
  }
  const parsed = JSON.parse(stdout.slice(start, end + 1));
  const rows = [];
  for (const entry of parsed) {
    if (Array.isArray(entry?.results)) rows.push(...entry.results);
  }
  return rows;
}

export function d1Query(sql, { remote = false } = {}) {
  const args = [
    "d1",
    "execute",
    DATABASE_NAME,
    remote ? "--remote" : "--local",
    "--json",
    "--command",
    sql,
  ];
  return parseJsonRows(runWrangler(args).stdout);
}
