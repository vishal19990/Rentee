/**
 * Optional WiFi, charged per person (not per room). Pure helpers, no imports, so rent.ts can use
 * them without an import cycle.
 *
 * A rental has zero or more WiFi plans. Each plan covers the months fromMonth..toMonth
 * (inclusive; toMonth null = ongoing) for a set of people at a rate per person that was
 * snapshotted when the plan was created or changed. Plans of one rental never overlap.
 * For a covered month inside the rental's stay, the plan adds a virtual charge item
 * { type: "wifi", label: "WiFi (n people)", amount: n × rate } to that month's due amount.
 */

/** Default WiFi price per person per month: ₹100 (minor units). */
export const DEFAULT_WIFI_RATE = 10000;

export const WIFI_CHARGE_TYPE = "wifi";

export type WifiPerson = { kind: "tenant" | "occupant"; occupantId?: string | null; name: string };

export type WifiPlanLike = {
  fromMonth: string;
  /** Inclusive; null = ongoing. */
  toMonth: string | null;
  people: { name: string }[];
  /** Minor units per person per month. */
  ratePerPerson: number;
};

export type WifiPlanRow = Omit<WifiPlanLike, "people"> & { id: string; people: WifiPerson[] };

export type WifiItem = { type: typeof WIFI_CHARGE_TYPE; label: string; amount: number };

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM shifted by n months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

const monthOfDate = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const iso = typeof d === "string" ? (/^\d{4}-\d{2}/.test(d) ? d : new Date(d).toISOString()) : d.toISOString();
  return iso.slice(0, 7);
};

export function peopleLabel(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

export function wifiLabel(n: number): string {
  return `WiFi (${peopleLabel(n)})`;
}

export function wifiPlanAmount(plan: Pick<WifiPlanLike, "people" | "ratePerPerson">): number {
  return plan.people.length * plan.ratePerPerson;
}

export function planCovers(plan: Pick<WifiPlanLike, "fromMonth" | "toMonth">, month: string): boolean {
  return plan.fromMonth <= month && (plan.toMonth === null || month <= plan.toMonth);
}

export function wifiPlanForMonth<P extends WifiPlanLike>(plans: P[] | undefined, month: string): P | null {
  for (const p of plans ?? []) if (planCovers(p, month)) return p;
  return null;
}

/**
 * The WiFi charge item for a month, or null. Months before the move-in month or after the
 * move-out month (when those dates are given) get nothing.
 */
export function wifiItemForMonth(
  rental: { wifiPlans?: WifiPlanLike[]; moveInDate?: Date | string | null; moveOutDate?: Date | string | null },
  month: string,
): WifiItem | null {
  const first = monthOfDate(rental.moveInDate);
  const last = monthOfDate(rental.moveOutDate);
  if ((first && month < first) || (last && month > last)) return null;
  const plan = wifiPlanForMonth(rental.wifiPlans, month);
  if (!plan || plan.people.length === 0) return null;
  const amount = wifiPlanAmount(plan);
  if (amount <= 0) return null;
  return { type: WIFI_CHARGE_TYPE, label: wifiLabel(plan.people.length), amount };
}

export function plansOverlap(a: Pick<WifiPlanLike, "fromMonth" | "toMonth">, b: Pick<WifiPlanLike, "fromMonth" | "toMonth">): boolean {
  const aEndsBeforeB = a.toMonth !== null && a.toMonth < b.fromMonth;
  const bEndsBeforeA = b.toMonth !== null && b.toMonth < a.fromMonth;
  return !aEndsBeforeB && !bEndsBeforeA;
}

/** True when any two plans cover the same month. */
export function hasOverlap(plans: Pick<WifiPlanLike, "fromMonth" | "toMonth">[]): boolean {
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) if (plansOverlap(plans[i], plans[j])) return true;
  }
  return false;
}

const byFrom = <P extends Pick<WifiPlanLike, "fromMonth">>(plans: P[]) => [...plans].sort((a, b) => (a.fromMonth < b.fromMonth ? -1 : 1));

