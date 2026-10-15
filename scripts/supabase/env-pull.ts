/**
 * Writes app env vars for a project.
 *   staging → .env.local              (used by `pnpm dev` and tests)
 *   live    → .env.production.local   (used by `pnpm build` / `pnpm start`; or copy into your host's env settings)
 */
import { upsertEnvFile } from "./env";
import { projectKeys } from "./keys";
import { parseTarget, projectRef } from "./mgmt";

const target = parseTarget(process.argv);
const siteIndex = process.argv.indexOf("--site-url");
const siteUrl = siteIndex >= 0 ? process.argv[siteIndex + 1] : target === "staging" ? "http://localhost:3000" : undefined;
const keys = await projectKeys(projectRef(target));
const file = target === "staging" ? ".env.local" : ".env.production.local";
upsertEnvFile(file, {
  NEXT_PUBLIC_SUPABASE_URL: keys.url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: keys.publishable,
  SUPABASE_SECRET_KEY: keys.secret,
  ...(siteUrl ? { NEXT_PUBLIC_SITE_URL: siteUrl } : {}),
});
console.log(`Wrote ${file} for ${target} (${keys.url}). The secret key stays server-side only.`);
