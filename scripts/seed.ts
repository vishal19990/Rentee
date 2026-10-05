/**
 * Seeds an admin account and (on an empty database) realistic demo data.
 *
 *   npm run seed                  -> create admin if missing; add demo data if there are no properties
 *   npm run seed -- --admin-only  -> only create the admin (use this for production)
 *   npm run seed -- --reset       -> wipe all Rentee data first, then seed (local databases only,
 *                                    unless --force is also given)
 *
 * Admin credentials: ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME (or SEED_ADMIN_EMAIL /
 * SEED_ADMIN_PASSWORD). Against a non-local MONGODB_URI (e.g. Atlas) a password must be given
 * explicitly — the dev default "rentee123" is never used there.
 */
import path from "node:path";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true });

const { connectDB, mongoUri } = await import("../src/lib/db");
const { User } = await import("../src/models/User");
const { Property } = await import("../src/models/Property");
const { Tenant } = await import("../src/models/Tenant");
const { Rental } = await import("../src/models/Rental");
const { Payment } = await import("../src/models/Payment");
const { Maintenance } = await import("../src/models/Maintenance");
const { addDays, addMonths, localToday, monthOf } = await import("../src/lib/rent");
const { minorDigits } = await import("../src/lib/money");

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const force = args.includes("--force");
const adminOnly = args.includes("--admin-only");

