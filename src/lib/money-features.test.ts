/**
 * Landlord features pack, batch A (F2–F5): rent changes, utility charges, deposits, expenses
 * and profit. One test (at least) per I/O-matrix row; amounts are in minor units (paise).
 */
import { describe, expect, it } from "vitest";
import { electricityAmount, meterUnits } from "./charges";
import { depositEntryError, depositSummary } from "./deposit";
import { fyList, fyMonths, fyOf, fyRange, fyStartYear, isFy } from "./fy";
import { DEFAULT_THRESHOLDS, desiredNotifications, type RentalInput } from "./notifications";
import { profitReport } from "./profit";
import {
  chargesForMonth,
  currentRent,
  dueForMonth,
  rentForMonth,
  rentSchedule,
  summarize,
  upcomingRentChange,
  type RentalLike,
} from "./rent";
import {
  chargeSchema,
  depositEntrySchema,
  expenseSchema,
  fieldErrorsOf,
  rentChangeSchema,
  validateAttachment,
} from "./validation";
import { buildReminder, reminderDue } from "./whatsapp";

const R = (rupees: number) => rupees * 100;

const base = (over: Partial<RentalLike> = {}): RentalLike => ({
  moveInDate: "2026-06-01",
  moveOutDate: null,
  monthlyRent: R(10000),
  dueDay: 5,
  ...over,
});

/* ---------- F4 rent changes ---------- */

