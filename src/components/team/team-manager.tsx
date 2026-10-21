"use client";

import { Copy, Ellipsis, KeyRound, MessageCircle, RefreshCw, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { addStaff, changeRole, deleteStaff, resetStaffPassword, setActive } from "@/actions/team";
import { useRunAction } from "@/components/leads/use-run-action";
import { ChangePasswordSheet } from "@/components/shell/change-password-sheet";
import { PageHeader } from "@/components/shell/page";
import { Avatar } from "@/components/shell/user-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, Input, Select } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { PasswordInput } from "@/components/ui/password-input";
import { Sheet } from "@/components/ui/sheet";
import { InlineAlert } from "@/components/ui/states";
import { generatePassword, MIN_PASSWORD, normalizeUsername, suggestUsername, USERNAME_RULES } from "@/lib/auth/username";
import { formatDate, timeAgo } from "@/lib/domain/format";
import { ROLE_LABELS } from "@/lib/domain/labels";
import type { ProfileRow, Role } from "@/lib/domain/types";

export type Member = ProfileRow & { last_sign_in_at: string | null; open_leads: number; overdue_follow_ups: number };

const ROLE_HELP: Record<Role, string> = {
  admin: "Everything, including team, roles and settings.",
  manager: "All leads, imports, assignment, team reports and exports.",
  salesperson: "Only their assigned leads and personal reports.",
};

const EMPTY_FORM = { fullName: "", username: "", usernameEdited: false, role: "salesperson" as Role, password: "" };

type Credentials = { name: string; username: string; password: string; kind: "new" | "reset" };

/** Plain-text login details to paste into WhatsApp or a message. */
function credentialsText(c: Credentials) {
  return `Hi ${c.name}, your login for our CRM:\n${window.location.origin}\nUsername: ${c.username}\nPassword: ${c.password}`;
}

export function TeamManager({ members, currentUserId }: { members: Member[]; currentUserId: string }) {
  const run = useRunAction();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<Member | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [ownPasswordOpen, setOwnPasswordOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ member: Member; action: "deactivate" | "reactivate" | "delete" } | { member: Member; action: "role"; role: Role } | null>(null);
  const [busy, setBusy] = useState(false);

  function openAdd() {
    setForm({ ...EMPTY_FORM, password: generatePassword() });
    setShowNewPassword(true);
    setAddError(null);
    setAddOpen(true);
  }

  async function add() {
    setAdding(true);
    setAddError(null);
    const result = await run(() => addStaff(form), { quietValidation: true });
    setAdding(false);
    if (result.ok) {
      setAddOpen(false);
      setCredentials({ name: form.fullName.trim(), username: result.data.username, password: form.password, kind: "new" });
      toast.success(`${form.fullName.trim()} added`);
    } else if (result.code === "validation") {
      setAddError(result.message);
    }
  }

  function openReset(member: Member) {
    setResetFor(member);
    setResetPassword(generatePassword());
    setShowResetPassword(true);
    setResetError(null);
  }

  async function reset() {
    if (!resetFor) return;
    setResetting(true);
    setResetError(null);
    const result = await run(() => resetStaffPassword({ userId: resetFor.id, password: resetPassword }), { quietValidation: true });
    setResetting(false);
    if (result.ok) {
      setCredentials({ name: resetFor.full_name, username: result.data.username, password: resetPassword, kind: "reset" });
      setResetFor(null);
      toast.success("Password reset");
    } else if (result.code === "validation") {
      setResetError(result.message);
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(credentialsText(credentials));
      toast.success("Login details copied");
    } catch {
      toast.error("Couldn't copy — select the details and copy them manually.");
    }
  }

  async function confirmAction() {
    if (!confirm) return;
    setBusy(true);
    const requestId = crypto.randomUUID();
    const result =
      confirm.action === "role"
        ? await run(() => changeRole({ requestId, userId: confirm.member.id, role: confirm.role }), { success: "Role updated" })
        : confirm.action === "delete"
          ? await run(() => deleteStaff({ requestId, userId: confirm.member.id }), { success: "Deleted — their history is kept" })
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
        description="Staff sign in with a username and password you set. Roles are enforced by the database on every request."
        actions={
          <Button onClick={openAdd}>
            <UserPlus /> Add member
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
                  {!m.is_active ? <Badge tint="red">Deactivated</Badge> : !m.last_sign_in_at ? <Badge tint="amber">Not signed in yet</Badge> : null}
                </p>
                <p className="truncate text-[13px] text-fg-muted">@{m.username}</p>
                <p className="text-xs text-fg-subtle">
                  {m.last_sign_in_at ? `Last sign-in ${timeAgo(m.last_sign_in_at)}` : `Added ${formatDate(m.invited_at)}`}
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
                  {m.id === currentUserId ? (
                    <MenuItem icon={<KeyRound />} onSelect={() => setOwnPasswordOpen(true)}>
                      Change my password
                    </MenuItem>
                  ) : m.is_active ? (
                    <MenuItem icon={<KeyRound />} onSelect={() => openReset(m)}>
                      Reset password
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
                      <MenuItem tone="danger" icon={<Trash2 />} onSelect={() => setConfirm({ member: m, action: "delete" })}>
                        Delete
                      </MenuItem>
                    </>
                  ) : null}
                </MenuContent>
              </Menu>
            </div>
          </li>
        ))}
      </ul>

      <Sheet
        open={addOpen}
        onOpenChange={(o) => !adding && setAddOpen(o)}
        title="Add a team member"
        description="Create their login. You'll get the username and password to send them — nothing is emailed."
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={adding}>
              Cancel
            </Button>
            <Button onClick={add} loading={adding}>
              Create login
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {addError ? <InlineAlert tone="danger">{addError}</InlineAlert> : null}
          <Field label="Full name" htmlFor="new-name" required>
            <Input
              id="new-name"
              value={form.fullName}
              autoComplete="off"
              onChange={(e) =>
                setForm({
                  ...form,
                  fullName: e.target.value,
                  username: form.usernameEdited ? form.username : suggestUsername(e.target.value),
                })
              }
            />
          </Field>
          <Field label="Username" htmlFor="new-username" required hint={USERNAME_RULES}>
            <Input
              id="new-username"
              value={form.username}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setForm({ ...form, username: normalizeUsername(e.target.value), usernameEdited: true })}
            />
          </Field>
          <Field label="Password" htmlFor="new-password" required hint={`At least ${MIN_PASSWORD} characters. They can change it after signing in.`}>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <PasswordInput
                  id="new-password"
                  autoComplete="new-password"
                  value={form.password}
                  visible={showNewPassword}
                  onVisibleChange={setShowNewPassword}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  setForm({ ...form, password: generatePassword() });
                  setShowNewPassword(true);
                }}
              >
                <RefreshCw /> New
              </Button>
            </div>
          </Field>
          <Field label="Role" htmlFor="new-role" hint={ROLE_HELP[form.role]}>
            <Select id="new-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="salesperson">Salesperson</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(resetFor)}
        onOpenChange={(o) => !resetting && !o && setResetFor(null)}
        size="sm"
        title={`Reset password for ${resetFor?.full_name ?? ""}`}
        description={`Sets a new password for @${resetFor?.username ?? ""}. Their old password stops working.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetFor(null)} disabled={resetting}>
              Cancel
            </Button>
            <Button onClick={reset} loading={resetting}>
              Set password
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {resetError ? <InlineAlert tone="danger">{resetError}</InlineAlert> : null}
          <Field label="New password" htmlFor="reset-password" hint={`At least ${MIN_PASSWORD} characters.`}>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <PasswordInput
                  id="reset-password"
                  autoComplete="new-password"
                  value={resetPassword}
                  visible={showResetPassword}
                  onVisibleChange={setShowResetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  setResetPassword(generatePassword());
                  setShowResetPassword(true);
                }}
              >
                <RefreshCw /> New
              </Button>
            </div>
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(credentials)}
        onOpenChange={(o) => !o && setCredentials(null)}
        size="sm"
        title={credentials?.kind === "reset" ? "New password set" : "Login created"}
        description={`Send these details to ${credentials?.name}. The password is shown only now — if it's lost, reset it here.`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => credentials && window.open(`https://wa.me/?text=${encodeURIComponent(credentialsText(credentials))}`, "_blank", "noopener")}
            >
              <MessageCircle /> WhatsApp
            </Button>
            <Button onClick={() => void copyCredentials()}>
              <Copy /> Copy details
            </Button>
          </>
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl bg-subtle p-4 text-sm">
          <dt className="text-fg-muted">Username</dt>
          <dd className="font-mono break-all select-all">{credentials?.username}</dd>
          <dt className="text-fg-muted">Password</dt>
          <dd className="font-mono break-all select-all">{credentials?.password}</dd>
        </dl>
        <p className="mt-3 text-[13px] text-fg-muted">They can change their password any time from their account menu.</p>
      </Sheet>

      <ChangePasswordSheet open={ownPasswordOpen} onOpenChange={setOwnPasswordOpen} />

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !busy && !o && setConfirm(null)}
        tone={confirm?.action === "deactivate" || confirm?.action === "delete" ? "danger" : "primary"}
        loading={busy}
        onConfirm={confirmAction}
        title={
          confirm?.action === "deactivate"
            ? `Deactivate ${confirm.member.full_name}?`
            : confirm?.action === "delete"
              ? `Delete ${confirm.member.full_name}?`
              : confirm?.action === "reactivate"
                ? `Reactivate ${confirm.member.full_name}?`
                : confirm?.action === "role"
                  ? `Make ${confirm.member.full_name} ${ROLE_LABELS[confirm.role].toLowerCase()}?`
                  : ""
        }
        description={
          confirm?.action === "deactivate"
            ? `They lose access immediately and are signed out. Their ${confirm.member.open_leads} open leads stay assigned to them — reassign them from Leads. Past notes and calls keep their name.`
            : confirm?.action === "delete"
              ? `They're removed from the team and can't sign in. Past calls, notes and lead history keep their name. @${confirm.member.username} becomes free to reuse. This can't be undone.`
              : confirm?.action === "reactivate"
                ? "They can sign in again with their existing password."
                : confirm?.action === "role"
                  ? ROLE_HELP[confirm.role]
                  : undefined
        }
        confirmLabel={
          confirm?.action === "deactivate"
            ? "Deactivate"
            : confirm?.action === "delete"
              ? "Delete"
              : confirm?.action === "reactivate"
                ? "Reactivate"
                : "Change role"
        }
      />
    </>
  );
}
