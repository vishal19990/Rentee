/**
 * Landlord features pack F6 (reports & export): collections, tenant ledger, FY summary, and
 * the Excel / PDF writers. Amounts are minor units (paise).
 */
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { ledgerPdf, fySummaryPdf, pdfMoney } from "./report-pdf";
import { attachmentHeader, collectionsByMonth, collectionsReport, fileSlug, fySummary, tenantLedger, type ScheduledRental } from "./reports";
import { collectionsXlsx, fySummaryXlsx, ledgerXlsx } from "./reports-xlsx";
import { rentSchedule, type RentalLike } from "./rent";

const R = (rupees: number) => rupees * 100;
const TODAY = "2026-10-20";

// Rent 10,000 from Jun 2026, raised to 11,000 from Sep; Oct electricity 1,200; Oct paid 10,000.
const rentalA: RentalLike = {
  moveInDate: "2026-06-01",
  monthlyRent: R(10000),
  dueDay: 5,
  rentChanges: [{ effectiveMonth: "2026-09", monthlyRent: R(11000) }],
  charges: [{ month: "2026-10", type: "electricity", amount: R(1200) }],
};
const paymentsA = [
  { forMonth: "2026-06", amount: R(10000) },
  { forMonth: "2026-07", amount: R(10000) },
  { forMonth: "2026-08", amount: R(10000) },
  { forMonth: "2026-09", amount: R(11000) },
  { forMonth: "2026-10", amount: R(10000) },
];
const scheduleA = rentSchedule(rentalA, paymentsA, TODAY);

const rentalB: RentalLike = { moveInDate: "2026-09-15", monthlyRent: R(8000), dueDay: 20 };
const scheduleB = rentSchedule(rentalB, [], TODAY);

const rentals: ScheduledRental[] = [
  { id: "a", propertyName: "Green Villa", tenantName: "Asha", schedule: scheduleA },
  { id: "b", propertyName: "Blue Flat", tenantName: "Ravi", schedule: scheduleB },
];

describe("collectionsReport", () => {
  it("sorts by balance (largest first) and totals the month", () => {
    const r = collectionsReport("2026-10", rentals, [
      { paidOn: "2026-10-03", amount: R(10000) },
      { paidOn: "2026-09-30", amount: R(11000) },
    ]);
    const [first, second] = r.rows;
    expect(first).toMatchObject({ rentalId: "b", due: R(8000), paid: 0, balance: R(8000), status: "upcoming" });
    expect(second).toMatchObject({ rentalId: "a", rent: R(11000), charges: R(1200), due: R(12200), paid: R(10000), balance: R(2200), status: "partial" });
    expect(r.totals).toEqual({ rent: R(19000), charges: R(1200), due: R(20200), paid: R(10000), balance: R(10200) });
    expect(r.received).toBe(R(10000)); // only cash dated in October
  });

  it("excludes rentals not occupying the month", () => {
    const r = collectionsReport("2026-07", rentals);
    expect(r.rows.map((x) => x.rentalId)).toEqual(["a"]);
    expect(r.rows[0]).toMatchObject({ rent: R(10000), due: R(10000), status: "paid" });
  });

  it("gives 12 FY months, April first, with zeros where nothing was due", () => {
    const months = collectionsByMonth("2026-27", rentals, []);
    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({ month: "2026-04", due: 0, rentals: 0 });
    expect(months.find((m) => m.month === "2026-09")).toMatchObject({ due: R(11000 + 8000), paid: R(11000), rentals: 2 });
    expect(months[11].month).toBe("2027-03");
  });
});

