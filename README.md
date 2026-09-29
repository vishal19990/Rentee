# Rentee

A login-protected admin panel for landlords: properties, tenants, month-to-month rentals, rent payments, maintenance requests and a dashboard (occupancy, income, overdue rent).

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

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local mongod (if needed) + Next dev server |
| `npm run seed` | Admin + demo data (skips demo data if properties exist) |
| `npm run seed -- --admin-only` | Only the admin account, no demo data (use for production) |
| `npm run seed -- --reset` | Wipes all Rentee data, then seeds. Refused on a non-local database unless `--force` is added. **Run this once if your `.data/db` was created before leases became rentals**; the old lease data is not migrated. |
| `npm run db` | Runs only the local mongod (Ctrl+C to stop) |
| `npm run build` / `npm start` | Production build / server. `npm start` listens on `0.0.0.0:$PORT` (default 3000) and never starts a local mongod. In production it exits with a clear error if `MONGODB_URI` or `AUTH_SECRET` is missing. |
| `npm test` | Vitest unit tests (rent schedule, money, validation) |
| `npm run typecheck` | `tsc --noEmit` |

## How it works

- **Auth:** only admins sign in; tenants do not. Passwords are stored as bcrypt hashes. The session is a signed JWT in an httpOnly, `sameSite=lax` cookie. `src/middleware.ts` redirects signed-out page requests to `/login` (API routes get 401). Every page, route handler and server action also checks the session against the database with `requireUser()`.
- **Money** is stored as integer minor units (paise, cents) and formatted with `Intl.NumberFormat`.
- **Rentals, not leases:** the landlord rents month-to-month. A rental links a tenant to a property with a move-in date, rent, deposit and due day. No end date is entered at creation.
  - **Move out** records a move-out date (defaults to today; may be past or future, but not before move-in). Rent stops after the move-out month.
  - A future move-out date keeps the rental `active` ("Moving out") until that day. On the move-out date it counts as moved out, and the stored status is synced automatically.
  - The dashboard lists rentals **moving out in the next 30 days**. Old `/leases` URLs redirect to `/rentals`.
- **Occupancy** is never stored. A property is `occupied` when it has an `active` rental. A partial unique index enforces at most one active rental per property.
- **Rent status** is computed, not stored (`src/lib/rent.ts`). For each month from the move-in month through the current month (or through the move-out month, if earlier):
  - `due` is the monthly rent and `paid` is the sum of payments for that month.
  - The month is **paid** once paid ≥ due.
  - Otherwise it is **overdue** (nothing paid) or **partial** (something paid) once the due day has passed, and **upcoming** before that.
  - Payments are append-only: the app has no way to delete them.
- **Deletion:** properties and tenants that have ever had a rental cannot be deleted; archive them instead. A rental with payments cannot be deleted; record a move-out instead. Once the move-out date arrives the property is vacant, so a new rental can be created.
- **Payments** can be recorded for any month from move-in through the move-out month. While a rental is open-ended, rent can be prepaid up to 12 months ahead.
- **WhatsApp rent reminders:** these use click-to-chat links (`https://wa.me/<digits>?text=<message>`) that open in a new tab. You press send in WhatsApp. There is no WhatsApp Business API and nothing is sent automatically.
  - **Where:** a "Remind on WhatsApp" button appears on the dashboard overdue list, the rental page and the tenant page.
  - **What it covers:** all past-due unpaid months and their total. With nothing overdue, an active rental gets a "due soon" reminder for the next unpaid month.
  - **Message:** comes from a template you can edit under **Settings → WhatsApp reminders** (stored in MongoDB, with a built-in default). Placeholders are `{tenant}`, `{property}`, `{amount}`, `{months}` and `{dueDate}`.
  - **Phone numbers:** non-digits are stripped.
    - A number starting with `+` or `00` is used as-is.
    - A 10-digit number gets `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE`.
    - An 11-digit number starting with `0` drops the `0` and gets that code.
    - Fewer than 8 digits disables the button, with the tooltip "Add a phone number".
  - **Log:** clicking records a reminder (rental, tenant, time, message) and shows "Last reminded …". The log shows the reminder was opened, not that it was delivered.
- **Admin notifications:** these are in-app alerts and reminders, shared by all admins; marking one read marks it read for everyone.
  - **Types:**
    - `rent_overdue` (alert): one per rental and month past its due day with a balance.
    - `rent_due_soon` (reminder): N days before a due date with a balance. Default N is 3.
    - `move_out_soon` (reminder): an active rental's move-out within M days. Default M is 7.
    - `maintenance_pending` (alert): an open or in-progress request older than K days (default 7), or urgent/high priority from creation.
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
- **Storage:** Atlas M0 has 512 MB. Photos (up to 5 MB each, 12 per property) are the main consumer.
- **Clock:** "today" (due dates, overdue) uses the server's timezone, which is UTC on Render. To use Indian time, add the environment variable `TZ=Asia/Kolkata`.

## Project layout

```
src/
  app/login/                 sign-in page + login/logout actions
  app/(admin)/…              dashboard, properties, tenants, rentals, payments, maintenance, settings
  app/api/uploads/[file]/    authenticated photo serving (GridFS)
  app/api/notifications/     notification poll endpoint (bell + desktop notifications)
  components/                app shell (sidebar / mobile drawer), UI primitives, form fields
  lib/                       db, auth, session, money, rent, validation, whatsapp, reminders,
                             notifications (pure rules), notification-sync, data loaders
  models/                    Mongoose schemas
  middleware.ts              route protection
scripts/local-mongo.mjs      local mongod helper (dev only)
render.yaml                  Render blueprint
scripts/seed.ts              admin + demo data
```

Out of scope for this build: online payments, email/SMS, accounting export.
