---
title: 'Rentee — tenant portal (invite link + password)'
type: 'feature'
created: '2026-11-10'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Only the landlord can log in. Tenants can't see what they owe, their receipts, agreement or documents, or report problems without messaging the landlord.

**Approach:** Add a separate, mobile-first **tenant portal** at `/portal`. The landlord invites a tenant with a private link (sent on WhatsApp); the tenant sets a password and then logs in with **phone number + password**. Tenants can: see rent by billing cycle and pay by UPI, see payment history and download receipts and deposit status, raise and track maintenance requests (optional photo), view/download their agreement and their documents, and update their phone, email and occupants (human choices). Strict per-tenant data isolation.

**Decisions:**
- **Accounts on `Tenant`:** `portal` subdocument {enabled bool, passwordHash (bcrypt), loginPhone (normalized digits via existing `normalizePhone`, unique among tenants with an account — partial unique index), inviteTokenHash, inviteExpiresAt, sessionVersion (int), lastLoginAt}. No separate users collection; tenants are never `User`s.
- **Invite:** tenant page card "Tenant portal": **Invite** (or **Send new invite**) creates a random token (32 bytes, stored only as SHA-256 hash, expires in 7 days, single use) → link `<APP_URL>/portal/invite/<token>`; buttons **Send on WhatsApp** (prefilled message to the tenant's phone) and **Copy link**. Shows status: Not invited / Invited (expires …) / Active (last login …) / Disabled. **Disable access** (sets enabled=false and bumps sessionVersion = logs out everywhere) and **Enable**. Requires a valid phone on the tenant.
- **Set password page** `/portal/invite/[token]`: shows tenant first name + property; password + confirm (min 8 chars, not all digits, not equal to phone); on success sets passwordHash, loginPhone, clears invite, bumps sessionVersion, signs in. Invalid/expired/used token → friendly page "Ask your landlord for a new link".
- **Login** `/portal/login`: phone + password; Cloudflare Turnstile (reuse `src/lib/turnstile.ts`, same keys) and the existing login throttle (reuse `src/lib/login-throttle.ts` with keys `tenant:<phone>` / ip); generic error "Invalid phone or password"; constant-time path with a dummy hash. "Forgot password?" text: "Ask your landlord to send a new invite link." Logout.
- **Sessions:** separate cookie `rentee_tenant` (httpOnly, sameSite=lax, secure in prod, 30 days), signed JWT (jose, AUTH_SECRET-derived key with a distinct purpose/audience `tenant`) with `sub`=tenantId, `ver`=sessionVersion. Every portal request re-checks the tenant exists, portal.enabled, and sessionVersion matches. **The admin session verifier must reject tenant tokens and vice versa** (different cookie, audience claim; admin `requireUser` already requires a User). Middleware: `/portal/login`, `/portal/invite/*` public; other `/portal/*` require the tenant cookie (redirect to `/portal/login`); a tenant cookie never grants admin pages.
- **Data isolation (critical):** a single `requireTenant()` helper returns `{ tenantId }`; every portal query is filtered by that tenantId (rentals where tenant = me; payments/charges/deposit entries of my rentals; agreements of my rentals; tenant documents of me; maintenance requests I created or on my active rental's property). Portal file routes under `/portal/api/...` verify ownership before streaming (receipt PDFs, deposit receipts, agreement/document files, maintenance photos). Never expose: other tenants, landlord settings, ID numbers of others, admin notes (`Tenant.notes`), expenses, enquiries, notifications, reports.
- **Portal pages (mobile-first, Rentee branding, bottom tab bar on phones):**
  - **Home `/portal`**: greeting, current rental(s): property, rent, current cycle period + due date; amount overdue / due now; **Pay by UPI** (QR + "Pay with UPI app" button using existing UPI pay-link logic, amount = due now) when UPI is configured; deposit status (quoted / paid / balance); WiFi line if any. Moved-out rentals shown read-only in a "Past" section.
  - **Payments `/portal/payments`**: rent schedule by cycle (period, due date, amount, paid, status) and payment list with **Receipt** download; deposit entries with deposit receipts.
  - **Maintenance `/portal/maintenance`**: list of my requests with status; **New request** (title, description, priority low/medium/high, optional photo ≤5 MB, stored like existing photos/bills — encrypted bucket), only for an active rental's property; creates a `Maintenance` record (mark `createdBy: "tenant"`, tenant ref) and an admin notification `maintenance_tenant_request`. Tenant cannot edit after submit except add a comment? (No — keep: view status only.)
  - **Documents `/portal/documents`**: agreement(s) with dates and attached document, and the tenant's documents (title, type, size) → download.
  - **Profile `/portal/profile`**: edit phone (re-normalized; must stay unique; becomes the new login phone; WhatsApp-valid), email, and occupants (same fields/validation as admin occupants incl. last-4 ID only); change password (current + new). Every change is recorded in a `TenantChangeLog` {tenant, field, from, to, at} and creates an admin notification `tenant_details_changed`; the admin tenant page shows "Recent changes by tenant".
- **Admin side:** tenant page "Tenant portal" card (above) and "Recent changes by tenant"; maintenance list shows a "From tenant" badge; landing page/README mention the portal; Settings nothing new.
- **Security extras:** portal routes use the existing security headers; rate limits via `src/lib/rate-limit.ts` on login POST (per IP) and invite POST; all forms server-validated (zod); file uploads magic-byte checked; CSRF via same-origin server actions.

**Always:** every portal data access scoped by the session tenant; tests proving tenant A cannot read tenant B's rental, payment, receipt, document, maintenance, or files (by id guessing); money in minor units; existing admin flows unchanged.

**Never:** tenant sessions reaching admin pages/APIs/MCP; showing other tenants' data; SMS/OTP providers; tenants editing rent, payments, deposits, agreements, or documents; touching the user's real database during development.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Invite | admin clicks Invite for tenant with phone | link created (7 days), WhatsApp prefilled | tenant without valid phone → "Add a phone number first" |
| Accept invite | valid token, password ok | account active, signed in to /portal | weak/mismatched password → field errors |
| Expired/used invite | token older than 7 days or used | friendly error page | N/A |
| Login | correct phone (any format) + password | /portal | wrong → "Invalid phone or password"; 5 failures → 15-min lock |
| Disabled | admin disables access | existing sessions end; login refused | N/A |
| Isolation | tenant A requests B's receipt/document/maintenance id | 404 | N/A |
| Tenant token on admin | rentee_tenant cookie on /dashboard or /api/mcp | redirect to /login / 401 | N/A |
| Pay | overdue ₹8,000 with UPI configured | QR + UPI button for ₹8,000 | UPI not set → hide pay section |
| Maintenance | new request with photo | listed as Open for tenant; admin notification + "From tenant" badge | non-image → field error |
| Profile phone change | new phone used by another account | not saved | field error |
| Profile change log | tenant changes email | change log entry + admin notification | N/A |

</frozen-after-approval>

## Code Map

- Admin auth/session: `src/lib/auth.ts`, `src/lib/session.ts`, `src/middleware.ts` (add portal rules; ensure separation).
- Reuse: `src/lib/login-throttle.ts`, `src/lib/turnstile.ts`, `src/lib/rate-limit.ts`, `src/lib/whatsapp.ts` (`normalizePhone`, wa.me), `src/lib/data.ts` (`loadRentals` with tenant filter), `src/lib/deposit-store.ts` (`loadDeposit`), receipts (`src/lib/receipt-store.ts`, `receipt-pdf.ts`, existing receipt components), UPI pay-link logic (`src/lib/share-links.ts`, `/p/` page components), occupants (`src/lib/occupants.ts`, `src/components/occupants-card.tsx` fields), document/file stores (`document-store.ts`, `file-store.ts`), agreements (`agreement-data.ts`), notifications (`notifications.ts`, `notification-sync.ts`, `notification-list.tsx` labels), maintenance model/pages.
- New: `src/lib/tenant-auth.ts`, `src/lib/portal-*.ts` (pure scoping/validation helpers + tests), `src/models/TenantChangeLog.ts`, `src/app/portal/**`, `src/components/portal/**`, admin `src/components/tenant-portal-card.tsx`.

## Tasks & Acceptance

**Execution:**
- [ ] tenant auth: model fields, invite, set password, login/logout, sessions, middleware separation + tests
- [ ] portal pages: home + pay, payments + receipts, documents, maintenance (+ admin notification), profile (+ change log + admin notification)
- [ ] scoped file routes; isolation tests; admin tenant-portal card + recent changes; README

**Acceptance Criteria:**
- Given two tenants with accounts, when tenant A tries every portal page and file route with tenant B's ids, then nothing of B's is returned.
- Given a tenant cookie, when calling admin pages, admin server actions, `/api/*` admin routes or `/api/mcp`, then access is denied.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: clean
- `npm test` -- expected: all pass
- `NEXT_DIST_DIR=.next-verify npm run build` -- expected: success (then delete `.next-verify`)
- `NEXT_DIST_DIR=.next-verify node scripts/mcp-e2e.mjs` -- expected: all pass
- A portal end-to-end script (new, like `scripts/mcp-e2e.mjs`) covering the matrix incl. isolation -- expected: all pass
