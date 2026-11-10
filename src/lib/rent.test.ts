import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, desiredNotifications } from "./notifications";
import {
  addDays,
  addMonths,
  addMonthsClamped,
  cycleFor,
  cycleMonthOn,
  dueForMonth,
  finalCycleMonth,
  formatCycle,
  formatCycleMonth,
  monthRange,
  payableMonths,
  paymentPeriodOptions,
  rentSchedule,
  rentalBadge,
  rentalStatus,
  summarize,
  type RentalLike,
} from "./rent";
import { collectionsReport } from "./reports";

const R = (rupees: number) => rupees * 100;

/** The spec's example rental: moved in 20 Oct 2026, rent ₹8,000. */
const rental = (over: Partial<RentalLike> = {}): RentalLike => ({
  moveInDate: "2026-10-20",
  moveOutDate: null,
  monthlyRent: R(8000),
  ...over,
});

describe("month / date helpers", () => {
  it("adds months across year boundaries", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-01", -13)).toBe("2024-12");
  });
  it("adds days", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("builds inclusive month ranges", () => {
    expect(monthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
  it("adds months keeping the day, clamped to the month end, never drifting", () => {
    expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsClamped("2027-01-31", 2)).toBe("2027-03-31");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-10-20", 3)).toBe("2027-01-20");
  });
  it("accepts Date objects stored as UTC midnight", () => {
    const s = rentSchedule(rental({ moveInDate: new Date("2026-10-20T00:00:00Z") }), [], "2026-11-10");
    expect(s.map((m) => m.month)).toEqual(["2026-10"]);
  });
});

describe("billing cycles (I/O matrix)", () => {
  it("Basic: moved in 20 Oct, today 10 Nov -> one cycle 20 Oct – 19 Nov, due 20 Nov, upcoming", () => {
    const s = rentSchedule(rental(), [], "2026-11-10");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      month: "2026-10",
      start: "2026-10-20",
      end: "2026-11-19",
      dueDate: "2026-11-20",
      rent: R(8000),
      due: R(8000),
      status: "upcoming",
      pastDue: false,
    });
  });

  it("Due day not overdue: on 20 Nov, unpaid, the cycle is still upcoming (due today)", () => {
    const [oct] = rentSchedule(rental(), [], "2026-11-20");
    expect(oct).toMatchObject({ status: "upcoming", pastDue: false, balance: R(8000) });
  });

  it("Overdue: on 21 Nov, unpaid -> overdue 8,000", () => {
    const s = rentSchedule(rental(), [], "2026-11-21");
    expect(s[0]).toMatchObject({ month: "2026-10", status: "overdue", pastDue: true, balance: R(8000) });
    expect(summarize(s)).toMatchObject({ overdueAmount: R(8000), overdueMonths: 1 });
    // The next cycle (20 Nov – 19 Dec) has started and is upcoming.
    expect(s[1]).toMatchObject({ month: "2026-11", start: "2026-11-20", dueDate: "2026-12-20", status: "upcoming" });
  });

  it("Paid: 8,000 paid for key 2026-10 -> paid", () => {
    const [oct] = rentSchedule(rental(), [{ forMonth: "2026-10", amount: R(8000) }], "2026-11-25");
    expect(oct).toMatchObject({ status: "paid", paid: R(8000), balance: 0 });
  });

  it("Partial: part paid after the due date -> partial", () => {
    const [oct] = rentSchedule(rental(), [{ forMonth: "2026-10", amount: R(5000) }], "2026-11-25");
    expect(oct).toMatchObject({ status: "partial", paid: R(5000), balance: R(3000) });
  });

  it("Month-end clamp: moved in 31 Jan 2027 -> dues 28 Feb, 31 Mar, 30 Apr, 31 May", () => {
    const r = rental({ moveInDate: "2027-01-31" });
    const s = rentSchedule(r, [], "2027-05-01");
    expect(s.map((m) => [m.start, m.end, m.dueDate])).toEqual([
      ["2027-01-31", "2027-02-27", "2027-02-28"],
      ["2027-02-28", "2027-03-30", "2027-03-31"],
      ["2027-03-31", "2027-04-29", "2027-04-30"],
      ["2027-04-30", "2027-05-30", "2027-05-31"],
    ]);
    expect(s.map((m) => m.month)).toEqual(["2027-01", "2027-02", "2027-03", "2027-04"]);
  });

  it("Leap year: moved in 31 Jan 2028 -> first due 29 Feb 2028", () => {
    expect(cycleFor(rental({ moveInDate: "2028-01-31" }), "2028-01")).toMatchObject({
      start: "2028-01-31",
      end: "2028-02-28",
      dueDate: "2028-02-29",
    });
  });

  it("Rent change: 9,000 effective 2027-01 -> the cycle starting 20 Jan 2027 onward is 9,000", () => {
    const r = rental({ rentChanges: [{ effectiveMonth: "2027-01", monthlyRent: R(9000) }] });
    const s = rentSchedule(r, [], "2027-02-25");
    expect(s.map((m) => [m.start, m.rent])).toEqual([
      ["2026-10-20", R(8000)],
      ["2026-11-20", R(8000)],
      ["2026-12-20", R(8000)],
      ["2027-01-20", R(9000)],
      ["2027-02-20", R(9000)],
    ]);
  });

  it("Charges: electricity 1,200 for month 2026-11 -> added to cycle 20 Nov – 19 Dec, due 20 Dec", () => {
    const r = rental({ charges: [{ month: "2026-11", type: "electricity", amount: R(1200) }] });
    const s = rentSchedule(r, [], "2026-12-01");
    const nov = s.find((m) => m.month === "2026-11")!;
    expect(nov).toMatchObject({ start: "2026-11-20", end: "2026-12-19", dueDate: "2026-12-20", rent: R(8000), charges: R(1200), due: R(9200) });
    expect(nov.chargeItems).toEqual([{ type: "electricity", amount: R(1200) }]);
    expect(s.find((m) => m.month === "2026-10")!.due).toBe(R(8000));
  });

  it("WiFi (month-keyed like charges): a plan from 2026-11 bills from the cycle 20 Nov – 19 Dec", () => {
    const r = rental({ wifiPlans: [{ fromMonth: "2026-11", toMonth: null, people: [{ name: "Asha" }, { name: "Ravi" }], ratePerPerson: R(100) }] });
    const s = rentSchedule(r, [], "2026-12-01");
    expect(s.map((m) => [m.start, m.due])).toEqual([
      ["2026-10-20", R(8000)],
      ["2026-11-20", R(8200)],
    ]);
    expect(s[1].chargeItems).toEqual([{ type: "wifi", label: "WiFi (2 people)", amount: R(200) }]);
    // Not pro-rated in a short final cycle either.
    expect(dueForMonth({ ...r, moveOutDate: "2026-12-05" }, "2026-11")).toBe(R(4267) + R(200));
  });

  it("Move-out mid-cycle: move-out 5 Dec -> final cycle 20 Nov – 5 Dec = 16/30 × 8,000 = 4,267, due 5 Dec", () => {
    const r = rental({ moveOutDate: "2026-12-05" });
    const s = rentSchedule(r, [], "2027-01-15");
    expect(s.map((m) => m.month)).toEqual(["2026-10", "2026-11"]);
    expect(s[0]).toMatchObject({ rent: R(8000), dueDate: "2026-11-20" });
    expect(s[1]).toMatchObject({ start: "2026-11-20", end: "2026-12-05", dueDate: "2026-12-05", rent: R(4267), due: R(4267) });
    expect(cycleFor(r, "2026-11")).toMatchObject({ days: 16, fullDays: 30 });
  });

  it("Move-out mid-cycle: that month's charges are not pro-rated", () => {
    const r = rental({ moveOutDate: "2026-12-05", charges: [{ month: "2026-11", type: "water", amount: R(300) }] });
    expect(dueForMonth(r, "2026-11")).toBe(R(4267) + R(300));
  });

  it("Move-out on the last day of a cycle charges the full cycle, due on the move-out date", () => {
    const s = rentSchedule(rental({ moveOutDate: "2026-11-19" }), [], "2026-12-01");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ end: "2026-11-19", dueDate: "2026-11-19", rent: R(8000) });
  });

  it("Move-out exactly on an anniversary ends with the previous cycle (no 1-day cycle)", () => {
    const r = rental({ moveOutDate: "2026-11-20" });
    expect(finalCycleMonth(r)).toBe("2026-10");
    const s = rentSchedule(r, [], "2026-12-01");
    expect(s.map((m) => [m.month, m.rent, m.dueDate])).toEqual([["2026-10", R(8000), "2026-11-20"]]);
  });

  it("Due soon: N = 3, due 20 Nov, today 17 Nov -> one rent_due_soon", () => {
    const r = rental();
    const today = "2026-11-17";
    const out = desiredNotifications({
      rentals: [
        {
          id: "r1",
          propertyId: "p1",
          propertyName: "Palm Grove",
          tenantId: "t1",
          tenantName: "Asha",
          status: "active",
          moveInDate: "2026-10-20",
          moveOutDate: null,
          monthlyRent: r.monthlyRent,
          schedule: rentSchedule(r, [], today),
        },
      ],
      maintenance: [],
      thresholds: DEFAULT_THRESHOLDS,
      today,
      now: new Date("2026-11-17T09:00:00Z"),
    });
    const soon = out.filter((n) => n.type === "rent_due_soon");
    expect(soon).toHaveLength(1);
    expect(soon[0]).toMatchObject({ key: "rent_due_soon:r1:2026-10", period: "2026-10" });
    expect(soon[0].body).toBe("₹8,000.00 from Asha for 20 Oct – 19 Nov 2026 is due on 20 Nov 2026.");
    expect(out.some((n) => n.type === "rent_overdue")).toBe(false);
  });

  it("Collections report: November includes the cycle 20 Oct – 19 Nov (due 20 Nov)", () => {
    const schedule = rentSchedule(rental(), [], "2026-11-25");
    const nov = collectionsReport("2026-11", [{ id: "r1", propertyName: "Palm Grove", tenantName: "Asha", schedule }]);
    expect(nov.rows).toHaveLength(1);
    expect(nov.rows[0]).toMatchObject({ cycleMonth: "2026-10", start: "2026-10-20", end: "2026-11-19", dueDate: "2026-11-20", due: R(8000) });
    const oct = collectionsReport("2026-10", [{ id: "r1", propertyName: "Palm Grove", tenantName: "Asha", schedule }]);
    expect(oct.rows).toHaveLength(0);
  });
});

