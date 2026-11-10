# Rentee

A login-protected admin panel for landlords: properties, tenants, month-to-month rentals, rent payments, maintenance requests and a dashboard (occupancy, income, overdue rent) — plus a mobile-first **tenant portal** (`/portal`) where invited tenants see what they owe, pay by UPI, download receipts and documents, and report repairs.

**Stack:** Next.js 15 (App Router, server actions) · TypeScript · Tailwind CSS v4 · MongoDB via Mongoose · zod · jose (JWT sessions) · bcrypt.

## Quick start

Requires Node 20+. You do **not** need MongoDB installed.

```bash
npm install
npm run seed     # creates the admin account + demo data
npm run dev      # http://localhost:3000
```

Sign in with `admin@rentee.local` / `rentee123` (change it under **Settings**).

When `MONGODB_URI` is the default local address (`mongodb://127.0.0.1:27017/rentee`) and nothing is listening on port 27017, `npm run dev` and `npm run seed` start a local `mongod` (mongodb-memory-server). Its data is kept in `.data/db`. The first run downloads a MongoDB binary. If you already run MongoDB, or you point `MONGODB_URI` somewhere else, that server is used instead.

## Configuration

Copy `.env.example` to `.env.local` and adjust:

| Variable | Default | Notes |
|---|---|---|
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/rentee` | MongoDB connection string |
| `AUTH_SECRET` | dev-only fallback | **Required in production.** Signs session JWTs; use 32+ random characters |
| `NEXT_PUBLIC_CURRENCY` | `INR` | ISO 4217 code used app-wide |
| `NEXT_PUBLIC_LOCALE` | `en-IN` | Number/date formatting locale |
| `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` | `91` | Added to 10-digit phone numbers for WhatsApp reminders |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | `admin@rentee.local` / `rentee123` / `Admin` | Account created by `npm run seed` (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` also work). On a non-local database a password **must** be set. |
| `NEXT_DIST_DIR` | `.next` | Build output folder, e.g. to verify a build without touching a running dev server's `.next` |
| `APP_URL` | request host | Public base URL used in shared receipt (`/r/`) and pay (`/p/`) links and for the Claude connector's OAuth/MCP URLs, e.g. `https://rentee.onrender.com`. Required in production if you connect Claude. |
| `FILES_ENCRYPTION_KEY` | — | **Required in production for uploads.** Encrypts tenant documents, tenant photos and expense bills at rest (AES-256-GCM, `src/lib/file-crypto.ts`). 32+ random characters (`openssl rand -base64 32`); same value locally and on Render. Keep a backup — without it encrypted files can't be opened. Encrypt files uploaded before this with `npx tsx scripts/encrypt-files.ts --confirm`. |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | — | Optional. Cloudflare Turnstile "I'm not a robot" check on the login page (Cloudflare → Turnstile → Add widget, hostname = your site). On only when both are set; checked on the server before the password (fails closed if Cloudflare is unreachable). Read at runtime, so changing them needs a restart, not a rebuild. |
| `PDF_FONTS_DIR` | `src/assets/fonts` | Where PDF fonts are read from at runtime (relative to the working directory) |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local mongod (if needed) + Next dev server |
| `npm run seed` | Admin + demo data (skips demo data if properties exist) |
| `npm run seed -- --admin-only` | Only the admin account, no demo data (use for production) |
| `npm run seed -- --reset` | Wipes all Rentee data (enquiries included), then seeds. Refused on a non-local database unless `--force` is added. **Run this once if your `.data/db` was created before leases became rentals**; the old lease data is not migrated. |
| `npm run db` | Runs only the local mongod (Ctrl+C to stop) |
| `npm run build` / `npm start` | Production build / server. `npm start` listens on `0.0.0.0:$PORT` (default 3000) and never starts a local mongod. In production it exits with a clear error if `MONGODB_URI` or `AUTH_SECRET` is missing. |
| `npm test` | Vitest unit tests (rent schedule, rent changes, charges, WiFi plans, deposits (advance and part payments), profit, reports, money, validation, notifications, WhatsApp, receipts, signed links, UPI, enquiries, virtual tours, tenant portal sessions / scoping / middleware separation) |
| `npm run typecheck` | `tsc --noEmit` |

## How it works