describe("rent changes (F4)", () => {
  const rental = base({ rentChanges: [{ effectiveMonth: "2026-09", monthlyRent: R(11000) }] });

  it("I/O matrix: rent 10,000 from Jun, 11,000 effective Sep -> Jun–Aug 10,000, Sep onward 11,000", () => {
    const s = rentSchedule(rental, [], "2026-11-20");
    expect(Object.fromEntries(s.map((m) => [m.month, m.due]))).toEqual({
      "2026-06": R(10000),
      "2026-07": R(10000),
      "2026-08": R(10000),
      "2026-09": R(11000),
      "2026-10": R(11000),
      "2026-11": R(11000),
    });
  });

  it("uses the latest change effective on or before the month, regardless of input order", () => {
    const r = base({
      rentChanges: [
        { effectiveMonth: "2027-04", monthlyRent: R(12000) },
        { effectiveMonth: "2026-09", monthlyRent: R(11000) },
      ],
    });
    expect(rentForMonth(r, "2026-08")).toBe(R(10000));
    expect(rentForMonth(r, "2026-09")).toBe(R(11000));
    expect(rentForMonth(r, "2027-03")).toBe(R(11000));
    expect(rentForMonth(r, "2027-04")).toBe(R(12000));
  });

  it("an existing rental with no changes keeps its original rent", () => {
    expect(rentSchedule(base(), [], "2026-08-10").every((m) => m.due === R(10000))).toBe(true);
    expect(currentRent(base(), "2026-08-10")).toBe(R(10000));
  });

  it("current rent reflects changes in force; a future change is reported as upcoming", () => {
    expect(currentRent(rental, "2026-08-31")).toBe(R(10000));
    expect(upcomingRentChange(rental, "2026-08-31")).toEqual({ effectiveMonth: "2026-09", monthlyRent: R(11000) });
    expect(currentRent(rental, "2026-09-01")).toBe(R(11000));
    expect(upcomingRentChange(rental, "2026-09-01")).toBeNull();
  });

  it("validation: effective month before the move-in month is a field error", () => {
    const schema = rentChangeSchema({ firstMonth: "2026-06", lastMonth: null });
    const bad = schema.safeParse({ effectiveMonth: "2026-05", monthlyRent: "11000" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(fieldErrorsOf(bad.error).effectiveMonth?.[0]).toMatch(/before the move-in month/);
    const ok = schema.safeParse({ effectiveMonth: "2026-09", monthlyRent: "11000" });
    expect(ok.success && ok.data.monthlyRent).toBe(R(11000));
  });

  it("validation: effective month after the move-out month is a field error", () => {
    const bad = rentChangeSchema({ firstMonth: "2026-06", lastMonth: "2026-10" }).safeParse({
      effectiveMonth: "2026-11",
      monthlyRent: "11000",
    });
    expect(bad.success).toBe(false);
  });

  it("due-soon notification for next month uses next month's rent (after a change)", () => {
    const r = base({ moveInDate: "2026-09-01", rentChanges: [{ effectiveMonth: "2026-10", monthlyRent: R(11000) }] });
    const today = "2026-10-02";
    const input: RentalInput = {
      id: "r1",
      propertyId: "p1",
      propertyName: "Palm Grove",
      tenantId: "t1",
      tenantName: "Asha",
      status: "active",
      moveOutDate: null,
      monthlyRent: r.monthlyRent,
      rentChanges: r.rentChanges,
      dueDay: 5,
      schedule: rentSchedule(r, [{ forMonth: "2026-09", amount: R(10000) }, { forMonth: "2026-10", amount: R(11000) }], today),
    };
    // Everything billed is paid, so next month (Nov) is the candidate: due 5 Nov, outside 3 days; widen the threshold.
    const out = desiredNotifications({
      rentals: [input],
      maintenance: [],
      thresholds: { ...DEFAULT_THRESHOLDS, dueSoonDays: 30 },
      today: "2026-10-10",
      now: new Date("2026-10-10T12:00:00Z"),
    });
    const soon = out.find((n) => n.type === "rent_due_soon");
    expect(soon?.body).toContain("₹11,000");
  });
});

/* ---------- F5 utility & other charges ---------- */

describe("utility charges (F5)", () => {
  it("I/O matrix: prev 1200, curr 1350, rate ₹8 -> ₹1,200; Oct due = rent + 1,200", () => {
    expect(meterUnits(1200, 1350)).toBe(150);
    const amount = electricityAmount(1200, 1350, R(8));
    expect(amount).toBe(R(1200));
    const r = base({ charges: [{ month: "2026-10", type: "electricity", amount: amount! }] });
    const oct = rentSchedule(r, [], "2026-10-20").find((m) => m.month === "2026-10")!;
    expect(oct).toMatchObject({ rent: R(10000), charges: R(1200), due: R(11200) });
    expect(oct.chargeItems).toEqual([{ type: "electricity", amount: R(1200) }]);
    expect(dueForMonth(r, "2026-10")).toBe(R(11200));
  });

  it("I/O matrix: current reading below previous is a field error", () => {
    expect(meterUnits(1350, 1200)).toBeNull();
    const res = chargeSchema({ firstMonth: "2026-06", lastMonth: "2027-10" }).safeParse({
      month: "2026-10",
      type: "electricity",
      meterPrevious: "1350",
      meterCurrent: "1200",
      meterRate: "8",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(fieldErrorsOf(res.error).meterCurrent?.[0]).toMatch(/less than the previous/);
  });

  it("computes the electricity amount from readings when no amount is typed, and keeps an edited amount", () => {
    const schema = chargeSchema({ firstMonth: "2026-06", lastMonth: "2027-10" });
    const computed = schema.safeParse({ month: "2026-10", type: "electricity", meterPrevious: "1200", meterCurrent: "1350", meterRate: "8" });
    expect(computed.success && computed.data).toMatchObject({ amount: R(1200), meter: { previous: 1200, current: 1350, rate: R(8) } });
    const edited = schema.safeParse({
      month: "2026-10",
      type: "electricity",
      meterPrevious: "1200",
      meterCurrent: "1350",
      meterRate: "8",
      amount: "1150",
    });
    expect(edited.success && edited.data.amount).toBe(R(1150));
  });

  it("a non-meter charge needs an amount and a month inside the rental", () => {
    const schema = chargeSchema({ firstMonth: "2026-06", lastMonth: "2026-12" });
    const water = schema.safeParse({ month: "2026-10", type: "water", amount: "300" });
    expect(water.success && water.data).toMatchObject({ amount: R(300), meter: null });
    const missing = schema.safeParse({ month: "2026-10", type: "water" });
    expect(missing.success).toBe(false);
    const outside = schema.safeParse({ month: "2027-01", type: "water", amount: "300" });
    expect(outside.success).toBe(false);
    if (!outside.success) expect(fieldErrorsOf(outside.error).month).toBeDefined();
  });

  it("I/O matrix: partial with charges — Oct rent 10,000 + charge 1,200, paid 10,000 -> partial, balance 1,200, reminder 1,200", () => {
    const r = base({ moveInDate: "2026-10-01", charges: [{ month: "2026-10", type: "electricity", amount: R(1200) }] });
    const today = "2026-10-20";
    const schedule = rentSchedule(r, [{ forMonth: "2026-10", amount: R(10000) }], today);
    expect(schedule[0]).toMatchObject({ status: "partial", balance: R(1200) });
    expect(summarize(schedule).overdueAmount).toBe(R(1200));

    const reminderRental = { status: "active" as const, monthlyRent: r.monthlyRent, dueDay: 5, moveOutDate: null, schedule };
    expect(reminderDue(reminderRental, today)?.amount).toBe(R(1200));
    const built = buildReminder({
      rental: reminderRental,
      tenantName: "Asha",
      tenantPhone: "9876543210",
      propertyName: "Palm Grove",
      template: "{amount} for {months}",
      today,
    });
    expect(built?.message).toBe("₹1,200 for Oct 2026");
  });

  it("charges are merged per type and a charge in a future month extends the schedule", () => {
    const r = base({
      charges: [
        { month: "2026-07", type: "water", amount: R(100) },
        { month: "2026-07", type: "water", amount: R(50) },
        { month: "2026-07", type: "maintenance", amount: R(500) },
      ],
    });
    expect(chargesForMonth(r, "2026-07")).toEqual({
      total: R(650),
      items: [
        { type: "water", amount: R(150) },
        { type: "maintenance", amount: R(500) },
      ],
    });
    expect(rentSchedule(r, [], "2026-06-10").map((m) => m.month)).toEqual(["2026-06", "2026-07"]);
  });

  it("due-soon reminder for next month includes that month's charges", () => {
    const r = base({ moveInDate: "2026-09-01", charges: [{ month: "2026-10", type: "water", amount: R(300) }] });
    const today = "2026-09-20";
    const schedule = rentSchedule(r, [{ forMonth: "2026-09", amount: R(10000) }], today);
    // October already appears in the schedule because it has a charge.
    const due = reminderDue({ status: "active", monthlyRent: r.monthlyRent, charges: r.charges, dueDay: 5, moveOutDate: null, schedule }, today);
    expect(due).toMatchObject({ kind: "due_soon", amount: R(10300) });
    // Next month not yet listed: computed with dueForMonth.
    const r2 = base({ moveInDate: "2026-09-01", charges: [{ month: "2026-11", type: "water", amount: R(300) }] });
    const s2 = rentSchedule(r2, [{ forMonth: "2026-09", amount: R(10000) }], today);
    expect(dueForMonth(r2, "2026-11")).toBe(R(10300));
    expect(s2.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });
});

/* ---------- F3 deposits ---------- */

describe("security deposit (F3)", () => {
  it("summarizes received, deductions, refunds and held balance", () => {
    expect(
      depositSummary([
        { kind: "received", amount: R(20000) },
        { kind: "deduction", amount: R(1500) },
        { kind: "refund", amount: R(10000) },
      ]),
    ).toEqual({ received: R(20000), deducted: R(1500), refunded: R(10000), held: R(8500) });
  });

  it("I/O matrix: held 20,000, refund 25,000 -> 'Cannot exceed held deposit ₹20,000'", () => {
    expect(depositEntryError(R(20000), "refund", R(25000))).toBe("Cannot exceed held deposit ₹20,000");
    expect(depositEntryError(R(20000), "deduction", R(20001))).toBe("Cannot exceed held deposit ₹20,000");
  });

  it("allows refunding exactly the held amount (balance reaches zero, never negative)", () => {
    expect(depositEntryError(R(20000), "refund", R(20000))).toBeNull();
    expect(depositEntryError(0, "refund", 1)).toBe("No deposit is held for this rental");
    expect(depositEntryError(0, "received", R(5000))).toBeNull();
  });

  it("a deduction needs a reason", () => {
    const bad = depositEntrySchema.safeParse({ kind: "deduction", amount: "1500", date: "2026-10-01" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(fieldErrorsOf(bad.error).reason).toBeDefined();
    expect(depositEntrySchema.safeParse({ kind: "refund", amount: "1500", date: "2026-10-01" }).success).toBe(true);
    expect(depositEntrySchema.safeParse({ kind: "refund", amount: "0", date: "2026-10-01" }).success).toBe(false);
  });
});

/* ---------- F2 expenses & profit ---------- */

describe("financial year", () => {
  it("I/O matrix: FY boundary — 31 Mar 2027 is 2026-27, 1 Apr 2027 is 2027-28", () => {
    expect(fyOf("2027-03-31")).toBe("2026-27");
    expect(fyOf("2027-04-01")).toBe("2027-28");
    expect(fyOf("2026-04-01")).toBe("2026-27");
    expect(fyOf("2099-12-31")).toBe("2099-00");
  });
  it("parses labels and lists ranges", () => {
    expect(isFy("2026-27")).toBe(true);
    expect(isFy("2026-28")).toBe(false);
    expect(fyStartYear("abc")).toBeNull();
    expect(fyRange("2026-27")).toEqual({ start: "2026-04-01", end: "2027-03-31", endExclusive: "2027-04-01" });
    expect(fyMonths("2026-27")[0]).toBe("2026-04");
    expect(fyMonths("2026-27")[11]).toBe("2027-03");
    expect(fyList("2025-01-10", "2026-10-05")).toEqual(["2026-27", "2025-26", "2024-25"]);
  });
});

describe("profit report (F2)", () => {
  it("I/O matrix: property income 1,20,000, expenses 30,000 in FY -> profit 90,000", () => {
    const payments = Array.from({ length: 12 }, (_, i) => ({
      paidOn: `${i < 9 ? 2026 : 2027}-${String(((i + 3) % 12) + 1).padStart(2, "0")}-05`,
      amount: R(10000),
      propertyId: "p1",
    }));
    const report = profitReport("2026-27", payments, [
      { date: "2026-07-15", amount: R(20000), propertyId: "p1" },
      { date: "2027-01-10", amount: R(10000), propertyId: "p1" },
    ]);
    expect(report.properties).toHaveLength(1);
    expect(report.properties[0]).toMatchObject({ propertyId: "p1", income: R(120000), expenses: R(30000), profit: R(90000) });
    expect(report.total).toEqual({ income: R(120000), expenses: R(30000), profit: R(90000) });
    expect(report.months.find((m) => m.month === "2026-07")).toMatchObject({ income: R(10000), expenses: R(20000), profit: -R(10000) });
  });

  it("I/O matrix: FY boundary — a payment on 31 Mar 2027 counts in 2026-27, on 1 Apr 2027 in 2027-28", () => {
    const payments = [
      { paidOn: "2027-03-31", amount: R(100), propertyId: "p1" },
      { paidOn: "2027-04-01", amount: R(200), propertyId: "p1" },
    ];
    expect(profitReport("2026-27", payments, []).total.income).toBe(R(100));
    expect(profitReport("2027-28", payments, []).total.income).toBe(R(200));
    expect(profitReport("2026-27", payments, []).months.find((m) => m.month === "2027-03")?.income).toBe(R(100));
  });

  it("keeps general expenses (no property) in their own row, listed last", () => {
    const report = profitReport(
      "2026-27",
      [
        { paidOn: "2026-05-01", amount: R(5000), propertyId: "p2" },
        { paidOn: "2026-05-01", amount: R(9000), propertyId: "p1" },
      ],
      [{ date: "2026-06-01", amount: R(1000), propertyId: null }],
    );
    expect(report.properties.map((r) => r.propertyId)).toEqual(["p1", "p2", null]);
    expect(report.properties[2]).toMatchObject({ income: 0, expenses: R(1000), profit: -R(1000) });
    expect(report.total.profit).toBe(R(13000));
  });
});

describe("expense validation (F2)", () => {
  it("accepts a general expense (no property) and converts the amount to minor units", () => {
    const res = expenseSchema.safeParse({ propertyId: "", category: "property_tax", amount: "4,500.50", date: "2026-07-01" });
    expect(res.success && res.data).toMatchObject({ propertyId: null, category: "property_tax", amount: 450050, maintenanceId: null });
  });
  it("rejects unknown categories, bad amounts and dates", () => {
    const res = expenseSchema.safeParse({ category: "travel", amount: "0", date: "2026-02-30" });
    expect(res.success).toBe(false);
    if (!res.success) expect(Object.keys(fieldErrorsOf(res.error))).toEqual(expect.arrayContaining(["category", "amount", "date"]));
  });
});

describe("attachments (bills)", () => {
  const pdfHead = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 0, 0, 0]);
  const exeHead = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0]);
  it("accepts a real PDF up to 10 MB", () => {
    expect(validateAttachment({ type: "application/pdf", size: 1000 }, pdfHead)).toBeNull();
    expect(validateAttachment({ type: "application/pdf", size: 10 * 1024 * 1024 }, pdfHead)).toBeNull();
  });
  it("rejects an .exe renamed .pdf, a 12 MB file and other types", () => {
    expect(validateAttachment({ type: "application/pdf", size: 1000 }, exeHead)).toMatch(/doesn't match/);
    expect(validateAttachment({ type: "application/pdf", size: 12 * 1024 * 1024 }, pdfHead)).toMatch(/10 MB/);
    expect(validateAttachment({ type: "application/x-msdownload", size: 1000 })).toMatch(/Only PDF/);
    expect(validateAttachment(null)).toMatch(/Choose a file/);
  });
});
