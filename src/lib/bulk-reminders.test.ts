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
    moveInDate?: string;
    dueDay?: number;
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
    moveInDate: opts.moveInDate ?? "2026-08-01",
    moveOutDate: opts.moveOutDate ?? null,
    monthlyRent: opts.rent ?? 1000000,
    dueDay: opts.dueDay ?? 1,
  };
  return {
    rental: {
      id,
      tenantId: `t-${id}`,
      tenantName: opts.tenantName ?? `Tenant ${id}`,
      propertyName: `Flat ${id}`,
      status: r.moveOutDate && r.moveOutDate <= TODAY ? "moved_out" : "active",
      monthlyRent: r.monthlyRent,
      dueDay: r.dueDay,
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
        // due soon: Oct due on the 9th (4 days away), all earlier months paid
        source("soon9", { dueDay: 9, payments: paid("2026-08", "2026-09") }),
        // overdue Oct only (due the 1st)
        source("oct", { payments: paid("2026-08", "2026-09") }),
        // overdue Aug–Oct
        source("aug", {}),
        // due soon: Oct due on the 7th
        source("soon7", { dueDay: 7, payments: paid("2026-08", "2026-09") }),
      ],
      TODAY,
    );
    expect(items.map((i) => i.rentalId)).toEqual(["aug", "oct", "soon7", "soon9"]);
    expect(items[0]).toMatchObject({ kind: "overdue", amount: 3000000, dueDate: "2026-08-01", tenantId: "t-aug" });
    expect(items[0].months).toContain("Aug 2026");
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
        source("paidUp", { payments: paid("2026-08", "2026-09", "2026-10") }), // next due 5 Nov
        source("soon12", { dueDay: 12, payments: paid("2026-08", "2026-09") }), // 7 days: included
        source("soon13", { dueDay: 13, payments: paid("2026-08", "2026-09") }), // 8 days: excluded
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
    const items = buildBulkItems([source("gone", { moveOutDate: "2026-09-20", payments: paid("2026-08") })], TODAY);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "overdue", amount: 1000000 });
  });
});

describe("filters", () => {
  const items = buildBulkItems(
    [
      source("a", { lastRemindedAt: "2026-10-04T10:00:00Z" }), // overdue, reminded yesterday
      source("b", { lastRemindedAt: "2026-09-20T10:00:00Z" }), // overdue, reminded 15 days ago
      source("c", { dueDay: 8, payments: paid("2026-08", "2026-09") }), // due soon, never reminded
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
    [source("a", {}), source("b", { url: null }), source("c", { payments: paid("2026-08") })],
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
