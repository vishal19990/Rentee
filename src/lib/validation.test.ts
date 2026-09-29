import { describe, expect, it } from "vitest";
import {
  moveOutSchema,
  maintenanceSchema,
  parseForm,
  passwordChangeSchema,
  paymentSchema,
  propertySchema,
  reminderTemplateSchema,
  rentalSchema,
  rentalUpdateSchema,
  tenantSchema,
  validateImage,
} from "./validation";

const ID = "64b7f0c2a1b2c3d4e5f60718";

function fd(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

describe("rentalSchema", () => {
  const base = {
    propertyId: ID,
    tenantId: ID,
    moveInDate: "2026-01-01",
    monthlyRent: "25000",
    deposit: "",
    dueDay: "5",
  };

  it("accepts a month-to-month rental with no move-out date and converts money", () => {
    const r = rentalSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.monthlyRent).toBe(2500000);
      expect(r.data.deposit).toBe(0);
      expect(r.data.dueDay).toBe(5);
      expect("moveOutDate" in r.data).toBe(false);
    }
  });

  it("rejects due day outside 1–28 and impossible dates", () => {
    expect(rentalSchema.safeParse({ ...base, dueDay: "29" }).success).toBe(false);
    expect(rentalSchema.safeParse({ ...base, dueDay: "0" }).success).toBe(false);
    expect(rentalSchema.safeParse({ ...base, moveInDate: "2026-02-30" }).success).toBe(false);
    expect(rentalSchema.safeParse({ ...base, moveInDate: "" }).success).toBe(false);
  });
});

describe("move-out validation", () => {
  it("puts a field error on moveOutDate when it is before the move-in date (I/O matrix)", () => {
    const r = moveOutSchema("2026-03-10").safeParse({ moveOutDate: "2026-03-09" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.moveOutDate?.[0]).toMatch(/before the move-in date/);
  });

  it("accepts a move-out on or after the move-in date, including a future date", () => {
    expect(moveOutSchema("2026-03-10").safeParse({ moveOutDate: "2026-03-10" }).success).toBe(true);
    expect(moveOutSchema("2026-03-10").safeParse({ moveOutDate: "2030-01-01" }).success).toBe(true);
  });

  it("requires a date to record a move-out", () => {
    const r = moveOutSchema("2026-03-10").safeParse({ moveOutDate: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.moveOutDate?.[0]).toBe("Move-out date is required");
  });

  it("edit form: move-out is optional, but can't be before move-in", () => {
    const base = { moveInDate: "2026-03-10", monthlyRent: "100", dueDay: "1" };
    const open = rentalUpdateSchema.safeParse({ ...base, moveOutDate: "" });
    expect(open.success && open.data.moveOutDate).toBe(null);
    const set = rentalUpdateSchema.safeParse({ ...base, moveOutDate: "2026-05-01" });
    expect(set.success && set.data.moveOutDate).toBe("2026-05-01");
    const bad = rentalUpdateSchema.safeParse({ ...base, moveOutDate: "2026-03-01" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(Object.keys(bad.error.flatten().fieldErrors)).toEqual(["moveOutDate"]);
  });
});

describe("paymentSchema", () => {
  const base = { rentalId: ID, forMonth: "2026-09", amount: "100", paidOn: "2026-09-02", method: "upi" };

  it("accepts a positive amount", () => {
    expect(paymentSchema.safeParse(base).success).toBe(true);
  });

  it.each(["0", "0.00", "-10", "", "abc"])("rejects amount %j with a field error", (amount) => {
    const r = paymentSchema.safeParse({ ...base, amount });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.amount?.length).toBeGreaterThan(0);
  });

  it("rejects a malformed month", () => {
    expect(paymentSchema.safeParse({ ...base, forMonth: "2026-13" }).success).toBe(false);
  });
});

describe("other schemas", () => {
  it("validates properties", () => {
    const ok = propertySchema.safeParse({
      name: "Villa",
      address: "1 Road",
      city: "Pune",
      type: "villa",
      bedrooms: "3",
      bathrooms: "2",
      monthlyRent: "30000",
    });
    expect(ok.success).toBe(true);
    const bad = propertySchema.safeParse({ name: " ", type: "castle", bedrooms: "-1", monthlyRent: "0" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const fe = bad.error.flatten().fieldErrors;
      expect(Object.keys(fe)).toEqual(expect.arrayContaining(["name", "address", "city", "type", "bedrooms", "monthlyRent"]));
    }
  });

  it("validates tenants with optional email", () => {
    expect(tenantSchema.safeParse({ name: "A", phone: "+91 98450 11223" }).success).toBe(true);
    expect(tenantSchema.safeParse({ name: "A", phone: "+91 98450 11223", email: "nope" }).success).toBe(false);
    expect(tenantSchema.safeParse({ name: "A", phone: "x" }).success).toBe(false);
  });

  it("validates maintenance with optional cost", () => {
    const r = maintenanceSchema.safeParse({ propertyId: ID, title: "Tap", priority: "high", status: "open", cost: "" });
    expect(r.success && r.data.cost).toBe(0);
  });

  it("requires matching new passwords", () => {
    const r = passwordChangeSchema.safeParse({ currentPassword: "x", newPassword: "abcdefgh", confirmPassword: "abcdefgi" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.confirmPassword?.[0]).toBe("Passwords do not match");
  });
});

describe("parseForm", () => {
  it("returns field errors and echoes submitted values", () => {
    const r = parseForm(paymentSchema, fd({ rentalId: ID, forMonth: "2026-09", amount: "0", paidOn: "2026-09-01", method: "cash" }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.state.fieldErrors?.amount?.[0]).toBe("Amount must be greater than zero");
      expect(r.state.values?.amount).toBe("0");
    }
  });
});

describe("validateImage", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  it("accepts a small PNG", () => {
    expect(validateImage({ type: "image/png", size: 1000 }, png)).toBeNull();
  });
  it("rejects non-images", () => {
    expect(validateImage({ type: "application/pdf", size: 1000 })).toMatch(/Only JPEG, PNG/);
  });
  it("rejects files over 5 MB", () => {
    expect(validateImage({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
  });
  it("rejects a file whose bytes don't match its declared type", () => {
    expect(validateImage({ type: "image/jpeg", size: 1000 }, png)).toMatch(/not a valid image/);
  });
  it("rejects an empty upload", () => {
    expect(validateImage({ type: "image/png", size: 0 })).toMatch(/Choose an image/);
    expect(validateImage(null)).toMatch(/Choose an image/);
  });
});

describe("reminderTemplateSchema", () => {
  it("accepts known placeholders", () => {
    expect(reminderTemplateSchema.safeParse({ reminderTemplate: "Hi {tenant}, {amount} due for {months}" }).success).toBe(true);
  });
  it("rejects unknown placeholders and too-short templates with a field error", () => {
    const r = reminderTemplateSchema.safeParse({ reminderTemplate: "Hi {name}, pay {rent} please" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.reminderTemplate?.[0]).toMatch(/Unknown placeholder {name}, {rent}/);
    expect(reminderTemplateSchema.safeParse({ reminderTemplate: "  hi  " }).success).toBe(false);
  });
});
