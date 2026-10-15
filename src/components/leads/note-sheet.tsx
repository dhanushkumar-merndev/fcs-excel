"use client";

import { useState } from "react";
import { addNote, editNote } from "@/actions/leads";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { InlineAlert } from "@/components/ui/states";
import { usePersistentDraft, useRequestId } from "@/lib/hooks";
import { useRunAction } from "./use-run-action";

export function NoteSheet({
  leadId,
  leadName,
  userId,
  open,
  onOpenChange,
  editing,
}: {
  leadId: string;
  leadName: string;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: { id: string; body: string; version: number } | null;
}) {
  const run = useRunAction();
  const [requestId, rotate] = useRequestId();
  const draftKey = open ? `draft:${userId}:note:${editing ? `edit:${editing.id}` : leadId}` : null;
  const [draft, setDraft, clearDraft] = usePersistentDraft(draftKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = editing && draft === "" ? editing.body : draft;

  async function save() {
    if (!value.trim()) {
      setError("Write a note first.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await run<unknown>(
      async () =>
        editing
          ? await editNote({ requestId, noteId: editing.id, version: editing.version, body: value })
          : await addNote({ requestId, leadId, body: value }),
      { success: editing ? "Note updated" : "Note added", quietValidation: true },
    );
    setSaving(false);
    if (result.ok) {
      clearDraft();
      rotate();
      onOpenChange(false);
    } else if (result.code === "validation") {
      setError(result.message);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title={editing ? "Edit note" : "Add note"}
      description={leadName}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {editing ? "Save changes" : "Save note"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        <Textarea
          autoFocus
          aria-label="Note"
          rows={6}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Customer preferences, budget, venue details…"
          maxLength={5000}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void save();
          }}
        />
        <p className="text-xs text-fg-subtle">
          {editing ? "The previous version is kept in the note's history." : "Drafts are kept on this device until saved."} Ctrl/⌘ + Enter to save.
        </p>
      </div>
    </Sheet>
  );
}
