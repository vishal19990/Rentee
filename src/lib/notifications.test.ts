import { describe, expect, it } from "vitest";
import { rentSchedule, rentalStatus, type PaymentLike } from "./rent";
import {
  DEFAULT_THRESHOLDS,
  daysBetween,
  desiredNotifications,
  planSync,
  syncDue,
  unreadCount,
  type MaintenanceInput,
  type NotificationSpec,
  type RentalInput,
} from "./notifications";

function rental(
  over: Partial<{ id: string; moveInDate: string; moveOutDate: string | null; monthlyRent: number }> = {},
  payments: PaymentLike[] = [],
  today: string,
): RentalInput {
  // Moved in 5 Aug: cycles run 5th → 4th and are due on the 5th of the next month
  // (cycle 2026-08 = 5 Aug – 4 Sep, due 5 Sep; cycle 2026-09 = 5 Sep – 4 Oct, due 5 Oct).
  const r = { id: "r1", moveInDate: "2026-08-05", moveOutDate: null as string | null, monthlyRent: 2000000, ...over };
  return {
    id: r.id,
    propertyId: "p1",
    propertyName: "Palm Grove Villa",
    tenantId: "t1",
    tenantName: "Asha Menon",
    status: rentalStatus(r, today),
    moveInDate: r.moveInDate,
    moveOutDate: r.moveOutDate,
    monthlyRent: r.monthlyRent,
    schedule: rentSchedule(r, payments, today),
  };
}

function maint(over: Partial<MaintenanceInput> = {}): MaintenanceInput {
  return {
    id: "m1",
    title: "Leaking tap",
    propertyId: "p1",
    propertyName: "Palm Grove Villa",
    status: "open",
    priority: "medium",
    createdAt: new Date("2026-10-01T09:00:00Z"),
    ...over,
  };
}

function generate(rentals: RentalInput[], maintenance: MaintenanceInput[], today: string, thresholds = DEFAULT_THRESHOLDS) {
  return desiredNotifications({ rentals, maintenance, thresholds, today, now: new Date(`${today}T12:00:00Z`) });
}

/** Minimal in-memory notification store that applies sync plans like the real sync does. */
class Store {
  items: (NotificationSpec & { readAt: Date | null; resolvedAt: Date | null })[] = [];
  sync(desired: NotificationSpec[]) {
    const plan = planSync(this.items, desired);
    for (const c of plan.create) this.items.push({ ...c, readAt: null, resolvedAt: null });
    for (const k of plan.resolveKeys) this.items.find((i) => i.key === k)!.resolvedAt = new Date();
    for (const r of plan.reopen) Object.assign(this.items.find((i) => i.key === r.key)!, r, { resolvedAt: null, readAt: null });
    for (const u of plan.update) Object.assign(this.items.find((i) => i.key === u.key)!, { title: u.title, body: u.body });
    return plan;
  }
  unread() {
    return unreadCount(this.items);
  }
}