const uri = mongoUri();
const isLocalDb = /^mongodb:\/\/(?:[^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri);
const explicitPassword = process.env.ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
const email = (process.env.ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || "admin@rentee.local").trim().toLowerCase();
const password = explicitPassword || "rentee123";
const adminName = process.env.ADMIN_NAME?.trim() || "Admin";

/** Hides credentials when printing the connection string. */
const redacted = uri.replace(/\/\/[^@/]*@/, "//***@");

/** Whole currency units -> minor units. */
const money = (major: number) => Math.round(major * 10 ** minorDigits());
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function monthsAgo(today: string, n: number): string {
  // Same day-of-month n months ago (clamped to 28 to stay valid in every month).
  const day = Math.min(Number(today.slice(8, 10)), 28);
  return `${addMonths(monthOf(today), -n)}-${String(day).padStart(2, "0")}`;
}

async function main() {
  if (!isLocalDb && !explicitPassword) {
    throw new Error("Refusing to create an admin with the default password on a non-local database. Set ADMIN_PASSWORD (and ADMIN_EMAIL).");
  }
  if (!isLocalDb && password === "rentee123") throw new Error("Choose a real ADMIN_PASSWORD for a non-local database (not the dev default).");
  if (password.length < 8) throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`ADMIN_EMAIL "${email}" is not a valid email address.`);
  if (reset && !isLocalDb && !force) {
    throw new Error("--reset on a non-local database would wipe real data. Add --force if you really mean it.");
  }

  console.log(`Database: ${redacted}`);
  await connectDB();
  await Promise.all([User.init(), Property.init(), Tenant.init(), Rental.init(), Payment.init(), Maintenance.init()]);

  if (reset) {
    console.log("Resetting collections…");
    await Promise.all([
      User.deleteMany({}),
      Property.deleteMany({}),
      Tenant.deleteMany({}),
      Rental.deleteMany({}),
      Payment.deleteMany({}),
      Maintenance.deleteMany({}),
    ]);
    // Collections without a model import here: notifications, reminders, settings, rent changes,
    // charges, deposit ledger, expenses, and GridFS files (photos, expense bills).
    const db = mongoose.connection.db!;
    for (const name of [
      "notifications",
      "reminderlogs",
      "appsettings",
      "rentchanges",
      "charges",
      "depositentries",
      "expenses",
      "photos.files",
      "photos.chunks",
      "bills.files",
      "bills.chunks",
    ]) {
      await db.collection(name).deleteMany({});
    }
    // Leftover from before month-to-month rentals replaced leases.
    const legacy = await mongoose.connection.db!.listCollections({ name: "leases" }).toArray();
    if (legacy.length) await mongoose.connection.db!.dropCollection("leases");
  }

  if (await User.exists({ email })) {
    console.log(`Admin ${email} already exists (password unchanged).`);
  } else {
    await User.create({ name: adminName, email, passwordHash: await bcrypt.hash(password, 12) });
    console.log(explicitPassword ? `Created admin ${email} (password from ADMIN_PASSWORD).` : `Created admin ${email} / ${password}`);
  }

  if (adminOnly) {
    console.log("--admin-only: skipping demo data.");
    return;
  }

  if (await Property.exists({})) {
    console.log("Properties already exist — skipping demo data (use --reset to start over).");
    return;
  }

  const today = localToday();
  console.log("Creating demo data…");

  const [palm, lotus, cedar, harbor] = await Property.create([
    {
      name: "Palm Grove Villa",
      address: "12 Palm Grove Road, Indiranagar",
      city: "Bengaluru",
      type: "villa",
      bedrooms: 4,
      bathrooms: 3,
      monthlyRent: money(55000),
      notes: "Gated community, covered parking for two cars.",
    },
    {
      name: "Lotus Apartment 3B",
      address: "Lotus Residency, 3rd floor, HSR Layout",
      city: "Bengaluru",
      type: "apartment",
      bedrooms: 2,
      bathrooms: 2,
      monthlyRent: money(28000),
    },
    {
      name: "Cedar House",
      address: "44 Cedar Lane, Koregaon Park",
      city: "Pune",
      type: "house",
      bedrooms: 3,
      bathrooms: 2,
      monthlyRent: money(38000),
    },
    {
      name: "Harbor View Studio",
      address: "Harbor View Towers, Bandra West",
      city: "Mumbai",
      type: "apartment",
      bedrooms: 1,
      bathrooms: 1,
      monthlyRent: money(32000),
    },
  ]);

  const [asha, rahul, meera, vikram] = await Tenant.create([
    { name: "Asha Menon", phone: "+91 98450 11223", email: "asha.menon@example.com", idNumber: "XXXX-XXXX-4521" },
    { name: "Rahul Verma", phone: "99001 44556", email: "rahul.v@example.com" },
    { name: "Meera Iyer", phone: "+91 98200 77889", email: "meera.iyer@example.com" },
    { name: "Vikram Shah", phone: "097300 22110" },
  ]);

  // 1) Palm Grove: moved in 3 months ago, open-ended, only the first month paid -> later months overdue.
  const palmIn = monthsAgo(today, 3);
  const palmRental = await Rental.create({
    property: palm._id,
    tenant: asha._id,
    moveInDate: d(palmIn),
    monthlyRent: money(55000),
    deposit: money(110000),
    dueDay: 5,
  });
  await Payment.create({
    rental: palmRental._id,
    forMonth: monthOf(palmIn),
    amount: money(55000),
    paidOn: d(palmIn),
    method: "bank_transfer",
    note: "First month",
  });

  // 2) Lotus: moved in 8 months ago, paid up except a partial payment last month,
  //    and has given notice: move-out scheduled in 20 days (still active until then).
  const lotusIn = monthsAgo(today, 8);
  const lotusRental = await Rental.create({
    property: lotus._id,
    tenant: rahul._id,
    moveInDate: d(lotusIn),
    moveOutDate: d(addDays(today, 20)),
    monthlyRent: money(28000),
    deposit: money(56000),
    dueDay: 1,
  });
  const lotusPayments = [];
  for (let i = 8; i >= 1; i--) {
    const m = addMonths(monthOf(today), -i);
    lotusPayments.push({
      rental: lotusRental._id,
      forMonth: m,
      amount: i === 1 ? money(18000) : money(28000),
      paidOn: d(`${m}-02`),
      method: i % 2 ? "upi" : "bank_transfer",
      note: i === 1 ? "Balance promised next week" : "",
    });
  }
  lotusPayments.push({
    rental: lotusRental._id,
    forMonth: monthOf(today),
    amount: money(28000),
    paidOn: d(`${monthOf(today)}-01`),
    method: "upi",
    note: "",
  });
  await Payment.create(lotusPayments);

  // 3) Cedar: tenant moved out 2 months ago (property is vacant now), fully paid.
  const cedarIn = monthsAgo(today, 14);
  const cedarOut = monthsAgo(today, 2);
  const cedarRental = await Rental.create({
    property: cedar._id,
    tenant: meera._id,
    moveInDate: d(cedarIn),
    moveOutDate: d(cedarOut),
    monthlyRent: money(36000),
    deposit: money(72000),
    dueDay: 10,
    status: "moved_out",
  });
  const cedarPayments = [];
  for (let m = monthOf(cedarIn); m <= monthOf(cedarOut); m = addMonths(m, 1)) {
    cedarPayments.push({ rental: cedarRental._id, forMonth: m, amount: money(36000), paidOn: d(`${m}-08`), method: "cheque" });
  }
  await Payment.create(cedarPayments);

  // 4) Harbor View: moved in today, open-ended; first rent not yet overdue.
  await Rental.create({
    property: harbor._id,
    tenant: vikram._id,
    moveInDate: d(today),
    monthlyRent: money(32000),
    deposit: money(64000),
    dueDay: 28,
  });

  await Maintenance.create([
    { property: palm._id, title: "Leaking kitchen tap", description: "Tenant reports constant drip under the sink.", priority: "medium", status: "open" },
    { property: lotus._id, title: "AC not cooling in bedroom", priority: "high", status: "in_progress", cost: money(4500) },
    { property: cedar._id, title: "Repaint living room before next tenant", priority: "low", status: "open", cost: money(18000) },
    { property: harbor._id, title: "Replace bathroom exhaust fan", priority: "medium", status: "done", cost: money(2200) },
  ]);

  console.log("Demo data ready: 4 properties, 4 tenants, 4 rentals, payments and maintenance requests.");
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