describe("tenantLedger", () => {
  const ledger = tenantLedger(
    scheduleA,
    [
      { paidOn: "2026-10-03", forMonth: "2026-10", amount: R(10000), method: "upi", note: "" },
      { paidOn: "2026-06-02", forMonth: "2026-06", amount: R(10000), method: "cash", note: "first" },
    ],
    [
      { date: "2026-10-31", kind: "refund", amount: R(5000), reason: "" },
      { date: "2026-06-01", kind: "received", amount: R(20000), reason: "Security deposit at move-in" },
      { date: "2026-10-31", kind: "deduction", amount: R(3000), reason: "Paint" },
    ],
  );

  it("uses the per-month rent (rent change) and charges, with a running outstanding", () => {
    expect(ledger.months.map((m) => [m.month, m.rent, m.charges, m.due, m.paid, m.balance, m.outstanding])).toEqual([
      ["2026-06", R(10000), 0, R(10000), R(10000), 0, 0],
      ["2026-07", R(10000), 0, R(10000), R(10000), 0, 0],
      ["2026-08", R(10000), 0, R(10000), R(10000), 0, 0],
      ["2026-09", R(11000), 0, R(11000), R(11000), 0, 0],
      ["2026-10", R(11000), R(1200), R(12200), R(10000), R(2200), R(2200)],
    ]);
    expect(ledger.months[4].chargeItems).toEqual([{ type: "electricity", label: "Electricity", amount: R(1200) }]);
    expect(ledger.months[4].status).toBe("partial");
    expect(ledger.totals).toMatchObject({ rent: R(52000), charges: R(1200), due: R(53200), paid: R(51000), outstanding: R(2200), overdue: R(2200) });
  });

  it("shows an overpayment as a negative running outstanding", () => {
    const s = rentSchedule({ moveInDate: "2026-09-01", monthlyRent: R(5000), dueDay: 5 }, [{ forMonth: "2026-09", amount: R(10000) }], TODAY);
    const l = tenantLedger(s, [], []);
    expect(l.months.map((m) => m.outstanding)).toEqual([-R(5000), 0]); // Oct unpaid uses up the credit
    expect(l.totals.outstanding).toBe(0);
  });

  it("orders payments and deposit entries by date and tracks the held deposit", () => {
    expect(ledger.payments.map((p) => p.paidOn)).toEqual(["2026-06-02", "2026-10-03"]);
    expect(ledger.deposit.map((d) => [d.label, d.held])).toEqual([
      ["Received", R(20000)],
      ["Refund", R(15000)], // same-day entries keep their recorded order
      ["Deduction", R(12000)],
    ]);
    expect(ledger.depositHeld).toBe(R(12000));
  });
});

describe("fySummary", () => {
  const names = new Map([
    ["p1", "Green Villa"],
    ["p2", "Blue Flat"],
  ]);

  it("profit = income − expenses per property (1,20,000 − 30,000 = 90,000), with categories", () => {
    const s = fySummary(
      "2026-27",
      [
        { paidOn: "2026-05-10", amount: R(60000), propertyId: "p1" },
        { paidOn: "2027-03-31", amount: R(60000), propertyId: "p1" }, // last day of FY 2026-27
        { paidOn: "2027-04-01", amount: R(99999), propertyId: "p1" }, // FY 2027-28: excluded
      ],
      [
        { date: "2026-08-01", amount: R(20000), propertyId: "p1", category: "property_tax" },
        { date: "2026-09-01", amount: R(10000), propertyId: "p1", category: "repair" },
        { date: "2026-09-02", amount: R(5000), propertyId: null, category: "other" },
        { date: "2026-03-31", amount: R(7777), propertyId: "p2", category: "repair" }, // FY 2025-26: excluded
      ],
      names,
    );
    const p1 = s.properties.find((p) => p.propertyId === "p1")!;
    expect(p1).toMatchObject({ name: "Green Villa", income: R(120000), expenses: R(30000), profit: R(90000) });
    expect(p1.expensesByCategory).toEqual([
      { category: "property_tax", label: "Property tax", amount: R(20000) },
      { category: "repair", label: "Repair", amount: R(10000) },
    ]);
    expect(s.properties.at(-1)).toMatchObject({ propertyId: null, name: "General (no property)", expenses: R(5000) });
    expect(s.properties.some((p) => p.propertyId === "p2")).toBe(false);
    expect(s.rentReceived).toBe(R(120000));
    expect(s.total).toEqual({ income: R(120000), expenses: R(35000), profit: R(85000) });
    expect(s.expensesByCategory.map((c) => c.category)).toEqual(["property_tax", "repair", "other"]);
    expect(s.months).toHaveLength(12);
  });

  it("names unknown properties", () => {
    const s = fySummary("2026-27", [{ paidOn: "2026-05-10", amount: 100, propertyId: "gone" }], [], names);
    expect(s.properties[0].name).toBe("(deleted property)");
  });
});

