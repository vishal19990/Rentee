import { describe, expect, it } from "vitest";
import {
  addMonthsToDate,
  agreementFormSchema,
  agreementSettingsSchema,
  agreementStatus,
  defaultAgreementEnd,
  desiredAgreementNotifications,
  latestAgreement,
  renewalStart,
  type AgreementLike,
  type AgreementRentalInput,
} from "./agreements";
import { CATEGORY_OF, planSync } from "./notifications";
import { addDays } from "./rent";

const TODAY = "2026-10-05";

const rental = (over: Partial<AgreementRentalInput> = {}): AgreementRentalInput => ({
  id: "r1",
  propertyId: "p1",
  propertyName: "Palm Grove Villa",
  tenantId: "t1",
  tenantName: "Asha Menon",
  status: "active",
  moveOutDate: null,
  ...over,
});

const agreement = (id: string, startDate: string, endDate: string): AgreementLike => ({ id, startDate, endDate });

function specs(rentals: AgreementRentalInput[], list: AgreementLike[], thresholdDays = 30, today = TODAY) {
  return desiredAgreementNotifications({ rentals, agreements: new Map([["r1", list]]), thresholdDays, today });
}

describe("dates", () => {
  it("defaults to start + 11 months − 1 day", () => {
    expect(defaultAgreementEnd("2026-06-01")).toBe("2027-04-30");
    expect(defaultAgreementEnd("2026-01-15")).toBe("2026-12-14");
    expect(defaultAgreementEnd("2026-12-31")).toBe("2027-11-29"); // 30 Nov is the clamped day, minus one
  });

  it("clamps month ends when adding months", () => {
    expect(addMonthsToDate("2026-03-31", 11)).toBe("2027-02-28");
    expect(addMonthsToDate("2027-03-31", 11)).toBe("2028-02-29");
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("renewal starts the day after the previous end", () => {
    expect(renewalStart({ endDate: "2027-04-30" })).toBe("2027-05-01");
    expect(renewalStart({ endDate: "2026-12-31" })).toBe("2027-01-01");
  });
});

describe("agreementStatus", () => {
  it("is expired after the end date, expiring within the threshold, active otherwise", () => {
    expect(agreementStatus({ endDate: "2026-10-04" }, TODAY, 30)).toBe("expired");
    expect(agreementStatus({ endDate: TODAY }, TODAY, 30)).toBe("expiring");
    expect(agreementStatus({ endDate: addDays(TODAY, 30) }, TODAY, 30)).toBe("expiring");
    expect(agreementStatus({ endDate: addDays(TODAY, 31) }, TODAY, 30)).toBe("active");
  });
});

describe("latestAgreement", () => {
  it("picks the latest start date", () => {
    const a = agreement("a", "2025-06-01", "2026-04-30");
    const b = agreement("b", "2026-05-01", "2027-03-31");
    expect(latestAgreement([b, a])?.id).toBe("b");
    expect(latestAgreement([])).toBeNull();
  });
});

describe("desiredAgreementNotifications", () => {
  it("matrix: endDate in 20 days, threshold 30 -> one agreement_expiring", () => {
    const out = specs([rental()], [agreement("a1", "2025-11-26", addDays(TODAY, 20))]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      key: "agreement_expiring:a1",
      type: "agreement_expiring",
      category: "reminder",
      rentalId: "r1",
      link: "/rentals/r1",
      title: "Agreement ends in 20 days: Palm Grove Villa",
    });
    expect(CATEGORY_OF.agreement_expiring).toBe("reminder");
  });

  it("is idempotent: a repeated sync plans no duplicate", () => {
    const first = specs([rental()], [agreement("a1", "2025-11-26", addDays(TODAY, 20))]);
    const second = specs([rental()], [agreement("a1", "2025-11-26", addDays(TODAY, 20))]);
    const plan = planSync(
      first.map((s) => ({ key: s.key, title: s.title, body: s.body, resolvedAt: null })),
      second,
    );
    expect(plan.create).toHaveLength(0);
    expect(plan.resolveKeys).toHaveLength(0);
  });

  it("nothing when the end date is beyond the threshold", () => {
    expect(specs([rental()], [agreement("a1", "2026-01-01", addDays(TODAY, 40))])).toEqual([]);
  });

  it("agreement_expired alert after the end date with no newer agreement", () => {
    const out = specs([rental()], [agreement("a1", "2025-10-01", "2026-08-31")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "agreement_expired:a1", type: "agreement_expired", category: "alert" });
  });

  it("renewal resolves the old notification (only the latest agreement counts)", () => {
    const old = agreement("a1", "2025-11-26", addDays(TODAY, 20));
    const before = specs([rental()], [old]);
    const renewed = agreement("a2", renewalStart(old), defaultAgreementEnd(renewalStart(old)));
    const after = specs([rental()], [old, renewed]);
    expect(after).toEqual([]);
    const plan = planSync(
      before.map((s) => ({ key: s.key, title: s.title, body: s.body, resolvedAt: null })),
      after,
    );
    expect(plan.resolveKeys).toEqual(["agreement_expiring:a1"]);
  });

  it("skips moved-out rentals and tenants already moving out by the end date", () => {
    expect(specs([rental({ status: "moved_out" })], [agreement("a1", "2025-10-01", "2026-08-31")])).toEqual([]);
    const end = addDays(TODAY, 20);
    expect(specs([rental({ moveOutDate: end })], [agreement("a1", "2025-11-26", end)])).toEqual([]);
    expect(specs([rental({ moveOutDate: addDays(end, 10) })], [agreement("a1", "2025-11-26", end)])).toHaveLength(1);
  });

  it("nothing for rentals without agreements", () => {
    expect(specs([rental()], [])).toEqual([]);
  });
});

describe("agreementFormSchema", () => {
  it("defaults an empty end date to 11 months", () => {
    expect(agreementFormSchema(null).parse({ startDate: "2026-06-01", endDate: "" })).toEqual({
      startDate: "2026-06-01",
      endDate: "2027-04-30",
      documentId: null,
    });
  });

  it("rejects an end before the start and a start before the allowed renewal date", () => {
    const r = agreementFormSchema("2027-05-01").safeParse({ startDate: "2027-04-01", endDate: "2027-03-01" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errs = r.error.flatten().fieldErrors as Record<string, string[] | undefined>;
      expect(errs.startDate?.[0]).toMatch(/^Must start on or after/);
      expect(errs.endDate?.[0]).toBe("End date can't be before the start date");
    }
  });

  it("validates the settings threshold", () => {
    expect(agreementSettingsSchema.parse({ agreementExpiryDays: "30" })).toEqual({ agreementExpiryDays: 30 });
    expect(agreementSettingsSchema.safeParse({ agreementExpiryDays: "0" }).success).toBe(false);
    expect(agreementSettingsSchema.safeParse({ agreementExpiryDays: "abc" }).success).toBe(false);
  });
});
