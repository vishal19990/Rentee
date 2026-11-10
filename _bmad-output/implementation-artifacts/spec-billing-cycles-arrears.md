---
title: 'Rentee — rent billed in move-in-anniversary cycles, paid at cycle end'
type: 'feature'
created: '2026-11-10'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Rentee assumes rent is paid in advance on a fixed day of each calendar month. The landlord's tenants pay **at the end of each monthly cycle that starts on the move-in date**: moved in 20 Oct → pays on 20 Nov, then 20 Dec, and so on. Today the app marks rent overdue too early and reminds before the period has been lived. (Human answers: due date "depends on from day of rental starts to 30 days"; "if he moved in October 20 he needs to pay on November 20"; applies to **all rentals**.)

**Approach:** Replace calendar-month billing with **anniversary cycles** for every rental and compute each cycle's due date as the cycle end (next anniversary). Keep the existing `forMonth` key (YYYY-MM of the cycle's start) so stored payments, charges, rent changes and WiFi plans stay valid without data migration.

**Decisions:**
- **Cycle k** (k = 0,1,2…): `start = addMonthsClamped(moveIn, k)`, `end = addMonthsClamped(moveIn, k+1) − 1 day`, **due date = `addMonthsClamped(moveIn, k+1)`** (the next anniversary). `addMonthsClamped` keeps the move-in day, clamped to the month's last day (31 Jan → 28/29 Feb → 31 Mar: always computed from the original move-in day, never drifting).
- **Cycle key** = `monthOf(start)` (YYYY-MM). With anniversary cycles each calendar month contains exactly one cycle start, so keys are unique and equal to today's `forMonth` semantics → payments, charges (`Charge.month`), rent changes (`effectiveMonth`), WiFi plans (`fromMonth/toMonth`) keep working unchanged: they apply to the cycle that starts in that month.
- **Amount:** full monthly rent (rent in force for the cycle's key month) + that key month's charges. **Move-out mid-cycle:** the final cycle ends on the move-out date and its rent is **pro-rated by days** (days stayed ÷ days in that cycle, rounded to the nearest rupee), due on the move-out date; charges for that month are not pro-rated. (Delegated decision, stated to the human; easy to switch to full-month.)
- **Status:** a cycle is `upcoming` until its due date, `paid` if paid ≥ due, otherwise `overdue`/`partial` from the day **after** the due date (due date itself is not overdue). Schedule lists cycles whose start ≤ today (the current cycle shows as upcoming with its due date), plus prepaid future cycles as today.
- **`dueDay` field:** no longer used for billing (kept in the DB for history; removed from forms; existing value ignored). Anything that read `dueDay` (rent schedule, notifications "due soon", reminders, pay links, dashboard, MCP tools, receipts, reports, WiFi/charges validations, payment form month picker, seed) must use the cycle due date instead.
- **Labels:** wherever a month label is shown for rent (schedule, receipts, reminders `{months}`, pay page, ledger, collections report, notifications, payment form "for" picker, MCP output), show the cycle period, e.g. "20 Oct – 19 Nov 2026" (short form "20 Oct–19 Nov" where space is tight). `{dueDate}` placeholder = cycle due date.
- **Payment form:** "For period" select lists cycles (label = period, value = key month); default = oldest unpaid due cycle, else the current cycle.
- **Notifications:** `rent_due_soon` N days before the cycle due date; `rent_overdue` from the day after; keys stay per rental+key month.
- **Reports:** collections "month" = cycles whose **due date** falls in that calendar month (so a cycle 20 Oct–19 Nov is collected in November); state this in the report header. Profit/FY by payment date unchanged.
- **All rentals switch** (human: all rentals). No data migration; existing payments remain attached to their key months.

**Always:** pure, unit-tested cycle maths (`src/lib/rent.ts`); money in minor units; existing tests updated to the new semantics with clear expectations; no data loss.

**Never:** fixed calendar due days; charging a full month for a partial final cycle (unless the human later asks); touching the user's real database during development.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Basic | move-in 20 Oct 2026, rent 8,000, today 10 Nov | one cycle 20 Oct–19 Nov, due 20 Nov, upcoming | N/A |
| Due day not overdue | today 20 Nov, unpaid | still upcoming / due today | N/A |
| Overdue | today 21 Nov, unpaid | overdue 8,000 | N/A |
| Paid | 8,000 paid for key 2026-10 | paid | N/A |
| Month-end clamp | move-in 31 Jan 2027 | dues 28 Feb, 31 Mar, 30 Apr, 31 May | N/A |
| Leap year | move-in 31 Jan 2028 | first due 29 Feb 2028 | N/A |
| Rent change | change to 9,000 effective 2027-01 | cycle starting 20 Jan 2027 onward 9,000 | N/A |
| Charges | electricity 1,200 month 2026-11 | added to cycle 20 Nov–19 Dec (due 20 Dec) | N/A |
| Move-out mid-cycle | move-out 5 Dec 2026 (cycle 20 Nov–19 Dec, 30 days) | final cycle 20 Nov–5 Dec = 16 days → 16/30 × 8,000 = 4,267, due 5 Dec | N/A |
| Due soon | N=3, due 20 Nov, today 17 Nov | one `rent_due_soon` | N/A |
| Collections report | November | includes cycle 20 Oct–19 Nov (due 20 Nov) | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/rent.ts` -- core: replace calendar months with cycles (`rentSchedule`, `payableMonths`, due dates, `summarize`, helpers); export cycle helpers (`cycleFor(key)`, `formatCycle`).
- Consumers of `dueDay` / month labels / `rentSchedule`: `src/lib/data.ts`, `src/lib/notifications.ts`, `src/lib/whatsapp.ts`, `src/lib/reminders.ts`, `src/lib/bulk-reminders.ts`, `src/lib/share-links.ts` + `/p/` page, receipts (`src/lib/receipts*.ts`, `receipt-pdf.ts`, receipt views), reports (`src/lib/reports*.ts`, `report-pdf.ts`, `reports-xlsx.ts`), payments form/actions, rental form/pages, dashboard, MCP tools (`src/lib/mcp/tools/*`), WiFi plan logic (if merged), seed.
- Grep for `dueDay`, `formatMonth(`, `forMonth` to find every place.

## Tasks & Acceptance

**Execution:**
- [ ] cycle maths + tests for every matrix row
- [ ] wire through all consumers; remove due-day field from forms; labels
- [ ] reports collections by due date; README

**Acceptance Criteria:**
- Given existing data, when the app loads, then no payment is lost and every rental shows cycles from its move-in day.
- Given the end-to-end MCP script and all unit tests, when run, then they pass with updated expectations.

## Implementation Notes

- Cycle maths in `src/lib/rent.ts`: `addMonthsClamped`, `cycleMonthOn`, `finalCycleMonth`, `cycleFor`, `cycleRent`, `cycleBill`, `formatCycle`/`formatCycleMonth`, `paymentPeriodOptions`. `RentMonth` gained `start`/`end`; `month` stays the key.
- Month-keyed extras seam: `chargesForMonth(rental, keyMonth)` (stored charges + WiFi plan items) is added to the cycle starting in that month by `cycleBill`; never pro-rated.
- Delegated: a move-out exactly on an anniversary ends with the previous cycle (no 1-day cycle). Pro-rating rounds to the nearest major unit.
- Pay links (`payDue`) now ask only for cycles whose due date has arrived, plus cycles up to the link's `through` key (the current, not-yet-due cycle is not demanded).
- Payment form "For period" select: `src/components/payment-period-fields.tsx` (swaps periods when the rental changes on /payments/new).
- Move-out / rental date edits refuse payments or charges after the final cycle key.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: clean
- `npm test` -- expected: all pass
- `NEXT_DIST_DIR=.next-verify npm run build` -- expected: success (then delete `.next-verify`)
- `NEXT_DIST_DIR=.next-verify node scripts/mcp-e2e.mjs` -- expected: all pass
