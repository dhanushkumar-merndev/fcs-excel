export const STAGES = [
  { value: "new", label: "New", tint: "gray" },
  { value: "contact_attempted", label: "Contact Attempted", tint: "orange" },
  { value: "contacted", label: "Contacted", tint: "blue" },
  { value: "interested", label: "Interested", tint: "blue" },
  { value: "qualified", label: "Qualified", tint: "teal" },
  { value: "quote_sent", label: "Quote Sent", tint: "violet" },
  { value: "negotiation", label: "Negotiation", tint: "amber" },
  { value: "advance_pending", label: "Advance Pending", tint: "amber" },
  { value: "booked", label: "Booked", tint: "green" },
  { value: "lost", label: "Lost", tint: "red" },
  { value: "unqualified", label: "Unqualified", tint: "gray" },
] as const;

export type Stage = (typeof STAGES)[number]["value"];
export type Tint = "gray" | "blue" | "teal" | "violet" | "amber" | "orange" | "green" | "red";

export const OPEN_STAGES: Stage[] = [
  "new",
  "contact_attempted",
  "contacted",
  "interested",
  "qualified",
  "quote_sent",
  "negotiation",
  "advance_pending",
];
export const CLOSED_STAGES: Stage[] = ["booked", "lost", "unqualified"];

const byValue = new Map<string, (typeof STAGES)[number]>(STAGES.map((s) => [s.value, s]));

export function stageLabel(stage: string | null | undefined) {
  return (stage && byValue.get(stage)?.label) || "Unknown";
}

export function stageTint(stage: string | null | undefined): Tint {
  return (stage && byValue.get(stage)?.tint) || "gray";
}

export function isClosedStage(stage: string | null | undefined) {
  return stage === "booked" || stage === "lost" || stage === "unqualified";
}

export function requiresReason(stage: string) {
  return stage === "lost" || stage === "unqualified";
}

export function isStage(value: string): value is Stage {
  return byValue.has(value);
}

/** A sensible stage after logging a call outcome, only ever moving forward from early stages. */
export function suggestedStageAfterCall(current: string, outcome: string): Stage | null {
  const early = current === "new" || current === "contact_attempted";
  if (!early) return null;
  if (outcome === "connected" || outcome === "callback_requested") return "contacted";
  if (current === "new" && ["no_answer", "busy", "switched_off"].includes(outcome)) return "contact_attempted";
  return null;
}

// ---------------------------------------------------------------------------
// BDE desks (lead phases). Mirrors private.phase_* in supabase/migrations/20261105100000_bde_pipeline.sql.
// ---------------------------------------------------------------------------
export const PHASES = [
  { value: "lead_desk", short: "BDE 1", label: "BDE 1 · Lead desk", job: "Calls every new lead" },
  { value: "qualification", short: "BDE 2", label: "BDE 2 · Qualification", job: "Works interested leads" },
  { value: "closing", short: "BDE 3", label: "BDE 3 · Closing", job: "Quotes, follows up, collects the advance" },
  { value: "operations", short: "BDE 4", label: "BDE 4 · Operations", job: "Hands over, assigns the chef, runs the event" },
] as const;

export type Phase = (typeof PHASES)[number]["value"];

const phaseByValue = new Map<string, (typeof PHASES)[number]>(PHASES.map((p) => [p.value, p]));

export function isPhase(value: string): value is Phase {
  return phaseByValue.has(value);
}

export function phaseLabel(phase: string | null | undefined) {
  return (phase && phaseByValue.get(phase)?.label) || "—";
}

export function phaseShort(phase: string | null | undefined) {
  return (phase && phaseByValue.get(phase)?.short) || "—";
}

export function nextPhase(phase: string): Phase | null {
  const i = PHASES.findIndex((p) => p.value === phase);
  return i >= 0 && i < PHASES.length - 1 ? PHASES[i + 1].value : null;
}

/** With the pipeline on, the stages a desk may set (moving desks is a handoff; booked is Confirm booking). */
export function stagesForPhase(phase: string): Stage[] {
  const own: Record<Phase, Stage[]> = {
    lead_desk: ["new", "contact_attempted", "contacted"],
    qualification: ["interested", "contact_attempted", "contacted"],
    closing: ["qualified", "quote_sent", "negotiation", "advance_pending"],
    operations: [],
  };
  return [...(isPhase(phase) ? own[phase] : []), "lost", "unqualified"];
}