- **Auth:** admins sign in at `/login`; tenants sign in separately to the tenant portal (below) and are never admins. Passwords are stored as bcrypt hashes. The session is a signed JWT in an httpOnly, `sameSite=lax` cookie. `src/middleware.ts` redirects signed-out page requests to `/login` (API routes get 401). Every page, route handler and server action also checks the session against the database with `requireUser()`.
- **Tenant portal (`/portal`):** a separate, mobile-first area for tenants (bottom tab bar on phones).
  - **Invite:** the tenant page's **Tenant portal** card → **Invite** creates a private link `<APP_URL>/portal/invite/<token>` (32 random bytes, stored only as a SHA-256 hash, valid 7 days, single use), shown once with **Send on WhatsApp** (prefilled message to the tenant's phone) and **Copy link**. The tenant needs a valid phone ("Add a phone number first"). The card shows Not invited / Invited (expires …) / Active (last login …) / Disabled, **Send new invite** (also the way to reset a forgotten password), **Disable access** (logs the tenant out everywhere) and **Enable**.
  - **Set password** (`/portal/invite/<token>`): shows the tenant's first name and property; password + confirm (at least 8 characters, not only digits, not their phone number). An invalid, expired or used link says "Ask your landlord for a new link".
  - **Sign in** (`/portal/login`): phone number (any format, normalized like WhatsApp numbers) + password, with the same Turnstile check and lockout as the admin login (5 failures per phone or 20 per address → 15 minutes) plus a per-address request limit; the answer is always "Invalid phone or password".
  - **Sessions:** cookie `rentee_tenant` (httpOnly, `sameSite=lax`, secure in production, path `/portal`, 30 days), a JWT signed with its own key derived from `AUTH_SECRET` and audience `rentee:tenant` (`src/lib/tenant-session.ts`). The admin verifier rejects tenant tokens and vice versa; a tenant cookie never opens admin pages, server actions, `/api/*` or `/api/mcp`. Every portal request re-checks the tenant in the database (account enabled, session version current), so **Disable access**, a password change or a new password via invite ends older sessions.
  - **Pages:** **Home** (current rental(s): rent, current period and due date, overdue / due now, **Pay by UPI** QR + "Pay with UPI app" for the amount due now when a UPI ID is set, deposit quoted / paid / balance, WiFi; moved-out rentals under "Past"), **Payments** (rent schedule by cycle, payments with **Receipt** PDFs, deposit entries with deposit receipts), **Repairs** (their requests and status; **New request** with title, details, priority low/medium/high and an optional photo ≤ 5 MB, signature-checked and stored encrypted in GridFS bucket `maintenance`; admins get a `maintenance_tenant_request` notification and the maintenance list shows **From tenant**), **Documents** (agreements with dates and the linked signed copy, and their documents) and **Profile** (phone — also the new login phone, must be unique — email, the people staying with them, password). Each profile change is logged and raises a `tenant_details_changed` notification; the admin tenant page shows **Recent changes by tenant**.
  - **Data isolation:** every portal query is scoped by the session tenant (`src/lib/portal-scope.ts`, `src/lib/portal-data.ts`); files are served through `/portal/api/…` only after an ownership check, so another tenant's id gives 404. Tenants see their own repair requests plus ones the landlord logged for their current home during their stay — never another tenant's. Admin notes, ID numbers, expenses, enquiries, notifications, reports and settings are never shown. Tenants can't change rent, payments, deposits, agreements or documents.
  - **Test it:** after a build, `NEXT_DIST_DIR=.next-verify node scripts/portal-e2e.mjs` (throwaway MongoDB on port 27392, app on 3392) runs invite → set password → login, isolation by id guessing, tenant-cookie-on-admin denial, disable, lockout, UPI, maintenance and profile checks.
- **Money** is stored as integer minor units (paise, cents) and formatted with `Intl.NumberFormat`.
- **Rentals, not leases:** the landlord rents month-to-month. A rental links a tenant to a property with a move-in date, rent and deposit. No end date is entered at creation.
  - **Billing cycles (rent paid at the end of each cycle):** rent is billed in monthly cycles that start on the move-in day, and each cycle's rent is due at its end, on the next anniversary. Moved in 20 Oct → cycle 20 Oct – 19 Nov, due 20 Nov; then 20 Nov – 19 Dec, due 20 Dec, and so on. A move-in on the 29th–31st is clamped to short months but never drifts (31 Jan → due 28 Feb → 31 Mar). A cycle is identified by the month it starts in (YYYY-MM): payments ("For period"), charges, rent changes and WiFi plans for a month apply to the cycle that starts in that month, so existing data needs no migration. The old "due day" field is no longer used or edited. Labels show the period, e.g. "20 Oct – 19 Nov 2026".
  - **Move out** records a move-out date (defaults to today; may be past or future, but not before move-in). The final cycle ends on the move-out date and its rent is pro-rated by days (days stayed ÷ days in that cycle, to the nearest rupee), due on the move-out date; that month's charges are not pro-rated. A move-out exactly on an anniversary simply ends with the previous cycle.
  - A future move-out date keeps the rental `active` ("Moving out") until that day. On the move-out date it counts as moved out, and the stored status is synced automatically.
  - The dashboard lists rentals **moving out in the next 30 days**. Old `/leases` URLs redirect to `/rentals`.
- **Occupancy** is never stored. A property is `occupied` when it has an `active` rental. A partial unique index enforces at most one active rental per property.
- **Rent status** is computed, not stored (`src/lib/rent.ts`). For each billing cycle that has started (plus prepaid future cycles), through the final cycle if a move-out is recorded:
  - `due` is the cycle's rent plus its key month's charges (see below), and `paid` is the sum of payments for that cycle.
  - The cycle is **paid** once paid ≥ due.
  - Otherwise it is **upcoming** until its due date (the due date itself is not overdue) and **overdue** (nothing paid) or **partial** (something paid) from the day after.
  - Payments are append-only: the app has no way to delete them.
