---
title: 'Rentee — deposit advance and part payments'
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

**Problem:** Tenants don't pay the full security deposit up front. They pay an **advance** — some at booking (before move-in) and/or on move-in day — and the **balance later in parts, whenever they can**. Today creating a rental records the whole deposit as received at move-in, so this can't be represented.

**Approach:** Keep `Rental.deposit` as the **agreed** deposit and record every deposit payment as a `received` DepositEntry with its real date. Payments dated on or before the move-in date are labelled **Advance**; later ones **Part payment**. The app displays **Deposit quoted** (total deposit quoted to the customer), **Advance paid**, **Paid later** (towards the deposit) and **Balance**; these exact labels are used on the deposit card, tenant page and ledger report (human: "display total deposit quoted, advance paid, and amount paid later towards deposit"). No schedule, no due dates, no deposit notifications. (Human clarified: "not instalments — consider this as advance, not full deposit"; advance is paid before move-in and also on move-in day.)

**Decisions:**
- **Create rental form:** "Deposit quoted" (existing field, relabelled from "Deposit") + **"Advance received"** (amount, default = agreed deposit for backwards-compatible convenience, may be lower or 0) + **"Advance date"** (default today; may be before the move-in date, never after today). Creates one `received` entry (source "initial") with that amount and date; none when 0. New field `Rental.depositAdvance` records that this rental uses the advance flow. **Rentals without it (all existing data) behave exactly as today.**
- **Deposit card:** shows **Deposit quoted**, **Advance paid** (sum of received entries dated ≤ move-in date), **Paid later** (received entries after move-in), **Balance** = max(agreed − total received, 0), Held (received − deductions − refunds), with a progress bar. Lists every entry with date, label (Advance / Part payment / Deduction / Refund), method, note and receipt link.
- **"Add deposit payment"** on the card: amount (default = balance), date (default today; any date ≥ 60 days before move-in and ≤ today), method cash|upi|bank_transfer|cheque|other, note. Label derived from date (≤ move-in → Advance). Validation: amount > 0 and ≤ balance → else "Only ₹X of the deposit is still due" (balance 0 → "The deposit is fully paid"). To take more, raise the agreed deposit first (edit rental; agreed can't go below total received: "Agreed deposit can't be less than ₹X already received"). Entries remain append-only; deductions/refunds unchanged.
- **Receipts:** each received entry has a "Receipt" (number `DEP/<FY>/<seq>` from its own counter, assigned on creation, lazily for older entries), reusing the rent receipt page/PDF/WhatsApp share link infrastructure with a deposit kind: title "Security deposit receipt", shows Advance/Part payment, this amount, total received, balance. Same privacy rules as rent receipts.
- **Visibility:** "Deposit balance ₹X" badge on the rentals list and rental header when balance > 0; tenant page shows it; dashboard card "Deposit balances" (count, total, up to 5 rentals with links), hidden when none; tenant ledger report (screen/Excel/PDF) deposit section shows agreed, advance, paid later, balance. Deposits never count as rent income.
- **WhatsApp:** "Remind on WhatsApp" on the deposit card when balance > 0: "Hi {tenant}, a gentle reminder that {balance} of the security deposit for {property} is still due. Thank you!" Logged as a ReminderLog (kind `deposit`). No automatic notifications.

**Always:** money in minor units; zod validation with field errors; `requireUser` on admin actions; responsive at 400px; existing data untouched on deploy.

**Never:** no due dates or instalment schedules; no deposit notifications; no editing/deleting deposit entries; do not reset or seed the user's database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Booking advance | agreed 50,000; advance 10,000 dated 10 days before move-in | entry labelled Advance; balance 40,000 | advance > agreed → field error |
| Move-in advance | then add 5,000 dated move-in day | labelled Advance; Advance total 15,000; balance 35,000 | N/A |
| Part payment | add 20,000 dated after move-in | labelled Part payment; Paid later 20,000; balance 15,000 | N/A |
| Too much | balance 15,000; add 20,000 | not saved | "Only ₹15,000 of the deposit is still due" |
| Fully paid | balance 0; add 1,000 | not saved | "The deposit is fully paid" |
| No advance | advance 0 | no entry; balance = agreed | N/A |
| Future date | payment dated tomorrow | not saved | date field error |
| Legacy rental | existing rental, no depositAdvance | full deposit received at move-in as before; balance 0; no badge | N/A |
| Agreed lowered | received 30,000; edit agreed to 25,000 | not saved | "Agreed deposit can't be less than ₹30,000 already received" |
| Deduction | received 30,000, deduction 5,000 | held 25,000; balance unchanged | deduction > held → existing error |

</frozen-after-approval>

## Code Map

- `src/lib/deposit.ts` (+ tests) -- pure status: agreed/advance/paidLater/balance/held, labels, validation.
- `src/lib/deposit-store.ts` -- initial entry from advance amount/date when `depositAdvance` set; balance check for `received`.
- `src/models/Rental.ts` (`depositAdvance`), `src/models/DepositEntry.ts` (method, receiptNo), `src/models/ReminderLog.ts` (kind).
- `src/app/(admin)/rentals/{actions.ts,ledger-actions.ts,rental-form.tsx,[id]/page.tsx,page.tsx}` -- form, card, badge.
- Receipts: `src/lib/receipts*.ts`, `receipt-pdf.ts`, `signed-links.ts`, `src/app/r/[token]/*`, admin receipt page -- add deposit kind.
- Dashboard card (new component), tenants/[id], reports ledger (`reports*.ts`, `report-pdf.ts`, `reports-xlsx.ts`), README.

## Tasks & Acceptance

**Execution:**
- [ ] pure helpers + tests for every matrix row
- [ ] model fields, create/edit form + validation, initial advance entry, add-payment action with balance check
- [ ] deposit card UI, WhatsApp balance reminder, deposit receipts
- [ ] badges, dashboard card, tenant page, ledger report, README

**Acceptance Criteria:**
- Given existing rentals, when the app loads after deploy, then their deposit figures are unchanged and no balance badge appears.
- Given a rental with ₹10,000 advance at booking and ₹5,000 on move-in of a ₹50,000 deposit, when its page is opened, then it shows Advance ₹15,000, Paid later ₹0, Balance ₹35,000.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: clean
- `npm test` -- expected: all pass
- `NEXT_DIST_DIR=.next-verify npm run build` -- expected: success (then delete `.next-verify`)
