import { listOrganizations, listProjects } from "./mgmt";

const [orgs, projects] = await Promise.all([listOrganizations(), listProjects()]);
const orgName = new Map(orgs.map((o) => [o.id, o.name]));
for (const o of orgs) orgName.set(o.slug ?? o.id, o.name);

console.log(`Organizations: ${orgs.map((o) => `${o.name} (${o.slug ?? o.id})`).join(", ")}`);
console.table(
  projects.map((p) => ({
    ref: p.ref ?? p.id,
    name: p.name,
    org: orgName.get(p.organization_id) ?? p.organization_slug ?? p.organization_id,
    region: p.region,
    status: p.status,
    created: p.created_at?.slice(0, 10),
  })),
);
