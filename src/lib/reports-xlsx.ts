/**
 * Excel (.xlsx) writers for the reports (F6), via exceljs. Money is written as numbers in major
 * units (so the landlord can sum / chart them) with a currency number format; dates as text
 * (YYYY-MM-DD) to avoid timezone drift.
 */
import ExcelJS from "exceljs";
import { CURRENCY, minorDigits } from "./money";
import { formatMonth } from "./rent";
import {
  MONTH_STATUS_LABELS,
  type CollectionsMonth,
  type CollectionsReport,
  type FySummary,
  type TenantLedger,
} from "./reports";
import { titleCase } from "./format";

type Col = { header: string; key: string; width: number; money?: boolean };
type Cell = string | number | null;

const major = (minor: number) => minor / 10 ** minorDigits();

function moneyFormat(): string {
  const d = minorDigits();
  return d > 0 ? `#,##0.${"0".repeat(d)};[Red]-#,##0.${"0".repeat(d)}` : "#,##0;[Red]-#,##0";
}

function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Rentee";
  wb.created = new Date();
  return wb;
}

/** Adds a sheet: optional title lines, a bold frozen header, rows, and an optional bold totals row. */
function addTable(
  wb: ExcelJS.Workbook,
  name: string,
  title: string[],
  cols: Col[],
  rows: Record<string, Cell>[],
  totals?: Record<string, Cell>,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name.slice(0, 31));
  for (const line of title) {
    const r = ws.addRow([line]);
    if (r.number === 1) r.font = { bold: true, size: 13 };
  }
  if (title.length) ws.addRow([]);
  const header = ws.addRow(cols.map((c) => (c.money ? `${c.header} (${CURRENCY})` : c.header)));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF94A3B8" } } };
  });
  ws.views = [{ state: "frozen", ySplit: header.number }];
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  const fmt = moneyFormat();
  const put = (values: Record<string, Cell>, bold = false) => {
    const row = ws.addRow(cols.map((c) => {
      const v = values[c.key];
      return c.money && typeof v === "number" ? major(v) : (v ?? null);
    }));
    cols.forEach((c, i) => {
      if (c.money) row.getCell(i + 1).numFmt = fmt;
    });
    if (bold) {
      row.font = { bold: true };
      row.eachCell((cell) => {
        cell.border = { top: { style: "thin", color: { argb: "FF94A3B8" } } };
      });
    }
  };
  for (const r of rows) put(r);
  if (totals) put(totals, true);
  return ws;
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  const out = await wb.xlsx.writeBuffer();
  return new Uint8Array(out as ArrayBuffer);
}

export async function collectionsXlsx(data: { report: CollectionsReport; byMonth: CollectionsMonth[]; fy: string }): Promise<Uint8Array> {
  const wb = newWorkbook();
  const { report, byMonth, fy } = data;
  addTable(
    wb,
    formatMonth(report.month),
    [`Collections — ${formatMonth(report.month)}`, `Cash received in the month (any rent month): ${major(report.received)} ${CURRENCY}`],
    [
      { header: "Property", key: "property", width: 28 },
      { header: "Tenant", key: "tenant", width: 24 },
      { header: "Due date", key: "dueDate", width: 12 },
      { header: "Rent", key: "rent", width: 14, money: true },
      { header: "Charges", key: "charges", width: 14, money: true },
      { header: "Due", key: "due", width: 14, money: true },
      { header: "Paid", key: "paid", width: 14, money: true },
      { header: "Balance", key: "balance", width: 14, money: true },
      { header: "Status", key: "status", width: 11 },
    ],
    report.rows.map((r) => ({
      property: r.propertyName,
      tenant: r.tenantName,
      dueDate: r.dueDate,
      rent: r.rent,
      charges: r.charges,
      due: r.due,
      paid: r.paid,
      balance: r.balance,
      status: MONTH_STATUS_LABELS[r.status],
    })),
    { property: "Total", ...report.totals },
  );
  const sum = (k: "rent" | "charges" | "due" | "paid" | "balance" | "received") => byMonth.reduce((s, m) => s + m[k], 0);
  addTable(
    wb,
    `FY ${fy} by month`,
    [`Collections by month — FY ${fy}`, "Due / paid / balance are for each rent month; received is cash by payment date."],
    [
      { header: "Month", key: "month", width: 12 },
      { header: "Rentals", key: "rentals", width: 9 },
      { header: "Rent", key: "rent", width: 14, money: true },
      { header: "Charges", key: "charges", width: 14, money: true },
      { header: "Due", key: "due", width: 14, money: true },
      { header: "Paid", key: "paid", width: 14, money: true },
      { header: "Balance", key: "balance", width: 14, money: true },
      { header: "Received", key: "received", width: 14, money: true },
    ],
    byMonth.map((m) => ({ ...m, month: formatMonth(m.month) })),
    {
      month: "Total",
      rentals: null,
      rent: sum("rent"),
      charges: sum("charges"),
      due: sum("due"),
      paid: sum("paid"),
      balance: sum("balance"),
      received: sum("received"),
    },
  );
  return toBuffer(wb);
}

