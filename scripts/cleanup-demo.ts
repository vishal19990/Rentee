/**
 * Removes the demo data created by `npm run seed` (and the built-in sample tour), keeping
 * everything real: admin accounts, settings, and any property / tenant / enquiry you added.
 *
 *   npm run cleanup:demo              # dry run: shows what would be removed, changes nothing
 *   npm run cleanup:demo -- --confirm # actually removes it
 *   add --all-enquiries               # also remove every enquiry, not only seeded ones
 *
 * Demo records are recognised by the exact names `scripts/seed.ts` uses. Everything that hangs
 * off a demo property or tenant (rentals, payments, charges, rent changes, deposits, agreements,
 * documents, reminders, maintenance, expenses, tour rooms, photos and their GridFS files) goes
 * with it. Sample tour rooms (`sample: true`) are removed from every property. Real enquiries are
 * kept; links from them to removed records are cleared. Notifications are cleared and rebuild
 * themselves from the remaining data on the next page load.
 *
 * Only Rentee's own collections are touched — other apps sharing the same database are safe.
 */
import path from "node:path";
import dotenv from "dotenv";
import mongoose, { type Types } from "mongoose";

dotenv.config({ path: path.join(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true });

const CONFIRM = process.argv.includes("--confirm");
/** Also remove every enquiry (and its timeline), not just the seeded ones. */
const ALL_ENQUIRIES = process.argv.includes("--all-enquiries");

const DEMO_PROPERTIES = ["Palm Grove Villa", "Lotus Apartment 3B", "Cedar House", "Harbor View Studio"];
const DEMO_TENANTS = [
  { name: "Asha Menon", email: "asha.menon@example.com" },
  { name: "Rahul Verma", email: "rahul.v@example.com" },
  { name: "Meera Iyer", email: "meera.iyer@example.com" },
  { name: "Vikram Shah", email: null },
];
const DEMO_ENQUIRIES = [
  "Karan Malhotra", "Sneha Kulkarni", "Arjun Nair", "Fatima Sheikh",
  "Rohan Gupta", "Divya Rao", "Rahul Verma", "Imran Khan",
];

type Id = Types.ObjectId;
type Doc = { _id: Id; [k: string]: unknown };

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not set (.env / .env.local).");
  process.exit(1);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
const db = mongoose.connection.db!;
const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
const col = (name: string) => db.collection<Doc>(name);
const has = (name: string) => existing.has(name);
const ids = (docs: Doc[]) => docs.map((d) => d._id);
const find = async (name: string, filter: object, projection: object = {}) =>
  has(name) ? col(name).find(filter, { projection }).toArray() : [];

console.log(`Database: ${db.databaseName} on ${uri.replace(/\/\/[^@]*@/, "//***@").replace(/\?.*$/, "")}`);
console.log(CONFIRM ? "Mode: DELETE (--confirm)\n" : "Mode: dry run (nothing will be changed; add --confirm to delete)\n");

// ---- What counts as demo ------------------------------------------------------------------
const properties = await find("properties", { name: { $in: DEMO_PROPERTIES } });
const tenants = await find("tenants", {
  $or: DEMO_TENANTS.map((t) => (t.email ? { name: t.name, email: t.email } : { name: t.name })),
});
const propertyIds = ids(properties);
const tenantIds = ids(tenants);

const rentals = await find("rentals", { $or: [{ property: { $in: propertyIds } }, { tenant: { $in: tenantIds } }] });
const rentalIds = ids(rentals);
const maintenance = await find("maintenances", { property: { $in: propertyIds } });
const maintenanceIds = ids(maintenance);

// Seeded enquiries (by name, created with demo properties) — a real enquiry with the same name
// but on a real property, or with no property, is only treated as demo if its phone matches seed.
const enquiries = await find(
  "enquiries",
  ALL_ENQUIRIES
    ? {}
    : {
        name: { $in: DEMO_ENQUIRIES },
        $or: [{ property: { $in: propertyIds } }, { convertedTenant: { $in: tenantIds } }, { createdBy: null }],
      },
);
const enquiryIds = ids(enquiries);

const tourRooms = await find("tourrooms", { $or: [{ property: { $in: propertyIds } }, { sample: true }] });
const documents = await find("tenantdocuments", { tenant: { $in: tenantIds } });
const expenses = await find("expenses", {
  $or: [{ property: { $in: propertyIds } }, { maintenance: { $in: maintenanceIds } }],
});

const plan: { label: string; collection: string; filter: object; count: number }[] = [];
const add = async (label: string, collection: string, filter: object) => {
  if (!has(collection)) return;
  plan.push({ label, collection, filter, count: await col(collection).countDocuments(filter) });
};

await add("Payments", "payments", { rental: { $in: rentalIds } });
await add("Charges", "charges", { rental: { $in: rentalIds } });
await add("WiFi plans", "wifiplans", { rental: { $in: rentalIds } });
await add("Rent changes", "rentchanges", { rental: { $in: rentalIds } });
await add("Deposit entries", "depositentries", { rental: { $in: rentalIds } });
await add("Agreements", "agreements", { rental: { $in: rentalIds } });
await add("Reminder logs", "reminderlogs", { $or: [{ rental: { $in: rentalIds } }, { tenant: { $in: tenantIds } }] });
await add("Tenant documents", "tenantdocuments", { tenant: { $in: tenantIds } });
await add("Expenses", "expenses", { _id: { $in: ids(expenses) } });
await add("Maintenance requests", "maintenances", { _id: { $in: maintenanceIds } });
await add("Tour rooms", "tourrooms", { _id: { $in: ids(tourRooms) } });
await add("Enquiry activities", "enquiryactivities", { enquiry: { $in: enquiryIds } });
await add("Enquiries", "enquiries", { _id: { $in: enquiryIds } });
await add("Rentals", "rentals", { _id: { $in: rentalIds } });
await add("Tenants", "tenants", { _id: { $in: tenantIds } });
await add("Properties", "properties", { _id: { $in: propertyIds } });
await add("Notifications (rebuilt automatically)", "notifications", {});

// GridFS files owned by the records above.
const photoNames = properties.flatMap((p) => (Array.isArray(p.photos) ? (p.photos as string[]) : []));
const tourFileIds = tourRooms.flatMap((r) => [r.image, r.thumbnail]).filter(Boolean) as Id[];
const documentFileIds = documents.map((d) => d.file).filter(Boolean) as Id[];
const billFileIds = expenses.map((e) => (e.bill as { fileId?: Id } | null)?.fileId).filter(Boolean) as Id[];
const files = [
  { bucket: "photos", label: "Property photos", filter: { filename: { $in: photoNames } } },
  { bucket: "tours", label: "Tour images", filter: { _id: { $in: tourFileIds } } },
  { bucket: "documents", label: "Document files", filter: { _id: { $in: documentFileIds } } },
  { bucket: "bills", label: "Bill files", filter: { _id: { $in: billFileIds } } },
];
const fileCounts = await Promise.all(
  files.map(async (f) => (has(`${f.bucket}.files`) ? col(`${f.bucket}.files`).countDocuments(f.filter) : 0)),
);

// ---- Report --------------------------------------------------------------------------------
console.log("Demo properties:", properties.map((p) => p.name).join(", ") || "none");
console.log("Demo tenants:   ", tenants.map((t) => t.name).join(", ") || "none");
console.log("Demo enquiries: ", enquiries.map((e) => e.name).join(", ") || "none");
console.log("\nWill remove:");
for (const p of plan) if (p.count) console.log(`  ${p.label.padEnd(38)} ${p.count}`);
files.forEach((f, i) => fileCounts[i] && console.log(`  ${f.label.padEnd(38)} ${fileCounts[i]}`));

const keep = async (name: string, label: string, filter: object = {}) =>
  has(name) && console.log(`  ${label.padEnd(38)} ${await col(name).countDocuments(filter)}`);
console.log("\nWill keep:");
await keep("users", "Admin accounts");
await keep("appsettings", "Settings");
await keep("properties", "Other (real) properties", { _id: { $nin: propertyIds } });
await keep("tenants", "Other (real) tenants", { _id: { $nin: tenantIds } });
await keep("enquiries", "Other (real) enquiries", { _id: { $nin: enquiryIds } });

const total = plan.reduce((s, p) => s + p.count, 0) + fileCounts.reduce((s, n) => s + n, 0);
if (!CONFIRM) {
  console.log(total ? "\nDry run only. Run again with --confirm to delete the above." : "\nNothing to clean up.");
  await mongoose.disconnect();
  process.exit(0);
}

// ---- Delete --------------------------------------------------------------------------------
for (const f of files) {
  if (!has(`${f.bucket}.files`)) continue;
  const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: f.bucket });
  for (const file of await col(`${f.bucket}.files`).find(f.filter, { projection: { _id: 1 } }).toArray()) {
    await bucket.delete(file._id).catch(() => undefined);
  }
}
for (const p of plan) if (p.count) await col(p.collection).deleteMany(p.filter);

// Real records keep working: clear links that pointed at removed demo data.
if (has("enquiries")) {
  await col("enquiries").updateMany({ property: { $in: propertyIds } }, { $set: { property: null } });
  await col("enquiries").updateMany({ convertedTenant: { $in: tenantIds } }, { $set: { convertedTenant: null } });
  await col("enquiries").updateMany({ convertedRental: { $in: rentalIds } }, { $set: { convertedRental: null } });
}
if (has("properties")) {
  await col("properties").updateMany(
    { "tour.startRoom": { $in: ids(tourRooms) } },
    { $set: { "tour.startRoom": null } },
  );
}
if (has("tourrooms")) {
  await col("tourrooms").updateMany({}, { $pull: { links: { toRoom: { $in: ids(tourRooms) } } } } as object);
}
// Receipt numbers restart at 0001 once no payments are left.
if (has("counters") && has("payments") && (await col("payments").countDocuments()) === 0) {
  await col("counters").deleteMany({ _id: { $regex: /^receipt:/ } } as object);
}

console.log(`\nDone. Removed ${total} records/files. Restart \`npm run dev\` (or reload the live site).`);
await mongoose.disconnect();
