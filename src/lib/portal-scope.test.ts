import { describe, expect, it } from "vitest";
import { byRentalScope, canSeeMaintenance, describeOccupant, maintenanceScope, portalMaintenanceSchema, rentalScope, scoped } from "./portal-scope";

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const P1 = "111111111111111111111111";
const P2 = "222222222222222222222222";

describe("portal scoping filters", () => {
  it("a requested id is always combined with the tenant's scope", () => {
    expect(scoped(B, { tenant: A })).toEqual({ _id: B, tenant: A });
    expect(scoped("../x", { tenant: A })).toBeNull();
    expect(scoped({ $ne: null }, { tenant: A })).toBeNull(); // operator injection
    expect(scoped(undefined, { tenant: A })).toBeNull();
  });

  it("rentals by tenant, rental records by my rental ids", () => {
    expect(rentalScope(A)).toEqual({ tenant: A });
    expect(byRentalScope([P1])).toEqual({ rental: { $in: [P1] } });
    expect(byRentalScope([])).toEqual({ rental: { $in: [] } }); // no rentals -> matches nothing
  });

  it("maintenance: my requests, or the landlord's for my current home during my stay", () => {
    const since = new Date("2026-06-01T00:00:00Z");
    const stays = [{ propertyId: P1, since }];
    const f = maintenanceScope(A, stays) as { $or: unknown[] };
    expect(f.$or).toHaveLength(2);
    expect(f.$or[0]).toEqual({ tenant: A });

    const mine = { tenant: A, createdBy: "tenant", property: P2, createdAt: new Date("2025-01-01") };
    const theirs = { tenant: B, createdBy: "tenant", property: P1, createdAt: new Date("2026-07-01") };
    const landlordHere = { tenant: null, createdBy: "admin", property: P1, createdAt: new Date("2026-07-01") };
    const landlordBefore = { tenant: null, createdBy: "admin", property: P1, createdAt: new Date("2026-01-01") };
    const landlordElsewhere = { tenant: null, createdBy: "admin", property: P2, createdAt: new Date("2026-07-01") };
    expect(canSeeMaintenance(mine, A, stays)).toBe(true);
    expect(canSeeMaintenance(theirs, A, stays)).toBe(false); // another tenant's request, even on my property
    expect(canSeeMaintenance(landlordHere, A, stays)).toBe(true);
    expect(canSeeMaintenance(landlordBefore, A, stays)).toBe(false); // before I moved in (previous tenant's time)
    expect(canSeeMaintenance(landlordElsewhere, A, stays)).toBe(false);
    expect(canSeeMaintenance(theirs, B, [])).toBe(true);
    expect(canSeeMaintenance(landlordHere, B, [])).toBe(false);
  });
});

describe("portal maintenance form", () => {
  it("tenants can pick low / medium / high only", () => {
    const base = { rentalId: P1, title: "Tap leaking", description: "" };
    expect(portalMaintenanceSchema.safeParse({ ...base, priority: "high" }).success).toBe(true);
    expect(portalMaintenanceSchema.safeParse({ ...base, priority: "urgent" }).success).toBe(false);
    expect(portalMaintenanceSchema.safeParse({ ...base, title: " ", priority: "low" }).success).toBe(false);
  });
});

describe("change log text", () => {
  it("shows only the last 4 ID digits", () => {
    expect(describeOccupant({ name: "Ravi", relation: "roommate", phone: "98450 11111", idLast4: "4521", emergency: true })).toBe(
      "Ravi, Roommate, 98450 11111, ID ••••4521, emergency contact",
    );
  });
});