describe("rent_overdue (I/O matrix: overdue notification)", () => {
  it("cycle 5 Sep – 4 Oct due 5 Oct, today the 6th, unpaid -> one rent_overdue for rental+cycle; repeated syncs add nothing", () => {
    const today = "2026-10-06";
    const r = rental({}, [{ forMonth: "2026-08", amount: 2000000 }], today);
    const desired = generate([r], [], today);
    const overdue = desired.filter((n) => n.type === "rent_overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({ key: "rent_overdue:r1:2026-09", period: "2026-09", category: "alert", link: "/rentals/r1" });
    expect(overdue[0].body).toBe("Asha Menon owes ₹20,000.00 for 5 Sept – 4 Oct 2026 (due 5 Oct 2026).");

    const store = new Store();
    store.sync(desired);
    const again = store.sync(generate([r], [], today));
    const third = store.sync(generate([r], [], today));
    expect(again.create).toEqual([]);
    expect(third.create).toEqual([]);
    expect(store.items.filter((i) => i.type === "rent_overdue")).toHaveLength(1);
  });

  it("is not overdue on the due day itself", () => {
    const r = rental({}, [{ forMonth: "2026-08", amount: 2000000 }], "2026-10-05");
    expect(generate([r], [], "2026-10-05").filter((n) => n.type === "rent_overdue")).toHaveLength(0);
  });
});

describe("rent_due_soon (I/O matrix: due-soon notification)", () => {
  it("due in 3 days (cycle end), unpaid, threshold 3 -> one rent_due_soon for rental+cycle", () => {
    const today = "2026-10-02"; // cycle 5 Sep – 4 Oct is due on 5 Oct
    const r = rental({}, [{ forMonth: "2026-08", amount: 2000000 }], today);
    const soon = generate([r], [], today).filter((n) => n.type === "rent_due_soon");
    expect(soon).toHaveLength(1);
    expect(soon[0]).toMatchObject({ key: "rent_due_soon:r1:2026-09", category: "reminder" });
    expect(soon[0].title).toContain("in 3 days");
    expect(soon[0].body).toBe("₹20,000.00 from Asha Menon for 5 Sept – 4 Oct 2026 is due on 5 Oct 2026.");
  });

  it("not yet when the due date is further away than the threshold", () => {
    const r = rental({}, [{ forMonth: "2026-08", amount: 2000000 }], "2026-10-01");
    expect(generate([r], [], "2026-10-01").filter((n) => n.type === "rent_due_soon")).toHaveLength(0);
  });

  it("covers the next cycle before it has started (a short final cycle due on the move-out date)", () => {
    // All cycles through 5 Oct – 4 Nov paid; moving out 7 Nov -> final cycle 5–7 Nov (3 of 30 days) due 7 Nov.
    const today = "2026-11-04";
    const paid = ["2026-08", "2026-09", "2026-10"].map((forMonth) => ({ forMonth, amount: 2000000 }));
    const r = rental({ moveOutDate: "2026-11-07" }, paid, today);
    const soon = generate([r], [], today).filter((n) => n.type === "rent_due_soon");
    expect(soon.map((n) => n.key)).toEqual(["rent_due_soon:r1:2026-11"]);
    expect(soon[0].body).toBe("₹2,000.00 from Asha Menon for 5 Nov – 7 Nov 2026 is due on 7 Nov 2026.");
  });

  it("is resolved when the cycle becomes overdue (replaced by rent_overdue)", () => {
    const store = new Store();
    const paidAug = [{ forMonth: "2026-08", amount: 2000000 }];
    store.sync(generate([rental({}, paidAug, "2026-10-03")], [], "2026-10-03"));
    const plan = store.sync(generate([rental({}, paidAug, "2026-10-06")], [], "2026-10-06"));
    expect(plan.resolveKeys).toEqual(["rent_due_soon:r1:2026-09"]);
    expect(plan.create.map((c) => c.key)).toEqual(["rent_overdue:r1:2026-09"]);
  });

  it("is not generated for a paid cycle or a moved-out rental", () => {
    const paid = rental({}, [{ forMonth: "2026-08", amount: 2000000 }, { forMonth: "2026-09", amount: 2000000 }], "2026-10-02");
    expect(generate([paid], [], "2026-10-02").filter((n) => n.type === "rent_due_soon")).toHaveLength(0);
    const gone = rental({ moveOutDate: "2026-09-30" }, [{ forMonth: "2026-08", amount: 2000000 }, { forMonth: "2026-09", amount: 2000000 }], "2026-10-02");
    expect(generate([gone], [], "2026-10-02")).toHaveLength(0);
  });
});

describe("resolved by payment (I/O matrix)", () => {
  it("full payment resolves the overdue notification and the unread count decreases", () => {
    const today = "2026-10-06";
    const store = new Store();
    store.sync(generate([rental({}, [{ forMonth: "2026-08", amount: 2000000 }], today)], [], today));
    expect(store.unread()).toBe(1);

    const afterPayment = rental({}, [{ forMonth: "2026-08", amount: 2000000 }, { forMonth: "2026-09", amount: 2000000 }], today);
    const plan = store.sync(generate([afterPayment], [], today));
    expect(plan.resolveKeys).toEqual(["rent_overdue:r1:2026-09"]);
    expect(store.items[0].resolvedAt).not.toBeNull();
    expect(store.unread()).toBe(0);
  });

  it("a partial payment keeps it open and updates the amount", () => {
    const today = "2026-10-06";
    const store = new Store();
    store.sync(generate([rental({}, [{ forMonth: "2026-08", amount: 2000000 }], today)], [], today));
    const partial = rental({}, [{ forMonth: "2026-08", amount: 2000000 }, { forMonth: "2026-09", amount: 500000 }], today);
    const plan = store.sync(generate([partial], [], today));
    expect(plan.resolveKeys).toEqual([]);
    expect(plan.update).toHaveLength(1);
    expect(store.items[0].body).toContain("₹15,000.00");
    expect(store.unread()).toBe(1);
  });

  it("read notifications don't count as unread", () => {
    const store = new Store();
    store.sync(generate([rental({}, [], "2026-10-06")], [], "2026-10-06"));
    expect(store.unread()).toBe(2); // cycles due 5 Sep and 5 Oct overdue
    store.items[0].readAt = new Date();
    expect(store.unread()).toBe(1);
  });
});

describe("move_out_soon (I/O matrix: moving out)", () => {
  it("active rental, move-out in 5 days, threshold 7 -> one move_out_soon", () => {
    const today = "2026-10-06";
    const r = rental({ moveOutDate: "2026-10-11" }, [{ forMonth: "2026-08", amount: 2000000 }, { forMonth: "2026-09", amount: 2000000 }], today);
    const n = generate([r], [], today).filter((x) => x.type === "move_out_soon");
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ key: "move_out_soon:r1:2026-10-11", category: "reminder" });
    expect(n[0].title).toContain("in 5 days");
  });

  it("not when further out than the threshold; resolved once the tenant has moved out", () => {
    const paid = [{ forMonth: "2026-08", amount: 2000000 }, { forMonth: "2026-09", amount: 2000000 }];
    expect(generate([rental({ moveOutDate: "2026-10-20" }, paid, "2026-10-06")], [], "2026-10-06")).toHaveLength(0);
    const store = new Store();
    store.sync(generate([rental({ moveOutDate: "2026-10-11" }, paid, "2026-10-06")], [], "2026-10-06"));
    const plan = store.sync(generate([rental({ moveOutDate: "2026-10-11" }, paid, "2026-10-11")], [], "2026-10-11"));
    expect(plan.resolveKeys).toEqual(["move_out_soon:r1:2026-10-11"]);
  });
});

