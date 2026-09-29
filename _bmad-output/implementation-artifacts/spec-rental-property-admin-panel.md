---
title: 'Rentee — rental property management admin panel'
type: 'feature'
created: '2026-09-29'
status: 'in-progress'
route: 'dispatch'
baseline_commit: '89fca3c557da4b078d5ffbab3a3d9079c3871f95'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A landlord who rents out several houses has no single place to track the houses, who lives in them, lease terms, rent collected or overdue, and repair issues.

**Approach:** Build a greenfield web app, "Rentee": a login-protected admin panel covering properties, tenants, leases, rent payments, maintenance requests, and a dashboard summarizing occupancy, income, and overdue rent. Polished, modern UI is a primary goal.

**Decisions (human delegated all choices; required Tailwind + MongoDB):**
- Stack: Next.js 15 (App Router, server actions) + TypeScript + Tailwind CSS v4 + MongoDB via Mongoose.
- DB connection from `MONGODB_URI`. Local dev with no MongoDB installed: `npm run dev` also starts a persistent local mongod (mongodb-memory-server, data in `.data/db`) on port 27017.
- Users: admin/landlord accounts only; tenants do not log in. Admins can add other admin accounts.
- Currency: app-wide, configurable via `NEXT_PUBLIC_CURRENCY` (default `INR`), formatted with `Intl.NumberFormat`.
- Property photos: supported; uploaded images stored on local disk under `uploads/` and served through an authenticated route.
- **No leases (human change 2026-09-29):** the landlord rents month-to-month. Replace the "Lease" concept everywhere (UI labels, nav, routes `/leases` → `/rentals`, model name, code identifiers) with a **Rental**: property, tenant, moveInDate, optional moveOutDate, monthlyRent, deposit, dueDay 1–28, status `active`/`moved_out`. No contract end date is entered at creation. Rent accrues monthly from move-in through the current month while active; "Move out" records a moveOutDate (defaults to today, may be a past or future date ≥ moveInDate) and rent stops after that month. A rental with a future moveOutDate stays `active` until that date passes (derived), then counts as moved out. Dashboard "leases ending in 30 days" becomes "moving out in 30 days" (active rentals with moveOutDate within 30 days). Wherever this spec below says "lease", read "rental".
- **WhatsApp rent reminders (human request 2026-09-29):** use WhatsApp click-to-chat links (`https://wa.me/<digits>?text=<urlencoded message>`), opened in a new tab; the admin presses send in WhatsApp. No WhatsApp Business API, no automatic sending. "Remind on WhatsApp" button appears on the dashboard overdue list, the rental detail page, and the tenant detail page, for rentals with an outstanding past-due balance (also allowed for the next upcoming month as a "due soon" reminder). Message built from an admin-editable template (Settings; stored in MongoDB; sensible default) with placeholders `{tenant}`, `{property}`, `{amount}` (formatted outstanding total), `{months}` (e.g. "Jul 2026, Aug 2026"), `{dueDate}` (earliest unpaid due date). Phone normalization: strip non-digits; a 10-digit number gets the default country code from `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` (default `91`); a leading `+`/`00` number is used as-is. Clicking records a reminder log (rental, tenant, timestamp, message) via server action and shows "Last reminded <relative time>" beside the button. Button is disabled with tooltip "Add a phone number" if the tenant has no valid phone.
- **Admin notifications (human request 2026-09-29):** in-app notifications for the admin(s). Types: `rent_overdue` (alert; past due day with balance > 0, one per rental+month), `rent_due_soon` (reminder; N days before due date with balance > 0, N default 3), `move_out_soon` (reminder; active rental with moveOutDate within M days, default 7, one per rental+moveOutDate), `maintenance_pending` (alert; open/in_progress request older than K days, default 7, or priority urgent/high on creation; one per request). Generated idempotently (unique key per type+subject+period) by a sync that runs at most once per 5 minutes when admin pages load or the poll endpoint is hit — no external cron. A notification whose condition is resolved (rent paid, request done, rental moved out) is auto-marked resolved and drops out of the unread count. Read state is shared across admins (single landlord use). UI: bell with unread badge in the admin top bar; dropdown with latest 10 + "View all"; `/notifications` page with filter (All/Unread/Alerts/Reminders), mark read, mark all read; each item links to its rental/property/maintenance page; rent items include the WhatsApp remind button. Browser desktop notifications via the Notification API while any admin tab is open: client polls `/api/notifications` every 60 s and shows a desktop notification for newly created items (permission requested from an explicit "Enable desktop notifications" button, never on page load). Settings section: N, M, K thresholds and a desktop-notifications toggle. No Web Push / service worker, no email/SMS.