- **Deletion:** properties and tenants that have ever had a rental cannot be deleted; archive them instead. A rental with payments cannot be deleted; record a move-out instead. Once the move-out date arrives the property is vacant, so a new rental can be created.
- **Payments** are recorded for a billing cycle ("For period", defaulting to the oldest unpaid cycle that is due, else the current one), from the move-in cycle through the final cycle. While a rental is open-ended, rent can be prepaid up to 12 months ahead.
- **WhatsApp rent reminders:** these use click-to-chat links (`https://wa.me/<digits>?text=<message>`) that open in a new tab. You press send in WhatsApp. There is no WhatsApp Business API and nothing is sent automatically.
  - **Where:** a "Remind on WhatsApp" button appears on the dashboard overdue list, the rental page and the tenant page.
  - **Bulk:** `/reminders` (nav **Reminders**, or **Send reminders** on the dashboard's overdue card) lists every rental with something due: overdue first (oldest due date, then largest amount), then rent due within 7 days. It shows the amount, months and when each tenant was last reminded, with filters (Overdue only / Due soon / Not reminded in 7 days) and select-all. Rows for tenants without a valid phone are disabled. **Start sending** opens the first selected reminder in WhatsApp and logs it, then shows the next one with **Send next** and **Skip** and a "3 of 8" progress count. Each click opens one WhatsApp tab; nothing is sent automatically.
  - **What it covers:** all past-due unpaid cycles and their total. With nothing overdue, an active rental gets a "due soon" reminder for the next unpaid cycle (due at its end). `{months}` lists the periods and `{dueDate}` is the cycle's due date.
  - **Message:** comes from a template you can edit under **Settings → WhatsApp reminders** (stored in MongoDB, with a built-in default). Placeholders are `{tenant}`, `{property}`, `{amount}`, `{months}` and `{dueDate}`.
  - **Phone numbers:** non-digits are stripped.
    - A number starting with `+` or `00` is used as-is.
    - A 10-digit number gets `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE`.
    - An 11-digit number starting with `0` drops the `0` and gets that code.
    - Fewer than 8 digits disables the button, with the tooltip "Add a phone number".
  - **Log:** clicking records a reminder (rental, tenant, time, message) and shows "Last reminded …". The log shows the reminder was opened, not that it was delivered.
- **Admin notifications:** these are in-app alerts and reminders, shared by all admins; marking one read marks it read for everyone.
  - **Types:**
    - `rent_overdue` (alert): one per rental and billing cycle with a balance, from the day after the cycle's due date.
    - `rent_due_soon` (reminder): N days before a cycle's due date with a balance. Default N is 3.
    - `move_out_soon` (reminder): an active rental's move-out within M days. Default M is 7.
    - `maintenance_pending` (alert): an open or in-progress request older than K days (default 7), or urgent/high priority from creation.
    - `enquiry_follow_up` (reminder): an open enquiry whose follow-up date is today or past. `enquiry_visit` (reminder): an open enquiry's visit is today or within the next 24 hours. Both resolve when the enquiry closes, is marked visited (visit only) or the date changes.
  - **How they're generated:** a sync compares current data with stored notifications. Each notification has a unique key per type, subject and period, so repeat runs never duplicate.
    - The full sync runs at most once every 5 minutes, when an admin page loads or the bell polls. There is no cron job.
    - After you record a payment, move-out, rental change or repair change, just the affected items are re-checked immediately. So a payment clears its overdue alert right away.
    - When a condition clears (rent paid, request done, tenant moved out), the notification is marked resolved and drops out of the unread count. If the condition returns, the notification reopens.
  - **Where you see them:**
    - The bell in the top bar shows the unread count and the latest 10 open items.
    - `/notifications` has All/Unread/Alerts/Reminders filters, "Mark read" and "Mark all read".
    - Rent items include the WhatsApp remind button.
  - **Desktop notifications:** open tabs poll `/api/notifications` (login required) every 60 s and show a browser notification for new items. Rentee asks the browser for permission only when you click **Enable desktop notifications**, never on page load. There is no Web Push or service worker, so nothing arrives when no Rentee tab is open.
  - **Settings → Notifications:** set N, M and K, and turn desktop notifications on or off.
- **Rent changes:** "Change rent" on a rental page sets a new monthly rent from an effective month — it applies from the cycle that starts in that month (default: the next cycle; not before the move-in cycle, nor after the final cycle). Rent for a cycle is the latest change effective on or before its key month, otherwise the rental's original rent, which is never overwritten. Saving the same month again replaces that change; a change can be removed. The rental page shows the rent history, the rent in force now and any scheduled change. The schedule, payment defaults, reminders, notifications and the dashboard all use the per-month rent.
- **Utility & other charges:** a rental page's **Add charge** form bills electricity, water, maintenance or other charges for a month. For electricity, enter the meter readings: the previous reading is pre-filled from the last bill and the rate per unit from the property (**Edit property → Electricity rate**), falling back to **Settings → Utility charges**. The amount is units × rate, and you can still edit it. A month's due amount is rent + its charges, and payments apply to that total. So overdue/partial status, the WhatsApp `{amount}` and notifications include charges, and the rent schedule shows the breakdown. Charges can be removed. A rental's dates can't be changed to exclude months that have charges.
- **WiFi (per person):** optional, charged per person, not per room. The price is **Settings → WiFi** (default ₹100 per person per month); changing it only affects plans added or changed afterwards.
  - The rental page's **WiFi** card: **Add WiFi** ticks the tenant and any of their other occupants and a **From month** (move-in month through the move-out month), showing e.g. "2 people × ₹100 = ₹200/month". With WiFi on, it shows who, the rate, the monthly amount and since when, with **Change** (new people from an effective month: the current plan ends the month before and a new one starts; on or before the current plan's start it simply replaces it) and **Stop** (from a month: WiFi is billed through the month before; on or before the start month the plan is removed). Past plans are listed as history; only the latest plan can be removed, to fix a mistake. Plans never overlap.
  - Each covered month inside the stay gets a "WiFi" item (people × rate) on top of rent and charges (`src/lib/wifi.ts`), so the rent schedule, overdue/partial status, receipts ("towards rent and WiFi"), the WhatsApp `{amount}`, pay links, notifications, the tenant ledger (screen, Excel, PDF), the collections report and the MCP `get_rental` breakdown include it. Payments are not split, so WiFi counts as rent received in the FY summary. Like charges, a month's WiFi is billed with the billing cycle that starts in that month (never pro-rated); nothing after the final cycle.
  - People and the rate are saved with each plan: removing an occupant keeps their name on the plan (past months stay as billed) and the card suggests **Change**. The dashboard shows a **WiFi** card (people, amount, rentals this month) when anyone has WiFi.
