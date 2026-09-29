import { describe, expect, it } from "vitest";
import { relativeTime } from "./format";
import { rentSchedule } from "./rent";
import {
  DEFAULT_REMINDER_TEMPLATE,
  NO_PHONE_TOOLTIP,
  buildReminder,
  normalizePhone,
  reminderDue,
  renderTemplate,
  unknownPlaceholders,
  whatsappUrl,
  type ReminderRental,
} from "./whatsapp";

const TODAY = "2026-09-29";

function rentalWith(over: Partial<{ moveInDate: string; moveOutDate: string | null; monthlyRent: number; dueDay: number }> = {}, payments: { forMonth: string; amount: number }[] = [], today = TODAY): ReminderRental {
  const r = { moveInDate: "2026-08-01", moveOutDate: null as string | null, monthlyRent: 1500000, dueDay: 5, ...over };
  return {
    status: r.moveOutDate && r.moveOutDate <= today ? "moved_out" : "active",
    monthlyRent: r.monthlyRent,
    dueDay: r.dueDay,
    moveOutDate: r.moveOutDate,
    schedule: rentSchedule(r, payments, today),
  };
}

describe("normalizePhone", () => {
  it("adds the default country code to a 10-digit number (I/O matrix: WhatsApp link)", () => {
    expect(normalizePhone("98765 43210")).toBe("919876543210");
    expect(normalizePhone("98765-43210", "44")).toBe("449876543210");
  });

  it("uses a +/00 international number as-is, without adding the default code (I/O matrix: intl phone)", () => {
    expect(normalizePhone("+1 (415) 555-0100")).toBe("14155550100");
    expect(normalizePhone("0044 20 7946 0958")).toBe("442079460958");
    expect(normalizePhone("+91 98765 43210")).toBe("919876543210");
  });

  it("drops a trunk 0 on an 11-digit local number", () => {
    expect(normalizePhone("098765 43210")).toBe("919876543210");
  });

  it("returns null for empty or too-short numbers (I/O matrix: no phone)", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("+1234567")).toBeNull(); // 7 digits
    expect(normalizePhone("1234567890123456")).toBeNull(); // > 15 digits
  });
});

describe("templating", () => {
  it("fills placeholders and leaves unknown ones", () => {
    expect(renderTemplate("Hi {tenant}, {amount} {x}", { tenant: "Asha", amount: "₹1" })).toBe("Hi Asha, ₹1 {x}");
  });
  it("reports unknown placeholders", () => {
    expect(unknownPlaceholders(DEFAULT_REMINDER_TEMPLATE)).toEqual([]);
    expect(unknownPlaceholders("Hi {tenant} {name} {name} {rent}")).toEqual(["name", "rent"]);
  });
  it("builds an encoded wa.me URL", () => {
    expect(whatsappUrl("919876543210", "Hi & bye?")).toBe("https://wa.me/919876543210?text=Hi%20%26%20bye%3F");
  });
});

