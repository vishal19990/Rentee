---
title: 'Rentee — landlord features pack (receipts, expenses, deposits, rent changes, utilities, reports, documents, agreements, bulk reminders, UPI)'
type: 'feature'
created: '2026-10-05'
status: 'in-progress'
route: 'dispatch'
baseline_commit: '76431c9787f980c37065cdacef2318b5fa7d648c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-rental-property-admin-panel.md'
  - '{project-root}/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Rentee tracks rent collected but not what the landlord spends, deposits held, rent increases, utility charges, receipts, documents, or agreement expiry; reminders are one-at-a-time and tenants have no easy way to pay.

**Approach:** Add ten features (human chose "do 1–10" and delegated all decisions) to the existing Next.js 15 + Tailwind v4 + Mongoose app, reusing its patterns (server actions + zod, `requireUser`, GridFS photo store, notification sync, WhatsApp helpers, `formatMoney`). Built in three sequential batches: **A** = F2–F5 (money model), **B** = F1, F6, F9, F10 (outputs), **C** = F7, F8 (documents/agreements).

**Features & decisions:**
- **F1 Rent receipts:** a receipt per payment, numbered per Indian FY (`RNT/2026-27/0001`, sequence stored atomically). Shows landlord details (Settings: name, address, phone, optional PAN), tenant, property, month(s), breakdown (rent + charges), amount, method, date, amount in words (Indian system). Downloadable PDF (admin) and a public **signed share link** `/r/<token>` (no login) rendering the receipt with a "Download PDF" button. "Send receipt on WhatsApp" button prefills a message containing the link.
- **F2 Expenses & profit:** Expense {property (optional = general), category (repair, maintenance, property_tax, society, electricity, water, insurance, loan_interest, other), amount, date, vendor, note, optional bill attachment (GridFS)}. `/expenses` list with filters. Maintenance request cost can be logged as an expense (button). `/reports/profit`: per property and total, income (payments received) − expenses, by month for a chosen FY, with a chart.
- **F3 Deposits:** DepositEntry {rental, kind received|deduction|refund, amount, date, reason}. Rental creation with deposit > 0 auto-creates a `received` entry (and migrate existing rentals lazily). Rental page "Deposit" card: received, deductions (with reasons), refunded, held balance; move-out flow offers to record deductions/refund. Held balance can never go negative (validation).
- **F4 Rent changes:** RentChange {rental, effectiveMonth YYYY-MM, monthlyRent, note}. Rent for a month = latest change with effectiveMonth ≤ month, else rental's original rent. "Change rent" action on rental page (effective month ≥ move-in month; default next month); history list. Rental's displayed current rent reflects it. Rent schedule, reminders, notifications, dashboard use per-month rent.
- **F5 Utility & other charges:** Charge {rental, month, type electricity|water|maintenance|other, amount, meter {previous, current, rate} optional, note}. Electricity form: previous reading auto-filled from last reading, units × rate (default rate per property, fallback Settings) = amount, editable. Month due = rent + charges for that month; schedule shows breakdown; payments apply to the month total; overdue/partial/notification/reminder/receipt amounts include charges.
- **F6 Reports & export:** `/reports` hub: monthly collections, tenant ledger (per rental: every month due/paid/balance + deposit entries), yearly FY summary (per property income, expenses, profit; total rent received for ITR). Each downloadable as **Excel (.xlsx via exceljs)**; tenant ledger and FY summary also as PDF.
- **F7 Documents:** TenantDocument {tenant, rental optional, type aadhaar|pan|agreement|police_verification|photo|other, title, file in GridFS bucket `documents`, uploadedAt}. Upload on tenant page (PDF/JPG/PNG/WEBP, ≤10 MB, magic-byte check), list, view/download through authenticated route, delete. Never publicly accessible.
- **F8 Agreement renewal:** Agreement {rental, startDate, endDate (default start + 11 months − 1 day), document optional (links a TenantDocument), status derived active|expiring|expired}. Rental page shows current agreement and history; "Renew" creates the next agreement starting the day after. Notification type `agreement_expiring` when endDate within X days (Settings, default 30) and `agreement_expired` alert after endDate with no newer agreement; dashboard "Agreements expiring" card.
- **F9 Bulk reminders:** `/reminders` page listing every rental with a due (overdue first, then due soon), amount, last reminded, select-all checkboxes; "Start sending" walks the selection one at a time (open WhatsApp link in new tab, log it, advance to next) with progress and skip. Filter: overdue only / due soon / not reminded in 7 days.
- **F10 UPI payments:** Settings: UPI ID (VPA) + payee name. Public signed **pay link** `/p/<token>` (expires 45 days) shows property, month(s), amount due (live from DB), UPI QR code (`upi://pay?pa=&pn=&am=&cu=INR&tn=`), "Pay with UPI app" button, and "Payment is confirmed once the landlord records it". New template placeholder `{payLink}`; default reminder template includes it when UPI ID set. Tenant-side payment is NOT auto-recorded.

