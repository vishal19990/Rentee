import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  monthRange,
  payableMonths,
  rentSchedule,
  rentalBadge,
  rentalStatus,
  summarize,
  type RentalLike,
} from "./rent";

const rental = (over: Partial<RentalLike> = {}): RentalLike => ({
  moveInDate: "2026-06-10",
  moveOutDate: null,
  monthlyRent: 10000,
  dueDay: 5,
  ...over,
});

describe("month helpers", () => {
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
  it("accepts Date objects stored as UTC midnight", () => {
    const s = rentSchedule(rental({ moveInDate: new Date("2026-06-10T00:00:00Z") }), [], "2026-06-20");
    expect(s.map((m) => m.month)).toEqual(["2026-06"]);
  });
});

describe("rentSchedule (month-to-month)", () => {
  it("open-ended rental moved in 5 months ago lists 6 months (move-in month through current)", () => {
    // I/O matrix: "Open-ended rental".
    const s = rentSchedule(rental({ moveInDate: "2026-04-15" }), [], "2026-09-29");
    expect(s.map((m) => m.month)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  });

  it("keeps accruing while open-ended, with no end date", () => {
    expect(rentSchedule(rental(), [], "2028-01-01")).toHaveLength(20);
  });

  it("returns nothing before move-in", () => {
    expect(rentSchedule(rental(), [], "2026-05-01")).toEqual([]);
  });

  it("stops after the move-out month", () => {
    const s = rentSchedule(rental({ moveOutDate: "2026-07-20" }), [], "2026-12-01");
    expect(s.map((m) => m.month)).toEqual(["2026-06", "2026-07"]);
  });

  it("with a future move-out date, accrues only through the current month", () => {
    const s = rentSchedule(rental({ moveOutDate: "2026-12-31" }), [], "2026-08-15");
    expect(s.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("move-out in the move-in month charges one month", () => {
    expect(rentSchedule(rental({ moveOutDate: "2026-06-10" }), [], "2026-09-01")).toHaveLength(1);
  });

  it("never makes the first month due before move-in", () => {
    const [first, second] = rentSchedule(rental(), [], "2026-07-01");
    expect(first.dueDate).toBe("2026-06-10");
    expect(second.dueDate).toBe("2026-07-05");
  });

  it("marks paid, partial, overdue and upcoming months", () => {
    const s = rentSchedule(
      rental(),
      [
        { forMonth: "2026-06", amount: 10000 },
        { forMonth: "2026-07", amount: 4000 },
        { forMonth: "2026-07", amount: 1000 },
      ],
      "2026-09-03",
    );
    const byMonth = Object.fromEntries(s.map((m) => [m.month, m]));
    expect(byMonth["2026-06"]).toMatchObject({ status: "paid", paid: 10000, balance: 0 });
    expect(byMonth["2026-07"]).toMatchObject({ status: "partial", paid: 5000, balance: 5000 });
    expect(byMonth["2026-08"]).toMatchObject({ status: "overdue", paid: 0, balance: 10000 });
    // September's due day (5th) has not passed yet.
    expect(byMonth["2026-09"]).toMatchObject({ status: "upcoming", pastDue: false, balance: 10000 });
  });

  it("is not overdue on the due day itself, only after it", () => {
    expect(rentSchedule(rental(), [], "2026-07-05")[1].status).toBe("upcoming");
    expect(rentSchedule(rental(), [], "2026-07-06")[1].status).toBe("overdue");
  });

  it("treats overpayment as paid", () => {
    const [m] = rentSchedule(rental(), [{ forMonth: "2026-06", amount: 12000 }], "2026-06-20");
    expect(m).toMatchObject({ status: "paid", balance: 0 });
  });

  it("includes prepaid future months, but never past the move-out month", () => {
    const s = rentSchedule(rental(), [{ forMonth: "2026-08", amount: 10000 }], "2026-06-20");
    expect(s.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(s[2].status).toBe("paid");
    const capped = rentSchedule(rental({ moveOutDate: "2026-07-31" }), [{ forMonth: "2026-08", amount: 1 }], "2026-06-20");
    expect(capped.map((m) => m.month)).toEqual(["2026-06"]);
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
  it("runs from move-in to move-out month", () => {
    expect(payableMonths(rental({ moveOutDate: "2026-08-03" }), "2026-09-29")).toEqual({ first: "2026-06", last: "2026-08" });
  });
  it("allows up to 12 months of prepayment while open-ended", () => {
    expect(payableMonths(rental(), "2026-09-29")).toEqual({ first: "2026-06", last: "2027-09" });
  });
});

describe("summarize", () => {
  it("computes overdue totals for a rental 3 months in with one payment", () => {
    // Acceptance scenario: moved in 3 months ago, only the first month paid.
    const s = rentSchedule(rental({ moveInDate: "2026-06-29", dueDay: 5 }), [{ forMonth: "2026-06", amount: 10000 }], "2026-09-29");
    const sum = summarize(s);
    expect(sum.overdueMonths).toBe(3);
    expect(sum.overdueAmount).toBe(30000);
    expect(sum.totalPaid).toBe(10000);
    expect(sum.totalDue).toBe(40000);
    expect(sum.balance).toBe(30000);
  });

  it("does not count upcoming balances as overdue", () => {
    const sum = summarize(rentSchedule(rental(), [{ forMonth: "2026-06", amount: 10000 }], "2026-07-01"));
    expect(sum.overdueAmount).toBe(0);
    expect(sum.balance).toBe(10000);
  });
});
