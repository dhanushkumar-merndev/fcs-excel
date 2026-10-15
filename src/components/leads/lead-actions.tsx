"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { WorkloadRow } from "@/lib/domain/types";
import { AssignSheet, type AssignScope } from "./assign-sheet";
import { FollowUpSheet } from "./follow-up-sheet";
import { LogCallSheet, type CallTarget } from "./log-call-sheet";
import { NoteSheet } from "./note-sheet";

type LeadLite = { id: string; customer_name: string };

type Ctx = {
  logCall: (lead: CallTarget, opts?: { prompted?: boolean }) => void;
  addNote: (lead: LeadLite) => void;
  scheduleFollowUp: (lead: LeadLite & { owner_id?: string | null }) => void;
  assign: (scope: AssignScope) => void;
  canAssign: boolean;
};

const LeadActionsContext = createContext<Ctx | null>(null);

export function useLeadActions() {
  const ctx = useContext(LeadActionsContext);
  if (!ctx) throw new Error("useLeadActions must be used inside LeadActionsProvider");
  return ctx;
}

/** Hosts the quick-action sheets once per page; cards and rows open them through context. */
export function LeadActionsProvider({
  userId,
  workload,
  canAssign,
  children,
  onAssigned,
}: {
  userId: string;
  workload?: WorkloadRow[];
  canAssign: boolean;
  children: ReactNode;
  onAssigned?: () => void;
}) {
  const [call, setCall] = useState<{ lead: CallTarget; prompted: boolean } | null>(null);
  const [note, setNote] = useState<LeadLite | null>(null);
  const [followUp, setFollowUp] = useState<(LeadLite & { owner_id?: string | null }) | null>(null);
  const [assignScope, setAssignScope] = useState<AssignScope | null>(null);
  const [open, setOpen] = useState<"call" | "note" | "follow" | "assign" | null>(null);

  const value = useMemo<Ctx>(
    () => ({
      logCall: (lead, opts) => {
        setCall({ lead, prompted: Boolean(opts?.prompted) });
        setOpen("call");
      },
      addNote: (lead) => {
        setNote(lead);
        setOpen("note");
      },
      scheduleFollowUp: (lead) => {
        setFollowUp(lead);
        setOpen("follow");
      },
      assign: (scope) => {
        setAssignScope(scope);
        setOpen("assign");
      },
      canAssign,
    }),
    [canAssign],
  );

  const close = useCallback((next: boolean) => {
    if (!next) setOpen(null);
  }, []);

  const assignees = canAssign ? workload?.filter((w) => w.is_active).map((w) => ({ id: w.id, full_name: w.full_name })) : undefined;

  return (
    <LeadActionsContext value={value}>
      {children}
      {call ? (
        <LogCallSheet lead={call.lead} prompted={call.prompted} userId={userId} open={open === "call"} onOpenChange={close} />
      ) : null}
      {note ? (
        <NoteSheet leadId={note.id} leadName={note.customer_name} userId={userId} open={open === "note"} onOpenChange={close} />
      ) : null}
      {followUp ? (
        <FollowUpSheet
          leadId={followUp.id}
          leadName={followUp.customer_name}
          open={open === "follow"}
          onOpenChange={close}
          assignees={assignees}
        />
      ) : null}
      {assignScope && workload ? (
        <AssignSheet scope={assignScope} workload={workload} open={open === "assign"} onOpenChange={close} onDone={onAssigned} />
      ) : null}
    </LeadActionsContext>
  );
}
