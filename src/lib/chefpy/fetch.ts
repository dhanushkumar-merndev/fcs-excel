import "server-only";
import { directorySchema, type DirectoryResult } from "./directory";

/**
 * Reads the chef directory from Chefpy. Server only: the token never reaches the browser.
 * Never throws; the page shows a specific message for each failure instead.
 */
export async function fetchChefDirectory(timeoutMs = 8000): Promise<DirectoryResult> {
  const base = process.env.CHEFPY_API_URL?.trim();
  const token = process.env.CHEFPY_INTEGRATION_TOKEN?.trim();
  if (!base || !token) return { ok: false, reason: "unconfigured" };

  let response: Response;
  try {
    response = await fetch(new URL("/api/integrations/chefs", base), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, reason: "unreachable", detail: error instanceof Error ? error.message : undefined };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "unauthorized" };
  if (!response.ok) {
    // Chefpy is up but couldn't serve the list (its database or its own config). Pass its message on.
    const message = await response
      .json()
      .then((b: unknown) => (b && typeof b === "object" && "error" in b && typeof b.error === "string" ? b.error : ""))
      .catch(() => "");
    return {
      ok: false,
      reason: response.status === 503 ? "upstreamUnconfigured" : response.status >= 500 ? "upstream" : "unreachable",
      detail: [`HTTP ${response.status}`, message].filter(Boolean).join(": "),
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "invalid", detail: "Chefpy did not return JSON" };
  }
  const parsed = directorySchema.safeParse(body);
  if (!parsed.success) return { ok: false, reason: "invalid", detail: parsed.error.issues[0]?.message };
  return { ok: true, data: parsed.data };
}
