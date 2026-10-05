---
title: 'Rentee — property enquiries (leads) tracking'
type: 'feature'
created: '2026-10-05'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** People enquire about the landlord's properties; some become tenants, some are rejected by the landlord, some decline. Their details and the outcome are not recorded anywhere, so follow-ups are missed and history is lost.

**Approach:** Add an Enquiries module to the existing Next.js 15 + Tailwind v4 + Mongoose app, reusing its patterns (server actions + zod, `requireUser`, UI components, notification sync, WhatsApp helpers). Human delegated all design decisions.

**Decisions:**
- **Enquiry** {name (required), phone (required), email, property (optional; null = "any property"), source walk_in|phone_call|whatsapp|referral|olx|99acres|magicbricks|nobroker|other, budget (minor units, optional), desiredMoveIn (date, optional), occupants (int, optional), occupation, notes, status, outcomeReason, outcomeAt, followUpDate (optional), visitAt (optional datetime), convertedTenant (ref, optional), convertedRental (ref, optional), createdBy, timestamps}.
- **Status flow:** `new` → `contacted` → `visit_scheduled` → `visited` → closed outcome. Closed outcomes: `accepted` (converted), `rejected` (by landlord; reason required: low_budget|references|occupants|pets|timing|other + free text), `declined` (by enquirer; reason required: found_elsewhere|rent_too_high|location|property_condition|other + free text), `no_response`, `property_let` (property already let). Any open status may jump to any other open status or to a closed outcome; closed enquiries can be **reopened** (back to `contacted`). Enquiries are never hard-deleted except by an explicit "Delete" with confirmation for mistaken entries only when status is `new` and there are no activities beyond creation.
- **Activity timeline:** EnquiryActivity {enquiry, kind note|call|whatsapp|visit|status_change|follow_up_set|converted, text, at, by}. Status changes, follow-up changes, visits, and conversion auto-log an activity. Admin can add notes/calls manually. Append-only.
- **Convert to tenant:** on `accepted`, "Convert to tenant" creates a Tenant prefilled (name, phone, email, notes: "From enquiry <date>") — or links an existing tenant if one has the same normalized phone (admin chooses) — then redirects to `/rentals/new?tenant=<id>&property=<id>` with both preselected (rentals/new must accept these query params). The enquiry stores convertedTenant; when a rental is later created for that tenant+property, link convertedRental.
- **Duplicate detection:** phone normalized with existing `normalizePhone`; creating/editing an enquiry whose phone matches other enquiries or an existing tenant shows a non-blocking warning with links to them. Enquiry detail page lists "Previous enquiries from this number".
- **Follow-ups & visits:** notification types `enquiry_follow_up` (reminder; followUpDate ≤ today and enquiry open; one per enquiry+followUpDate) and `enquiry_visit` (reminder; visitAt within next 24 h or today; one per enquiry+visitAt). Resolved when the enquiry closes or the date is changed. Dashboard card "Enquiries": open count, follow-ups due today/overdue (list, max 5), visits today.
- **WhatsApp:** "Message on WhatsApp" button on the enquiry page (wa.me link, editable prefilled text: "Hi {name}, this is regarding your enquiry for {property}."); clicking logs a `whatsapp` activity.
- **Pages:** `/enquiries` list (search name/phone, filters: status group Open/Accepted/Rejected/Declined/All, property, source, follow-up due; default Open; sort newest), stats strip for a chosen period (default this month): total, visits, accepted, rejected, declined, conversion rate = accepted / closed; plus a by-source table (count, accepted, rate). `/enquiries/new`, `/enquiries/[id]` (details, status actions, outcome form, follow-up/visit setters, timeline, add note, convert, WhatsApp), `/enquiries/[id]/edit`. Property page gets an "Enquiries" card (open + recent closed for that property). Nav: "Enquiries" entry.
- **Seed:** demo enquiries across statuses (only when seeding demo data; `--reset` clears the new collections).

**Always:** all pages/actions `requireUser`; zod validation with field errors; responsive at 400px; idempotent notification keys; money in minor units.

**Never:** no public enquiry form or tenant-facing page; no automatic WhatsApp/SMS; do not reset or seed the user's dev database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create enquiry | name + phone "98765 43210", property Palm | saved status `new`, creation activity logged | missing name/phone → field errors |
| Duplicate phone | new enquiry with phone matching an earlier enquiry (different formatting) | saved; warning lists the earlier enquiry | N/A |
| Reject without reason | outcome `rejected`, no reason | not saved | field error on reason |
| Decline with reason | `declined`, found_elsewhere | status closed, outcomeAt set, status_change activity | N/A |
| Reopen | closed `rejected` → reopen | status `contacted`, outcome fields cleared, activity logged | N/A |
| Follow-up due | open enquiry, followUpDate = today | one `enquiry_follow_up` notification; repeat sync no duplicate | N/A |
| Follow-up resolved | enquiry closed | its follow-up notification resolved | N/A |
| Convert | accepted enquiry, no tenant with that phone | Tenant created with name/phone/email; redirect to rentals/new with tenant+property preselected | N/A |
| Convert existing tenant | tenant already has that phone | admin offered "link existing"; no duplicate tenant created | N/A |
| Conversion rate | 10 closed in period: 3 accepted | 30% | 0 closed → "—" |

</frozen-after-approval>

## Code Map

- `src/models/` -- add `Enquiry.ts`, `EnquiryActivity.ts`; follow existing model style (hot-reload-safe pattern used by Rental/Property).
- `src/lib/enquiries.ts` -- pure logic (status transitions, validation helpers, stats, duplicate matching) + `src/lib/enquiries.test.ts`.
- `src/lib/validation.ts` -- zod schemas pattern (`parseForm`, `ActionState`).
- `src/lib/whatsapp.ts` -- `normalizePhone`, `whatsappUrl` reuse.
- `src/lib/notifications.ts`, `src/lib/notification-sync.ts` -- add two types; small insertions only.
- `src/components/shell.tsx` -- nav entry; `src/components/ui.tsx`, `form.tsx` -- UI primitives.
- `src/app/(admin)/rentals/new/page.tsx` -- accept `tenant` & `property` query params for preselection.
- `src/app/(admin)/properties/[id]/page.tsx`, `src/app/(admin)/dashboard/page.tsx` -- one-component insertions (new UI in separate components).
- `scripts/seed.ts`, `README.md`.

## Tasks & Acceptance

**Execution:**
- [ ] models + pure logic + tests for every matrix row
- [ ] actions (create, edit, status/outcome, reopen, note, follow-up, visit, convert, whatsapp log, delete-mistake)
- [ ] pages `/enquiries`, `/enquiries/new`, `/enquiries/[id]`, `/enquiries/[id]/edit`; property card; dashboard card; nav
- [ ] notifications + rentals/new preselect + seed + README

**Acceptance Criteria:**
- Given an existing database, when the app loads, then existing pages are unaffected and `/enquiries` shows an empty state.
- Given a logged-out visitor, when opening any `/enquiries` URL, then they are redirected to `/login`.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx tsc --noEmit` -- expected: clean
- `npm test` -- expected: all pass
- `NEXT_DIST_DIR=.next-verify npm run build` -- expected: success (then delete `.next-verify`)
