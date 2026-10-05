import "server-only";
import { Types } from "mongoose";
import { connectDB } from "./db";
import { depositEntryError, depositSummary, type DepositKind, type DepositSummary } from "./deposit";
import { dateFromISO } from "./format";
import { toISODate } from "./rent";
import { DepositEntry } from "@/models/DepositEntry";
import { Rental } from "@/models/Rental";

function isDuplicateKey(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Makes sure a rental's deposit ledger exists. Idempotent and safe to call on every read:
 * - a rental with deposit > 0 gets one `received` entry (source "initial") dated at move-in —
 *   this is how rentals from before the ledger are migrated, lazily;
 * - the cached `depositHeld` guard on the rental is initialised from the ledger once.
 */
export async function ensureDepositLedger(rentalId: string | Types.ObjectId): Promise<void> {
  await connectDB();
  const rental = await Rental.findById(rentalId).select("deposit moveInDate depositHeld").lean();
  if (!rental) return;
  const initialised = typeof rental.depositHeld === "number";

  let created = false;
  if (rental.deposit > 0 && !(initialised && (await DepositEntry.exists({ rental: rental._id, source: "initial" })))) {
    await DepositEntry.init(); // the partial unique index makes the upsert race-safe
    try {
      const res = await DepositEntry.updateOne(
        { rental: rental._id, source: "initial" },
        {
          $setOnInsert: {
            rental: rental._id,
            source: "initial",
            kind: "received",
            amount: rental.deposit,
            date: rental.moveInDate,
            reason: "Security deposit at move-in",
          },
        },
        { upsert: true },
      );
      created = res.upsertedCount > 0;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err; // a concurrent call created it
    }
  }
  if (initialised) {
    // A deposit entered later (rental edited from 0 to an amount): only the call that created
    // the initial entry moves the guard.
    if (created) await Rental.updateOne({ _id: rental._id }, { $inc: { depositHeld: rental.deposit } });
    return;
  }
  // Until depositHeld exists no other entry can be added (addDepositEntry requires it),
  // so the ledger read here is complete.
  const entries = await DepositEntry.find({ rental: rental._id }).select("kind amount").lean();
  const held = Math.max(depositSummary(entries).held, 0);
  await Rental.updateOne({ _id: rental._id, depositHeld: { $exists: false } }, { $set: { depositHeld: held } });
}

export type DepositEntryRow = {
  id: string;
  kind: DepositKind;
  amount: number;
  date: string;
  reason: string;
  createdAt: string;
};

export async function loadDeposit(rentalId: string | Types.ObjectId): Promise<{ entries: DepositEntryRow[]; summary: DepositSummary }> {
  await ensureDepositLedger(rentalId);
  const rows = await DepositEntry.find({ rental: rentalId }).sort({ date: 1, createdAt: 1 }).lean();
  const entries = rows.map((e) => ({
    id: String(e._id),
    kind: e.kind as DepositKind,
    amount: e.amount,
    date: toISODate(e.date),
    reason: e.reason ?? "",
    createdAt: e.createdAt.toISOString(),
  }));
  return { entries, summary: depositSummary(entries) };
}

/**
 * Appends a ledger entry. Deductions and refunds are guarded atomically against the cached
 * held balance, so the held deposit can never go negative, even with concurrent requests.
 * Returns an error message (for the amount field) or null on success.
 */
export async function addDepositEntry(
  rentalId: Types.ObjectId,
  entry: { kind: DepositKind; amount: number; date: string; reason: string },
  userId: string | null,
): Promise<string | null> {
  await ensureDepositLedger(rentalId);
  const out = entry.kind !== "received";
  const res = await Rental.updateOne(
    out ? { _id: rentalId, depositHeld: { $gte: entry.amount } } : { _id: rentalId, depositHeld: { $exists: true } },
    { $inc: { depositHeld: out ? -entry.amount : entry.amount } },
  );
  if (res.matchedCount === 0) {
    const { summary } = await loadDeposit(rentalId);
    return depositEntryError(summary.held, entry.kind, entry.amount) ?? "The deposit changed meanwhile. Please try again.";
  }
  try {
    await DepositEntry.create({
      rental: rentalId,
      kind: entry.kind,
      amount: entry.amount,
      date: dateFromISO(entry.date),
      reason: entry.reason,
      source: "manual",
      createdBy: userId,
    });
  } catch (err) {
    // Undo the guard so it stays in step with the ledger.
    await Rental.updateOne({ _id: rentalId }, { $inc: { depositHeld: out ? entry.amount : -entry.amount } });
    throw err;
  }
  return null;
}
