import { describe, expect, it } from "vitest";
import { amountInWords, numberToIndianWords } from "./amount-words";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { embedAppFonts } from "./pdf-fonts";
import { receiptFileName, renderReceiptPdf } from "./receipt-pdf";
import {
  firstName,
  formatReceiptNo,
  landlordSettingsSchema,
  receiptBreakdown,
  receiptFy,
  receiptMessage,
  type ReceiptData,
} from "./receipts";
import { rentSchedule } from "./rent";
import { PAY_LINK_DAYS, signPayToken, signReceiptToken, verifyPayToken, verifyReceiptToken } from "./signed-links";
import { payDue, upiEnabled, upiSettingsSchema, upiUri } from "./upi";
import {
  DEFAULT_REMINDER_TEMPLATE,
  DEFAULT_REMINDER_TEMPLATE_UPI,
  buildReminder,
  renderTemplate,
  reminderVars,
  unknownPlaceholders,
} from "./whatsapp";

const SECRET = new TextEncoder().encode("test-secret-0123456789-abcdefghijklmnop");
const OTHER = new TextEncoder().encode("another-secret-0123456789-abcdefghijk");
const PAYMENT_ID = "65f1a2b3c4d5e6f708192a3b";
const RENTAL_ID = "65f1a2b3c4d5e6f708192a3c";

describe("receipt numbering (matrix: Receipt numbering)", () => {
  it("formats RNT/<FY>/<seq> with 4-digit padding", () => {
    expect(formatReceiptNo("2026-27", 1)).toBe("RNT/2026-27/0001");
    expect(formatReceiptNo("2026-27", 2)).toBe("RNT/2026-27/0002");
    expect(formatReceiptNo("2026-27", 12345)).toBe("RNT/2026-27/12345");
    expect(() => formatReceiptNo("2026-27", 0)).toThrow();
  });

  it("numbers by the payment date's Indian financial year (FY boundary)", () => {
    expect(receiptFy("2026-04-01")).toBe("2026-27");
    expect(receiptFy("2027-03-31")).toBe("2026-27");
    expect(receiptFy("2027-04-01")).toBe("2027-28");
  });

  it("receipt file name is filesystem-safe", () => {
    expect(receiptFileName("RNT/2026-27/0001")).toBe("Receipt-RNT-2026-27-0001.pdf");
  });
});

