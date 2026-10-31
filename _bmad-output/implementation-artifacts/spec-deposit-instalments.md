---
title: 'Rentee — deposit paid later / in instalments'
type: 'feature'
created: '2026-10-31'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tenants often pay the security deposit later, in parts. Today creating a rental with a deposit records the whole amount as received at move-in, so a part-paid deposit can't be represented or chased.

**Approach:** Separate the **agreed** deposit (Rental.deposit) from what was **received** (DepositEntry `received` entries). Let the admin record how much was paid at move-in (full, partial, or nothing) and add later instalments, see the pending amount everywhere it matters, remind the tenant, and issue a receipt per instalment. Human delegated design decisions.

**Decisions:**
- **Rental fields:** `deposit` stays the agreed amount. New optional `depositPaidAtMoveIn` (minor units, 0 ≤ x ≤ deposit) and `depositDueDate` (date, optional, ≥ move-in). Create form: "Deposit paid at move-in" defaults to the full deposit; admin can lower it or enter 0. The initial `received` entry (source "initial") is created with `depositPaidAtMoveIn` instead of `deposit`, and none when it is 0. **Rentals without `depositPaidAtMoveIn` (all existing data) behave exactly as today** (full deposit at move-in).
- **Pending** = max(deposit − total received, 0). Total received counts all `received` entries (deductions/refunds don't change pending). Pure helper in `src/lib/deposit.ts` (`depositStatus(agreed, entries)` → {agreed, received, pending, held, state: none|pending|paid|over}).
- **Record deposit payment:** Deposit card action (kind `received`, amount defaults to pending, date default today, method cash|upi|bank_transfer|cheque|other, optional note). Validation: amount > 0; amount ≤ pending → else error "Only ₹X of the deposit is pending" (when pending is 0: "The deposit is fully paid"). To accept more, the admin edits the agreed deposit first. Existing deduction/refund rules unchanged (held never negative). Entries stay append-only.
- **Deposit card UI:** Agreed / Received / Pending / Held figures, progress bar, due date (overdue in red when past and pending > 0), instalment list with method and receipt link, "Record deposit payment", "Remind on WhatsApp" (when pending > 0 and tenant phone valid; message: "Hi {tenant}, a friendly reminder that {amount} of your security deposit for {property} is pending{dueClause}. Thank you!" where dueClause = " (due {date})" if set). Logs a ReminderLog with kind `deposit`.
- **Deposit receipts:** every `received` deposit entry gets a receipt number `DEP/<FY>/<seq>` (separate counter `deposit-receipt:<FY>`, assigned on creation; existing entries numbered lazily when first opened). Reuse the receipt page/PDF/share-link infrastructure (`/r/<token>` with a kind discriminator), titled "Security deposit receipt", showing agreed, this instalment, total received, pending. Same privacy rules as rent receipts.
- **Visibility:** rentals list and rental header badge "Deposit pending ₹X"; tenant page shows it; dashboard card "Deposits pending" (count, total, top 5 with links); tenant ledger report (screen, Excel, PDF) deposit section shows agreed / received / pending. FY summary unchanged (deposits are not income).
- **Notification** `deposit_pending` (reminder): active rental, pending > 0, depositDueDate set and ≤ today; one per rental+dueDate; resolved when pending reaches 0 or due date changes or rental moves out. Rentals with no due date get no notification (still shown on dashboard card).
- **Bulk reminders page:** out of scope (rent only).

**Always:** money in minor units; zod validation with field errors; `requireUser` on all admin actions; responsive at 400px; idempotent notification keys; no changes to existing data on deploy (lazy behaviour only).

**Never:** no deletion/edit of deposit entries; deposits never counted as rent income; do not reset or seed the user's database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nothing at move-in | deposit 50,000, paid at move-in 0 | no initial entry; pending 50,000 | N/A |
| Partial at move-in | deposit 50,000, paid 20,000 | initial received 20,000; pending 30,000 | paid > deposit → field error |
| Instalment | pending 30,000, record 10,000 | pending 20,000, receipt DEP/2026-27/0001 | N/A |
| Over-payment | pending 20,000, record 25,000 | not saved | "Only ₹20,000 of the deposit is pending" |
| Fully paid | pending 0, record 1,000 | not saved | "The deposit is fully paid" |
| Legacy rental | existing rental, deposit 40,000, no depositPaidAtMoveIn | received 40,000 at move-in as before; pending 0 | N/A |
| Deduction after partial | received 20,000, deduction 5,000 | held 15,000, pending stays 30,000 | deduction > held → existing error |
| Overdue notification | pending > 0, due date yesterday | one `deposit_pending`; repeat sync no duplicate | N/A |
| Resolved | last instalment clears pending | notification resolved, badge gone | N/A |
| Agreed raised | edit deposit 50,000 → 60,000 with 50,000 received | pending 10,000 | agreed below received → field error "Agreed deposit can't be less than received ₹X" |

</frozen-after-approval>

## Code Map

- `src/lib/deposit.ts` (+ tests in `src/lib/money-features.test.ts` or new `deposit.test.ts`) -- pure status/validation.
- `src/lib/deposit-store.ts` -- `ensureDeposit`/initial entry uses `depositPaidAtMoveIn`; `addDepositEntry` adds pending check for `received`.
- `src/models/Rental.ts`, `src/models/DepositEntry.ts` (add method, receiptNo), `src/models/ReminderLog.ts` (kind).
- `src/app/(admin)/rentals/{actions.ts,ledger-actions.ts,rental-form.tsx,[id]/page.tsx,page.tsx}` -- form fields, card, badge.
- Receipts: `src/lib/receipts*.ts`, `src/lib/receipt-pdf.ts`, `src/lib/signed-links.ts`, `src/app/r/[token]/*`, `src/app/(admin)/payments/[id]/receipt` -- extend with deposit kind.
- `src/lib/notifications.ts`, `src/lib/notification-sync.ts`, `notification-list.tsx` -- new type.
- `src/app/(admin)/dashboard/page.tsx` + new `src/components/deposits-pending-card.tsx`; tenants/[id] page; reports ledger (`src/lib/reports*.ts`, `report-pdf.ts`, `reports-xlsx.ts`).
- README.

## Tasks & Acceptance

**Execution:**
- [ ] pure helpers + tests for every matrix row
- [ ] model fields, create/edit form + validation, initial entry change, instalment action with pending check
- [ ] deposit card UI, WhatsApp deposit reminder, deposit receipts (page, PDF, share link)
- [ ] badges, dashboard card, tenant page, ledger report, notification type, README

**Acceptance Criteria:**
- Given existing rentals in the database, when the app loads after deploy, then their deposit figures are unchanged and nothing shows as pending.
- Given a rental created with ₹0 paid at move-in and a due date in the past, when the dashboard loads, then it appears under "Deposits pending" and a `deposit_pending` notification exists.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: clean
- `npm test` -- expected: all pass
- `NEXT_DIST_DIR=.next-verify npm run build` -- expected: success (then delete `.next-verify`)
