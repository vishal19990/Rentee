import { describe, expect, it } from "vitest";
import { occupantSchema } from "./occupants";

describe("occupant form", () => {
  it("accepts a roommate with name only", () => {
    const r = occupantSchema.safeParse({ name: " Priya Shah ", relation: "roommate" });
    expect(r.success && r.data).toEqual({ name: "Priya Shah", phone: "", relation: "roommate", idLast4: "", notes: "", emergency: false });
  });

  it("keeps phone, last-4 ID and the emergency tick", () => {
    const r = occupantSchema.safeParse({ name: "Ravi", phone: "+91 98765 43210", relation: "spouse", idLast4: "4521", emergency: "on" });
    expect(r.success && r.data.emergency).toBe(true);
    expect(r.success && r.data.idLast4).toBe("4521");
  });

  it("requires a name", () => {
    expect(occupantSchema.safeParse({ name: "  ", relation: "friend" }).success).toBe(false);
  });

  it("refuses a full 12-digit Aadhaar in the ID field (last 4 digits only)", () => {
    expect(occupantSchema.safeParse({ name: "A", relation: "family", idLast4: "123456789012" }).success).toBe(false);
  });

  it("refuses a too-short phone and an unknown relation", () => {
    expect(occupantSchema.safeParse({ name: "A", relation: "friend", phone: "123" }).success).toBe(false);
    expect(occupantSchema.safeParse({ name: "A", relation: "cousin" }).success).toBe(false);
  });
});
