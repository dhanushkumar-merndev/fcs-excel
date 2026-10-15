import {
  ArrowRightLeft,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  FileSpreadsheet,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  RotateCcw,
  StickyNote,
  Tag,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatCalendarDate, formatDateTime, formatDue, formatINR, timeAgo } from "@/lib/domain/format";
import { callOutcomeLabel, guestRangeLabel, humanizeCode } from "@/lib/domain/labels";
import { stageLabel } from "@/lib/domain/stages";
import type { LeadEventRow } from "@/lib/domain/types";

type Event = LeadEventRow & { actor: { full_name: string } | null };

const FIELD_LABELS: Record<string, string> = {
  customer_name: "Name",
  phone_e164: "Phone",
  phone_raw: "Phone (as entered)",
  occasion_code: "Occasion",
  menu_code: "Menu",
  guest_range: "Guests",
  event_date: "Event date",
  event_address: "Address",
  priority: "Priority",
  quoted_amount_inr: "Quoted amount",
  booking_value_inr: "Booking value",
};

function fieldValue(field: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "empty";
  switch (field) {
    case "occasion_code":
    case "menu_code":
      return humanizeCode(String(value));
    case "guest_range":
      return guestRangeLabel(String(value));
    case "event_date":
      return formatCalendarDate(String(value));
    case "quoted_amount_inr":
    case "booking_value_inr":
      return formatINR(value as number);
    default:
      return String(value);
  }
}

function describe(e: Event): { icon: ReactNode; title: ReactNode; detail?: ReactNode } {
  const p = e.payload as Record<string, unknown>;
  const s = (k: string) => (p[k] === null || p[k] === undefined ? "" : String(p[k]));
  switch (e.event_type) {
    case "lead_created":
      return { icon: <Plus />, title: "Created this lead" };
    case "lead_imported":
      return {
        icon: <FileSpreadsheet />,
        title: (
          <>
            Imported from{" "}
            <Link className="underline underline-offset-2" href={`/imports/${s("batch_id")}`}>
              {s("file_name")}
            </Link>{" "}
            (row {s("row_number")})
          </>
        ),
        detail: Array.isArray(p.kept_as_separate_enquiry_of) && (p.kept_as_separate_enquiry_of as unknown[]).length
          ? "Kept as a separate enquiry after a duplicate-phone warning."
          : undefined,
      };
    case "assigned":
      return {
        icon: <UserPlus />,
        title: s("from_name") ? `Reassigned from ${s("from_name")} to ${s("to_name")}` : `Assigned to ${s("to_name")}`,
        detail: [s("reason"), Number(p.transferred_follow_ups) > 0 ? `${s("transferred_follow_ups")} pending follow-up(s) transferred` : ""]
          .filter(Boolean)
          .join(" · ") || undefined,
      };
    case "unassigned":
      return { icon: <ArrowRightLeft />, title: `Moved to the unassigned queue${s("from_name") ? ` from ${s("from_name")}` : ""}`, detail: s("reason") || undefined };
    case "dial_requested":
      return { icon: <Phone />, title: "Tapped Call", detail: "Dial attempt only — not a logged call." };
    case "call_logged":
      return { icon: <PhoneCall />, title: `Logged call: ${callOutcomeLabel(s("outcome"))}`, detail: s("note") || undefined };
    case "note_added":
      return { icon: <StickyNote />, title: "Added a note", detail: s("excerpt") || undefined };
    case "note_edited":
      return { icon: <Pencil />, title: "Edited a note", detail: s("excerpt") || undefined };
    case "follow_up_created":
      return {
        icon: <CalendarClock />,
        title: `Scheduled a follow-up for ${p.due_at ? formatDue(String(p.due_at)) : "later"}`,
        detail: [s("purpose"), s("assignee_name") ? `Responsible: ${s("assignee_name")}` : ""].filter(Boolean).join(" · "),
      };
    case "follow_up_completed":
      return { icon: <CalendarCheck />, title: `Completed follow-up: ${s("purpose") || "follow-up"}`, detail: s("outcome") || undefined };
    case "follow_up_rescheduled":
      return {
        icon: <CalendarClock />,
        title: `Rescheduled “${s("purpose")}”`,
        detail: `${p.from ? formatDue(String(p.from)) : ""} → ${p.to ? formatDue(String(p.to)) : ""}${s("reason") ? ` · ${s("reason")}` : ""}`,
      };
    case "follow_up_cancelled":
      return { icon: <CalendarX />, title: `Cancelled follow-up: ${s("purpose")}`, detail: s("reason") || undefined };
    case "stage_changed":
      return { icon: <Tag />, title: `Stage: ${stageLabel(s("from"))} → ${stageLabel(s("to"))}`, detail: s("reason") || undefined };
    case "lead_reopened":
      return { icon: <RotateCcw />, title: "Reopened the lead", detail: s("reason") || undefined };
    case "details_updated": {
      const changes = (p.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
      const keys = Object.keys(changes).filter((k) => k !== "phone_raw");
      return {
        icon: <Pencil />,
        title: `Updated ${keys.map((k) => FIELD_LABELS[k] ?? k).join(", ").toLowerCase() || "details"}`,
        detail: (
          <ul className="mt-0.5 space-y-0.5">
            {keys.map((k) => (
              <li key={k}>
                {FIELD_LABELS[k] ?? k}: <span className="line-through opacity-70">{fieldValue(k, changes[k].from)}</span> → {fieldValue(k, changes[k].to)}
              </li>
            ))}
          </ul>
        ),
      };
    }
    default:
      return { icon: <Tag />, title: humanizeCode(e.event_type) };
  }
}

export function Timeline({ events }: { events: Event[] }) {
  if (!events.length) return <p className="py-8 text-center text-sm text-fg-muted">No activity yet.</p>;
  return (
    <ol className="relative">
      {events.map((e, i) => {
        const d = describe(e);
        return (
          <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < events.length - 1 ? <span aria-hidden className="absolute top-8 bottom-0 left-[15px] w-px bg-line" /> : null}
            <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-fg-muted [&_svg]:size-4">
              {d.icon}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-sm text-fg">{d.title}</p>
              {d.detail ? <div className="mt-0.5 text-[13px] break-words whitespace-pre-line text-fg-muted">{d.detail}</div> : null}
              <p className="mt-1 text-xs text-fg-subtle">
                {e.actor?.full_name ?? "System"} · <time dateTime={e.created_at} title={formatDateTime(e.created_at)}>{formatDateTime(e.created_at)}</time>
                <span className="hidden sm:inline"> · {timeAgo(e.created_at)}</span>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
