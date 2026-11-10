---
title: 'Rentee — optional WiFi charged per person'
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

**Problem:** The landlord is installing WiFi and gives it only to people who want it — charged **per person, not per room**, ₹100 per person per month by default. It's optional per rental and must be tracked and billed monthly.

**Approach:** Add recurring **WiFi plans** to rentals that turn into monthly charge items automatically, using the existing per-month charges model (rent + charges = due) so reminders, overdue alerts, pay links, receipts, ledgers and reports include WiFi without special cases. Human delegated design decisions.

**Decisions:**
- **Model** `WifiPlan` {rental, fromMonth YYYY-MM, toMonth YYYY-MM|null (inclusive; null = ongoing), people: [{ kind "tenant"|"occupant", occupantId? , name (snapshot) }], ratePerPerson (minor units, snapshot at creation), createdAt}. Plans for one rental never overlap in months (validated). Month amount = people.length × ratePerPerson.
- **Settings:** "WiFi price per person" (AppSettings, default ₹100 = 10000 paise, editable). Changing it affects only plans created/changed afterwards.
- **Rent maths:** in the per-month due computation (`src/lib/rent.ts` / `src/lib/charges.ts`), a month covered by a WiFi plan gets a virtual charge item `{ type: "wifi", label: "WiFi (n people)", amount }` alongside stored charges. Months outside the rental's payable range get nothing. Payments apply to the month total as today. Keep it pure and tested.
- **Rental page "WiFi" card:**
  - No plan → "Add WiFi": checkboxes for the tenant and each other occupant (from the tenant's occupants), "From month" (default current month, ≥ move-in month, ≤ move-out month), shows "2 people × ₹100 = ₹200/month" live.
  - Active plan → shows who, rate, monthly amount, since when; actions **Change** (new people set + effective month: ends the current plan the month before and starts a new one; effective month must be after the current plan's fromMonth, else it simply replaces the current plan) and **Stop** (from a month: sets toMonth = month − 1; if that's before fromMonth, delete the plan).
  - History list of past plans (period, people, amount). Remove a plan only if it is the latest (to fix mistakes).
- **Everywhere charges appear** (rent schedule, receipts "Rent + WiFi", WhatsApp `{amount}`, pay link, notifications, tenant ledger screen/Excel/PDF, collections report): WiFi appears as its own line labelled "WiFi". FY summary: WiFi income counted with rent received (payments aren't split), as today for charges.
- **Dashboard card "WiFi"** (only if any active plan): people on WiFi this month, monthly WiFi amount, rentals count.
- **Occupant removal:** if an occupant on a WiFi plan is removed, the plan keeps its name snapshot (billing history unchanged); the card shows a hint to Change the plan.
- **MCP:** `get_rental` includes WiFi in the per-month breakdown automatically via charges; no new write tool.

**Always:** money in minor units; zod validation with field errors; `requireUser`; responsive at 400px; existing rentals without plans unchanged; pure logic unit-tested.

**Never:** charging WiFi per room; changing past months when the price setting changes; touching the user's real database during development.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add WiFi | tenant + 1 occupant ticked, rate ₹100, from Nov 2026 | Nov onward: charge "WiFi (2 people)" ₹200 each month; due = rent + 200 | none ticked → field error "Tick at least one person" |
| Before move-in | from month earlier than move-in month | not saved | field error |
| Change mid-way | plan 2 people since Nov; change to 3 people from Jan 2027 | Nov–Dec ₹200, Jan onward ₹300 | effective ≤ fromMonth → replaces current plan |
| Stop | stop from Feb 2027 | WiFi through Jan 2027, none from Feb | stop month ≤ fromMonth → plan removed |
| Price change | setting ₹100 → ₹150 | existing plans unchanged; new/changed plans use ₹150 | N/A |
| Partial with WiFi | Nov rent 8,000 + WiFi 200, paid 8,000 | Nov partial, balance 200 | N/A |
| Moved out | move-out Mar 2027, plan ongoing | no WiFi after Mar | N/A |
| Overlap guard | two plans covering the same month | rejected | error |

</frozen-after-approval>

## Code Map

- `src/lib/rent.ts`, `src/lib/charges.ts` -- per-month due = rent + charges (+ WiFi virtual items); keep `rentSchedule` pure.
- `src/lib/data.ts` (`loadRentals`) -- load WiFi plans per rental alongside charges.
- `src/models/AppSettings.ts`, `src/lib/settings.ts` -- WiFi price setting; settings page card (separate component).
- `src/models/Tenant.ts` occupants (`src/lib/occupants.ts`, `src/components/occupants-card.tsx`) -- people to tick.
- Receipts (`src/lib/receipts*.ts`, `receipt-pdf.ts`), reports (`src/lib/reports*.ts`), WhatsApp (`src/lib/whatsapp.ts`, `reminders.ts`), notifications, MCP `get_rental` -- verify WiFi shows via the charges path; fix any place that lists charge types explicitly.
- `src/app/(admin)/rentals/[id]/page.tsx` -- WiFi card (new component), small insertion.
- `src/app/(admin)/dashboard/page.tsx` -- WiFi card (new component).

## Tasks & Acceptance

**Execution:**
- [ ] WifiPlan model + pure plan→monthly items logic + tests for every matrix row
- [ ] integrate into schedule/loadRentals; settings price; rental WiFi card with add/change/stop/remove
- [ ] receipts/reports/reminders/ledger labels; dashboard card; README

**Acceptance Criteria:**
- Given an existing rental with no WiFi, when the app loads, then its dues are unchanged.
- Given WiFi for 2 people at ₹100 from this month, when viewing the rental, dashboard overdue list, WhatsApp reminder and receipt, then each shows ₹200 WiFi on top of rent.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: clean
- `npm test` -- expected: all pass
- `NEXT_DIST_DIR=.next-verify npm run build` -- expected: success (then delete `.next-verify`)
