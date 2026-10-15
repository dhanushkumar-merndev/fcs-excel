import { addDays, istParts, istToInstant, todayIST } from "./format";

export type QuickSlot = { key: string; label: string; at: Date };

/** Quick follow-up times in IST: later today (if before 8 PM), tomorrow morning/evening, in 3 days. */
export function quickSlots(now: Date = new Date()): QuickSlot[] {
  const slots: QuickSlot[] = [];
  const today = todayIST(now);
  const p = istParts(now);
  const minutes = p.hour * 60 + p.minute + 120;
  const rounded = Math.ceil(minutes / 30) * 30;
  if (rounded <= 20 * 60) {
    const hh = String(Math.floor(rounded / 60)).padStart(2, "0");
    const mm = String(rounded % 60).padStart(2, "0");
    slots.push({ key: "later", label: "Later today", at: istToInstant(today, `${hh}:${mm}`) });
  }
  const tomorrow = addDays(today, 1);
  slots.push({ key: "tomorrow_am", label: "Tomorrow, 10 AM", at: istToInstant(tomorrow, "10:00") });
  slots.push({ key: "tomorrow_pm", label: "Tomorrow, 6 PM", at: istToInstant(tomorrow, "18:00") });
  slots.push({ key: "in_3_days", label: "In 3 days", at: istToInstant(addDays(today, 3), "10:00") });
  return slots;
}

export function defaultPurpose(outcome: string | null) {
  switch (outcome) {
    case "no_answer":
    case "busy":
    case "switched_off":
      return "Try calling again";
    case "callback_requested":
      return "Call back as requested";
    case "connected":
      return "Follow up on the conversation";
    default:
      return "Follow up";
  }
}
