/**
 * Reports (F6), pure builders: monthly collections, tenant ledger and the financial-year
 * summary. Inputs are plain data (already loaded); amounts are integer minor units.
 * The Excel / PDF writers (reports-xlsx.ts, report-pdf.ts) and the pages render these.
 */
import { DEPOSIT_KIND_LABELS, type DepositKind } from "./deposit";
import { chargeLabel } from "./charges";
import { expenseCategoryLabel } from "./expenses";
import { fyMonths, fyOf } from "./fy";
import { profitReport, type ProfitExpense, type ProfitPayment } from "./profit";
import { monthOf, type MonthStatus, type RentMonth } from "./rent";

/* ---------------- monthly collections ---------------- */

/** A rental with its computed rent schedule (RentalRow from lib/data fits). */
export type ScheduledRental = {
  id: string;
  propertyName: string;
  tenantName: string;
  schedule: RentMonth[];
};

export type CollectionRow = {
  rentalId: string;
  propertyName: string;
  tenantName: string;
  dueDate: string;
  rent: number;
  charges: number;
  due: number;
  paid: number;
  balance: number;
  status: MonthStatus;
};

export type CollectionTotals = { rent: number; charges: number; due: number; paid: number; balance: number };

export type CollectionsReport = {
  month: string;
  rows: CollectionRow[];
  totals: CollectionTotals;
  /** Cash actually received during the month (by payment date), whatever month it paid for. */
  received: number;
};

const zeroTotals = (): CollectionTotals => ({ rent: 0, charges: 0, due: 0, paid: 0, balance: 0 });

/**
 * Who owed what for one month and how much of it was collected. A rental is included when
 * the month is in its schedule (move-in month through the current / move-out month).
 * Rows: unpaid first (largest balance first), then by property name.
 */
export function collectionsReport(
  month: string,
  rentals: ScheduledRental[],
  payments: { paidOn: string; amount: number }[] = [],
): CollectionsReport {
  const rows: CollectionRow[] = [];
  const totals = zeroTotals();
  for (const r of rentals) {
    const m = r.schedule.find((s) => s.month === month);
    if (!m) continue;
    rows.push({
      rentalId: r.id,
      propertyName: r.propertyName,
      tenantName: r.tenantName,
      dueDate: m.dueDate,
      rent: m.rent,
      charges: m.charges,
      due: m.due,
      paid: m.paid,
      balance: m.balance,
      status: m.status,
    });
    totals.rent += m.rent;
    totals.charges += m.charges;
    totals.due += m.due;
    totals.paid += m.paid;
    totals.balance += m.balance;
  }
  rows.sort((a, b) => b.balance - a.balance || a.propertyName.localeCompare(b.propertyName) || a.tenantName.localeCompare(b.tenantName));
  const received = payments.reduce((s, p) => (monthOf(p.paidOn) === month ? s + p.amount : s), 0);
  return { month, rows, totals, received };
}

export type CollectionsMonth = CollectionTotals & { month: string; received: number; rentals: number };

/** The same totals for each month of a financial year (April first). */
export function collectionsByMonth(
  fy: string,
  rentals: ScheduledRental[],
  payments: { paidOn: string; amount: number }[] = [],
): CollectionsMonth[] {
  return fyMonths(fy).map((month) => {
    const r = collectionsReport(month, rentals, payments);
    return { month, rentals: r.rows.length, received: r.received, ...r.totals };
  });
}

/* ---------------- tenant ledger ---------------- */

export type LedgerMonth = {
  month: string;
  dueDate: string;
  rent: number;
  charges: number;
  /** "Electricity ₹1,200; Water ₹300" style text is left to the renderer; this is the breakdown. */
  chargeItems: { type: string; label: string; amount: number }[];
  due: number;
  paid: number;
  balance: number;
  status: MonthStatus;
  /** Cumulative due − cumulative paid up to and including this month (negative = paid ahead). */
  outstanding: number;
};

export type LedgerPayment = { paidOn: string; forMonth: string; amount: number; method: string; note: string };

export type LedgerDepositEntry = {
  date: string;
  kind: DepositKind;
  label: string;
  amount: number;
  reason: string;
  /** Held balance after this entry. */
  held: number;
};

export type TenantLedger = {
  months: LedgerMonth[];
  payments: LedgerPayment[];
  deposit: LedgerDepositEntry[];
  totals: { rent: number; charges: number; due: number; paid: number; outstanding: number; overdue: number };
  depositHeld: number;
};