describe("maintenance_pending (I/O matrix: stale maintenance)", () => {
  it("open request created 8 days ago, threshold 7 -> one maintenance_pending", () => {
    const n = generate([], [maint({ createdAt: new Date("2026-09-28T12:00:00Z") })], "2026-10-06");
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ key: "maintenance_pending:m1", category: "alert", link: "/maintenance/m1/edit" });
  });

  it("not for a fresh medium request, but urgent/high alert immediately", () => {
    expect(generate([], [maint({ createdAt: new Date("2026-10-05T12:00:00Z") })], "2026-10-06")).toHaveLength(0);
    expect(generate([], [maint({ priority: "urgent", createdAt: new Date("2026-10-06T11:00:00Z") })], "2026-10-06")).toHaveLength(1);
    expect(generate([], [maint({ priority: "high", createdAt: new Date("2026-10-06T11:00:00Z") })], "2026-10-06")).toHaveLength(1);
  });

  it("resolves when done and reopens (unread again) if the request is reopened", () => {
    const store = new Store();
    const stale = maint({ createdAt: new Date("2026-09-20T12:00:00Z") });
    store.sync(generate([], [stale], "2026-10-06"));
    store.items[0].readAt = new Date();
    expect(store.sync(generate([], [{ ...stale, status: "done" }], "2026-10-06")).resolveKeys).toEqual(["maintenance_pending:m1"]);
    const reopened = store.sync(generate([], [stale], "2026-10-07"));
    expect(reopened.reopen).toHaveLength(1);
    expect(store.items).toHaveLength(1);
    expect(store.unread()).toBe(1);
  });
});

describe("helpers", () => {
  it("daysBetween", () => {
    expect(daysBetween("2026-10-02", "2026-10-05")).toBe(3);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-10-05", "2026-10-02")).toBe(-3);
  });
  it("throttles syncs to once per 5 minutes", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    expect(syncDue(null, now)).toBe(true);
    expect(syncDue(new Date("2026-10-06T11:56:00Z"), now)).toBe(false);
    expect(syncDue(new Date("2026-10-06T11:55:00Z"), now)).toBe(true);
  });
  it("never plans the same key twice", () => {
    const d = generate([], [maint({ priority: "urgent" })], "2026-10-06");
    expect(planSync([], [...d, ...d]).create).toHaveLength(1);
  });
});