describe("buildReminder", () => {
  it("I/O matrix: phone '98765 43210', ₹15,000 overdue for Aug 2026", () => {
    // Moved in Aug 2026, August paid 0, September paid in full -> only Aug overdue (₹15,000).
    const rental = rentalWith({}, [{ forMonth: "2026-09", amount: 1500000 }]);
    const r = buildReminder({
      rental,
      tenantName: "Asha Menon",
      tenantPhone: "98765 43210",
      propertyName: "Palm Grove Villa",
      template: DEFAULT_REMINDER_TEMPLATE,
      today: TODAY,
    })!;
    expect(r.kind).toBe("overdue");
    expect(r.url).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    const text = decodeURIComponent(r.url!.split("?text=")[1]);
    expect(text).toBe(r.message);
    expect(text).toContain("Asha Menon");
    expect(text).toContain("Palm Grove Villa");
    expect(text).toContain("₹15,000");
    expect(text).not.toContain("₹15,000.00");
    expect(text).toContain("Aug 2026");
    expect(text).toContain("5 Aug 2026");
  });

  it("I/O matrix: international phone is used without the default code", () => {
    const r = buildReminder({
      rental: rentalWith(),
      tenantName: "Sam",
      tenantPhone: "+1 (415) 555-0100",
      propertyName: "Loft",
      template: "{tenant}",
      today: TODAY,
    })!;
    expect(r.phone).toBe("14155550100");
    expect(r.url).toBe("https://wa.me/14155550100?text=Sam");
  });

  it("I/O matrix: no valid phone -> no URL (button disabled with tooltip)", () => {
    for (const tenantPhone of ["", "12345", undefined]) {
      const r = buildReminder({ rental: rentalWith(), tenantName: "A", tenantPhone, propertyName: "P", template: "x", today: TODAY })!;
      expect(r).not.toBeNull();
      expect(r.phone).toBeNull();
      expect(r.url).toBeNull();
    }
    expect(NO_PHONE_TOOLTIP).toBe("Add a phone number");
  });

  it("lists every overdue month and the outstanding total", () => {
    const r = buildReminder({
      rental: rentalWith({ moveInDate: "2026-07-01" }, [{ forMonth: "2026-07", amount: 500000 }]),
      tenantName: "A",
      tenantPhone: "9876543210",
      propertyName: "P",
      template: "{amount} | {months} | {dueDate}",
      today: TODAY,
    })!;
    // Jul balance 10,000 + Aug 15,000 + Sep 15,000
    expect(r.message).toBe("₹40,000 | Jul 2026, Aug 2026, Sept 2026 | 5 Jul 2026");
  });
});

describe("reminderDue", () => {
  it("offers a 'due soon' reminder for the upcoming month when nothing is past due", () => {
    const due = reminderDue(rentalWith({ moveInDate: "2026-09-01", dueDay: 28 }, [], "2026-09-20"), "2026-09-20")!;
    expect(due).toMatchObject({ kind: "due_soon", amount: 1500000, dueDate: "2026-09-28" });
  });

  it("offers next month as 'due soon' when everything so far is paid", () => {
    const due = reminderDue(rentalWith({}, [{ forMonth: "2026-08", amount: 1500000 }, { forMonth: "2026-09", amount: 1500000 }]), TODAY)!;
    expect(due).toMatchObject({ kind: "due_soon", dueDate: "2026-10-05" });
    expect(due.months.map((m) => m.month)).toEqual(["2026-10"]);
  });

  it("has nothing to remind about when moving out before the next month", () => {
    const paid = [{ forMonth: "2026-08", amount: 1500000 }, { forMonth: "2026-09", amount: 1500000 }];
    expect(reminderDue(rentalWith({ moveOutDate: "2026-09-30" }, paid), TODAY)).toBeNull();
  });

  it("still reminds a moved-out tenant about arrears, but never 'due soon'", () => {
    const moved = rentalWith({ moveOutDate: "2026-09-10" }, [{ forMonth: "2026-08", amount: 1500000 }]);
    expect(moved.status).toBe("moved_out");
    expect(reminderDue(moved, TODAY)).toMatchObject({ kind: "overdue", amount: 1500000 });
    const settled = rentalWith({ moveOutDate: "2026-09-10" }, [
      { forMonth: "2026-08", amount: 1500000 },
      { forMonth: "2026-09", amount: 1500000 },
    ]);
    expect(reminderDue(settled, TODAY)).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  it("formats recent and older times", () => {
    expect(relativeTime(new Date("2026-09-29T11:59:50Z"), now, "en")).toBe("just now");
    expect(relativeTime(new Date("2026-09-29T11:55:00Z"), now, "en")).toBe("5 minutes ago");
    expect(relativeTime(new Date("2026-09-29T09:00:00Z"), now, "en")).toBe("3 hours ago");
    expect(relativeTime(new Date("2026-09-28T12:00:00Z"), now, "en")).toBe("yesterday");
    expect(relativeTime(new Date("2026-09-19T12:00:00Z"), now, "en")).toBe("last week");
  });
});