- **Security deposit:** each rental has a deposit ledger: **received**, **deduction** (a reason is required) and **refund** entries, shown in the rental page's **Deposit** card with the held balance (received − deductions − refunds).
  - **Advance and part payments:** tenants often pay part of the deposit up front and the rest later. The new-rental form has **Deposit quoted** (the total agreed), **Advance received** (empty = the whole deposit, `0` = nothing yet; can't exceed the deposit quoted) and **Advance date** (default today; may be before move-in, never after today, at most 60 days before move-in). The advance is recorded as a "received" entry on that date.
    - Payments dated on or before the move-in date are labelled **Advance**, later ones **Part payment**. The Deposit card, tenant ledger (screen, Excel, PDF) show **Deposit quoted**, **Advance paid**, **Paid later** and **Balance** (quoted − received, never negative), plus held, with a progress bar.
    - **Add deposit payment** on the Deposit card: amount (default = balance), date (60 days before move-in through today), method (cash, UPI, bank transfer, cheque, other) and a note. More than the balance is refused ("Only ₹15,000 of the deposit is still due"; "The deposit is fully paid" at 0) — raise the deposit quoted first (**Edit rental**), which can't go below what was received ("Agreed deposit can't be less than ₹30,000 already received"). Both checks are atomic.
    - There are no due dates, schedules or deposit notifications. While a balance is due, the rentals list, rental header and tenant page show a **Deposit balance ₹X** badge, the dashboard shows a **Deposit balances** card (count, total, up to 5 rentals; hidden when none), and the Deposit card has **Remind on WhatsApp** ("Hi {tenant}, a gentle reminder that {balance} of the security deposit for {property} is still due. Thank you!"), logged as a `deposit` reminder (not counted as a rent reminder).
    - **Receipts:** each received entry has a **Receipt** (`/deposits/[id]/receipt`) titled "Security deposit receipt", numbered `DEP/2026-27/0001` from its own counter per FY (older entries are numbered when first opened). It shows Advance / Part payment, this amount, the total received and the balance, with a PDF (`/api/deposit-receipts/[id]`) and a WhatsApp share link on `/r/<token>`, under the same privacy rules as rent receipts.
    - Deposits are never counted as rent income.
  - Rentals created before advances existed keep their behaviour: the whole deposit is a "received" entry dated at move-in (rentals from before the ledger get theirs the first time they're opened), the balance is always 0 and they never show a badge.
  - The held balance can never go negative. A deduction or refund larger than the balance is refused ("Cannot exceed held deposit ₹20,000"), and the check is atomic, so two refunds at once can't overdraw it.
  - Entries can be edited (amount, date, method or reason; not their type) or deleted from the Deposit card. A change is refused if it would leave the held deposit below zero or, on advance-flow rentals, take the total received above the deposit quoted. Deleting the opening entry is remembered, so it isn't re-created. A rental with manual deposit entries can't be deleted.
  - After a move-out is recorded, the Deposit card asks you to settle the deposit: record deductions, then refund the balance.
  - Editing a rental's deposit field only changes the agreed amount (deposit quoted). Record later money in or out in the Deposit card.
- **Expenses & profit:** `/expenses` lists what you spend, filtered by financial year, property (or **General**, for expenses not tied to a property) and category. The categories are repair, maintenance, property tax, society charges, electricity, water, insurance, loan interest and other.
  - An expense can carry a bill: PDF, JPG, PNG or WEBP up to 10 MB. The server checks the type, size and file signature, so a renamed `.exe` is rejected. Bills are stored in GridFS (bucket `bills`) and served only to signed-in admins through `/api/expenses/[id]/bill`. Replacing or removing a bill, or deleting the expense, deletes the file.
  - A maintenance request's page has **Log cost as expense**, which opens a pre-filled expense form. Each request can be logged once.
  - A property with expenses can't be deleted; archive it instead.
  - `/reports/profit` shows income minus expenses for an Indian financial year (1 April – 31 March). The table lists each property, plus a General row, and a total. A monthly chart and table cover all properties or one. Income is rent received, counted by payment date (a payment on 31 Mar 2027 counts in 2026-27, one on 1 Apr 2027 in 2027-28).
- **Reports:** `/reports` is the hub. Every report can be downloaded as Excel (.xlsx); the tenant ledger and the FY summary also as PDF. Downloads go through `/api/reports/…`, which need a signed-in admin (`401` otherwise) and are sent with `Cache-Control: private, no-store`.
  - **Monthly collections** (`/reports/collections`): for a calendar month, every billing cycle whose **due date** falls in it (so a cycle 20 Oct – 19 Nov is collected in November) — rent + charges due, paid, balance and status, plus the cash received in that month by payment date; and the same totals for every month of that financial year.
  - **Tenant ledger** (`/reports/ledger`): for one rental, every month from move-in with rent (after rent changes), charges, due, paid, balance and a running outstanding (negative = paid ahead), the payments, and the deposit entries with the held balance after each. **Download ledger** on a rental page downloads its PDF; on a tenant page it opens the ledger for that tenant's rentals.
  - **Financial year summary** (`/reports/fy`): per property (plus General) income, expenses and profit for an Indian FY, expenses by category, and the total rent received for your ITR. Income is payments by payment date, so it includes utility charges collected with rent.
  - Excel files hold amounts as numbers (in rupees, not paise) so you can sum and chart them. PDFs use the built-in Helvetica font, so `₹` prints as `Rs.` and characters outside Latin-1 (e.g. Devanagari names) print as `?`.
- **Tenant documents:** Aadhaar, PAN, agreement, police verification, photo or other, uploaded on the tenant page.
  - PDF, JPG, PNG or WebP up to 10 MB. The file type is decided by the file's signature (magic bytes), not its name, so a renamed `.exe` is rejected.
  - Stored in MongoDB GridFS (bucket `documents`, separate from photos). A document can optionally be linked to one of the tenant's rentals.
  - Viewed or downloaded only through `/api/documents/[id]`, which requires a signed-in admin (`401` otherwise) and is sent with `Cache-Control: private, no-store`. There is no public link.
  - Deleting a document removes its GridFS file and unlinks it from any agreement. Deleting a tenant deletes their documents.
- **Rental agreements:** the rental page has an **Agreement** card.
  - **Add agreement** records the current agreement. The start date defaults to move-in. Leave the end date empty to use start + 11 months − 1 day (1 Jun 2026 → 30 Apr 2027); for a start on a day the target month lacks, the day is clamped first (31 Mar 2026 → 27 Feb 2027).
  - **Renew** creates the next agreement starting the day after the latest one ends. Older agreements stay as history. Only the latest agreement can be deleted, to correct a mistake.
  - A signed copy can be linked from the tenant's documents.
  - Status is derived, not stored: **expired** after the end date, **expiring** within X days of it, **active** otherwise. Set X under **Settings → Agreements** (default 30).
  - Notifications, for active rentals and their latest agreement only: `agreement_expiring` (reminder) when it ends within X days, unless the tenant is already scheduled to move out by then; `agreement_expired` (alert) once the end date passes with no newer agreement. Renewing resolves both.
  - The dashboard's **Agreements expiring** card lists active rentals whose latest agreement is expiring or expired.
- **Rent receipts:** every payment has a receipt, opened with the **Receipt** button on the payments list and the rental page's payments table (`/payments/[id]/receipt`).
  - Numbered per Indian financial year of the payment date: `RNT/2026-27/0001`, `0002`, … A payment is numbered when it is recorded; payments from before receipts existed are numbered the first time their receipt is opened. The sequence is one MongoDB counter per FY incremented atomically (`$inc`), so two payments never share a number (a rare race can leave a gap, never a duplicate).
  - Shows your details from **Settings → Receipts** (name, address, optional phone and PAN), the tenant, property, month, the month's breakdown (rent + charges, paid so far, balance), the amount, method, date and the amount in words (Indian system: "Rupees One Lakh Twenty-Five Thousand Only").
  - **Download PDF** (`/api/receipts/[id]`, signed-in admins only). PDFs embed Noto Sans (with Noto Sans Devanagari as a fallback) from `src/assets/fonts` (SIL Open Font License), so "₹" and Devanagari names print correctly. `src/lib/pdf-fonts.ts` (`embedAppFonts`) can be reused by other PDFs.
  - **Send receipt on WhatsApp** opens WhatsApp with a message containing a share link `/r/<token>`. It opens without login and has its own **Download PDF**. The link shows only the tenant's first name, the property name, the month and amounts (plus your receipt details) — never the tenant's phone, ID or documents, and no payment note.
- **UPI pay links:** set your UPI ID (and optionally a payee name) under **Settings → UPI payments** (INR only).
  - Reminder templates get the `{payLink}` placeholder, and the default template adds "Pay by UPI: {payLink}" once a UPI ID is set. With no UPI ID, `{payLink}` is empty and no pay page is offered.
  - The link `/p/<token>` opens without login for 45 days. It shows the property, the tenant's first name, the unpaid months and the amount due **computed live** (a link made when ₹12,000 was due shows ₹7,000 after ₹5,000 is recorded; "Nothing due, thank you" once paid), a UPI QR code (`upi://pay?pa=…&pn=…&am=…&cu=INR&tn=…`) and a "Pay with a UPI app" button.
  - Paying does **not** record anything: "Payment is confirmed once the landlord records it". Record the payment as usual when it arrives.
- **Signed links:** `/r/`, `/p/` and `/t/` are the only pages outside the login (besides the tenant portal's own sign-in and invite pages). Their tokens are HMAC-SHA256 signed with a key derived from `AUTH_SECRET` (`src/lib/signed-links.ts`); changing `AUTH_SECRET` invalidates all shared links. A tampered token gives a 404; an expired pay link gives a 404 "This link has expired". The pages are `noindex` and send no referrer.
- **Enquiries (leads):** `/enquiries` (nav **Enquiries**) records people who ask about a property, or about any property: name, phone, email, source (walk-in, phone call, WhatsApp, referral, OLX, 99acres, MagicBricks, NoBroker, other), budget, desired move-in, occupants, occupation and notes. Admins only; there is no public enquiry form.
  - **Status:** `new` → `contacted` → `visit scheduled` → `visited`, in any order, then closed as **accepted**, **rejected** (by you; a reason is required), **declined** (by them; a reason is required), **no response** or **property let**. A closed enquiry can be reopened (back to `contacted`).
  - **Timeline:** every status, follow-up, visit, WhatsApp and conversion change is logged automatically; add notes and calls by hand. Entries can't be edited or deleted. An enquiry can only be deleted (to fix a mistaken entry) while it is `new` with nothing logged beyond its creation.
  - **Follow-ups and visits:** set a follow-up date and a visit date/time on the enquiry page. Scheduling a visit moves a new or contacted enquiry to `visit scheduled`. They drive the `enquiry_follow_up` / `enquiry_visit` notifications and the dashboard's **Enquiries** card (open count, follow-ups due, today's visits).
  - **Duplicates:** phones are compared after normalizing (as for WhatsApp), so `98765 43210` and `+91 98765-43210` match. The form warns (without blocking) when the number belongs to another enquiry or a tenant, and the enquiry page lists previous enquiries from the number.
  - **Convert to tenant:** on an accepted enquiry, creates a tenant from its name, phone and email, or links the existing tenant with the same phone (restoring them if archived), then opens `/rentals/new?tenant=…&property=…` with both preselected. Creating that rental links it to the enquiry.
  - **WhatsApp:** **Message on WhatsApp** opens a wa.me link with editable text ("Hi {name}, this is regarding your enquiry for {property}.") and logs it in the timeline. Nothing is sent automatically.
  - **Results:** the list shows, for a chosen period (default this month), enquiries received, visits, accepted / rejected / declined and the conversion rate (accepted ÷ closed in the period; "—" when nothing closed), plus the same by source. Filters: Open / Accepted / Rejected / Declined / All, search by name or phone, property, source and "follow-up due". Each property page has an **Enquiries** card.
- **Virtual tours (360°):** each property page has a **Virtual tour** card (empty with **Create tour** until you add one). The editor is at `/properties/[id]/tour`.
  - **Rooms** are 360° photos (equirectangular, twice as wide as tall, ±3%): JPEG, PNG or WebP. The browser shrinks anything wider than 6144 px to 6144 × 3072 JPEG and makes a 512 × 256 thumbnail before upload; the server re-checks the signature, size (12 MB photo / 300 KB thumbnail) and the 2:1 shape ("This isn't a 360° photo …"). Files live in GridFS (bucket `tours`) and are served to admins through `/api/tours/[roomId]/(image|thumb)`.
  - **Editing:** rename, reorder, delete (removes its files and every link pointing to it), **Set as start**, **Set starting view** (the direction the room opens in), and **Add link**: click a spot such as a door, pick the room it opens, optionally with a return link (placed opposite if you don't add one by hand). Links show as arrows; click one to walk into that room.
  - **Sample tour:** a property without rooms offers **Use sample tour**, which adds three demo rooms (Living room, Bedroom, Kitchen) linked at their doors, marked **Sample**. They behave like normal rooms; replace them with your own photos. `npm run seed` adds it to the first demo property. The images are generated by `node scripts/generate-sample-tour.mjs` into `src/assets/sample-tour/` (with `manifest.json` holding each door's hotspot).
  - **External tour (optional):** a Matterport (`my.matterport.com`), Kuula (`kuula.co`), YouTube (converted to `/embed/`) or Google Maps embed (`www.google.com/maps/embed`) link, shown in a sandboxed iframe. With both, the tour has "360° rooms" / "External tour" tabs.
  - **Viewer:** Photo Sphere Viewer (MIT, bundled, no CDN), loaded only on tour pages. Drag or swipe to look, zoom, fullscreen, gyroscope on phones, arrows and room thumbnails to move; the first room slowly turns until you touch it.
  - **Sharing:** turn on **Share link** to get `/t/<token>` (copy it or **Send on WhatsApp**). It opens without login and shows only the property name, city, bedrooms/bathrooms, asking rent and Available/Occupied — no address line, no tenant. Turning sharing off or **Reset link** makes old links 404. On an enquiry, **Send tour on WhatsApp** sends "Hi {name}, here's a 360° tour of {property}: {link}" and logs it in the timeline.
  - Deleting a property deletes its tour rooms and files.
- **Photos:** JPEG/PNG/WebP/GIF up to 5 MB. The server checks the file type, size and file signature. Photos are stored **in MongoDB GridFS** (bucket `photos`), so they survive hosts with an ephemeral disk. They are served only to signed-in admins through `/api/uploads/[file]`. Deleting a photo or property removes its GridFS file. In development only, photos from before GridFS that are still in a local `uploads/` folder keep displaying. They are not migrated; re-upload them if you want them in the database.

## Deploy to Render

Rentee runs on Render's free web-service plan with a free MongoDB Atlas cluster. Everything, photos included, lives in MongoDB, so Render's ephemeral disk doesn't matter.

### 1. MongoDB Atlas (free M0 cluster)

1. Create an account at <https://www.mongodb.com/cloud/atlas> and create a free **M0** cluster. A region near Singapore (or near your Render region) keeps latency low.
2. **Database Access** → add a database user with a strong password and the *Read and write to any database* role.
3. **Network Access** → *Add IP Address* → `0.0.0.0/0` (allow from anywhere). Render's free plan has no fixed outbound IP, so this is required. Access is still protected by the user and password.
4. **Connect** → *Drivers* → copy the connection string and add a database name before the `?`, e.g.
   `mongodb+srv://rentee:<password>@cluster0.xxxxx.mongodb.net/rentee?retryWrites=true&w=majority`
   URL-encode special characters in the password (e.g. `@` → `%40`).

### 2. Deploy the blueprint

1. Push this repository to GitHub or GitLab.
2. Render Dashboard → **New → Blueprint** → select the repo. `render.yaml` defines one free web service, `rentee`, in Singapore:
   - Build command: `npm ci && npm run build`. The build needs no database.
   - Start command: `npm start`.
   - Health check: `/login`.
3. When prompted, paste the Atlas string into **MONGODB_URI**. `AUTH_SECRET` is generated for you. `NODE_ENV`, `NODE_VERSION`, `NEXT_PUBLIC_CURRENCY` and `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE` are preset. Change the `NEXT_PUBLIC_*` values before the first build if needed; they are baked into the build.
4. Wait for the deploy to go live. The service URL shows the login page, but there is no admin yet.

### 3. Create the first admin (from your own machine)

From a local checkout where you've run `npm install` (the seed uses dev tools like `tsx`), run the seed against the Atlas database with `--admin-only`, so no demo data is created. No local mongod is started for a remote URI, and the `0.0.0.0/0` Network Access rule also lets your machine connect.

```bash
# macOS / Linux
MONGODB_URI="mongodb+srv://…/rentee?…" ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="a-long-password" ADMIN_NAME="Your Name" \
  npm run seed -- --admin-only
```

```powershell
# Windows PowerShell
$env:MONGODB_URI="mongodb+srv://…/rentee?…"; $env:ADMIN_EMAIL="you@example.com"; $env:ADMIN_PASSWORD="a-long-password"; $env:ADMIN_NAME="Your Name"
npm run seed -- --admin-only
```

Then sign in on the Render URL. You can add more admins under **Settings**. Against a non-local database the seed refuses to run without `ADMIN_PASSWORD` and refuses `--reset` without `--force`.

### Things to know on the free plans

- **Sleep:** a free Render web service spins down after about 15 minutes without traffic. The next request wakes it, which takes up to about a minute.
- **Notifications:** the notification check (at most every 5 minutes) only runs while someone uses the app, since there's no cron. Desktop notifications only appear while a Rentee tab is open; there's no Web Push. A sleeping service delivers nothing until it is woken.
- **Storage:** Atlas M0 has 512 MB. Photos (up to 5 MB each, 12 per property), expense bills (up to 10 MB each) and tour photos (usually 2–5 MB per room) are the main consumers.
- **Clock:** "today" (due dates, overdue) uses the server's timezone, which is UTC on Render. To use Indian time, add the environment variable `TZ=Asia/Kolkata`.

## Connect Rentee to Claude

Rentee includes a remote MCP server at `<APP_URL>/api/mcp`, so Claude (claude.ai, Claude Desktop, Claude Code) can answer questions about your rentals and, if you allow it, record payments and other changes. It is protected by Rentee's own OAuth 2.1 server: Claude registers itself, you sign in to Rentee and approve, and Claude gets a token tied to your admin account. The examples below use `https://rentee-4fkw.onrender.com`; use your own Rentee URL.

**First, set `APP_URL` on Render** (Dashboard → rentee → Environment) to your public URL with no trailing slash, e.g. `APP_URL=https://rentee-4fkw.onrender.com`, then redeploy. Every OAuth and MCP URL (issuer, resource, metadata) is built from it; Claude rejects the connection if they don't match the address it connected to.

- **claude.ai:** Settings → Connectors → **Add custom connector** → name `Rentee`, URL `https://rentee-4fkw.onrender.com/api/mcp` → Add → **Connect**. Leave the OAuth client ID/secret fields empty (Claude registers itself).
- **Claude Desktop:** Settings → Connectors → **Add custom connector** with the same URL, then **Connect**.
- **Claude Code:** `claude mcp add --transport http rentee https://rentee-4fkw.onrender.com/api/mcp`, then run `/mcp` in Claude Code and choose **Authenticate**.

**Consent:** a Rentee page opens. Sign in if asked, check the app name and where it returns to, and choose **Allow access**. Read access is always granted. Tick **Also allow changes (record payments, add enquiries…)** only if Claude should be able to write; without it, write tools answer "requires rentee:write". A free Render service may be asleep: the first connection can take up to a minute.

**What Claude can do:**
- Read: `get_dashboard`, `list_properties`, `get_property`, `list_tenants`, `get_tenant`, `list_rentals`, `get_rental`, `list_overdue_rent`, `list_payments`, `list_expenses`, `get_profit_report`, `list_enquiries`, `get_enquiry`, `list_maintenance`, `list_notifications`, `list_agreements_expiring`. Money comes as `{ formatted: "₹15,000.00", paise: 1500000 }`; dates are ISO.
- Write (with `rentee:write`): `record_rent_payment`, `add_deposit_payment`, `create_enquiry`, `add_enquiry_note`, `create_maintenance_request`, `update_maintenance_status`. They use the same validation as the app (payable months, deposit balance, …). There are no delete tools.
- Never shared: tenant ID numbers, documents and their files, photos, passwords, tokens, settings secrets.

**Revoke:** Settings → **Connected apps** lists each connection (app, read-only or read & changes, who allowed it, when, last used) with **Revoke**, which disconnects it immediately. The same card shows the last 20 changes made by connected apps. Deleting an admin also stops their tokens working.

**How it works:** discovery via `/.well-known/oauth-protected-resource` (RFC 9728) and `/.well-known/oauth-authorization-server` (RFC 8414); dynamic client registration at `/api/oauth/register` (RFC 7591; `https://` redirect URIs, or `http://localhost` for local clients; 20 per hour per IP, at most 200 apps); `/oauth/authorize` (authorization code + PKCE S256 only, exact redirect URI match, `resource` must be the MCP URL); `/api/oauth/token` (1-hour access tokens, 30-day refresh tokens that rotate on every use — replaying an old one revokes the whole connection); `/api/oauth/revoke` (RFC 7009). Codes, tokens and client secrets are random and stored only as SHA-256 hashes (collections `rentee_oauth_*`, `rentee_mcp_audit_logs`). `/api/mcp` is a stateless Streamable HTTP endpoint; without a valid bearer token it answers 401 with `WWW-Authenticate: Bearer resource_metadata="…"`.

**Test it locally:** `NEXT_DIST_DIR=.next-verify npm run build`, then `NEXT_DIST_DIR=.next-verify node scripts/mcp-e2e.mjs`. The script starts its own throwaway MongoDB (port 27391) and `next start` (port 3391), seeds demo data, runs the whole OAuth + MCP flow with raw HTTP and the official MCP SDK client, then stops both.
- **Request limits (MCP + OAuth):** per minute — 60 requests per Claude connection on `/api/mcp`, 30 per address for requests without a valid token, 30 per address on `/api/oauth/token` and `/api/oauth/revoke` (registration has its own hourly limit). Over the limit → `429` with `Retry-After`; clients back off and retry. Counters live in `rentee_rate_limits` and expire on their own (`src/lib/rate-limit.ts`).

## Project layout

```
src/
  app/login/                 sign-in page + login/logout actions
  app/(admin)/…              dashboard, properties, tenants, enquiries, rentals, payments, maintenance,
                             expenses, reports (hub, collections, ledger, FY summary, profit),
                             notifications, settings
  app/api/uploads/[file]/    authenticated photo serving (GridFS)
  app/api/expenses/[id]/bill authenticated expense bill serving (GridFS)
  app/api/reports/…          authenticated Excel / PDF report downloads
  app/api/notifications/     notification poll endpoint (bell + desktop notifications)
  app/api/receipts/[id]      authenticated receipt PDF
  app/api/mcp/               MCP connector (Streamable HTTP, OAuth bearer tokens)
  app/api/oauth/, app/oauth/authorize, app/.well-known/  OAuth 2.1 server (register, token, revoke, consent, metadata)
  lib/oauth/, lib/mcp/       OAuth rules + store; MCP tools
  app/r/[token], app/p/[token]  public signed receipt / UPI pay pages (no login)
  app/portal/…               tenant portal: login, invite (set password), home, payments, repairs,
                             documents, profile; app/portal/api/… tenant-scoped file routes
  lib/tenant-session.ts, lib/tenant-auth.ts, lib/portal-*.ts  tenant sessions, guard, scoping, data
  app/t/[token]              public virtual tour page + token-checked tour images (no login)
  assets/sample-tour/        generated sample 360° rooms (scripts/generate-sample-tour.mjs)
  assets/fonts/              Noto Sans fonts for PDFs (OFL)
  components/                app shell (sidebar / mobile drawer), UI primitives, form fields
  lib/                       db, auth, session, money, rent, validation, whatsapp, reminders,
                             notifications (pure rules), notification-sync, data loaders,
                             fy, charges, deposit (+ deposit-store), expenses, profit, file-store,
                             reports (+ reports-data, reports-xlsx, report-pdf),
                             receipts (+ receipt-store, receipt-pdf, amount-words), pdf-fonts,
                             signed-links, share-links, upi
  models/                    Mongoose schemas
  middleware.ts              route protection
scripts/local-mongo.mjs      local mongod helper (dev only)
render.yaml                  Render blueprint
scripts/seed.ts              admin + demo data
```

Out of scope for this build: online payments, email/SMS, accounting-software integration (reports export to Excel/PDF only).
