import { describe, expect, it } from "vitest";
import {
  canDeleteEnquiry,
  closeWithOutcome,
  conversionRate,
  dateTimeFromLocal,
  desiredEnquiryNotifications,
  enquirySchema,
  enquiryStats,
  enquiryWhatsAppMessage,
  followUpDue,
  formatRate,
  matchingByPhone,
  moveToOpenStatus,
  outcomeSchema,
  parseEnquiryForm,
  periodRange,
  phoneKey,
  reopen,
  samePhone,
  statusesInGroup,
  toLocalDateTimeInput,
  visitSoon,
  type EnquiryNotificationInput,
  type StatsRow,
} from "./enquiries";
import { planSync } from "./notifications";

const ID = "0123456789abcdef01234567";

describe("create enquiry (validation)", () => {
  it("accepts name + phone with a property", () => {
    const r = enquirySchema.safeParse({ name: "Priya", phone: "98765 43210", propertyId: ID, source: "walk_in" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Priya");
      expect(r.data.propertyId).toBe(ID);
      expect(r.data.budget).toBeNull();
      expect(r.data.followUpDate).toBeNull();
    }
  });

  it("missing name / phone -> field errors", () => {
    const r = parseEnquiryForm(enquirySchema, { name: "", phone: "", source: "walk_in" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.state.fieldErrors?.name?.[0]).toBe("Name is required");
      expect(r.state.fieldErrors?.phone?.[0]).toBe("Phone is required");
      expect(r.state.values?.source).toBe("walk_in");
    }
  });

  it("empty property = any property; budget in minor units; optional fields validated", () => {
    const r = enquirySchema.safeParse({
      name: "A",
      phone: "9876543210",
      propertyId: "",
      source: "olx",
      budget: "25,000",
      occupants: "3",
      desiredMoveIn: "2026-11-01",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.propertyId).toBeNull();
      expect(r.data.budget).toBe(2500000);
      expect(r.data.occupants).toBe(3);
    }
    const bad = enquirySchema.safeParse({ name: "A", phone: "9876543210", source: "fax", occupants: "0", desiredMoveIn: "2026-02-30" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const f = bad.error.flatten().fieldErrors;
      expect(f.source).toBeDefined();
      expect(f.occupants).toBeDefined();
      expect(f.desiredMoveIn).toBeDefined();
    }
  });
});

describe("duplicate phone detection", () => {
  it("matches the same number written differently", () => {
    expect(phoneKey("98765 43210")).toBe("919876543210");
    expect(samePhone("98765 43210", "+91 98765-43210")).toBe(true);
    expect(samePhone("098765 43210", "9876543210")).toBe(true);
    expect(samePhone("98765 43210", "98765 43211")).toBe(false);
    expect(samePhone("", "")).toBe(false);
  });

  it("lists earlier enquiries / tenants with that phone, excluding itself", () => {
    const items = [
      { id: "a", phone: "+91 98765 43210" },
      { id: "b", phone: "99999 00000" },
      { id: "self", phone: "9876543210" },
    ];
    expect(matchingByPhone("98765 43210", items, "self").map((i) => i.id)).toEqual(["a"]);
  });
});

describe("status flow", () => {
  const now = new Date("2026-10-05T10:00:00Z");

  it("reject without a reason is refused with a field error on reason", () => {
    const r = parseEnquiryForm(outcomeSchema, { outcome: "rejected", reason: "", reasonText: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.state.fieldErrors?.reason?.[0]).toBe("Select a reason");
  });

  it("reason 'other' needs text; reasons must match the outcome", () => {
    const other = parseEnquiryForm(outcomeSchema, { outcome: "declined", reason: "other", reasonText: "" });
    expect(other.success).toBe(false);
    if (!other.success) expect(other.state.fieldErrors?.reasonText).toBeDefined();
    const wrong = parseEnquiryForm(outcomeSchema, { outcome: "declined", reason: "pets" });
    expect(wrong.success).toBe(false);
    const ok = parseEnquiryForm(outcomeSchema, { outcome: "no_response", reason: "pets" });
    expect(ok.success && ok.data.outcomeReason).toBe("");
  });

  it("decline with a reason closes the enquiry, sets outcomeAt and logs a status change", () => {
    const parsed = outcomeSchema.parse({ outcome: "declined", reason: "found_elsewhere", reasonText: "" });
    const t = closeWithOutcome("visited", parsed, now);
    expect(t.ok).toBe(true);
    if (t.ok) {
      expect(t.update).toEqual({ status: "declined", outcomeReason: "found_elsewhere", outcomeNote: "", outcomeAt: now });
      expect(t.activity).toBe("Status: Visited → Declined (Found elsewhere)");
    }
  });

  it("a closed enquiry can't be closed again or moved to an open status", () => {
    expect(closeWithOutcome("accepted", { outcome: "rejected", outcomeReason: "pets", outcomeNote: "" }, now).ok).toBe(false);
    expect(moveToOpenStatus("rejected", "contacted").ok).toBe(false);
  });

  it("any open status may jump to any other open status", () => {
    const t = moveToOpenStatus("new", "visited");
    expect(t.ok && t.update.status).toBe("visited");
    expect(moveToOpenStatus("new", "new").ok).toBe(false);
    expect(moveToOpenStatus("new", "accepted").ok).toBe(false);
  });

  it("reopen: closed rejected -> contacted with outcome fields cleared", () => {
    const t = reopen("rejected");
    expect(t.ok).toBe(true);
    if (t.ok) {
      expect(t.update).toEqual({ status: "contacted", outcomeReason: "", outcomeNote: "", outcomeAt: null });
      expect(t.activity).toContain("Reopened");
    }
    expect(reopen("contacted").ok).toBe(false);
  });

  it("delete only a new enquiry with nothing beyond its creation activity", () => {
    expect(canDeleteEnquiry("new", 1)).toBe(true);
    expect(canDeleteEnquiry("new", 2)).toBe(false);
    expect(canDeleteEnquiry("contacted", 1)).toBe(false);
  });

  it("status groups", () => {
    expect(statusesInGroup("open")).toEqual(["new", "contacted", "visit_scheduled", "visited"]);
    expect(statusesInGroup("declined")).toEqual(["declined"]);
    expect(statusesInGroup("all")).toHaveLength(9);
  });
});

describe("follow-up & visit notifications", () => {
  const now = new Date(2026, 9, 5, 9, 0); // 5 Oct 2026, 09:00 local
  const base: EnquiryNotificationInput = {
    id: "e1",
    name: "Priya",
    phone: "98765 43210",
    propertyId: "p1",
    propertyName: "Palm Grove Villa",
    status: "contacted",
    followUpDate: "2026-10-05",
    visitAt: null,
  };

  it("follow-up due today -> one enquiry_follow_up notification; repeat sync creates no duplicate", () => {
    const desired = desiredEnquiryNotifications([base], now);
    expect(desired).toHaveLength(1);
    expect(desired[0]).toMatchObject({
      key: "enquiry_follow_up:e1:2026-10-05",
      type: "enquiry_follow_up",
      category: "reminder",
      link: "/enquiries/e1",
      propertyId: "p1",
    });
    const first = planSync([], desired);
    expect(first.create).toHaveLength(1);
    const stored = first.create.map((c) => ({ key: c.key, title: c.title, body: c.body, resolvedAt: null }));
    const again = planSync(stored, desiredEnquiryNotifications([base], now));
    expect(again).toEqual({ create: [], resolveKeys: [], reopen: [], update: [] });
  });

  it("follow-up in the future -> nothing; overdue -> still due", () => {
    expect(desiredEnquiryNotifications([{ ...base, followUpDate: "2026-10-06" }], now)).toHaveLength(0);
    expect(followUpDue({ status: "new", followUpDate: "2026-10-01" }, "2026-10-05")).toBe(true);
  });

  it("closing the enquiry resolves its follow-up notification", () => {
    const stored = desiredEnquiryNotifications([base], now).map((c) => ({ key: c.key, title: c.title, body: c.body, resolvedAt: null }));
    const plan = planSync(stored, desiredEnquiryNotifications([{ ...base, status: "declined" }], now));
    expect(plan.resolveKeys).toEqual(["enquiry_follow_up:e1:2026-10-05"]);
  });

  it("changing the follow-up date resolves the old key and creates the new one", () => {
    const stored = desiredEnquiryNotifications([base], now).map((c) => ({ key: c.key, title: c.title, body: c.body, resolvedAt: null }));
    const plan = planSync(stored, desiredEnquiryNotifications([{ ...base, followUpDate: "2026-10-04" }], now));
    expect(plan.resolveKeys).toEqual(["enquiry_follow_up:e1:2026-10-05"]);
    expect(plan.create.map((c) => c.key)).toEqual(["enquiry_follow_up:e1:2026-10-04"]);
  });

  it("visit today or within 24 h -> one enquiry_visit; later or past days -> none", () => {
    const today = new Date(2026, 9, 5, 18, 30);
    const tomorrowMorning = new Date(2026, 9, 6, 8, 0);
    const inTwoDays = new Date(2026, 9, 7, 10, 0);
    const yesterday = new Date(2026, 9, 4, 10, 0);
    const open = { ...base, followUpDate: null, status: "visit_scheduled" };
    const v = desiredEnquiryNotifications([{ ...open, visitAt: today }], now);
    expect(v).toHaveLength(1);
    expect(v[0].key).toBe(`enquiry_visit:e1:${today.toISOString()}`);
    expect(v[0].title).toMatch(/^Visit today at /);
    expect(desiredEnquiryNotifications([{ ...open, visitAt: tomorrowMorning }], now)[0].title).toMatch(/^Visit tomorrow at /);
    expect(desiredEnquiryNotifications([{ ...open, visitAt: inTwoDays }], now)).toHaveLength(0);
    expect(desiredEnquiryNotifications([{ ...open, visitAt: yesterday }], now)).toHaveLength(0);
    expect(visitSoon({ status: "rejected", visitAt: today }, now)).toBe(false);
  });

  it("datetime-local round trip", () => {
    const d = dateTimeFromLocal("2026-10-05T18:30");
    expect(toLocalDateTimeInput(d)).toBe("2026-10-05T18:30");
    expect(toLocalDateTimeInput(null)).toBe("");
  });
});

describe("conversion (tenant matching)", () => {
  const tenants = [{ id: "t1", phone: "+91 98450 11223" }];
  it("no tenant with that phone -> create a new tenant", () => {
    expect(matchingByPhone("98765 43210", tenants)).toHaveLength(0);
  });
  it("tenant already has that phone -> offered to link, no duplicate", () => {
    expect(matchingByPhone("9845011223", tenants).map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("stats", () => {
  const range = periodRange("this_month", "2026-10-05");

  it("period ranges", () => {
    expect(range).toEqual({ from: "2026-10-01", to: "2026-11-01" });
    expect(periodRange("last_month", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2026-01-01" });
    expect(periodRange("all", "2026-10-05")).toEqual({ from: null, to: null });
  });

  it("10 closed in the period, 3 accepted -> 30%", () => {
    const closed: StatsRow[] = [
      ...Array.from({ length: 3 }, () => ({ status: "accepted", source: "olx" })),
      ...Array.from({ length: 4 }, () => ({ status: "rejected", source: "olx" })),
      ...Array.from({ length: 2 }, () => ({ status: "declined", source: "walk_in" })),
      { status: "no_response", source: "walk_in" },
    ].map((r) => ({ ...r, createdDate: "2026-10-02", outcomeDate: "2026-10-03", visitDate: null }));
    const rows: StatsRow[] = [
      ...closed,
      { status: "new", source: "walk_in", createdDate: "2026-10-04", outcomeDate: null, visitDate: "2026-10-06" },
      // Closed last month: not counted in this month's outcomes.
      { status: "accepted", source: "olx", createdDate: "2026-09-02", outcomeDate: "2026-09-20", visitDate: "2026-09-10" },
    ];
    const s = enquiryStats(rows, range);
    expect(s).toMatchObject({ total: 11, visits: 1, accepted: 3, rejected: 4, declined: 2, closed: 10 });
    expect(s.conversionRate).toBeCloseTo(0.3);
    expect(formatRate(s.conversionRate)).toBe("30%");
    const olx = s.bySource.find((x) => x.source === "olx")!;
    expect(olx).toMatchObject({ count: 7, accepted: 3, closed: 7 });
    expect(formatRate(olx.rate)).toBe("43%");
  });

  it("0 closed -> —", () => {
    expect(conversionRate(0, 0)).toBeNull();
    expect(formatRate(null)).toBe("—");
    expect(enquiryStats([], range).conversionRate).toBeNull();
  });
});

describe("WhatsApp message", () => {
  it("prefills the enquiry text", () => {
    expect(enquiryWhatsAppMessage("Priya", "Palm Grove Villa")).toBe("Hi Priya, this is regarding your enquiry for Palm Grove Villa.");
    expect(enquiryWhatsAppMessage("Priya", null)).toBe("Hi Priya, this is regarding your enquiry for our property.");
  });
});
