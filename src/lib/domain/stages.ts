export const STAGES = [
  { value: "new", label: "New", tint: "gray" },
  { value: "contact_attempted", label: "Contact Attempted", tint: "orange" },
  { value: "contacted", label: "Contacted", tint: "blue" },
  { value: "qualified", label: "Qualified", tint: "teal" },
  { value: "quote_sent", label: "Quote Sent", tint: "violet" },
  { value: "negotiation", label: "Negotiation", tint: "amber" },
  { value: "booked", label: "Booked", tint: "green" },
  { value: "lost", label: "Lost", tint: "red" },
  { value: "unqualified", label: "Unqualified", tint: "gray" },
] as const;

export type Stage = (typeof STAGES)[number]["value"];
export type Tint = "gray" | "blue" | "teal" | "violet" | "amber" | "orange" | "green" | "red";

export const OPEN_STAGES: Stage[] = ["new", "contact_attempted", "contacted", "qualified", "quote_sent", "negotiation"];
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