/** The plan with the latest fromMonth (the only one that may be removed). */
export function latestPlan<P extends WifiPlanLike>(plans: P[]): P | null {
  const sorted = byFrom(plans);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

/**
 * The plan the card manages: the latest plan that is ongoing or ends this month or later
 * (it may start in the future). Null when WiFi has been stopped or never added.
 */
export function activePlan<P extends WifiPlanLike>(plans: P[], thisMonth: string): P | null {
  const latest = latestPlan(plans);
  return latest && (latest.toMonth === null || latest.toMonth >= thisMonth) ? latest : null;
}

/* ---------- plan edits (pure: return the writes to make, or an error) ---------- */

export type PlanDraft = { fromMonth: string; toMonth: string | null; people: WifiPerson[]; ratePerPerson: number };

export type PlanEdit =
  | { ok: false; field: string; message: string }
  | {
      ok: true;
      /** Plans to update (by id) with the given fields. */
      update: { id: string; set: Partial<PlanDraft> }[];
      create: PlanDraft[];
      remove: string[];
      message: string;
    };

const fail = (field: string, message: string): PlanEdit => ({ ok: false, field, message });

export type StayBounds = { firstMonth: string; lastMonth: string | null };

function boundsError(field: string, month: string, b: StayBounds, fmt: (m: string) => string): PlanEdit | null {
  if (month < b.firstMonth) return fail(field, `Month can't be before the move-in month (${fmt(b.firstMonth)})`);
  if (b.lastMonth && month > b.lastMonth) return fail(field, `Month can't be after the move-out month (${fmt(b.lastMonth)})`);
  return null;
}

/** Checks the resulting set of plans never overlaps. */
function overlapAfter(plans: WifiPlanRow[], edit: Extract<PlanEdit, { ok: true }>): boolean {
  const after: Pick<WifiPlanLike, "fromMonth" | "toMonth">[] = plans
    .filter((p) => !edit.remove.includes(p.id))
    .map((p) => ({ ...p, ...(edit.update.find((u) => u.id === p.id)?.set ?? {}) }));
  return hasOverlap([...after, ...edit.create]);
}

const OVERLAP = "WiFi already covers some of these months. Change or remove the other plan first.";

/** "Add WiFi": a new ongoing plan from `fromMonth`. */
export function planAdd(
  plans: WifiPlanRow[],
  input: { fromMonth: string; people: WifiPerson[]; ratePerPerson: number },
  bounds: StayBounds,
  fmt: (m: string) => string = (m) => m,
): PlanEdit {
  if (input.people.length === 0) return fail("people", "Tick at least one person");
  const err = boundsError("fromMonth", input.fromMonth, bounds, fmt);
  if (err) return err;
  const edit: PlanEdit = {
    ok: true,
    update: [],
    create: [{ fromMonth: input.fromMonth, toMonth: null, people: input.people, ratePerPerson: input.ratePerPerson }],
    remove: [],
    message: `WiFi added from ${fmt(input.fromMonth)}.`,
  };
  if (overlapAfter(plans, edit)) return fail("fromMonth", OVERLAP);
  return edit;
}

/**
 * "Change": new people (at the current rate) from `effectiveMonth`. After the current plan's
 * fromMonth, it ends the current plan the month before and starts a new one (keeping the
 * current plan's end, if any); on or before it, it simply replaces the current plan.
 */
export function planChange(
  plans: WifiPlanRow[],
  currentId: string,
  input: { effectiveMonth: string; people: WifiPerson[]; ratePerPerson: number },
  bounds: StayBounds,
  fmt: (m: string) => string = (m) => m,
): PlanEdit {
  const current = plans.find((p) => p.id === currentId);
  if (!current) return fail("effectiveMonth", "This WiFi plan no longer exists. Reload the page.");
  if (input.people.length === 0) return fail("people", "Tick at least one person");
  const err = boundsError("effectiveMonth", input.effectiveMonth, bounds, fmt);
  if (err) return err;
  if (current.toMonth !== null && input.effectiveMonth > current.toMonth) {
    return fail("effectiveMonth", `This plan ends in ${fmt(current.toMonth)}. Choose ${fmt(current.toMonth)} or earlier.`);
  }
  let edit: PlanEdit;
  if (input.effectiveMonth <= current.fromMonth) {
    edit = {
      ok: true,
      update: [{ id: current.id, set: { fromMonth: input.effectiveMonth, people: input.people, ratePerPerson: input.ratePerPerson } }],
      create: [],
      remove: [],
      message: `WiFi plan from ${fmt(input.effectiveMonth)} replaced.`,
    };
  } else {
    edit = {
      ok: true,
      update: [{ id: current.id, set: { toMonth: shiftMonth(input.effectiveMonth, -1) } }],
      create: [{ fromMonth: input.effectiveMonth, toMonth: current.toMonth, people: input.people, ratePerPerson: input.ratePerPerson }],
      remove: [],
      message: `WiFi changed from ${fmt(input.effectiveMonth)}.`,
    };
  }
  if (overlapAfter(plans, edit)) return fail("effectiveMonth", OVERLAP);
  return edit;
}

/** "Stop" from a month: WiFi through the month before; a plan that would end before it starts is removed. */
export function planStop(
  plans: WifiPlanRow[],
  currentId: string,
  stopMonth: string,
  fmt: (m: string) => string = (m) => m,
): PlanEdit {
  const current = plans.find((p) => p.id === currentId);
  if (!current) return fail("stopMonth", "This WiFi plan no longer exists. Reload the page.");
  const toMonth = shiftMonth(stopMonth, -1);
  if (current.toMonth !== null && toMonth >= current.toMonth) {
    return fail("stopMonth", `This plan already ends in ${fmt(current.toMonth)}.`);
  }
  if (toMonth < current.fromMonth) {
    return { ok: true, update: [], create: [], remove: [current.id], message: "WiFi plan removed (it hadn't started yet)." };
  }
  return { ok: true, update: [{ id: current.id, set: { toMonth } }], create: [], remove: [], message: `WiFi stops from ${fmt(stopMonth)}.` };
}

/** Removing a plan (to fix a mistake) is only allowed for the latest one. */
export function planRemove(plans: WifiPlanRow[], planId: string): PlanEdit {
  const latest = latestPlan(plans);
  if (!latest || latest.id !== planId) return fail("planId", "Only the latest WiFi plan can be removed.");
  return { ok: true, update: [], create: [], remove: [planId], message: "WiFi plan removed." };
}

/* ---------- dashboard ---------- */

export type WifiMonthSummary = { people: number; amount: number; rentals: number };

/** People on WiFi, the WiFi amount and the number of rentals with WiFi for a month. */
export function wifiMonthSummary(
  rentals: { wifiPlans?: WifiPlanLike[]; moveInDate?: Date | string | null; moveOutDate?: Date | string | null }[],
  month: string,
): WifiMonthSummary {
  const out = { people: 0, amount: 0, rentals: 0 };
  for (const r of rentals) {
    const item = wifiItemForMonth(r, month);
    if (!item) continue;
    out.people += wifiPlanForMonth(r.wifiPlans, month)!.people.length;
    out.amount += item.amount;
    out.rentals += 1;
  }
  return out;
}

/* ---------- people from the form ---------- */

/** Checkbox name for a person on the WiFi form ("person_tenant" or "person_<occupantId>"). */
export const personField = (p: Pick<WifiPerson, "kind" | "occupantId">) =>
  p.kind === "tenant" ? "person_tenant" : `person_${p.occupantId}`;

/** The people ticked on the form, taken only from the allowed list (tenant + current occupants). */
export function pickPeople(allowed: WifiPerson[], values: Record<string, string>): WifiPerson[] {
  return allowed.filter((p) => values[personField(p)] === "on");
}
