# Verification results

**Run date:** 15 Oct 2026

**How it was run:** The automated suites run the real Supabase migrations in embedded Postgres 17 (PGlite) with a Supabase auth shim. Each request runs as `authenticated` with a JWT `sub`, the same way PostgREST does. Playwright ran against a production build (`next build && next start`) at 1440×900 and 360×780.

**Summary:**

| Check | Result |
|---|---|
| `pnpm lint` | Clean |
| `pnpm typecheck` | Clean |
| `pnpm build` | Clean. 29 routes; all app pages are partial-prerendered. |
| `pnpm test` | **67 / 67 passed** |
| `pnpm test:e2e` (smoke) | **6 / 6 passed** (desktop and mobile) |

**Live deployment, checked 15 Oct 2026 at https://fcs-crm-sales.vercel.app:**
- All 6 migrations are applied, both cron jobs are active, and public sign-up is disabled.
- An admin signed in at 1440 px and 360 px without browser errors. The dashboard, Leads, Import and Team pages returned 200.
- Signed-out requests redirect to `/login`, and the API returns 401.
- Responses come from `bom1` (Mumbai).

**Pending:** the Playwright workflow specs (`tests/e2e/workflows.spec.ts`) need the hosted staging project and `pnpm seed:demo`. They have not run yet because the staging project doesn't exist yet.

| Completion criterion | Evidence | Status |
|---|---|---|
| Authorized user imports 1,000 valid leads | `tests/db/import-pipeline.test.ts` › *imports 1,000 valid leads* (real `valid-1000.xlsx` through parse → clean → stage → chunked processing) | ✅ |
| 1,001-row file gets a clear limit message | `tests/unit/fixtures.test.ts` and `import-pipeline` › *rejects the 1,001-row file*; the server repeats the check in `POST /api/imports`; the database caps `total_rows` at 1000 | ✅ |
| Re-uploading the same source leads creates no extra records | `import-pipeline` › *re-importing … creates no extra records and links existing ones* (1,000 skipped, 1,000 linked, lead count unchanged) | ✅ |
| Interrupted imports can be retried safely | `import-pipeline` › *an interrupted import resumes safely and totals reconcile* (stopped after 300 rows, resumed, retried after completion) and › *idempotent for a retried submission*; `workflows.test.ts` › *retries safely* (failed rows) | ✅ |
| Duplicate phones produce warnings and links | `tests/unit/import.test.ts` › duplicates; `fixtures.test.ts` › edge cases (repeat customer, possible duplicate event needing a decision, duplicate within file) | ✅ |
| Two genuine events for one customer stay separate | `workflows.test.ts` › *keeps two genuine events*; `import-pipeline` › edge cases (3 leads on one phone) | ✅ |
| Long IDs and phones keep exact values | `import.test.ts` › ids/phone; `import-pipeline` (`l:1234567890123456789`, `p:+919991999189` → `+919991999189` with the original kept); Excel-rounded IDs are flagged, not used for matching | ✅ |
| Yearless dates are surfaced and never silently given a year | `import.test.ts` › dates (`29 October`, `25 nov`, `31 oct` → yearless; explicit choice required); `import-pipeline` › edge cases (`event_date` null, *needs review*, raw text kept) | ✅ |
| Admin/manager can bulk-assign | `workflows.test.ts` › *bulk reassignment moves pending work…*; UI path in `tests/e2e/workflows.spec.ts` (staging) | ✅ DB · ⏳ UI |
| Salesperson can't read or change another salesperson's leads (UI/API) | `workflows.test.ts` › salesperson isolation (table, search, child records, every RPC, direct writes, role escalation, anonymous); `smoke.spec.ts` › API rejects anonymous callers; `workflows.spec.ts` › URL and API attempt (staging) | ✅ DB · ⏳ UI |
| Reassignment transfers pending work and updates access | `workflows.test.ts` › reassignment (pending follow-ups move, completed keep `completed_by`, old owner loses access immediately, history and notification written) | ✅ |
| Notes and history persist after refresh | `workflows.test.ts` › notes, revisions, append-only audit events; `workflows.spec.ts` › reload check (staging) | ✅ DB · ⏳ UI |
| Call taps never fabricate completed calls | `workflows.test.ts` › *dial tap records intent only*; `workflows.spec.ts` › timeline shows "Tapped Call" only (staging) | ✅ DB · ⏳ UI |
| Follow-ups appear in the correct due and overdue views | `workflows.test.ts` › *generates due and overdue reminders once* and `search_leads` follow-up states; the Follow-ups page uses IST day boundaries | ✅ |
| Reports reconcile with the underlying leads | `workflows.test.ts` and `import-pipeline` › report totals equal `search_leads` counts; per-stage sums equal totals; skipped imports excluded | ✅ |
| Exports preserve formatting and honor filters and permissions | `tests/unit/export.test.ts` (text phones and IDs, real date cells in IST, formula guard, CSV BOM); exports run under RLS via `search_leads`; salesperson export is off by default (`workflows.spec.ts`) | ✅ unit · ⏳ UI |
| Core workflows work at mobile and desktop widths | `smoke.spec.ts` at 360 px and 1440 px (no horizontal overflow, theme without flash); `workflows.spec.ts` › mobile bottom nav and sheets (staging) | ✅ smoke · ⏳ full |

## Known limits

- Staff sign in with a username and password. Nothing is emailed. Admins create logins and reset passwords from Team, and share them by copy or WhatsApp. Covered by `tests/db/username.test.ts` (backfill, format, uniqueness) and `tests/unit/username.test.ts`.
- Revenue, ROAS, and cost per lead aren't reported, because ad spend isn't tracked. Recorded booking value is shown with its coverage.
- Original import files are stored in a private bucket, accessible only through the server.
