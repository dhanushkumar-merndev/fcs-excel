"use client";

import { Copy, Ellipsis, Link2, MessageCircle, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { changeRole, createSignInLink, inviteStaff, setActive } from "@/actions/team";
import { useRunAction } from "@/components/leads/use-run-action";
import { PageHeader } from "@/components/shell/page";
import { Avatar } from "@/components/shell/user-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, Input, Select } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Sheet } from "@/components/ui/sheet";
import { InlineAlert } from "@/components/ui/states";
import { formatDate, timeAgo } from "@/lib/domain/format";
import { ROLE_LABELS } from "@/lib/domain/labels";
import type { ProfileRow, Role } from "@/lib/domain/types";

export type Member = ProfileRow & { last_sign_in_at: string | null; open_leads: number; overdue_follow_ups: number };

const ROLE_HELP: Record<Role, string> = {
  admin: "Everything, including team, roles and settings.",
  manager: "All leads, imports, assignment, team reports and exports.",
  salesperson: "Only their assigned leads and personal reports.",
};

export function TeamManager({ members, currentUserId }: { members: Member[]; currentUserId: string }) {
  const run = useRunAction();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", role: "salesperson" as Role });
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [link, setLink] = useState<{ name: string; url: string; kind: string } | null>(null);
  const [confirm, setConfirm] = useState<{ member: Member; action: "deactivate" | "reactivate" } | { member: Member; action: "role"; role: Role } | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite() {
    setInviting(true);
    setInviteError(null);
    const result = await run(() => inviteStaff(form), { quietValidation: true });
    setInviting(false);
    if (result.ok) {
      setInviteOpen(false);
      setLink({ name: form.fullName, url: result.data.link, kind: "invite" });
      setForm({ fullName: "", email: "", role: "salesperson" });
      toast.success(`${form.fullName} added`);
    } else if (result.code === "validation") {
      setInviteError(result.message);
    }
  }

  async function signInLink(member: Member) {
    const result = await run(() => createSignInLink(member.id));
    if (result.ok) setLink({ name: member.full_name, url: result.data.link, kind: result.data.kind });
  }

  async function confirmAction() {
    if (!confirm) return;
    setBusy(true);
    const requestId = crypto.randomUUID();
    const result =
      confirm.action === "role"
        ? await run(() => changeRole({ requestId, userId: confirm.member.id, role: confirm.role }), { success: "Role updated" })
        : await run(() => setActive({ requestId, userId: confirm.member.id, active: confirm.action === "reactivate" }), {
            success: confirm.action === "reactivate" ? "Reactivated" : "Deactivated — access removed",
          });
    setBusy(false);
    if (result.ok) setConfirm(null);
  }

  const active = members.filter((m) => m.is_active);
  const inactive = members.filter((m) => !m.is_active);

  return (
    <>
      <PageHeader
        title="Team"
        description="Invite-only. Roles are enforced by the database on every request."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus /> Invite
          </Button>
        }
      />

      <ul className="flex flex-col gap-2">
        {[...active, ...inactive].map((m) => (
          <li key={m.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={m.full_name} className="size-10" />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <span className="truncate">{m.full_name}</span>
                  {m.id === currentUserId ? <span className="text-xs font-normal text-fg-subtle">You</span> : null}
                  {!m.is_active ? <Badge tint="red">Deactivated</Badge> : !m.last_sign_in_at ? <Badge tint="amber">Invited — not signed in yet</Badge> : null}
                </p>
                <p className="truncate text-[13px] text-fg-muted">{m.email}</p>
                <p className="text-xs text-fg-subtle">
                  {m.last_sign_in_at ? `Last sign-in ${timeAgo(m.last_sign_in_at)}` : `Invited ${formatDate(m.invited_at)}`}
                  {m.is_active ? ` · ${m.open_leads} open leads · ${m.overdue_follow_ups} overdue` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select
                aria-label={`Role for ${m.full_name}`}
                value={m.role}
                disabled={!m.is_active || m.id === currentUserId}
                onChange={(e) => setConfirm({ member: m, action: "role", role: e.target.value as Role })}
                className="w-40"
              >
                {(["salesperson", "manager", "admin"] as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
              <Menu>
                <MenuTrigger className="flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-hover" aria-label={`Actions for ${m.full_name}`}>
                  <Ellipsis className="size-4" />
                </MenuTrigger>
                <MenuContent>
                  {m.is_active ? (
                    <MenuItem icon={<Link2 />} onSelect={() => void signInLink(m)}>
                      {m.last_sign_in_at ? "Copy password reset link" : "Copy invite link again"}
                    </MenuItem>
                  ) : null}
                  {m.id !== currentUserId ? (
                    <>
                      <MenuSeparator />
                      {m.is_active ? (
                        <MenuItem tone="danger" onSelect={() => setConfirm({ member: m, action: "deactivate" })}>
                          Deactivate
                        </MenuItem>
                      ) : (
                        <MenuItem onSelect={() => setConfirm({ member: m, action: "reactivate" })}>Reactivate</MenuItem>
                      )}
                    </>
                  ) : null}
                </MenuContent>
              </Menu>
            </div>
          </li>
        ))}
      </ul>

      <Sheet
        open={inviteOpen}
        onOpenChange={(o) => !inviting && setInviteOpen(o)}
        title="Invite a team member"
        description="You'll get a one-time sign-in link to send them. They set their own password."
        footer={
          <>
            <Button variant="secondary" onClick={() => setInviteOpen(false)} disabled={inviting}>
              Cancel
            </Button>
            <Button onClick={invite} loading={inviting}>
              Create invite
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {inviteError ? <InlineAlert tone="danger">{inviteError}</InlineAlert> : null}
          <Field label="Full name" htmlFor="inv-name" required>
            <Input id="inv-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Email" htmlFor="inv-email" required>
            <Input id="inv-email" type="email" inputMode="email" autoCapitalize="none" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Role" htmlFor="inv-role" hint={ROLE_HELP[form.role]}>
            <Select id="inv-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="salesperson">Salesperson</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(link)}
        onOpenChange={(o) => !o && setLink(null)}
        title={link?.kind === "reset" ? "Password reset link" : "Invite link"}
        description={`Send this to ${link?.name}. It works once and expires within 24 hours.`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Hi ${link?.name}, here is your link to sign in to our CRM: ${link?.url}`)}`, "_blank", "noopener")}
            >
              <MessageCircle /> WhatsApp
            </Button>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link!.url);
                  toast.success("Link copied");
                } catch {
                  toast.error("Couldn't copy — select the link and copy it manually.");
                }
              }}
            >
              <Copy /> Copy link
            </Button>
          </>
        }
      >
        <p className="rounded-xl bg-subtle p-3 font-mono text-[12px] break-all select-all">{link?.url}</p>
        <p className="mt-3 text-[13px] text-fg-muted">Anyone with this link can set the password for this account, so share it only with them.</p>
      </Sheet>

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !busy && !o && setConfirm(null)}
        tone={confirm?.action === "deactivate" ? "danger" : "primary"}
        loading={busy}
        onConfirm={confirmAction}
        title={
          confirm?.action === "deactivate"
            ? `Deactivate ${confirm.member.full_name}?`
            : confirm?.action === "reactivate"
              ? `Reactivate ${confirm.member.full_name}?`
              : confirm?.action === "role"
                ? `Make ${confirm.member.full_name} ${ROLE_LABELS[confirm.role].toLowerCase()}?`
                : ""
        }
        description={
          confirm?.action === "deactivate"
            ? `They lose access immediately and are signed out. Their ${confirm.member.open_leads} open leads stay assigned to them — reassign them from Leads. Past notes and calls keep their name.`
            : confirm?.action === "reactivate"
              ? "They can sign in again with their existing password."
              : confirm?.action === "role"
                ? ROLE_HELP[confirm.role]
                : undefined
        }
        confirmLabel={confirm?.action === "deactivate" ? "Deactivate" : confirm?.action === "reactivate" ? "Reactivate" : "Change role"}
      />
    </>
  );
}