## Boundaries & Constraints

**Always:**
- Every page, route handler, and server action except login requires an authenticated session; unauthenticated page requests redirect to `/login`.
- Passwords stored only as bcrypt hashes; session is a signed JWT (jose) in an httpOnly, sameSite=lax cookie.
- Money stored as integer minor units; displayed with the app-wide currency.
- All form input validated server-side (zod) with field-level error messages shown in the form.
- A property can have at most one `active` lease; property occupancy (`vacant`/`occupied`) is derived from active leases, never set manually.
- Properties/tenants with leases cannot be deleted — archive instead.
- Responsive layout usable at 400px width; consistent design system (sidebar, cards, tables, badges, empty states).

**Never:**
- No online payment gateway, email/SMS sending, or accounting export in this build.
- No hard-deleting payment records.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Login OK | valid email + password | session set, redirect `/dashboard` | N/A |
| Login bad | wrong password | stay on `/login` | generic "Invalid email or password" |
| Second active lease | property already has active lease | lease not created | form error "Property already has an active lease" |
| Move-out date invalid | moveOutDate < moveInDate | not saved | field error on move-out date |
| Open-ended rental | active rental, no moveOutDate, moved in 5 months ago | schedule lists 6 months (move-in month through current) | N/A |
| Rent due | active lease, no payment for a past month past due day | month shown overdue on dashboard and lease page | N/A |
| Partial payment | payment < rent for that month | month shows "partial" with balance | N/A |
| Delete in-use property | property with any lease | not deleted | "Archive instead" message |
| Non-positive amount | payment amount ≤ 0 | not saved | field error |
| WhatsApp link | tenant phone "98765 43210", overdue ₹15,000 for Aug 2026 | link `https://wa.me/919876543210?text=...` containing tenant name, property, "₹15,000", "Aug 2026" | N/A |
| WhatsApp intl phone | phone "+1 (415) 555-0100" | digits `14155550100`, no default code added | N/A |
| WhatsApp no phone | tenant phone empty/invalid (<8 digits) | button disabled | tooltip "Add a phone number" |
| Overdue notification | rental dueDay 5, today the 6th, Oct unpaid | one `rent_overdue` notification for that rental+Oct; repeated syncs create no duplicate | N/A |
| Due-soon notification | due in 3 days, unpaid, threshold 3 | one `rent_due_soon` for that rental+month | N/A |
| Resolved by payment | overdue notification exists; full payment recorded | notification marked resolved, unread count decreases | N/A |
| Moving out | active rental, moveOutDate in 5 days, threshold 7 | one `move_out_soon` | N/A |
| Stale maintenance | open request created 8 days ago, threshold 7 | one `maintenance_pending` | N/A |
| Bad upload | non-image or > 5 MB | not saved | field error |

</frozen-after-approval>

## Code Map

Greenfield — `D:/Projects/Rentee` contains only `_bmad`, `_bmad-output`, `.claude` (do not modify). No git repo. Node 20.19, npm 10.8; no local mongod.

- `src/lib/db.ts` -- cached Mongoose connection from `MONGODB_URI`
- `src/models/{User,Property,Tenant,Lease,Payment,Maintenance}.ts` -- Mongoose schemas
- `src/lib/{auth,session,money,rent,validation}.ts` -- bcrypt, JWT session, money format, rent schedule, zod schemas
- `src/middleware.ts` -- redirect unauthenticated requests
- `src/app/login/`, `src/app/(admin)/{dashboard,properties,tenants,leases,payments,maintenance,settings}/` -- pages + server actions
- `src/app/api/uploads/[file]/route.ts` -- authenticated image serving
- `src/components/` -- shell, UI primitives
- `scripts/local-mongo.mjs`, `scripts/seed.ts` -- local DB, seed admin + demo data

