import "server-only";
/**
 * Server loaders for the reports (F6). Shared by the /reports pages and the export routes so
 * the screen and the downloaded files always show the same numbers.
 */
import { asObjectId, loadRentals, propertyOptions, toId, type RentalRow } from "./data";
import { connectDB } from "./db";
import { loadDeposit } from "./deposit-store";
import { dateFromISO } from "./format";
import { fyList, fyRange } from "./fy";
import { addMonths, localToday, toISODate } from "./rent";
import {
  collectionsByMonth,
  collectionsReport,
  fySummary,
  tenantLedger,
  type CollectionsMonth,
  type CollectionsReport,
  type FySummary,
  type TenantLedger,
} from "./reports";
import { Expense } from "@/models/Expense";
import { Payment } from "@/models/Payment";
import { Rental } from "@/models/Rental";
import { Tenant } from "@/models/Tenant";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(s: unknown): s is string {
  return typeof s === "string" && MONTH_RE.test(s);
}

/** FY options for pickers: from the earliest payment / expense / move-in through today, newest first. */
export async function reportYears(today = localToday()): Promise<string[]> {
  await connectDB();
  const [p, e, r] = await Promise.all([
    Payment.findOne().sort({ paidOn: 1 }).select("paidOn").lean(),
    Expense.findOne().sort({ date: 1 }).select("date").lean(),
    Rental.findOne().sort({ moveInDate: 1 }).select("moveInDate").lean(),
  ]);
  const earliest = [p?.paidOn, e?.date, r?.moveInDate].filter(Boolean).map((d) => toISODate(d!)).sort()[0] ?? today;
  return fyList(earliest < today ? earliest : today, today);
}

export type CollectionsData = { report: CollectionsReport; byMonth: CollectionsMonth[] };

/** Collections for one month plus the month-by-month totals of the FY it falls in. */
export async function loadCollections(month: string, fy: string, today = localToday()): Promise<CollectionsData> {
  const rentals = await loadRentals({}, today);
  const { start, endExclusive } = fyRange(fy);
  const monthStart = `${month}-01`;
  const nextMonthStart = `${addMonths(month, 1)}-01`;
  const lo = monthStart < start ? monthStart : start;
  const hi = nextMonthStart > endExclusive ? nextMonthStart : endExclusive;
  const payments = await Payment.find({ paidOn: { $gte: dateFromISO(lo), $lt: dateFromISO(hi) } })
    .select("paidOn amount")
    .lean();
  const cash = payments.map((p) => ({ paidOn: toISODate(p.paidOn), amount: p.amount }));
  return { report: collectionsReport(month, rentals, cash), byMonth: collectionsByMonth(fy, rentals, cash) };
}

export type LedgerData = { rental: RentalRow; ledger: TenantLedger };

/** One rental's ledger, or null if the id is unknown. */
export async function loadLedger(rentalId: string, today = localToday()): Promise<LedgerData | null> {
  const _id = asObjectId(rentalId);
  if (!_id) return null;
  const [rental] = await loadRentals({ _id }, today);
  if (!rental) return null;
  const [payments, deposit] = await Promise.all([
    Payment.find({ rental: _id }).sort({ paidOn: 1, createdAt: 1 }).select("paidOn forMonth amount method note").lean(),
    loadDeposit(_id),
  ]);
  const ledger = tenantLedger(
    rental.schedule,
    payments.map((p) => ({ paidOn: toISODate(p.paidOn), forMonth: p.forMonth, amount: p.amount, method: p.method, note: p.note ?? "" })),
    deposit.entries,
  );
  return { rental, ledger };
}

export type LedgerOption = { id: string; label: string; tenantId: string; tenantName: string; propertyName: string };

/** Rentals for the ledger picker, optionally for one tenant; active first, newest move-in first. */
export async function ledgerOptions(tenantId?: string): Promise<LedgerOption[]> {
  await connectDB();
  const tid = tenantId ? asObjectId(tenantId) : null;
  const rentals = await Rental.find(tid ? { tenant: tid } : {})
    .sort({ status: 1, moveInDate: -1 })
    .select("property tenant moveInDate moveOutDate")
    .populate<{ property: { name: string } | null; tenant: { _id: unknown; name: string } | null }>([
      { path: "property", select: "name" },
      { path: "tenant", select: "name" },
    ])
    .lean();
  return rentals.map((r) => {
    const propertyName = r.property?.name ?? "(deleted property)";
    const tenantName = r.tenant?.name ?? "(deleted tenant)";
    const stay = `${toISODate(r.moveInDate).slice(0, 7)}${r.moveOutDate ? ` to ${toISODate(r.moveOutDate).slice(0, 7)}` : ""}`;
    return { id: toId(r._id), label: `${tenantName} — ${propertyName} (${stay})`, tenantId: r.tenant ? toId(r.tenant._id) : "", tenantName, propertyName };
  });
}

/** Name of a tenant (for headings), or null. */
export async function tenantName(tenantId: string): Promise<string | null> {
  const _id = asObjectId(tenantId);
  if (!_id) return null;
  await connectDB();
  const t = await Tenant.findById(_id).select("name").lean();
  return t?.name ?? null;
}

/** FY summary: income by payment date and expenses by date, per property. */
export async function loadFySummary(fy: string): Promise<FySummary> {
  const { start, endExclusive } = fyRange(fy);
  const range = { $gte: dateFromISO(start), $lt: dateFromISO(endExclusive) };
  await connectDB();
  const [payments, expenses, properties] = await Promise.all([
    Payment.find({ paidOn: range }).select("rental paidOn amount").lean(),
    Expense.find({ date: range }).select("property date amount category").lean(),
    propertyOptions({ includeArchived: true }),
  ]);
  const rentals = await Rental.find({ _id: { $in: [...new Set(payments.map((p) => toId(p.rental)))] } })
    .select("property")
    .lean();
  const propertyOfRental = new Map(rentals.map((r) => [toId(r._id), toId(r.property)]));
  return fySummary(
    fy,
    payments.map((p) => ({ paidOn: toISODate(p.paidOn), amount: p.amount, propertyId: propertyOfRental.get(toId(p.rental)) ?? null })),
    expenses.map((e) => ({
      date: toISODate(e.date),
      amount: e.amount,
      category: e.category,
      propertyId: e.property ? toId(e.property) : null,
    })),
    new Map(properties.map((p) => [p.id, p.name])),
  );
}
