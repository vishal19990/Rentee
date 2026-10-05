/**
 * Profit report (pure): income (payments received, by paid-on date) − expenses (by expense
 * date) for one Indian financial year, per property and per month. Cash basis.
 */
import { fyMonths, fyOf } from "./fy";
import { monthOf } from "./rent";

/** propertyId null = general (not tied to a property). */
export type ProfitPayment = { paidOn: string; amount: number; propertyId: string | null };
export type ProfitExpense = { date: string; amount: number; propertyId: string | null };

export type ProfitMonth = { month: string; income: number; expenses: number; profit: number };

export type ProfitRow = {
  propertyId: string | null;
  income: number;
  expenses: number;
  profit: number;
  months: ProfitMonth[];
};

export type ProfitReport = {
  fy: string;
  months: ProfitMonth[];
  properties: ProfitRow[];
  total: { income: number; expenses: number; profit: number };
};

const emptyMonths = (months: string[]): ProfitMonth[] => months.map((month) => ({ month, income: 0, expenses: 0, profit: 0 }));

export function profitReport(fy: string, payments: ProfitPayment[], expenses: ProfitExpense[]): ProfitReport {
  const months = fyMonths(fy);
  const idx = new Map(months.map((m, i) => [m, i]));
  const rows = new Map<string, ProfitRow>();
  const rowFor = (id: string | null) => {
    const key = id ?? "";
    let r = rows.get(key);
    if (!r) {
      r = { propertyId: id, income: 0, expenses: 0, profit: 0, months: emptyMonths(months) };
      rows.set(key, r);
    }
    return r;
  };
  const totals = emptyMonths(months);

  for (const p of payments) {
    if (fyOf(p.paidOn) !== fy) continue;
    const i = idx.get(monthOf(p.paidOn))!;
    const r = rowFor(p.propertyId);
    r.income += p.amount;
    r.months[i].income += p.amount;
    totals[i].income += p.amount;
  }
  for (const e of expenses) {
    if (fyOf(e.date) !== fy) continue;
    const i = idx.get(monthOf(e.date))!;
    const r = rowFor(e.propertyId);
    r.expenses += e.amount;
    r.months[i].expenses += e.amount;
    totals[i].expenses += e.amount;
  }
  for (const r of rows.values()) {
    r.profit = r.income - r.expenses;
    for (const m of r.months) m.profit = m.income - m.expenses;
  }
  for (const m of totals) m.profit = m.income - m.expenses;

  const income = totals.reduce((s, m) => s + m.income, 0);
  const exp = totals.reduce((s, m) => s + m.expenses, 0);
  // Properties by income (highest first); general expenses last.
  const properties = [...rows.values()].sort((a, b) =>
    a.propertyId === null ? 1 : b.propertyId === null ? -1 : b.income - a.income,
  );
  return { fy, months: totals, properties, total: { income, expenses: exp, profit: income - exp } };
}