**Always:** amounts in integer minor units; all new admin pages/actions use `requireUser`; all forms validated server-side with zod and field errors; responsive at 400px; consistent with existing UI components; idempotent notification keys; public pages (`/r/`, `/p/`) excluded from auth middleware but only reachable with a valid HMAC-signed token (secret derived from `AUTH_SECRET`), reveal only tenant first name, property name, months, amounts, landlord name/UPI — never phone, ID numbers, documents, or other tenants; tampered/expired token → 404 page.

**Never:** no payment gateway, no automatic WhatsApp sending, no tenant login, no hard-delete of payments or deposit entries (corrections are new entries), no breaking change to existing URLs; do not reset or seed the user's dev database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rent change mid-tenancy | rent 10,000 from move-in Jun; change to 11,000 effective Sep | Jun–Aug due 10,000, Sep onward 11,000 | effective month < move-in → field error |
| Electricity charge | prev 1200, curr 1350, rate ₹8 | amount ₹1,200; Oct due = rent + 1,200 | curr < prev → field error |
| Partial with charges | Oct rent 10,000 + charge 1,200, paid 10,000 | Oct partial, balance 1,200, reminder amount 1,200 | N/A |
| Deposit refund too large | held 20,000; refund 25,000 | not saved | "Cannot exceed held deposit ₹20,000" |
| Receipt numbering | first payments of FY 2026-27 | RNT/2026-27/0001, 0002…; concurrent creates never duplicate | N/A |
| Amount in words | 1,25,000 | "Rupees One Lakh Twenty-Five Thousand Only" | N/A |
| Tampered share link | `/r/<token>` with altered payload/signature | 404 | N/A |
| Expired pay link | `/p/<token>` older than 45 days | 404 "This link has expired" | N/A |
| Pay link amount | link made when due was 12,000; tenant paid 5,000 since | page shows 7,000 (live) | fully paid → "Nothing due, thank you" |
| UPI not configured | no UPI ID in settings | `{payLink}` renders empty; pay page/QR not offered | settings hint |
| Agreement expiring | endDate in 20 days, threshold 30 | one `agreement_expiring` notification | N/A |
| Document upload | .exe renamed .pdf, or 12 MB | rejected | field error |
| Profit | property income 1,20,000, expenses 30,000 in FY | profit 90,000 | N/A |
| FY boundary | payment dated 31 Mar 2027 vs 1 Apr 2027 | counted in 2026-27 vs 2027-28 | N/A |

</frozen-after-approval>

## Code Map

