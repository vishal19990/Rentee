import { describe, expect, it } from "vitest";
import { chargeLabel, chargesPhrase } from "./charges";
import { receiptBreakdown } from "./receipts";
import { dueForMonth, rentSchedule, type RentalLike } from "./rent";
import { payDue } from "./upi";
import { reminderDue } from "./whatsapp";
import {
  activePlan,
  hasOverlap,
  pickPeople,
  planAdd,
  planChange,
  planRemove,
  planStop,
  wifiItemForMonth,
  wifiMonthSummary,
  type PlanEdit,
  type WifiPerson,
  type WifiPlanRow,
} from "./wifi";

const tenant: WifiPerson = { kind: "tenant", occupantId: null, name: "Asha" };
const occ1: WifiPerson = { kind: "occupant", occupantId: "a".repeat(24), name: "Ravi" };
const occ2: WifiPerson = { kind: "occupant", occupantId: "b".repeat(24), name: "Meena" };

const plan = (over: Partial<WifiPlanRow> = {}): WifiPlanRow => ({
  id: "p1",
  fromMonth: "2026-11",
  toMonth: null,
  people: [tenant, occ1],
  ratePerPerson: 10000,
  ...over,
});

const rental = (over: Partial<RentalLike> = {}): RentalLike => ({
  moveInDate: "2026-06-01",
  moveOutDate: null,
  monthlyRent: 800000,
  dueDay: 5,
  ...over,
});

const bounds = { firstMonth: "2026-06", lastMonth: null };

/** Applies a successful edit to an in-memory plan list (what the server action writes). */
function applyEdit(plans: WifiPlanRow[], edit: PlanEdit): WifiPlanRow[] {
  if (!edit.ok) throw new Error(edit.message);
  let n = plans.length;
  return [
    ...plans.filter((p) => !edit.remove.includes(p.id)).map((p) => ({ ...p, ...(edit.update.find((u) => u.id === p.id)?.set ?? {}) })),
    ...edit.create.map((c) => ({ ...c, id: `p${++n}` })),
  ];
}

describe("WiFi charge items", () => {
  it("add WiFi: tenant + 1 occupant at ₹100 from Nov 2026 -> ₹200 WiFi each month, due = rent + 200", () => {
    const r = rental({ wifiPlans: [plan()] });
    expect(wifiItemForMonth(r, "2026-10")).toBeNull();
    expect(wifiItemForMonth(r, "2026-11")).toEqual({ type: "wifi", label: "WiFi (2 people)", amount: 20000 });
    expect(wifiItemForMonth(r, "2027-04")?.amount).toBe(20000);
    expect(dueForMonth(r, "2026-11")).toBe(820000);
    expect(dueForMonth(r, "2026-10")).toBe(800000);
    const s = rentSchedule(r, [], "2026-12-20");
    const nov = s.find((m) => m.month === "2026-11")!;
    expect(nov).toMatchObject({ rent: 800000, charges: 20000, due: 820000 });
    expect(nov.chargeItems).toEqual([{ type: "wifi", label: "WiFi (2 people)", amount: 20000 }]);
  });

  it("existing rentals without plans are unchanged", () => {
    const withNone = rentSchedule(rental(), [], "2026-12-20");
    const withEmpty = rentSchedule(rental({ wifiPlans: [] }), [], "2026-12-20");
    expect(withEmpty).toEqual(withNone);
    expect(withNone.every((m) => m.due === 800000 && m.chargeItems.length === 0)).toBe(true);
  });

  it("WiFi merges with stored charges, listed after them", () => {
    const r = rental({ wifiPlans: [plan()], charges: [{ month: "2026-11", type: "electricity", amount: 50000 }] });
    const nov = rentSchedule(r, [], "2026-11-20").find((m) => m.month === "2026-11")!;
    expect(nov.chargeItems.map((c) => c.type)).toEqual(["electricity", "wifi"]);
    expect(nov.due).toBe(870000);
  });

  it("partial with WiFi: Nov rent 8,000 + WiFi 200, paid 8,000 -> partial, balance 200", () => {
    const r = rental({ wifiPlans: [plan()] });
    const nov = rentSchedule(r, [{ forMonth: "2026-11", amount: 800000 }], "2026-11-20").find((m) => m.month === "2026-11")!;
    expect(nov.status).toBe("partial");
    expect(nov.balance).toBe(20000);
  });

  it("moved out: move-out Mar 2027, plan ongoing -> no WiFi after Mar", () => {
    const r = rental({ moveOutDate: "2027-03-15", wifiPlans: [plan()] });
    expect(wifiItemForMonth(r, "2027-03")?.amount).toBe(20000);
    expect(wifiItemForMonth(r, "2027-04")).toBeNull();
    const s = rentSchedule(r, [], "2027-06-01");
    expect(s[s.length - 1].month).toBe("2027-03");
  });

  it("before move-in: a plan month before the stay bills nothing", () => {
    const r = rental({ moveInDate: "2026-12-01", wifiPlans: [plan({ fromMonth: "2026-11" })] });
    expect(wifiItemForMonth(r, "2026-11")).toBeNull();
    expect(wifiItemForMonth(r, "2026-12")?.amount).toBe(20000);
  });

  it("an ongoing plan never extends the schedule into the future", () => {
    const s = rentSchedule(rental({ wifiPlans: [plan()] }), [], "2026-11-20");
    expect(s[s.length - 1].month).toBe("2026-11");
  });

  it("labels and receipt wording", () => {
    expect(chargeLabel("wifi")).toBe("WiFi");
    expect(chargesPhrase([{ type: "wifi" }])).toBe(" and WiFi");
    expect(chargesPhrase([{ type: "wifi" }, { type: "water" }])).toBe(" and charges");
    expect(chargesPhrase([])).toBe("");
    const b = receiptBreakdown(
      { monthlyRent: 800000, wifiPlans: [plan()], moveInDate: "2026-06-01" },
      { id: "x", forMonth: "2026-11", amount: 820000, paidOn: "2026-11-03" },
      [],
    );
    expect(b.monthDue).toBe(820000);
    expect(b.chargeItems).toEqual([{ type: "wifi", label: "WiFi (2 people)", amount: 20000 }]);
  });

  it("reminders and pay links include WiFi", () => {
    const r = rental({ moveInDate: "2026-11-01", wifiPlans: [plan()] });
    const schedule = rentSchedule(r, [], "2026-11-20");
    const due = reminderDue({ ...r, status: "active", moveOutDate: null, schedule }, "2026-11-20");
    expect(due?.amount).toBe(820000);
    // Next month's "due soon" amount (outside the schedule) also includes WiFi.
    const paid = rentSchedule(r, [{ forMonth: "2026-11", amount: 820000 }], "2026-11-20");
    expect(reminderDue({ ...r, status: "active", moveOutDate: null, schedule: paid }, "2026-11-20")?.amount).toBe(820000);
    const pay = payDue({ ...r, moveInDate: "2026-11-01", moveOutDate: null, schedule: paid }, "2026-12", "2026-11-20");
    expect(pay.amount).toBe(820000);
  });
});