describe("amount in words (matrix: Amount in words)", () => {
  it("1,25,000 -> Rupees One Lakh Twenty-Five Thousand Only", () => {
    expect(amountInWords(125_000_00)).toBe("Rupees One Lakh Twenty-Five Thousand Only");
  });

  it("uses the Indian system (thousand, lakh, crore)", () => {
    expect(numberToIndianWords(0)).toBe("Zero");
    expect(numberToIndianWords(15)).toBe("Fifteen");
    expect(numberToIndianWords(1_000)).toBe("One Thousand");
    expect(numberToIndianWords(10_101)).toBe("Ten Thousand One Hundred One");
    expect(numberToIndianWords(99_99_999)).toBe("Ninety-Nine Lakh Ninety-Nine Thousand Nine Hundred Ninety-Nine");
    expect(numberToIndianWords(1_00_00_000)).toBe("One Crore");
    expect(numberToIndianWords(1_25_00_00_000)).toBe("One Hundred Twenty-Five Crore");
    expect(numberToIndianWords(2_03_04_005)).toBe("Two Crore Three Lakh Four Thousand Five");
  });

  it("includes paise", () => {
    expect(amountInWords(1500_50)).toBe("Rupees One Thousand Five Hundred and Fifty Paise Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(() => amountInWords(-1)).toThrow();
  });
});

describe("signed receipt links (matrix: Tampered share link)", () => {
  it("round-trips a valid token", () => {
    const t = signReceiptToken(PAYMENT_ID, SECRET);
    expect(t).toMatch(/^r\.[a-f\d]{24}\.[A-Za-z0-9_-]+$/);
    expect(verifyReceiptToken(t, SECRET)).toEqual({ ok: true, link: { kind: "receipt", paymentId: PAYMENT_ID } });
  });

  it("rejects an altered payload, altered signature, other secret or garbage", () => {
    const t = signReceiptToken(PAYMENT_ID, SECRET);
    const [kind, id, sig] = t.split(".");
    const otherId = id.slice(0, -1) + (id.endsWith("b") ? "c" : "b");
    const flipped = sig.slice(0, -2) + (sig.at(-2) === "A" ? "B" : "A") + sig.at(-1);
    for (const bad of [
      `${kind}.${otherId}.${sig}`,
      `${kind}.${id}.${flipped}`,
      `${kind}.${id}`,
      `${kind}.${id}.`,
      `p.${id}.${sig}`,
      "",
      "nonsense",
      t + "x",
    ]) {
      expect(verifyReceiptToken(bad, SECRET)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(verifyReceiptToken(t, OTHER).ok).toBe(false);
  });

  it("a pay token is not accepted as a receipt token and vice versa", () => {
    const pay = signPayToken(RENTAL_ID, {}, SECRET);
    expect(verifyReceiptToken(pay, SECRET).ok).toBe(false);
    expect(verifyPayToken(signReceiptToken(PAYMENT_ID, SECRET), new Date(), SECRET).ok).toBe(false);
  });
});

describe("signed pay links (matrix: Expired pay link)", () => {
  const made = new Date("2026-10-05T10:00:00Z");
  const daysLater = (n: number) => new Date(made.getTime() + n * 86_400_000);

  it("is valid for 45 days, then expired", () => {
    const t = signPayToken(RENTAL_ID, { through: "2026-11", now: made }, SECRET);
    expect(PAY_LINK_DAYS).toBe(45);
    const ok = verifyPayToken(t, daysLater(45), SECRET);
    expect(ok.ok && ok.link).toMatchObject({ kind: "pay", rentalId: RENTAL_ID, through: "2026-11" });
    expect(verifyPayToken(t, daysLater(46), SECRET)).toEqual({ ok: false, reason: "expired" });
  });

  it("same-day links are identical (logged reminder text matches the opened one)", () => {
    expect(signPayToken(RENTAL_ID, { now: made }, SECRET)).toBe(signPayToken(RENTAL_ID, { now: daysLater(0.4) }, SECRET));
  });

  it("extending the expiry or changing the rental breaks the signature (invalid, not expired)", () => {
    const t = signPayToken(RENTAL_ID, { now: made }, SECRET);
    const parts = t.split(".");
    const extended = [...parts.slice(0, 3), (parseInt(parts[3], 36) + 1000).toString(36), parts[4]].join(".");
    expect(verifyPayToken(extended, daysLater(100), SECRET)).toEqual({ ok: false, reason: "invalid" });
    const old = signPayToken(RENTAL_ID, { now: made }, SECRET);
    const tampered = old.replace(RENTAL_ID, PAYMENT_ID);
    expect(verifyPayToken(tampered, daysLater(100), SECRET)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("pay link amount is live (matrix: Pay link amount)", () => {
  const rental = { moveInDate: "2026-06-01", moveOutDate: null, monthlyRent: 12_000_00, dueDay: 5 };
  const today = "2026-10-20";

  it("link made when 12,000 was due; 5,000 paid since -> 7,000", () => {
    const before = rentSchedule(rental, [{ forMonth: "2026-06", amount: 12_000_00 }, { forMonth: "2026-07", amount: 12_000_00 }, { forMonth: "2026-08", amount: 12_000_00 }, { forMonth: "2026-09", amount: 12_000_00 }], today);
    expect(payDue({ ...rental, schedule: before }, "2026-10", today).amount).toBe(12_000_00);
    const after = rentSchedule(
      rental,
      [
        { forMonth: "2026-06", amount: 12_000_00 },
        { forMonth: "2026-07", amount: 12_000_00 },
        { forMonth: "2026-08", amount: 12_000_00 },
        { forMonth: "2026-09", amount: 12_000_00 },
        { forMonth: "2026-10", amount: 5_000_00 },
      ],
      today,
    );
    const due = payDue({ ...rental, schedule: after }, "2026-10", today);
    expect(due).toEqual({ months: [{ month: "2026-10", balance: 7_000_00 }], amount: 7_000_00 });
  });

  it("fully paid -> nothing due", () => {
    const paid = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((m) => ({ forMonth: m, amount: 12_000_00 }));
    expect(payDue({ ...rental, schedule: rentSchedule(rental, paid, today) }, null, today).amount).toBe(0);
  });

  it("a due-soon link for next month includes next month (with charges) until it is paid", () => {
    const paid = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((m) => ({ forMonth: m, amount: 12_000_00 }));
    const terms = { ...rental, charges: [{ month: "2026-11", type: "electricity", amount: 1_200_00 }] };
    const due = payDue({ ...terms, schedule: rentSchedule(terms, paid, today) }, "2026-11", today);
    expect(due).toEqual({ months: [{ month: "2026-11", balance: 13_200_00 }], amount: 13_200_00 });
    const paidNov = rentSchedule(terms, [...paid, { forMonth: "2026-11", amount: 13_200_00 }], today);
    expect(payDue({ ...terms, schedule: paidNov }, "2026-11", today).amount).toBe(0);
  });

  it("never asks for months after the move-out month", () => {
    const left = { ...rental, moveOutDate: "2026-10-31" };
    const paid = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((m) => ({ forMonth: m, amount: 12_000_00 }));
    expect(payDue({ ...left, schedule: rentSchedule(left, paid, today) }, "2026-11", today).amount).toBe(0);
  });
});

describe("UPI (matrix: UPI not configured)", () => {
  const due = {
    kind: "overdue" as const,
    months: [{ month: "2026-09", dueDate: "2026-09-05", balance: 15_000_00 }],
    amount: 15_000_00,
    dueDate: "2026-09-05",
  };

  it("UPI is enabled only with a valid UPI ID and INR", () => {
    expect(upiEnabled({ upiId: "" }, "INR")).toBe(false);
    expect(upiEnabled(null, "INR")).toBe(false);
    expect(upiEnabled({ upiId: "not-a-vpa" }, "INR")).toBe(false);
    expect(upiEnabled({ upiId: "landlord@okhdfcbank" }, "USD")).toBe(false);
    expect(upiEnabled({ upiId: "landlord@okhdfcbank" }, "INR")).toBe(true);
  });

  it("{payLink} renders empty when UPI is not configured", () => {
    const msg = renderTemplate("Pay: [{payLink}]", reminderVars(due, "Asha", "Palm Grove"));
    expect(msg).toBe("Pay: []");
  });

  it("{payLink} is a known placeholder and the UPI default template uses it", () => {
    expect(unknownPlaceholders("Hi {tenant} {payLink}")).toEqual([]);
    expect(DEFAULT_REMINDER_TEMPLATE).not.toContain("{payLink}");
    expect(DEFAULT_REMINDER_TEMPLATE_UPI).toContain("{payLink}");
    expect(unknownPlaceholders(DEFAULT_REMINDER_TEMPLATE_UPI)).toEqual([]);
  });

  it("buildReminder fills {payLink} from the builder (covering the reminder's months)", () => {
    const rental = {
      status: "active" as const,
      monthlyRent: 15_000_00,
      dueDay: 5,
      moveOutDate: null,
      schedule: rentSchedule({ moveInDate: "2026-09-01", monthlyRent: 15_000_00, dueDay: 5 }, [], "2026-09-20"),
    };
    const base = { rental, tenantName: "Asha", tenantPhone: "9876543210", propertyName: "Palm Grove", template: DEFAULT_REMINDER_TEMPLATE_UPI, today: "2026-09-20" };
    const seen: string[] = [];
    const withLink = buildReminder({ ...base, payLink: (d) => (seen.push(d.months.at(-1)!.month), "https://x.test/p/abc") })!;
    expect(withLink.message).toContain("Pay by UPI: https://x.test/p/abc");
    expect(seen).toEqual(["2026-09"]);
    expect(decodeURIComponent(withLink.url!)).toContain("https://x.test/p/abc");
    const without = buildReminder(base)!;
    expect(without.message).not.toContain("{payLink}");
    expect(without.message).not.toContain("https://");
  });

  it("builds the upi://pay URI", () => {
    expect(upiUri({ vpa: "landlord@okhdfcbank", payeeName: "R Kumar", amount: 7_000_00, note: "Rent Oct 2026 Palm Grove" })).toBe(
      "upi://pay?pa=landlord%40okhdfcbank&pn=R%20Kumar&am=7000.00&cu=INR&tn=Rent%20Oct%202026%20Palm%20Grove",
    );
  });

  it("validates the UPI ID in settings", () => {
    expect(upiSettingsSchema.safeParse({ upiId: "bad id", upiPayeeName: "" }).success).toBe(false);
    expect(upiSettingsSchema.safeParse({ upiId: "", upiPayeeName: "" }).success).toBe(true);
    expect(upiSettingsSchema.parse({ upiId: " me@ybl ", upiPayeeName: "Me" })).toEqual({ upiId: "me@ybl", upiPayeeName: "Me" });
  });
});

describe("receipt content", () => {
  const rental = {
    monthlyRent: 10_000_00,
    rentChanges: [{ effectiveMonth: "2026-09", monthlyRent: 11_000_00 }],
    charges: [{ month: "2026-10", type: "electricity", amount: 1_200_00 }],
  };

  it("breaks the month into rent + charges and tracks the balance after each payment", () => {
    const p1 = { id: "a", forMonth: "2026-10", amount: 10_000_00, paidOn: "2026-10-03", createdAt: "2026-10-03T10:00:00.000Z" };
    const p2 = { id: "b", forMonth: "2026-10", amount: 2_200_00, paidOn: "2026-10-10", createdAt: "2026-10-10T10:00:00.000Z" };
    const b1 = receiptBreakdown(rental, p1, [p1, p2]);
    expect(b1).toEqual({
      month: "2026-10",
      rent: 11_000_00,
      chargeItems: [{ type: "electricity", amount: 1_200_00 }],
      monthDue: 12_200_00,
      paidToDate: 10_000_00,
      balanceAfter: 2_200_00,
    });
    const b2 = receiptBreakdown(rental, p2, [p1, p2]);
    expect(b2.paidToDate).toBe(12_200_00);
    expect(b2.balanceAfter).toBe(0);
  });

  it("public pages use the first name only", () => {
    expect(firstName("  Asha  Menon ")).toBe("Asha");
  });

  it("WhatsApp receipt message contains the /r/ link", () => {
    const msg = receiptMessage(
      { receiptNo: "RNT/2026-27/0001", amount: 10_000_00, tenantName: "Asha Menon", propertyName: "Palm Grove", month: "2026-10" },
      "https://rentee.test/r/r.abc.def",
    );
    expect(msg).toContain("Hi Asha,");
    expect(msg).toContain("RNT/2026-27/0001");
    expect(msg).toContain("https://rentee.test/r/r.abc.def");
    expect(msg).not.toContain("Menon");
  });

  it("validates landlord details (PAN format)", () => {
    expect(landlordSettingsSchema.safeParse({ landlordPan: "abcde1234f" }).success).toBe(true);
    expect(landlordSettingsSchema.parse({ landlordPan: "abcde 1234f" }).landlordPan).toBe("ABCDE1234F");
    expect(landlordSettingsSchema.safeParse({ landlordPan: "ABCDE12345" }).success).toBe(false);
    expect(landlordSettingsSchema.safeParse({ landlordPhone: "12" }).success).toBe(false);
  });

  it("splits text into font runs: Noto Sans for Latin and ₹, Devanagari fallback, ? when uncovered", async () => {
    const fonts = await embedAppFonts(await PDFDocument.create());
    const runs = fonts.runs("₹100 आशा 😀");
    expect(runs.map((r) => r.text)).toEqual(["₹100 ", "आशा", " ?"]);
    expect(runs[0].font).toBe(fonts.regular);
    expect(runs[1].font).not.toBe(fonts.regular);
    expect(fonts.widthOf("₹1,25,000", 10)).toBeGreaterThan(0);
  });

  it("renders a PDF whose embedded font maps the ₹ sign and Devanagari (not 'Rs.' or '?')", async () => {
    const data: ReceiptData = {
      receiptNo: "RNT/2026-27/0001",
      paidOn: "2026-10-03",
      method: "UPI",
      amount: 125_000_00,
      landlord: { name: "R Kumar", address: "12 MG Road, Bengaluru", phone: "+91 98765 43210", pan: "ABCDE1234F" },
      tenantName: "आशा Menon",
      propertyName: "Palm Grove Villa",
      propertyAddress: "4 Palm Street, Kochi",
      note: null,
      breakdown: { month: "2026-10", rent: 123_800_00, chargeItems: [{ type: "electricity", amount: 1_200_00 }], monthDue: 125_000_00, paidToDate: 125_000_00, balanceAfter: 0 },
    };
    const pdf = await renderReceiptPdf(data);
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);

    // Decode every stream and read the fonts' ToUnicode CMaps: ₹ (U+20B9) and न (U+0928) are mapped.
    const loaded = await PDFDocument.load(pdf);
    let streams = "";
    for (const [, obj] of loaded.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream) streams += Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1") + "\n";
    }
    expect(streams).toMatch(/beginbfchar|beginbfrange/);
    expect(streams.toUpperCase()).toContain("<20B9>");
    expect(streams.toUpperCase()).toMatch(/<0906>|<0906[0-9A-F]*>/); // आ
    expect(streams).not.toContain("Rs. ");
  });
});
