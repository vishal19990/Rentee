import { describe, expect, it } from "vitest";
import { formatMoney, minorDigits, parseMoney, toMajorString } from "./money";

describe("money", () => {
  it("knows minor unit digits per currency", () => {
    expect(minorDigits("INR")).toBe(2);
    expect(minorDigits("USD")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
  });

  it("parses decimal input into integer minor units", () => {
    expect(parseMoney("12500", "INR")).toBe(1250000);
    expect(parseMoney("12,500.5", "INR")).toBe(1250050);
    expect(parseMoney("0.07", "INR")).toBe(7);
    expect(parseMoney(" 1 000.00 ", "INR")).toBe(100000);
    expect(parseMoney("1500", "JPY")).toBe(1500);
  });

  it("rejects invalid input", () => {
    expect(parseMoney("", "INR")).toBeNull();
    expect(parseMoney("abc", "INR")).toBeNull();
    expect(parseMoney("-5", "INR")).toBeNull();
    expect(parseMoney("1.234", "INR")).toBeNull();
    expect(parseMoney("1.5", "JPY")).toBeNull();
  });

  it("formats minor units with the currency", () => {
    expect(formatMoney(1250050, "INR", "en-IN")).toBe("₹12,500.50");
    expect(formatMoney(12345678, "INR", "en-IN")).toBe("₹1,23,456.78");
    expect(formatMoney(199, "USD", "en-US")).toBe("$1.99");
    expect(formatMoney(1500, "JPY", "en-US")).toBe("¥1,500");
  });

  it("round-trips through the input string", () => {
    expect(toMajorString(1250050, "INR")).toBe("12500.50");
    expect(parseMoney(toMajorString(1250050, "INR"), "INR")).toBe(1250050);
  });
});
