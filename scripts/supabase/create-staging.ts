/** Creates the staging project (once) and records its ref in .env. */
import { randomBytes } from "node:crypto";
import { upsertEnvFile, loadToolEnv } from "./env";
import { api, listProjects, projectRef, type Project } from "./mgmt";

const NAME = "fcs-crm-staging";
const env = loadToolEnv();

const projects = await listProjects();
const existing = projects.find((p) => p.name === NAME);
if (existing) {
  const ref = existing.ref ?? existing.id;
  console.log(`Staging project already exists: ${ref} (${existing.status})`);
  upsertEnvFile(".env", { SUPABASE_STAGING_PROJECT_REF: ref });
  process.exit(0);
}

const live = projects.find((p) => (p.ref ?? p.id) === projectRef("live"));
if (!live) throw new Error("Live project not found; cannot determine organization.");

const dbPass = env.SUPABASE_STAGING_DB_PASSWORD || randomBytes(24).toString("base64url");
const created = await api<Project>("/v1/projects", {
  method: "POST",
  body: JSON.stringify({
    name: NAME,
    organization_id: live.organization_id,
    organization_slug: live.organization_slug ?? live.organization_id,
    region: "ap-south-1",
    db_pass: dbPass,
  }),
});
const ref = created.ref ?? created.id;
upsertEnvFile(".env", { SUPABASE_STAGING_PROJECT_REF: ref, SUPABASE_STAGING_DB_PASSWORD: dbPass });
console.log(`Created staging project ${ref} (${created.status}). Waiting for it to become healthy…`);

for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  const status = (await listProjects()).find((p) => (p.ref ?? p.id) === ref)?.status;
  console.log(`  status: ${status}`);
  if (status === "ACTIVE_HEALTHY") break;
}