/**
 * Per-rental ledger: every scheduled month (oldest first) with rent + charges due, paid and
 * balance plus a running outstanding; the payments (oldest first); and the deposit ledger with
 * the held balance after each entry.
 */
export function tenantLedger(
  schedule: RentMonth[],
  payments: LedgerPayment[],
  depositEntries: { date: string; kind: DepositKind; amount: number; reason: string }[],
): TenantLedger {
  let running = 0;
  const totals = { rent: 0, charges: 0, due: 0, paid: 0, outstanding: 0, overdue: 0 };
  const months = [...schedule]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => {
      running += m.due - m.paid;
      totals.rent += m.rent;
      totals.charges += m.charges;
      totals.due += m.due;
      totals.paid += m.paid;
      if (m.pastDue) totals.overdue += m.balance;
      return {
        month: m.month,
        dueDate: m.dueDate,
        rent: m.rent,
        charges: m.charges,
        chargeItems: m.chargeItems.map((c) => ({ type: c.type, label: chargeLabel(c.type), amount: c.amount })),
        due: m.due,
        paid: m.paid,
        balance: m.balance,
        status: m.status,
        outstanding: running,
      };
    });
  totals.outstanding = running;

  let held = 0;
  const deposit = [...depositEntries]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.date.localeCompare(b.e.date) || a.i - b.i)
    .map(({ e }) => {
      held += e.kind === "received" ? e.amount : -e.amount;
      return { date: e.date, kind: e.kind, label: DEPOSIT_KIND_LABELS[e.kind] ?? e.kind, amount: e.amount, reason: e.reason, held };
    });

  const sortedPayments = [...payments].sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.forMonth.localeCompare(b.forMonth));
  return { months, payments: sortedPayments, deposit, totals, depositHeld: held };
}

/* ---------------- financial-year summary ---------------- */

export type FySummaryProperty = {
  propertyId: string | null;
  name: string;
  income: number;
  expenses: number;
  profit: number;
  expensesByCategory: { category: string; label: string; amount: number }[];
};

export type FySummary = {
  fy: string;
  properties: FySummaryProperty[];
  total: { income: number; expenses: number; profit: number };
  /** Total rent received in the FY (payments by paid-on date) — the figure for the ITR. */
  rentReceived: number;
  expensesByCategory: { category: string; label: string; amount: number }[];
  months: { month: string; income: number; expenses: number; profit: number }[];
};

export type FyExpense = ProfitExpense & { category: string };

function categoryList(map: Map<string, number>) {
  return [...map]
    .map(([category, amount]) => ({ category, label: expenseCategoryLabel(category), amount }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

/**
 * Per-property income (rent received, by payment date), expenses and profit for an Indian
 * financial year, with expense categories (property tax, loan interest… matter for the ITR).
 * `names` maps property id -> name; unknown ids show as "(deleted property)".
 */
export function fySummary(
  fy: string,
  payments: ProfitPayment[],
  expenses: FyExpense[],
  names: Map<string, string>,
): FySummary {
  const profit = profitReport(fy, payments, expenses);
  const inFy = expenses.filter((e) => fyOf(e.date) === fy);
  const byProp = new Map<string, Map<string, number>>();
  const all = new Map<string, number>();
  for (const e of inFy) {
    const key = e.propertyId ?? "";
    if (!byProp.has(key)) byProp.set(key, new Map());
    const m = byProp.get(key)!;
    m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
    all.set(e.category, (all.get(e.category) ?? 0) + e.amount);
  }
  const properties = profit.properties.map((r) => ({
    propertyId: r.propertyId,
    name: r.propertyId === null ? "General (no property)" : (names.get(r.propertyId) ?? "(deleted property)"),
    income: r.income,
    expenses: r.expenses,
    profit: r.profit,
    expensesByCategory: categoryList(byProp.get(r.propertyId ?? "") ?? new Map()),
  }));
  return {
    fy,
    properties,
    total: profit.total,
    rentReceived: profit.total.income,
    expensesByCategory: categoryList(all),
    months: profit.months,
  };
}

/* ---------------- helpers shared by the writers ---------------- */

export const MONTH_STATUS_LABELS: Record<MonthStatus, string> = {
  paid: "Paid",
  partial: "Partial",
  overdue: "Overdue",
  upcoming: "Upcoming",
};

/** A file-name-safe slug: "Green Villa / Flat 2" -> "green-villa-flat-2". */
export function fileSlug(s: string, fallback = "report"): string {
  const slug = s
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** Content-Disposition value for a download with a safe ASCII name plus the UTF-8 name. */
export function attachmentHeader(name: string): string {
  const ascii = name.replace(/[^\w.\- ]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
