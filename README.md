# FCS CRM

Lead management for an event catering and chef-booking business: import Meta lead-form exports, assign leads, call and follow up, move enquiries through sales stages, and report on performance.

**Stack:** Next.js 16 (App Router, Cache Components) · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Auth, Postgres with Row Level Security, pg_cron, Storage, Realtime) · SheetJS · Vitest · Playwright.

Business defaults: Asia/Kolkata time, dates as `DD MMM YYYY`, INR, India as the default phone country, at most 1,000 rows per import, invite-only staff.

## Setup (development against the staging project)

Requirements: Node 22+, pnpm 11.

1. Install dependencies.
   ```bash
   pnpm install
   ```
2. Create `.env` with the tooling variables. These are used only by the scripts, never by the app.
   ```bash
   ACCESS_TOKEN=sbp_…                         # Supabase personal access token
   SUPABASE_PROJECT_REF=ijletxnxnsepuxemjtlk   # live project
   SUPABASE_STAGING_PROJECT_REF=…               # staging project (demo data and tests)
   ```
3. Prepare staging.
   ```bash
   pnpm db:inspect --target staging     # read-only: what's already in the database
   pnpm db:migrate --target staging     # applies supabase/migrations in order and records them
   pnpm env:pull --target staging       # writes .env.local (URL, publishable key, secret key)
   pnpm auth:config --target staging --site-url http://localhost:3000
   pnpm seed:demo                        # demo staff and leads; refuses to run against live
   ```
4. Start the app with `pnpm dev`, then open http://localhost:3000. Demo sign-ins are in `.env.demo.local`.

## Going live

The live project only ever receives the migrations and real staff. Demo data never touches it.

```bash
pnpm db:inspect --target live                               # check before changing anything
pnpm db:migrate --target live
pnpm auth:config --target live --site-url https://crm.your-domain.com
pnpm env:pull --target live --site-url https://crm.your-domain.com   # writes .env.production.local
pnpm bootstrap:admin --target live --email owner@your-domain.com --name "Owner Name"
pnpm build && pnpm start
```

`bootstrap:admin` prints a one-time link for setting the first admin's password. After that, the admin invites everyone else from **Team**.

If you deploy to a host such as Vercel, set these variables in its dashboard instead of using `.env.production.local`:

| Variable | Where it's used |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser and server. Safe to expose because RLS protects all data. |
| `SUPABASE_SECRET_KEY` | **Server only.** Used for staff invites, bans, and storing original import files. |
| `NEXT_PUBLIC_SITE_URL` | Base URL for invite and reset links |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Recommended when running more than one instance |

Never deploy `ACCESS_TOKEN`. It is an account-level token used only by the scripts in `scripts/`.

## How it works

**Permissions are enforced in Postgres.**
- Every table has RLS enabled, and the `anon` role has no access.
- Signed-in users get `SELECT` only, filtered by role:
  - Admins and managers see all leads.
  - Salespeople see only the leads they own, plus those leads' notes, calls, follow-ups, timeline, and assignment history.
- Every write goes through a `SECURITY DEFINER` function in `supabase/migrations/20261015100200_lead_workflows.sql`. Each one:
  - checks the caller's role and lead access,
  - writes the change and its audit event in one transaction,
  - rejects stale edits (version check),
  - and is idempotent per request ID, so double-clicks and retries are safe.
- Roles live in `profiles` and are managed only by admins. JWT and user metadata are never trusted for roles.
- Deactivated staff lose all access immediately, and their login is also banned.

**Imports** (`src/lib/import/*`, `src/app/api/imports/*`):
1. The browser parses the file for an instant preview. Each step has its own screen: sheet, column mapping, cleaning, duplicates, confirm.
2. On confirm, the server re-parses the uploaded file itself. It repeats the 1,000-row check, re-cleans every row, and re-checks duplicates against the database before staging anything.
3. Rows are processed in chunks of 100. Each row runs in its own sub-transaction, and concurrent processing of the same batch uses `SKIP LOCKED`.
4. Unique source IDs make retries and parallel imports safe: an existing ID is skipped and linked, never duplicated.
5. An interrupted import keeps its progress and can be resumed. Totals always reconcile: created + skipped + invalid + failed = rows.

**Data cleaning rules:**
- IDs stay text. Values rounded by Excel are flagged and never "repaired".
- `p:+91…` phones become E.164, and the original value is kept.
- Dates without a year (`29 October`) need an explicit year choice, or are imported as *Date needs review*.
- Ambiguous dates (`05/10/2025`) and impossible ones (`31 nov`) are flagged.
- `CREATED` becomes stage New. `CRM UPDATE` is kept only as a legacy marker.

**Reminders:** `pg_cron` runs `private.generate_follow_up_reminders()` every minute. It creates due and overdue notifications that persist until read, so they're waiting even if nobody had the app open. Overdue badges are computed live from pending follow-ups.

**Reports and exports** use a single filter function, `public.search_leads`, so report totals, drill-down lists, and exports always agree.
- Acquisition metrics use the original lead creation time. Activity metrics use when the work happened. Import time is reported separately.
- Exports keep phones and IDs as text and write real Excel dates.
- Exports guard against formula injection and label whether they contain selected rows or the full filtered result.

**Calling:** the Call button opens `tel:` and records only a "dial requested" event. A call counts only when someone logs an outcome.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Run the app |
| `pnpm lint` / `pnpm typecheck` | Static checks |
| `pnpm test` | Unit tests plus database tests. The database tests run the real migrations in embedded Postgres (PGlite). No server needed. |
| `pnpm test:e2e` | Playwright at 360 px and 1440 px. Workflow specs need a seeded staging project. |
| `pnpm db:projects` / `db:inspect` / `db:migrate` | Supabase Management API tooling (`--target staging\|live`) |
| `pnpm env:pull` / `auth:config` / `bootstrap:admin` / `seed:demo` | Environment and auth setup, first admin, demo data |
| `pnpm fixtures` | Regenerates the import test files in `tests/fixtures/` |

## Project layout

```
supabase/migrations/   schema, RLS, workflow RPCs, imports, search/reports, reminders
src/app/(app)/         dashboard, leads, follow-ups, imports, reports, team, settings, more
src/app/api/           import pipeline, exports, dial tracking
src/lib/import/        parser, cleaning rules, duplicate detection (shared by browser and server)
src/components/        UI kit, shell, leads, imports, reports, team
tests/unit, tests/db   Vitest (cleaning rules, exports, permissions, workflows, full import pipeline)
tests/e2e              Playwright
```
