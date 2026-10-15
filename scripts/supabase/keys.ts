import { api, getApiKeys } from "./mgmt";

export type ProjectKeys = { url: string; publishable: string; secret: string };

/** Publishable + secret keys for a project (new-style keys preferred; legacy anon/service_role as fallback). */
export async function projectKeys(ref: string): Promise<ProjectKeys> {
  let keys = await getApiKeys(ref);
  const find = (type: string, legacyName: string) =>
    keys.find((k) => k.type === type && k.api_key)?.api_key ?? keys.find((k) => k.name === legacyName && k.api_key)?.api_key ?? null;

  if (!keys.some((k) => k.type === "secret")) {
    try {
      await api(`/v1/projects/${ref}/api-keys`, { method: "POST", body: JSON.stringify({ type: "secret", name: "crm_server" }) });
      keys = await getApiKeys(ref);
    } catch {
      // Fall back to the legacy service_role key.
    }
  }
  const publishable = find("publishable", "anon");
  const secret = find("secret", "service_role");
  if (!publishable || !secret) throw new Error(`Couldn't read API keys for ${ref}.`);
  return { url: `https://${ref}.supabase.co`, publishable, secret };
}
