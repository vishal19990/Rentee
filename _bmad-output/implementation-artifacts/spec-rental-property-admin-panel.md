---
title: 'Rentee — rental property management admin panel'
type: 'feature'
created: '2026-09-29'
status: 'ready-for-dev'
route: 'dispatch'
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
| Lease dates invalid | end date ≤ start date | not saved | field error on end date |
| Rent due | active lease, no payment for a past month past due day | month shown overdue on dashboard and lease page | N/A |
| Partial payment | payment < rent for that month | month shows "partial" with balance | N/A |
| Delete in-use property | property with any lease | not deleted | "Archive instead" message |
| Non-positive amount | payment amount ≤ 0 | not saved | field error |
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