describe("helpers", () => {
  it("fileSlug and attachmentHeader produce safe names", () => {
    expect(fileSlug("Green Villa / Flat #2")).toBe("green-villa-flat-2");
    expect(fileSlug("राम")).toBe("report");
    expect(attachmentHeader("ledger-é.pdf")).toBe(`attachment; filename="ledger-_.pdf"; filename*=UTF-8''ledger-%C3%A9.pdf`);
  });

  it("pdfMoney keeps the ₹ sign (report PDFs use the Unicode fonts)", () => {
    expect(pdfMoney(R(120000))).toContain("₹");
  });
});

describe("export files", () => {
  const ledger = tenantLedger(scheduleA, [{ paidOn: "2026-06-02", forMonth: "2026-06", amount: R(10000), method: "upi", note: "" }], [
    { date: "2026-06-01", kind: "received", amount: R(20000), reason: "Security deposit at move-in" },
  ]);
  const heading = { tenantName: "Asha ₹ राम", propertyName: "Green Villa", stay: "1 Jun 2026 – present", generatedOn: "20 Oct 2026" };
  const summary = fySummary("2026-27", [{ paidOn: "2026-05-10", amount: R(120000), propertyId: "p1" }], [
    { date: "2026-08-01", amount: R(30000), propertyId: "p1", category: "property_tax" },
  ], new Map([["p1", "Green Villa"]]));

  async function readXlsx(buf: Uint8Array) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(buf) as unknown as ArrayBuffer);
    return wb;
  }
  const findRow = (ws: ExcelJS.Worksheet, first: string) => {
    let found: ExcelJS.Row | null = null;
    ws.eachRow((row) => {
      if (!found && row.getCell(1).value === first) found = row;
    });
    return found as ExcelJS.Row | null;
  };

  it("ledger workbook has Rent, Payments and Deposit sheets with amounts in rupees", async () => {
    const wb = await readXlsx(await ledgerXlsx(heading, ledger));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Rent", "Payments", "Deposit"]);
    const oct = findRow(wb.getWorksheet("Rent")!, "Oct 2026")!;
    expect(oct.getCell(5).value).toBe("Electricity 1200");
    expect(oct.getCell(6).value).toBe(12200); // due
    expect(oct.getCell(6).numFmt).toContain("#,##0.00");
    expect(findRow(wb.getWorksheet("Deposit")!, "Held now")!.getCell(5).value).toBe(20000);
  });

  it("collections and FY workbooks", async () => {
    const months = collectionsByMonth("2026-27", rentals);
    const c = await readXlsx(await collectionsXlsx({ report: collectionsReport("2026-10", rentals), byMonth: months, fy: "2026-27" }));
    expect(c.worksheets.map((w) => w.name)).toEqual(["Oct 2026", "FY 2026-27 by month"]);
    expect(findRow(c.worksheets[0], "Total")!.getCell(6).value).toBe(20200);
    const f = await readXlsx(await fySummaryXlsx(summary));
    expect(findRow(f.getWorksheet("By property")!, "Green Villa")!.getCell(4).value).toBe(90000);
  });

  it("PDFs are valid documents, even with non-Latin names", async () => {
    for (const bytes of [await ledgerPdf(heading, ledger), await fySummaryPdf(summary, "20 Oct 2026")]) {
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    }
  });

  it("long ledgers flow onto more pages", async () => {
    const long = rentSchedule({ moveInDate: "2020-01-01", monthlyRent: R(5000), dueDay: 5 }, [], TODAY);
    const doc = await PDFDocument.load(await ledgerPdf(heading, tenantLedger(long, [], [])));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
