/**
 * Username sign-in: the migration backfills existing staff and the database enforces the format
 * and uniqueness that the app relies on to resolve a username to exactly one login.
 */
import { describe, expect, it } from "vitest";
import { applyMigrations, createDb, createStaff } from "./pglite";

const USERNAME_MIGRATION = "20261016100000";

describe("username migration", () => {
  it("backfills unique, valid usernames from existing emails", async () => {
    const db = await createDb({ stopBefore: USERNAME_MIGRATION });
    const people = [
      ["00000000-0000-4000-8000-000000000001", "Sakthi Gayathri", "sakthigayathri261@gmail.com"],
      ["00000000-0000-4000-8000-000000000002", "Dhanush", "Dhanush.Kumar+crm@Gmail.com"],
      ["00000000-0000-4000-8000-000000000003", "Al", "al@x.com"],
      ["00000000-0000-4000-8000-000000000004", "Same One", "same@a.com"],
      ["00000000-0000-4000-8000-000000000005", "Same Two", "same@b.com"],
      ["00000000-0000-4000-8000-000000000006", "Dotted", "_.weird@c.com"],
    ];
    for (const [id, name, email] of people) {
      await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
      await db.query(`insert into public.profiles (id, full_name, email, role) values ($1, $2, $3, 'admin')`, [id, name, email]);
    }
    await applyMigrations(db, (name) => name >= USERNAME_MIGRATION);
    const { rows } = await db.query<{ email: string; username: string }>(`select email, username from public.profiles order by created_at, id`);
    expect(Object.fromEntries(rows.map((r) => [r.email, r.username]))).toEqual({
      "sakthigayathri261@gmail.com": "sakthigayathri261",
      "Dhanush.Kumar+crm@Gmail.com": "dhanush.kumarcrm",
      "al@x.com": "al00",
      "same@a.com": "same",
      "same@b.com": "same2",
      "_.weird@c.com": "weird",
    });
    for (const r of rows) expect(r.username).toMatch(/^[a-z0-9][a-z0-9._-]{2,31}$/);
  });
});

describe("username rules", () => {
  it("rejects invalid and duplicate usernames", async () => {
    const db = await createDb();
    await createStaff(db, "00000000-0000-4000-8000-0000000000a1", "admin", "Gayathri");
    const insert = (id: string, username: string) =>
      db
        .query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@fcs-staff.invalid`])
        .then(() =>
          db.query(`insert into public.profiles (id, full_name, email, username, role) values ($1, 'X', $2, $3, 'salesperson')`, [
            id,
            `${id}@fcs-staff.invalid`,
            username,
          ]),
        );
    await expect(insert("00000000-0000-4000-8000-0000000000a2", "gayathri")).rejects.toThrow(/profiles_username_key/);
    await expect(insert("00000000-0000-4000-8000-0000000000a3", "Bad Name")).rejects.toThrow(/profiles_username_format/);
    await expect(insert("00000000-0000-4000-8000-0000000000a4", "ab")).rejects.toThrow(/profiles_username_format/);
    await expect(insert("00000000-0000-4000-8000-0000000000a5", ".dot")).rejects.toThrow(/profiles_username_format/);
    await expect(insert("00000000-0000-4000-8000-0000000000a6", "anil.k_2")).resolves.toBeTruthy();
  });
});
