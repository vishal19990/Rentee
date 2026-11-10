import { describe, expect, it } from "vitest";
import {
  buildBulkItems,
  filterBulkItems,
  notRemindedSince,
  progressLabel,
  selectAllState,
  sendQueue,
  toggleSelectAll,
  type BulkReminderItem,
  type BulkSource,
} from "./bulk-reminders";
import { rentSchedule } from "./rent";

const TODAY = "2026-10-05";
const NOW = new Date("2026-10-05T12:00:00Z");

function source(
  id: string,
  opts: {
    /** Move-in day in July 2026 (default 1): cycles run from it and are due on it the next month. */
    day?: number;
    rent?: number;
    payments?: { forMonth: string; amount: number }[];
    url?: string | null;
    lastRemindedAt?: string | null;
    noButton?: boolean;
    tenantName?: string;
    moveOutDate?: string | null;
  } = {},
): BulkSource {
  const r = {
    moveInDate: `2026-07-${String(opts.day ?? 1).padStart(2, "0")}`,
    moveOutDate: opts.moveOutDate ?? null,
    monthlyRent: opts.rent ?? 1000000,
  };
  return {
    rental: {
      id,
      tenantId: `t-${id}`,
      tenantName: opts.tenantName ?? `Tenant ${id}`,
      propertyName: `Flat ${id}`,
      status: r.moveOutDate && r.moveOutDate <= TODAY ? "moved_out" : "active",
      monthlyRent: r.monthlyRent,
      moveInDate: r.moveInDate,
      moveOutDate: r.moveOutDate,
      schedule: rentSchedule(r, opts.payments ?? [], TODAY),
    },
    button: opts.noButton
      ? undefined
      : {
          url: opts.url === undefined ? `https://wa.me/91999${id}?text=hi` : opts.url,
          message: `Hi ${id}`,
          lastRemindedAt: opts.lastRemindedAt ?? null,
        },
  };
}

const paid = (...months: string[]) => months.map((forMonth) => ({ forMonth, amount: 1000000 }));

describe("buildBulkItems", () => {
  it("lists overdue rentals first (oldest due first), then due soon (nearest first)", () => {
    const items = buildBulkItems(
      [
        // due soon: cycle 9 Sep – 8 Oct due on 9 Oct (4 days away), earlier cycles paid
        source("soon9", { day: 9, payments: paid("2026-07", "2026-08") }),
        // overdue: only the cycle due 1 Oct
        source("oct", { payments: paid("2026-07", "2026-08") }),
        // overdue: cycles due 1 Aug, 1 Sep and 1 Oct
        source("aug", {}),
        // due soon: due on 7 Oct
        source("soon7", { day: 7, payments: paid("2026-07", "2026-08") }),
      ],
      TODAY,
    );
    expect(items.map((i) => i.rentalId)).toEqual(["aug", "oct", "soon7", "soon9"]);
    expect(items[0]).toMatchObject({ kind: "overdue", amount: 3000000, dueDate: "2026-08-01", tenantId: "t-aug" });
    expect(items[0].months).toBe("1 Jul – 31 Jul 2026, 1 Aug – 31 Aug 2026, 1 Sept – 30 Sept 2026");
    expect(items[2]).toMatchObject({ kind: "due_soon", amount: 1000000, dueDate: "2026-10-07" });
  });

  it("orders overdue rentals with the same due date by amount, largest first", () => {
    const items = buildBulkItems(
      [source("small", { rent: 500000 }), source("big", { rent: 2000000 })],
      TODAY,
    );
    expect(items.map((i) => i.rentalId)).toEqual(["big", "small"]);
  });

  it("leaves out fully paid rentals whose next due date is more than 7 days away", () => {
    const items = buildBulkItems(
      [
        source("paidUp", { payments: paid("2026-07", "2026-08", "2026-09") }), // running cycle due 1 Nov
        source("soon12", { day: 12, payments: paid("2026-07", "2026-08") }), // due 12 Oct, 7 days: included
        source("soon13", { day: 13, payments: paid("2026-07", "2026-08") }), // due 13 Oct, 8 days: excluded
      ],
      TODAY,
    );
    expect(items.map((i) => i.rentalId)).toEqual(["soon12"]);
  });

  it("keeps rentals with no valid phone (disabled) and skips rentals without a reminder", () => {
    const items = buildBulkItems([source("nophone", { url: null }), source("none", { noButton: true })], TODAY);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ rentalId: "nophone", url: null });
  });

  it("includes a moved-out rental that still owes rent", () => {
    // Moved out 31 Aug (end of the cycle 1–31 Aug, due that day); only July's cycle paid.
    const items = buildBulkItems([source("gone", { moveOutDate: "2026-08-31", payments: paid("2026-07") })], TODAY);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "overdue", amount: 1000000 });
  });
});

describe("filters", () => {
  const items = buildBulkItems(
    [
      source("a", { lastRemindedAt: "2026-10-04T10:00:00Z" }), // overdue, reminded yesterday
      source("b", { lastRemindedAt: "2026-09-20T10:00:00Z" }), // overdue, reminded 15 days ago
      source("c", { day: 8, payments: paid("2026-07", "2026-08") }), // due soon (8 Oct), never reminded
    ],
    TODAY,
  );

  it("overdue only / due soon", () => {
    expect(filterBulkItems(items, "overdue", NOW).map((i) => i.rentalId)).toEqual(["a", "b"]);
    expect(filterBulkItems(items, "due_soon", NOW).map((i) => i.rentalId)).toEqual(["c"]);
    expect(filterBulkItems(items, "all", NOW)).toHaveLength(3);
  });

  it("not reminded in 7 days", () => {
    expect(filterBulkItems(items, "not_reminded", NOW).map((i) => i.rentalId)).toEqual(["b", "c"]);
  });

  it("notRemindedSince treats exactly 7 days ago as due for a reminder", () => {
    expect(notRemindedSince(null, NOW)).toBe(true);
    expect(notRemindedSince("2026-09-28T12:00:00Z", NOW)).toBe(true);
    expect(notRemindedSince("2026-09-28T12:00:01Z", NOW)).toBe(false);
    expect(notRemindedSince("garbage", NOW)).toBe(true);
  });
});

describe("selection and queue", () => {
  const items: BulkReminderItem[] = buildBulkItems(
    [source("a", {}), source("b", { url: null }), source("c", { payments: paid("2026-07") })],
    TODAY,
  );

  it("select-all adds only sendable items, and toggles off when all are selected", () => {
    const all = toggleSelectAll(new Set(), items);
    expect([...all].sort()).toEqual(["a", "c"]);
    expect(selectAllState(all, items)).toBe("all");
    expect(toggleSelectAll(all, items).size).toBe(0);
  });

  it("select-all keeps selections hidden by the current filter", () => {
    const next = toggleSelectAll(new Set(["hidden"]), items.slice(0, 1));
    expect([...next].sort()).toEqual(["a", "hidden"]);
  });

  it("reports a partial selection", () => {
    expect(selectAllState(new Set(["a"]), items)).toBe("some");
    expect(selectAllState(new Set(["b"]), items)).toBe("none");
  });

  it("queues selected sendable items in display order, never a disabled row", () => {
    const q = sendQueue(items, new Set(["c", "b", "a"]));
    expect(q.map((i) => i.rentalId)).toEqual(["a", "c"]);
  });

  it("progress label", () => {
    expect(progressLabel(2, 8)).toBe("3 of 8");
    expect(progressLabel(8, 8)).toBe("8 of 8");
  });
});
