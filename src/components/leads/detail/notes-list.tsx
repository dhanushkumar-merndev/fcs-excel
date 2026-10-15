"use client";

import { Pencil, PhoneCall } from "lucide-react";
import { useState } from "react";
import { getNoteHistory } from "@/actions/leads";
import { Avatar } from "@/components/shell/user-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime, timeAgo } from "@/lib/domain/format";
import { callOutcomeLabel } from "@/lib/domain/labels";
import type { LeadEventRow, NoteRow } from "@/lib/domain/types";
import { useLeadActions } from "../lead-actions";
import { NoteSheet } from "../note-sheet";

type Note = NoteRow & { author: { full_name: string } | null; revisions: { count: number }[] };
type Revision = Awaited<ReturnType<typeof getNoteHistory>>[number];

export function NotesList({
  notes,
  events,
  userId,
  leadId,
  leadName,
}: {
  notes: Note[];
  events: LeadEventRow[];
  userId: string;
  leadId: string;
  leadName: string;
}) {
  const actions = useLeadActions();
  const [editing, setEditing] = useState<Note | null>(null);
  const [historyFor, setHistoryFor] = useState<Note | null>(null);
  const [history, setHistory] = useState<Revision[] | null>(null);

  const outcomeByCall = new Map<string, string>();
  for (const e of events) {
    if (e.event_type === "call_logged" && e.payload?.call_log_id) outcomeByCall.set(String(e.payload.call_log_id), String(e.payload.outcome));
  }

  async function openHistory(note: Note) {
    setHistoryFor(note);
    setHistory(null);
    setHistory(await getNoteHistory(note.id));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => actions.addNote({ id: leadId, customer_name: leadName })}>
          Add note
        </Button>
      </div>
      {notes.length === 0 ? <p className="py-6 text-center text-sm text-fg-muted">No notes yet.</p> : null}
      <ol className="flex flex-col gap-4">
        {notes.map((note) => {
          const revisions = note.revisions?.[0]?.count ?? 0;
          const outcome = note.call_log_id ? outcomeByCall.get(note.call_log_id) : null;
          return (
            <li key={note.id} className="flex gap-3">
              <Avatar name={note.author?.full_name ?? "?"} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                  <span className="font-medium">{note.author?.full_name ?? "Someone"}</span>
                  <time className="text-fg-subtle" dateTime={note.created_at} title={formatDateTime(note.created_at)}>
                    {formatDateTime(note.created_at)}
                  </time>
                  {outcome ? (
                    <Badge tint="blue" className="h-5 px-2 text-[11px]">
                      <PhoneCall className="size-3" /> {callOutcomeLabel(outcome)}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm break-words whitespace-pre-line">{note.body}</p>
                <div className="mt-1 flex items-center gap-3 text-xs text-fg-subtle">
                  {note.edited_at ? (
                    <button type="button" className="underline-offset-2 hover:text-fg hover:underline" onClick={() => openHistory(note)}>
                      Edited {timeAgo(note.edited_at)} · {revisions} earlier version{revisions === 1 ? "" : "s"}
                    </button>
                  ) : null}
                  {note.author_id === userId ? (
                    <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => setEditing(note)}>
                      <Pencil className="size-3" /> Edit
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <NoteSheet
        leadId={leadId}
        leadName={leadName}
        userId={userId}
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        editing={editing ? { id: editing.id, body: editing.body, version: editing.version } : null}
      />

      <Sheet open={Boolean(historyFor)} onOpenChange={(o) => !o && setHistoryFor(null)} title="Note history" description="Earlier versions, newest first.">
        {history === null ? (
          <div className="flex justify-center py-8">
            <Spinner label="Loading history" />
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {historyFor ? (
              <li className="rounded-xl border border-line p-3">
                <p className="text-xs text-fg-subtle">Current version</p>
                <p className="mt-1 text-sm whitespace-pre-line">{historyFor.body}</p>
              </li>
            ) : null}
            {history.map((rev) => (
              <li key={rev.id} className="rounded-xl bg-subtle p-3">
                <p className="text-xs text-fg-subtle">
                  Version {rev.revision} · replaced by {rev.editor?.full_name ?? "someone"} on {formatDateTime(rev.edited_at)}
                </p>
                <p className="mt-1 text-sm whitespace-pre-line">{rev.body}</p>
              </li>
            ))}
          </ol>
        )}
      </Sheet>
    </div>
  );
}