## Tasks & Acceptance

**Execution:**
- [ ] scaffold (`package.json`, tsconfig, next config, Tailwind, `.env.example`, `.gitignore`, `scripts/local-mongo.mjs`) -- foundation
- [ ] `src/models/*`, `src/lib/db.ts`, `scripts/seed.ts` -- data layer; Property: name, address, city, type, bedrooms, bathrooms, monthlyRent, photos[], notes, archived; Tenant: name, phone, email, idNumber, notes, archived; Lease: property, tenant, startDate, endDate, monthlyRent, deposit, dueDay 1–28, status active/ended; Payment: lease, forMonth YYYY-MM, amount, paidOn, method, note; Maintenance: property, title, description, priority, status open/in_progress/done, cost
- [ ] auth, session, middleware, login page, logout -- route protection
- [ ] `src/lib/money.ts`, `src/lib/rent.ts` -- money formatting; per-month due/paid/balance/status for a lease
- [ ] admin shell + UI components -- sidebar nav, mobile drawer, cards, tables, badges, forms, empty states
- [ ] properties, tenants, leases, payments, maintenance CRUD pages -- per Intent
- [ ] dashboard -- occupancy, collected this month, overdue total + list, open maintenance, leases ending in 30 days, 6-month income chart
- [ ] settings -- add admin accounts, change own password
- [ ] `src/lib/*.test.ts` -- vitest for rent schedule, money, validation
- [ ] `README.md` -- setup and run

**Acceptance Criteria:**
- Given a fresh checkout, when running `npm install`, `npm run seed`, `npm run dev`, then the app loads at localhost:3000 and the seeded admin can log in.
- Given an active lease starting 3 months ago with 1 payment, when viewing the dashboard, then the unpaid past-due months appear overdue with correct total.
- Given a lease is ended, when viewing its property, then it shows `vacant` and a new lease can be created.
- Given a logged-out user, when visiting any admin URL, then they are redirected to `/login`.

## Implementation Notes

- 2026-09-29: Implemented by subagent (Next.js 15, Tailwind v4, Mongoose). Subagent reported: tsc clean, 39 vitest tests pass, `npm run build` passes, 32/32 scripted form checks. Seed admin `admin@rentee.local` / `rentee123`.
- Added rules where spec was silent: no archiving with an active lease; lease deletable only with no payments; payments must fall within lease months; ending a lease sets end date to today.
- Orchestrator fix: `safeNext` in `src/app/login/actions.ts` now rejects backslashes (`/\evil.com` open redirect).
- 2026-09-29: Lease → month-to-month Rental change implemented (`src/models/Rental.ts`, `/rentals`, `/leases` redirects). Orchestrator verified: `tsc --noEmit` clean, 50/50 vitest pass, no "lease" strings left in `src/`. Subagent: build compiled; 23/23 scripted checks. Move-out dated today takes effect immediately (property vacant). Old lease data not migrated — run `npm run seed -- --reset`.
- 2026-09-29: WhatsApp reminders (`src/lib/whatsapp.ts`, ReminderLog, AppSettings template) and admin notifications (`src/lib/notifications.ts`, `notification-sync.ts`, Notification model, bell, `/notifications`, desktop Notification API polling) implemented. Orchestrator verified: tsc clean, 86/86 vitest pass. Beyond spec: after payment/move-out/rental/maintenance changes the affected subject is re-synced immediately (so payment resolves its alert at once); trunk-0 11-digit phones normalized.
- PENDING: clean production build check (the user's `npm run dev` shares `.next`), then step-04 review.

## Spec Change Log

## Review Triage Log

## Design Notes

Rent status is computed, not stored: for each month from lease start through the current month (capped at end date), due = monthlyRent; paid = sum of payments with that `forMonth`; status = paid if paid ≥ due; else overdue/partial if past the due day, upcoming otherwise. Payments stay the single source of truth.

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: no type errors
- `npm test` -- expected: all vitest tests pass
- `npm run build` -- expected: production build succeeds

**Manual checks:**
- Log in, create property → tenant → lease → payment → maintenance request; dashboard figures update.