describe("WiFi plan edits", () => {
  it("add: none ticked -> field error", () => {
    expect(planAdd([], { fromMonth: "2026-11", people: [], ratePerPerson: 10000 }, bounds)).toMatchObject({
      ok: false,
      field: "people",
      message: "Tick at least one person",
    });
  });

  it("add: before move-in -> field error, not saved", () => {
    const e = planAdd([], { fromMonth: "2026-05", people: [tenant], ratePerPerson: 10000 }, bounds);
    expect(e).toMatchObject({ ok: false, field: "fromMonth" });
  });

  it("add: after move-out -> field error", () => {
    const e = planAdd([], { fromMonth: "2027-04", people: [tenant], ratePerPerson: 10000 }, { firstMonth: "2026-06", lastMonth: "2027-03" });
    expect(e).toMatchObject({ ok: false, field: "fromMonth" });
  });

  it("add: creates an ongoing plan at the given rate", () => {
    const e = planAdd([], { fromMonth: "2026-11", people: [tenant, occ1], ratePerPerson: 10000 }, bounds);
    expect(e.ok && e.create).toEqual([{ fromMonth: "2026-11", toMonth: null, people: [tenant, occ1], ratePerPerson: 10000 }]);
  });

  it("change mid-way: 2 people since Nov, 3 people from Jan 2027 -> Nov–Dec ₹200, Jan on ₹300", () => {
    const plans = applyEdit([plan()], planChange([plan()], "p1", { effectiveMonth: "2027-01", people: [tenant, occ1, occ2], ratePerPerson: 10000 }, bounds));
    expect(plans).toHaveLength(2);
    expect(hasOverlap(plans)).toBe(false);
    const r = rental({ wifiPlans: plans });
    expect(wifiItemForMonth(r, "2026-11")?.amount).toBe(20000);
    expect(wifiItemForMonth(r, "2026-12")?.amount).toBe(20000);
    expect(wifiItemForMonth(r, "2027-01")).toEqual({ type: "wifi", label: "WiFi (3 people)", amount: 30000 });
    expect(wifiItemForMonth(r, "2027-08")?.amount).toBe(30000);
    expect(activePlan(plans, "2026-12")?.fromMonth).toBe("2027-01");
  });

  it("change on or before fromMonth replaces the current plan", () => {
    const e = planChange([plan()], "p1", { effectiveMonth: "2026-11", people: [tenant], ratePerPerson: 15000 }, bounds);
    const plans = applyEdit([plan()], e);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ fromMonth: "2026-11", toMonth: null, ratePerPerson: 15000, people: [tenant] });
    const earlier = applyEdit([plan()], planChange([plan()], "p1", { effectiveMonth: "2026-09", people: [tenant], ratePerPerson: 10000 }, bounds));
    expect(earlier).toHaveLength(1);
    expect(earlier[0].fromMonth).toBe("2026-09");
  });

  it("change: none ticked -> field error", () => {
    expect(planChange([plan()], "p1", { effectiveMonth: "2027-01", people: [], ratePerPerson: 10000 }, bounds)).toMatchObject({ ok: false, field: "people" });
  });

  it("stop from Feb 2027 -> WiFi through Jan 2027, none from Feb", () => {
    const plans = applyEdit([plan()], planStop([plan()], "p1", "2027-02"));
    expect(plans[0].toMonth).toBe("2027-01");
    const r = rental({ wifiPlans: plans });
    expect(wifiItemForMonth(r, "2027-01")?.amount).toBe(20000);
    expect(wifiItemForMonth(r, "2027-02")).toBeNull();
    expect(activePlan(plans, "2027-02")).toBeNull();
    expect(activePlan(plans, "2027-01")?.id).toBe("p1");
  });

  it("stop month on or before fromMonth removes the plan", () => {
    expect(planStop([plan()], "p1", "2026-11")).toMatchObject({ ok: true, remove: ["p1"] });
    expect(planStop([plan()], "p1", "2026-08")).toMatchObject({ ok: true, remove: ["p1"] });
  });

  it("price change: existing plans keep their rate; new/changed plans use the new one", () => {
    const old = plan({ ratePerPerson: 10000 });
    expect(wifiItemForMonth(rental({ wifiPlans: [old] }), "2027-03")?.amount).toBe(20000);
    const changed = applyEdit([old], planChange([old], "p1", { effectiveMonth: "2027-01", people: [tenant, occ1], ratePerPerson: 15000 }, bounds));
    const r = rental({ wifiPlans: changed });
    expect(wifiItemForMonth(r, "2026-12")?.amount).toBe(20000);
    expect(wifiItemForMonth(r, "2027-01")?.amount).toBe(30000);
  });

  it("overlap guard: a plan covering months of another is rejected", () => {
    const stopped = plan({ toMonth: "2027-01" });
    expect(planAdd([stopped], { fromMonth: "2026-12", people: [tenant], ratePerPerson: 10000 }, bounds)).toMatchObject({ ok: false, field: "fromMonth" });
    expect(planAdd([stopped], { fromMonth: "2027-02", people: [tenant], ratePerPerson: 10000 }, bounds).ok).toBe(true);
    // A plan that starts later blocks an ongoing one starting earlier.
    expect(planAdd([plan({ fromMonth: "2027-05" })], { fromMonth: "2027-01", people: [tenant], ratePerPerson: 10000 }, bounds).ok).toBe(false);
    // Replacing back over an earlier plan's months is rejected too.
    const two = [plan({ id: "p1", toMonth: "2026-12" }), plan({ id: "p2", fromMonth: "2027-01" })];
    expect(planChange(two, "p2", { effectiveMonth: "2026-12", people: [tenant], ratePerPerson: 10000 }, bounds)).toMatchObject({ ok: false });
    expect(hasOverlap([plan({ id: "a" }), plan({ id: "b", fromMonth: "2027-06" })])).toBe(true);
  });

  it("only the latest plan can be removed", () => {
    const two = [plan({ id: "p1", toMonth: "2026-12" }), plan({ id: "p2", fromMonth: "2027-01" })];
    expect(planRemove(two, "p1").ok).toBe(false);
    expect(planRemove(two, "p2")).toMatchObject({ ok: true, remove: ["p2"] });
  });

  it("people come only from the allowed list", () => {
    const allowed = [tenant, occ1];
    expect(pickPeople(allowed, { person_tenant: "on", [`person_${occ2.occupantId}`]: "on" })).toEqual([tenant]);
    expect(pickPeople(allowed, {})).toEqual([]);
  });

  it("dashboard summary counts people, amount and rentals this month", () => {
    const rentals = [
      { wifiPlans: [plan()], moveInDate: "2026-06-01", moveOutDate: null },
      { wifiPlans: [plan({ people: [tenant], ratePerPerson: 15000 })], moveInDate: "2026-06-01", moveOutDate: null },
      { wifiPlans: [plan({ toMonth: "2026-10" })], moveInDate: "2026-06-01", moveOutDate: null },
      { wifiPlans: [], moveInDate: "2026-06-01", moveOutDate: null },
    ];
    expect(wifiMonthSummary(rentals, "2026-11")).toEqual({ people: 3, amount: 35000, rentals: 2 });
  });
});
