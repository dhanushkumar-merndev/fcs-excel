import { loadToolEnv } from "./env";

const API = "https://api.supabase.com";

export type Target = "live" | "staging";

const env = loadToolEnv();

function token(): string {
  const value = env.SUPABASE_ACCESS_TOKEN || env.ACCESS_TOKEN;
  if (!value) {
    throw new Error("Missing Supabase management token. Set ACCESS_TOKEN (or SUPABASE_ACCESS_TOKEN) in .env.");
  }
  return value;
}

export function projectRef(target: Target): string {
  const ref = target === "live" ? env.SUPABASE_PROJECT_REF : env.SUPABASE_STAGING_PROJECT_REF;
  if (!ref) {
    throw new Error(
      target === "live"
        ? "SUPABASE_PROJECT_REF is not set in .env"
        : "SUPABASE_STAGING_PROJECT_REF is not set in .env",
    );
  }
  return ref;
}

export function parseTarget(argv: string[]): Target {
  const index = argv.indexOf("--target");
  const value = index >= 0 ? argv[index + 1] : "staging";
  if (value !== "live" && value !== "staging") throw new Error(`Invalid --target ${value}`);
  return value;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (response.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${text.slice(0, 2000)}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

export async function query<T = Record<string, unknown>>(ref: string, sql: string, readOnly = false): Promise<T[]> {
  return api<T[]>(`/v1/projects/${ref}/database/query`, {
    method: "POST",
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
}

export type Project = {
  id: string;
  ref?: string;
  name: string;
  organization_id: string;
  organization_slug?: string;
  region: string;
  status: string;
  created_at: string;
};

export const listProjects = () => api<Project[]>("/v1/projects");
export const listOrganizations = () => api<{ id: string; slug?: string; name: string }[]>("/v1/organizations");

export type ApiKey = { name: string; api_key: string | null; type?: string; id?: string };
export const getApiKeys = (ref: string) => api<ApiKey[]>(`/v1/projects/${ref}/api-keys?reveal=true`);
