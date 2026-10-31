import "server-only";
import { Types } from "mongoose";
import { connectDB } from "./db";
import {
  agreedDepositError,
  depositEntryError,
  depositEntryLabel,
  depositLedgerError,
  depositPaymentError,
  depositStatus,
  depositSummary,
  type DepositKind,
  type DepositMethod,
  type DepositStatus,
  type DepositSummary,
} from "./deposit";
import { dateFromISO } from "./format";
import { ensureDepositReceiptNo } from "./receipt-store";
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
  const rental = await Rental.findById(rentalId)
    .select("deposit moveInDate depositHeld depositAdvance depositReceived depositInitialRemoved")
    .lean();
  if (!rental) return;
  const initialised = typeof rental.depositHeld === "number";
  // Advance-flow rentals open the ledger with the advance taken at creation (none when 0);
  // older rentals with the whole deposit, received at move-in.
  const adv = rental.depositAdvance ?? null;
  const initialAmount = adv ? adv.amount : rental.deposit;

  let created = false;
  if (
    initialAmount > 0 &&
    !rental.depositInitialRemoved &&
    !(initialised && (await DepositEntry.exists({ rental: rental._id, source: "initial" })))
  ) {
    await DepositEntry.init(); // the partial unique index makes the upsert race-safe
    try {
      const res = await DepositEntry.updateOne(
        { rental: rental._id, source: "initial" },
        {
          $setOnInsert: {
            rental: rental._id,
            source: "initial",
            kind: "received",
            amount: initialAmount,
            date: adv ? adv.date : rental.moveInDate,
            reason: adv ? "" : "Security deposit at move-in",
          },
        },
        { upsert: true },
      );
      created = res.upsertedCount > 0;
      // New advance payments get their receipt number when recorded.
      if (created && adv && res.upsertedId) await ensureDepositReceiptNo(res.upsertedId as Types.ObjectId);
    } catch (err) {
      if (!isDuplicateKey(err)) throw err; // a concurrent call created it
    }
  }
  if (initialised) {
    // A deposit entered later (rental edited from 0 to an amount): only the call that created
    // the initial entry moves the guard.
    if (created) await Rental.updateOne({ _id: rental._id }, { $inc: { depositHeld: initialAmount } });
    return;
  }
  // Until depositHeld exists no other entry can be added (addDepositEntry requires it),
  // so the ledger read here is complete.
  const entries = await DepositEntry.find({ rental: rental._id }).select("kind amount").lean();
  const summary = depositSummary(entries);
  const held = Math.max(summary.held, 0);
  // Advance-flow rentals also cache the total received (the guard for payments), set together.
  await Rental.updateOne(
    { _id: rental._id, depositHeld: { $exists: false } },
    { $set: adv ? { depositHeld: held, depositReceived: summary.received } : { depositHeld: held } },
  );
}

export type DepositEntryRow = {
  id: string;
  kind: DepositKind;
  amount: number;
  date: string;
  reason: string;
  createdAt: string;
  /** Payment method of a received entry, if recorded. */
  method: string | null;
  receiptNo: string | null;
  /** Advance / Part payment / Deduction / Refund. */
  label: string;
};

export async function loadDeposit(rentalId: string | Types.ObjectId): Promise<{
  entries: DepositEntryRow[];
  summary: DepositSummary;
  /** Deposit quoted, advance, paid later and balance. */
  status: DepositStatus;
  /** Created with the advance flow (the deposit may be paid in parts). */
  advanceFlow: boolean;
}> {
  await ensureDepositLedger(rentalId);
  const [rows, rental] = await Promise.all([
    DepositEntry.find({ rental: rentalId }).sort({ date: 1, createdAt: 1 }).lean(),
    Rental.findById(rentalId).select("deposit moveInDate depositAdvance").lean(),
  ]);
  const moveInDate = rental ? toISODate(rental.moveInDate) : "";
  const entries = rows.map((e) => {
    const date = toISODate(e.date);
    return {
      id: String(e._id),
      kind: e.kind as DepositKind,
      amount: e.amount,
      date,
      reason: e.reason ?? "",
      createdAt: e.createdAt.toISOString(),
      method: e.method ?? null,
      receiptNo: e.receiptNo ?? null,
      label: depositEntryLabel({ kind: e.kind, date }, moveInDate),
    };
  });
  const advanceFlow = !!rental?.depositAdvance;
  const status = depositStatus({ deposit: rental?.deposit ?? 0, moveInDate, advanceFlow }, entries);
  return { entries, summary: depositSummary(entries), status, advanceFlow };
}

/**
 * Records a deposit payment ("Add deposit payment"). On advance-flow rentals it is guarded
 * atomically so the total received never exceeds the agreed deposit; the entry gets its
 * receipt number straight away. Returns an error message (for the amount field) or null.
 */
export async function addDepositPayment(
  rentalId: Types.ObjectId,
  payment: { amount: number; date: string; method: DepositMethod; note: string },
  userId: string | null,
): Promise<string | null> {
  return addDepositEntry(rentalId, { kind: "received", amount: payment.amount, date: payment.date, reason: payment.note, method: payment.method }, userId);
}

