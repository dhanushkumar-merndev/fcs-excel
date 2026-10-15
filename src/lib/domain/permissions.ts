import type { Role } from "./types";

/**
 * UI-level capability map. It only decides what to show; the database enforces every rule
 * independently (RLS + checked RPCs), so hiding a control is never the security boundary.
 */
export function can(role: Role, capability: Capability, opts: { salespersonExportEnabled?: boolean } = {}) {
  switch (capability) {
    case "import":
    case "assign":
    case "createLead":
    case "viewTeamWorkload":
    case "viewAllLeads":
      return role === "admin" || role === "manager";
    case "export":
      return role === "admin" || role === "manager" || Boolean(opts.salespersonExportEnabled);
    case "manageTeam":
    case "manageSettings":
      return role === "admin";
  }
}

export type Capability =
  | "import"
  | "assign"
  | "createLead"
  | "viewTeamWorkload"
  | "viewAllLeads"
  | "export"
  | "manageTeam"
  | "manageSettings";

export type NavKey = "dashboard" | "leads" | "follow-ups" | "imports" | "reports" | "team" | "settings";

export function navFor(role: Role): NavKey[] {
  const items: NavKey[] = ["dashboard", "leads", "follow-ups"];
  if (can(role, "import")) items.push("imports");
  items.push("reports");
  if (can(role, "viewTeamWorkload")) items.push("team");
  if (can(role, "manageSettings")) items.push("settings");
  return items;
}