Existing app (read README.md first). Key reuse points:
- `src/lib/rent.ts` -- `rentSchedule`/`summarize`: extend to per-month rent (F4) and charges (F5); keep pure + tested.
- `src/lib/data.ts` -- server data loaders; `syncRentalStatuses`.
- `src/lib/notifications.ts`, `src/lib/notification-sync.ts` -- add agreement types (F8); amounts include charges.
- `src/lib/whatsapp.ts`, `src/lib/reminders.ts`, `src/components/whatsapp-button.tsx` -- reuse for F1 share, F9 bulk, F10 `{payLink}`.
- `src/lib/photo-store.ts` -- GridFS pattern to reuse for `documents` and expense bills.
- `src/lib/session.ts` -- secret source for HMAC link signing (new `src/lib/signed-links.ts`).
- `src/middleware.ts` -- add `/r/` and `/p/` public exclusions.
- `src/models/AppSettings.ts` -- add landlord details, UPI, default electricity rate, agreement threshold.
- `src/components/shell.tsx` -- nav: add Expenses, Reports, Reminders.
- `src/app/(admin)/rentals/[id]/page.tsx` -- add Deposit, Rent changes, Charges, Agreement cards.
- `src/app/(admin)/tenants/[id]/page.tsx` -- Documents section.

## Tasks & Acceptance

**Execution (batch A):**
- [x] models RentChange, Charge, DepositEntry, Expense; `src/lib/rent.ts` per-month due = rent(month) + charges(month); update all consumers -- F2–F5
- [x] rental page cards + actions for rent change, charges (electricity calculator), deposit; `/expenses` CRUD; `/reports/profit` -- F2–F5 UI
**Execution (batch B):**
- [ ] `src/lib/signed-links.ts`, receipt numbering counter, amount-in-words, PDF generation (pdf-lib or @react-pdf/renderer), `/r/[token]`, receipt buttons on payments/rental pages -- F1
- [ ] `/reports` hub + xlsx/PDF exports -- F6
- [ ] `/reminders` bulk flow -- F9
- [ ] UPI settings, `/p/[token]` with QR (`qrcode` package), `{payLink}` placeholder -- F10
**Execution (batch C):**
- [ ] documents GridFS store, upload/list/serve/delete on tenant page -- F7
- [ ] Agreement model, rental card, renew, notifications, dashboard card -- F8
**All batches:** unit tests for every matrix row (pure logic in `src/lib/*`), README sections.

**Acceptance Criteria:**
- Given an existing database from before this change, when the app loads, then all existing pages work and existing rentals show their original rent and deposit unchanged.
- Given a payment, when the admin clicks "Send receipt on WhatsApp", then WhatsApp opens with a message containing a `/r/` link that opens the receipt without login.
- Given a logged-out visitor, when opening any admin URL or document URL, then access is denied; only valid `/r/` and `/p/` tokens render.

## Implementation Notes

- 2026-10-05 batch A (F2-F5) implemented by subagent. Verified: tsc clean, 113/113 vitest (new src/lib/money-features.test.ts covers every batch-A matrix row), production build (.next-verify, deleted), 59/61 scripted HTTP checks against next start + an ephemeral in-memory mongod on port 27999 (the 2 misses were test regexes expecting "Sep" where en-IN renders "Sept"; data verified correct). User dev DB untouched.
- Decisions: Rental.monthlyRent stays the original rent (RentalRow.currentRent for display); same effective month replaces a rent change; charges and rent changes are deletable (only payments/deposit entries are append-only); deposit held balance is guarded atomically by a cached Rental.depositHeld counter ($inc with $gte filter), ledger stays the source of truth; legacy rentals get their initial received entry lazily on first view; rentals with manual deposit entries cannot be deleted; properties with expenses cannot be deleted; electricity rate = Property.electricityRate, else Settings.defaultElectricityRate; profit is cash basis (payments by paidOn).
- Extension points for later batches: lib/fy.ts (receipt FY numbering, FY summary), lib/profit.ts, lib/file-store.ts (add a "documents" bucket), validateAttachment (PDF/JPG/PNG/WEBP <=10 MB, magic bytes), /reports currently redirects to /reports/profit (replace with the hub), RentMonth.rent/charges/chargeItems for receipts and ledgers.
- next.config.ts: serverActions bodySizeLimit and middlewareClientMaxBodySize raised to 16mb (needs a dev-server restart).

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: clean
- `npm test` -- expected: all pass
- `NEXT_DIST_DIR=.next-verify npm run build` -- expected: success (then delete `.next-verify`)

**Manual checks:**
- Create rent change, electricity charge, deposit refund, expense; profit report and receipts reflect them.