/**
 * Appends a ledger entry. Deductions and refunds are guarded atomically against the cached
 * held balance, so the held deposit can never go negative, even with concurrent requests.
 * Returns an error message (for the amount field) or null on success.
 */
export async function addDepositEntry(
  rentalId: Types.ObjectId,
  entry: { kind: DepositKind; amount: number; date: string; reason: string; method?: DepositMethod | null },
  userId: string | null,
): Promise<string | null> {
  await ensureDepositLedger(rentalId);
  const out = entry.kind !== "received";
  // Advance-flow rentals: money in can't take the total received past the agreed deposit.
  const capped = !out && !!(await Rental.exists({ _id: rentalId, depositAdvance: { $ne: null } }));
  const inc = capped
    ? { depositHeld: entry.amount, depositReceived: entry.amount }
    : { depositHeld: out ? -entry.amount : entry.amount };
  const res = await Rental.updateOne(
    out
      ? { _id: rentalId, depositHeld: { $gte: entry.amount } }
      : capped
        ? {
            _id: rentalId,
            depositHeld: { $exists: true },
            depositReceived: { $exists: true },
            $expr: { $lte: [{ $add: ["$depositReceived", entry.amount] }, "$deposit"] },
          }
        : { _id: rentalId, depositHeld: { $exists: true } },
    { $inc: inc },
  );
  if (res.matchedCount === 0) {
    const { summary, status } = await loadDeposit(rentalId);
    const error = capped ? depositPaymentError(status.balance, entry.amount) : depositEntryError(summary.held, entry.kind, entry.amount);
    return error ?? "The deposit changed meanwhile. Please try again.";
  }
  let id: Types.ObjectId;
  try {
    const doc = await DepositEntry.create({
      rental: rentalId,
      kind: entry.kind,
      amount: entry.amount,
      date: dateFromISO(entry.date),
      reason: entry.reason,
      source: "manual",
      createdBy: userId,
      method: entry.method ?? null,
    });
    id = doc._id;
  } catch (err) {
    // Undo the guard so it stays in step with the ledger.
    const undo = Object.fromEntries(Object.entries(inc).map(([k, v]) => [k, -v]));
    await Rental.updateOne({ _id: rentalId }, { $inc: undo });
    throw err;
  }
  if (entry.kind === "received") await ensureDepositReceiptNo(id);
  return null;
}

/**
 * Edits or deletes one ledger entry (`patch` null = delete). The ledger as it would be
 * afterwards is validated (held ≥ 0; advance-flow: received ≤ deposit quoted), then the change
 * is written and the cached guards are recomputed from the ledger. Returns an error message
 * (for the amount field) or null. Not atomic against a simultaneous new entry on the same
 * rental — acceptable for a single landlord editing their own ledger.
 */
export async function changeDepositEntry(
  rentalId: Types.ObjectId,
  entryId: Types.ObjectId,
  patch: { amount: number; date: string; reason: string; method?: DepositMethod | null } | null,
): Promise<string | null> {
  await ensureDepositLedger(rentalId);
  const [rental, rows] = await Promise.all([
    Rental.findById(rentalId).select("deposit depositAdvance").lean(),
    DepositEntry.find({ rental: rentalId }).select("kind amount source").lean(),
  ]);
  const target = rows.find((e) => e._id.equals(entryId));
  if (!rental || !target) return "Deposit entry not found.";
  const next = patch
    ? rows.map((e) => (e._id.equals(entryId) ? { kind: e.kind, amount: patch.amount } : e))
    : rows.filter((e) => !e._id.equals(entryId));
  const error = depositLedgerError(next, { deposit: rental.deposit, advanceFlow: !!rental.depositAdvance });
  if (error) return error;

  if (patch) {
    const set: Record<string, unknown> = { amount: patch.amount, date: dateFromISO(patch.date), reason: patch.reason };
    if (target.kind === "received") set.method = patch.method ?? null;
    await DepositEntry.updateOne({ _id: entryId, rental: rentalId }, { $set: set });
  } else {
    await DepositEntry.deleteOne({ _id: entryId, rental: rentalId });
    // Keep a deleted opening entry from being re-created on the next read.
    if (target.source === "initial") await Rental.updateOne({ _id: rentalId }, { $set: { depositInitialRemoved: true } });
  }

  const summary = depositSummary(await DepositEntry.find({ rental: rentalId }).select("kind amount").lean());
  await Rental.updateOne(
    { _id: rentalId },
    {
      $set: rental.depositAdvance
        ? { depositHeld: Math.max(summary.held, 0), depositReceived: summary.received }
        : { depositHeld: Math.max(summary.held, 0) },
    },
  );
  return null;
}

/**
 * Changing the agreed deposit of an advance-flow rental: refused below the total already
 * received. Returns an error message or null. Older rentals are not checked. (updateRental also
 * filters on the cached depositReceived, so a payment racing the edit can't slip past.)
 */
export async function agreedDepositGuard(rentalId: Types.ObjectId, agreed: number): Promise<string | null> {
  const rental = await Rental.findById(rentalId).select("depositAdvance").lean();
  if (!rental?.depositAdvance) return null;
  const { summary } = await loadDeposit(rentalId);
  return agreedDepositError(agreed, summary.received);
}
