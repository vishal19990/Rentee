/**
 * Deposit advance and part payments: one test (at least) per I/O-matrix row of
 * spec-deposit-instalments.md. Amounts are minor units (paise).
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderReceiptPdf } from "./receipt-pdf";
import {
  agreedDepositError,
  depositEntryError,
  depositEntryLabel,
  depositPaymentError,
  depositPaymentLabel,
  depositReminderMessage,
  depositStatus,
} from "./deposit";
import { depositReceiptCounterKey, formatDepositReceiptNo, isDepositReceipt } from "./receipts";
import { tenantLedger } from "./reports";
import { signDepositReceiptToken, signReceiptToken, verifyDepositReceiptToken, verifyReceiptToken } from "./signed-links";
import { depositPaymentSchema, fieldErrorsOf, rentalCreateSchema } from "./validation";

const R = (rupees: number) => rupees * 100;
const MOVE_IN = "2026-10-20";
const TODAY = "2026-10-31";
const terms = { deposit: R(50000), moveInDate: MOVE_IN, advanceFlow: true };
const received = (date: string, amount: number) => ({ kind: "received", date, amount });

const booking = received("2026-10-10", R(10000)); // 10 days before move-in
const moveInDay = received(MOVE_IN, R(5000));
const later = received("2026-10-25", R(20000));

const rentalForm = (over: Record<string, string> = {}) => ({
  propertyId: "a".repeat(24),
  tenantId: "b".repeat(24),
  moveInDate: MOVE_IN,
  monthlyRent: "25000",
  deposit: "50000",
  dueDay: "5",
  ...over,
});

describe("deposit advance and part payments", () => {
  it("booking advance: 10,000 dated before move-in is an Advance; balance 40,000", () => {
    expect(depositPaymentLabel(booking.date, MOVE_IN)).toBe("Advance");
    const s = depositStatus(terms, [booking]);
    expect(s).toMatchObject({ agreed: R(50000), advance: R(10000), paidLater: 0, balance: R(40000), held: R(10000) });
  });

  it("booking advance > agreed is a field error on the advance", () => {
    const res = rentalCreateSchema(TODAY).safeParse(rentalForm({ depositAdvance: "60000", depositAdvanceDate: "2026-10-10" }));
    expect(res.success).toBe(false);
    if (!res.success) expect(fieldErrorsOf(res.error).depositAdvance?.[0]).toBe("Advance can't be more than the deposit quoted");
  });

  it("create form: advance amount and date are taken as entered (may be before move-in)", () => {
    const res = rentalCreateSchema(TODAY).safeParse(rentalForm({ depositAdvance: "10000", depositAdvanceDate: "2026-10-10" }));
    expect(res.success && res.data.advance).toEqual({ amount: R(10000), date: "2026-10-10" });
  });

  it("create form: empty advance defaults to the whole deposit, dated today", () => {
    const res = rentalCreateSchema(TODAY).safeParse(rentalForm());
    expect(res.success && res.data.advance).toEqual({ amount: R(50000), date: TODAY });
  });

  it("move-in day payment is also an Advance: advance 15,000, balance 35,000 (acceptance)", () => {
    expect(depositPaymentLabel(MOVE_IN, MOVE_IN)).toBe("Advance");
    const s = depositStatus(terms, [booking, moveInDay]);
    expect(s).toMatchObject({ advance: R(15000), paidLater: 0, balance: R(35000) });
  });

  it("part payment after move-in: Paid later 20,000, balance 15,000", () => {
    expect(depositEntryLabel(later, MOVE_IN)).toBe("Part payment");
    const s = depositStatus(terms, [booking, moveInDay, later]);
    expect(s).toMatchObject({ advance: R(15000), paidLater: R(20000), received: R(35000), balance: R(15000) });
  });

  it("too much: balance 15,000, paying 20,000 is refused", () => {
    expect(depositPaymentError(R(15000), R(20000))).toBe("Only ₹15,000 of the deposit is still due");
    expect(depositPaymentError(R(15000), R(15000))).toBeNull();
  });

  it("fully paid: balance 0 refuses any payment", () => {
    expect(depositPaymentError(0, R(1000))).toBe("The deposit is fully paid");
  });

  it("no advance: 0 creates no entry, so the balance is the whole deposit", () => {
    const res = rentalCreateSchema(TODAY).safeParse(rentalForm({ depositAdvance: "0" }));
    expect(res.success && res.data.advance.amount).toBe(0);
    expect(depositStatus(terms, [])).toMatchObject({ advance: 0, paidLater: 0, balance: R(50000), held: 0 });
  });

  it("future date: a payment (or advance) dated tomorrow is a date field error", () => {
    const pay = depositPaymentSchema({ moveInDate: MOVE_IN, today: TODAY }).safeParse({ amount: "1000", date: "2026-11-01", method: "cash" });
    expect(pay.success).toBe(false);
    if (!pay.success) expect(fieldErrorsOf(pay.error).date?.[0]).toBe("Date can't be in the future");
    const adv = rentalCreateSchema(TODAY).safeParse(rentalForm({ depositAdvanceDate: "2026-11-01" }));
    expect(adv.success).toBe(false);
    if (!adv.success) expect(fieldErrorsOf(adv.error).depositAdvanceDate).toBeDefined();
  });

  it("payment dates: from 60 days before move-in through today; method is required", () => {
    const schema = depositPaymentSchema({ moveInDate: MOVE_IN, today: TODAY });
    expect(schema.safeParse({ amount: "1000", date: "2026-08-21", method: "upi", note: "" }).success).toBe(true);
    const early = schema.safeParse({ amount: "1000", date: "2026-08-20", method: "upi" });
    expect(early.success).toBe(false);
    if (!early.success) expect(fieldErrorsOf(early.error).date).toBeDefined();
    const noMethod = schema.safeParse({ amount: "1000", date: TODAY });
    expect(noMethod.success).toBe(false);
    if (!noMethod.success) expect(fieldErrorsOf(noMethod.error).method).toBeDefined();
  });

  it("legacy rental: full deposit received at move-in, balance always 0 (no badge)", () => {
    const legacy = { deposit: R(20000), moveInDate: "2026-06-01", advanceFlow: false };
    const entries = [received("2026-06-01", R(20000))];
    expect(depositStatus(legacy, entries)).toMatchObject({ received: R(20000), held: R(20000), advance: R(20000), balance: 0 });
    // Even if the agreed amount was raised later, a legacy rental never shows a balance.
    expect(depositStatus({ ...legacy, deposit: R(30000) }, entries).balance).toBe(0);
  });

  it("agreed lowered below what was received is refused", () => {
    expect(agreedDepositError(R(25000), R(30000))).toBe("Agreed deposit can't be less than ₹30,000 already received");
    expect(agreedDepositError(R(30000), R(30000))).toBeNull();
  });

  it("deduction: received 30,000, deduction 5,000 -> held 25,000, balance unchanged", () => {
    const before = depositStatus(terms, [received("2026-10-10", R(30000))]);
    const after = depositStatus(terms, [received("2026-10-10", R(30000)), { kind: "deduction", date: TODAY, amount: R(5000) }]);
    expect(after.held).toBe(R(25000));
    expect(after.balance).toBe(before.balance);
    expect(depositEntryError(R(25000), "deduction", R(26000))).toBe("Cannot exceed held deposit ₹25,000");
    expect(depositEntryLabel({ kind: "deduction", date: TODAY }, MOVE_IN)).toBe("Deduction");
  });

  it("WhatsApp balance reminder text", () => {
    expect(depositReminderMessage("Asha Menon", "Green Villa", R(15000))).toBe(
      "Hi Asha Menon, a gentle reminder that ₹15,000 of the security deposit for Green Villa is still due. Thank you!",
    );
  });

  it("tenant ledger shows quoted, advance, paid later and balance, with Advance / Part payment labels", () => {
    const l = tenantLedger([], [], [later, booking, moveInDay].map((e) => ({ ...e, kind: "received" as const, reason: "" })), terms);
    expect(l.deposit.map((d) => d.label)).toEqual(["Advance", "Advance", "Part payment"]);
    expect(l.depositStatus).toMatchObject({ agreed: R(50000), advance: R(15000), paidLater: R(20000), balance: R(15000) });
  });
});

describe("deposit receipts", () => {
  const SECRET = new TextEncoder().encode("x".repeat(40));
  const ID = "0123456789abcdef01234567";

  it("are numbered DEP/<FY>/<seq> from their own counter", () => {
    expect(formatDepositReceiptNo("2026-27", 7)).toBe("DEP/2026-27/0007");
    expect(depositReceiptCounterKey("2026-27")).toBe("deposit-receipt:2026-27");
    expect(isDepositReceipt({ kind: "deposit" } as never)).toBe(true);
  });

  it("render as a one-page PDF", async () => {
    const pdf = await renderReceiptPdf({
      kind: "deposit",
      receiptNo: "DEP/2026-27/0001",
      paidOn: "2026-10-10",
      method: "UPI",
      amount: R(10000),
      landlord: { name: "Ravi", address: "1 MG Road", phone: "", pan: "" },
      tenantName: "Asha",
      propertyName: "Green Villa",
      propertyAddress: null,
      note: null,
      label: "Advance",
      agreed: R(50000),
      totalReceived: R(10000),
      balance: R(40000),
    });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe("Security deposit receipt DEP/2026-27/0001");
  });

  it("have their own signed /r/ token that rent receipt links don't accept (and vice versa)", () => {
    const t = signDepositReceiptToken(ID, SECRET);
    expect(verifyDepositReceiptToken(t, SECRET)).toEqual({ ok: true, link: { kind: "deposit-receipt", entryId: ID } });
    expect(verifyReceiptToken(t, SECRET).ok).toBe(false);
    expect(verifyDepositReceiptToken(signReceiptToken(ID, SECRET), SECRET).ok).toBe(false);
    expect(verifyDepositReceiptToken(`${t}x`, SECRET).ok).toBe(false);
  });
});