describe("rentSchedule listing", () => {
  it("lists every cycle that has started, open-ended", () => {
    const s = rentSchedule(rental(), [], "2027-03-19");
    expect(s.map((m) => m.month)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(rentSchedule(rental(), [], "2027-03-20").map((m) => m.month).at(-1)).toBe("2027-03");
  });

  it("returns nothing before move-in", () => {
    expect(rentSchedule(rental(), [], "2026-10-19")).toEqual([]);
  });

  it("the move-in day starts the first cycle", () => {
    expect(rentSchedule(rental(), [], "2026-10-20").map((m) => m.month)).toEqual(["2026-10"]);
  });

  it("includes prepaid future cycles, but never past the final cycle", () => {
    const s = rentSchedule(rental(), [{ forMonth: "2026-12", amount: R(8000) }], "2026-11-01");
    expect(s.map((m) => m.month)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(s[2]).toMatchObject({ status: "paid", start: "2026-12-20", dueDate: "2027-01-20" });
    const capped = rentSchedule(rental({ moveOutDate: "2026-11-10" }), [{ forMonth: "2026-11", amount: 1 }], "2026-11-01");
    expect(capped.map((m) => m.month)).toEqual(["2026-10"]);
  });

  it("treats overpayment as paid", () => {
    const [m] = rentSchedule(rental(), [{ forMonth: "2026-10", amount: R(9000) }], "2026-12-01");
    expect(m).toMatchObject({ status: "paid", balance: 0 });
  });
});

describe("cycle helpers", () => {
  it("finds the cycle containing a date", () => {
    expect(cycleMonthOn(rental(), "2026-10-19")).toBeNull();
    expect(cycleMonthOn(rental(), "2026-10-20")).toBe("2026-10");
    expect(cycleMonthOn(rental(), "2026-11-19")).toBe("2026-10");
    expect(cycleMonthOn(rental(), "2026-11-20")).toBe("2026-11");
    expect(cycleMonthOn(rental({ moveInDate: "2027-01-31" }), "2027-02-27")).toBe("2027-01");
    expect(cycleMonthOn(rental({ moveInDate: "2027-01-31" }), "2027-02-28")).toBe("2027-02");
  });

  it("has no cycle before move-in or after the final cycle", () => {
    expect(cycleFor(rental(), "2026-09")).toBeNull();
    expect(cycleFor(rental({ moveOutDate: "2026-12-05" }), "2026-12")).toBeNull();
  });

  it("formats a cycle's period (long, across years, and short)", () => {
    expect(formatCycle({ start: "2026-10-20", end: "2026-11-19" }, { locale: "en-IN" })).toBe("20 Oct – 19 Nov 2026");
    expect(formatCycle({ start: "2026-12-20", end: "2027-01-19" }, { locale: "en-IN" })).toBe("20 Dec 2026 – 19 Jan 2027");
    expect(formatCycle({ start: "2026-10-20", end: "2026-11-19" }, { short: true, locale: "en-IN" })).toBe("20 Oct–19 Nov");
    expect(formatCycleMonth(rental(), "2026-11", { locale: "en-IN" })).toBe("20 Nov – 19 Dec 2026");
  });

  it("payment periods: payable cycles labelled by period; default = oldest unpaid due cycle, else the current one", () => {
    const r = rental();
    const today = "2027-01-05";
    const schedule = rentSchedule(r, [{ forMonth: "2026-10", amount: R(8000) }], today);
    const p = paymentPeriodOptions(r, schedule, today);
    expect(p.options[0]).toEqual({ value: "2026-10", label: formatCycleMonth(r, "2026-10") });
    expect(p.options.at(-1)?.value).toBe("2028-01");
    // Nov cycle (due 20 Dec) is unpaid and past due.
    expect(p.defaultMonth).toBe("2026-11");
    const allPaid = rentSchedule(r, [{ forMonth: "2026-10", amount: R(8000) }, { forMonth: "2026-11", amount: R(8000) }], today);
    // Everything due is paid: the current cycle (20 Dec – 19 Jan).
    expect(paymentPeriodOptions(r, allPaid, today).defaultMonth).toBe("2026-12");
  });
});

describe("rentalStatus", () => {
  it("is active with no move-out date", () => {
    expect(rentalStatus({ moveOutDate: null }, "2026-09-29")).toBe("active");
  });
  it("stays active until a future move-out date arrives, then is moved out", () => {
    expect(rentalStatus({ moveOutDate: "2026-10-15" }, "2026-10-14")).toBe("active");
    expect(rentalStatus({ moveOutDate: "2026-10-15" }, "2026-10-15")).toBe("moved_out");
    expect(rentalStatus({ moveOutDate: "2026-10-15" }, "2026-11-01")).toBe("moved_out");
  });
  it("maps to badge keys", () => {
    expect(rentalBadge({ status: "active", movingOut: false })).toBe("active");
    expect(rentalBadge({ status: "active", movingOut: true })).toBe("moving_out");
    expect(rentalBadge({ status: "moved_out", movingOut: false })).toBe("moved_out");
  });
});

describe("payableMonths", () => {
  it("runs from the move-in cycle to the final cycle (the one containing the move-out date)", () => {
    expect(payableMonths(rental({ moveOutDate: "2026-12-05" }), "2027-01-29")).toEqual({ first: "2026-10", last: "2026-11" });
    expect(payableMonths(rental({ moveOutDate: "2026-12-25" }), "2027-01-29")).toEqual({ first: "2026-10", last: "2026-12" });
  });
  it("allows up to 12 months of prepayment while open-ended", () => {
    expect(payableMonths(rental(), "2026-11-29")).toEqual({ first: "2026-10", last: "2027-11" });
  });
});

describe("summarize", () => {
  it("computes overdue totals for a rental 3 cycles in with one payment", () => {
    // Moved in 20 Oct; on 25 Jan the Oct, Nov and Dec cycles are past due, Jan's has started.
    const s = rentSchedule(rental(), [{ forMonth: "2026-10", amount: R(8000) }], "2027-01-25");
    expect(s.map((m) => m.status)).toEqual(["paid", "overdue", "overdue", "upcoming"]);
    const sum = summarize(s);
    expect(sum.overdueMonths).toBe(2);
    expect(sum.overdueAmount).toBe(R(16000));
    expect(sum.totalPaid).toBe(R(8000));
    expect(sum.totalDue).toBe(R(32000));
    expect(sum.balance).toBe(R(24000));
  });

  it("does not count the running (upcoming) cycle as overdue", () => {
    const sum = summarize(rentSchedule(rental(), [], "2026-11-15"));
    expect(sum.overdueAmount).toBe(0);
    expect(sum.balance).toBe(R(8000));
  });
});
