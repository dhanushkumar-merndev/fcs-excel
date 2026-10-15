import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

/** Tolerant .env parser: accepts `KEY=value`, `KEY = value`, quotes, comments, missing trailing newline. */
export function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

export function loadToolEnv(): Record<string, string> {
  return {
    ...parseEnvFile(resolve(ROOT, ".env")),
    ...parseEnvFile(resolve(ROOT, ".env.local")),
    ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
  };
}

/** Upserts keys in an env file without touching other lines. */
export function upsertEnvFile(file: string, values: Record<string, string>) {
  const path = resolve(ROOT, file);
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const pending = new Map(Object.entries(values));
  const next = lines.map((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match && pending.has(match[1])) {
      const value = pending.get(match[1])!;
      pending.delete(match[1]);
      return `${match[1]}=${value}`;
    }
    return line;
  });
  while (next.length && next[next.length - 1] === "") next.pop();
  for (const [key, value] of pending) next.push(`${key}=${value}`);
  writeFileSync(path, next.join("\n") + "\n", { mode: 0o600 });
}

export const repoRoot = ROOT;