export type LedgerHeading = { tenantName: string; propertyName: string; stay: string; generatedOn: string };

export async function ledgerXlsx(h: LedgerHeading, ledger: TenantLedger): Promise<Uint8Array> {
  const wb = newWorkbook();
  const title = [`Tenant ledger — ${h.tenantName}`, `${h.propertyName} · ${h.stay}`, `Generated ${h.generatedOn}`];
  addTable(
    wb,
    "Rent",
    title,
    [
      { header: "Month", key: "month", width: 12 },
      { header: "Due date", key: "dueDate", width: 12 },
      { header: "Rent", key: "rent", width: 14, money: true },
      { header: "Charges", key: "charges", width: 14, money: true },
      { header: "Charge details", key: "details", width: 32 },
      { header: "Due", key: "due", width: 14, money: true },
      { header: "Paid", key: "paid", width: 14, money: true },
      { header: "Balance", key: "balance", width: 14, money: true },
      { header: "Status", key: "status", width: 11 },
      { header: "Running outstanding", key: "outstanding", width: 20, money: true },
    ],
    ledger.months.map((m) => ({
      month: formatMonth(m.month),
      dueDate: m.dueDate,
      rent: m.rent,
      charges: m.charges,
      details: m.chargeItems.map((c) => `${c.label} ${major(c.amount)}`).join("; "),
      due: m.due,
      paid: m.paid,
      balance: m.balance,
      status: MONTH_STATUS_LABELS[m.status],
      outstanding: m.outstanding,
    })),
    {
      month: "Total",
      rent: ledger.totals.rent,
      charges: ledger.totals.charges,
      due: ledger.totals.due,
      paid: ledger.totals.paid,
      outstanding: ledger.totals.outstanding,
    },
  );
  addTable(
    wb,
    "Payments",
    title,
    [
      { header: "Paid on", key: "paidOn", width: 12 },
      { header: "For month", key: "forMonth", width: 12 },
      { header: "Amount", key: "amount", width: 14, money: true },
      { header: "Method", key: "method", width: 14 },
      { header: "Note", key: "note", width: 36 },
    ],
    ledger.payments.map((p) => ({ ...p, forMonth: formatMonth(p.forMonth), method: titleCase(p.method) })),
    { paidOn: "Total", amount: ledger.payments.reduce((s, p) => s + p.amount, 0) },
  );
  addTable(
    wb,
    "Deposit",
    title,
    [
      { header: "Date", key: "date", width: 12 },
      { header: "Entry", key: "label", width: 12 },
      { header: "Amount", key: "amount", width: 14, money: true },
      { header: "Reason", key: "reason", width: 36 },
      { header: "Held after", key: "held", width: 14, money: true },
    ],
    ledger.deposit.map((d) => ({ ...d, amount: d.kind === "received" ? d.amount : -d.amount })),
    { date: "Held now", held: ledger.depositHeld },
  );
  return toBuffer(wb);
}

export async function fySummaryXlsx(s: FySummary): Promise<Uint8Array> {
  const wb = newWorkbook();
  const [y] = s.fy.split("-");
  const title = [`Financial year summary — FY ${s.fy}`, `1 Apr ${y} – 31 Mar ${Number(y) + 1}. Income is rent received, by payment date.`];
  addTable(
    wb,
    "By property",
    [...title, `Total rent received (for ITR): ${major(s.rentReceived)} ${CURRENCY}`],
    [
      { header: "Property", key: "name", width: 30 },
      { header: "Income", key: "income", width: 15, money: true },
      { header: "Expenses", key: "expenses", width: 15, money: true },
      { header: "Profit", key: "profit", width: 15, money: true },
    ],
    s.properties.map((p) => ({ name: p.name, income: p.income, expenses: p.expenses, profit: p.profit })),
    { name: "Total", ...s.total },
  );
  addTable(
    wb,
    "Expenses",
    title,
    [
      { header: "Property", key: "name", width: 30 },
      { header: "Category", key: "label", width: 20 },
      { header: "Amount", key: "amount", width: 15, money: true },
    ],
    s.properties.flatMap((p) => p.expensesByCategory.map((c) => ({ name: p.name, label: c.label, amount: c.amount }))),
    { name: "Total", amount: s.total.expenses },
  );
  addTable(
    wb,
    "By month",
    title,
    [
      { header: "Month", key: "month", width: 12 },
      { header: "Income", key: "income", width: 15, money: true },
      { header: "Expenses", key: "expenses", width: 15, money: true },
      { header: "Profit", key: "profit", width: 15, money: true },
    ],
    s.months.map((m) => ({ ...m, month: formatMonth(m.month) })),
    { month: "Total", ...s.total },
  );
  return toBuffer(wb);
}
