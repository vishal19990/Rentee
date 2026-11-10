import { describe, expect, it } from "vitest";
import { roomChangeError } from "./room-change";

const today = "2026-11-10";

describe("change room", () => {
  it("allowed for a booking that hasn't started (future move-in), even with an advance or prepaid rent", () => {
    expect(roomChangeError({ status: "active", moveInDate: "2026-11-15", today, hasPayments: true })).toBeNull();
  });

  it("allowed on the move-in day", () => {
    expect(roomChangeError({ status: "active", moveInDate: today, today, hasPayments: true })).toBeNull();
  });

  it("allowed after move-in while no rent has been paid", () => {
    expect(roomChangeError({ status: "active", moveInDate: "2026-10-01", today, hasPayments: false })).toBeNull();
  });

  it("refused once the tenant has lived there and paid rent", () => {
    expect(roomChangeError({ status: "active", moveInDate: "2026-10-01", today, hasPayments: true })).toMatch(/Record a move-out/);
  });

  it("refused for a rental that has ended", () => {
    expect(roomChangeError({ status: "moved_out", moveInDate: "2026-01-01", today, hasPayments: false })).toMatch(/ended/);
  });
});
