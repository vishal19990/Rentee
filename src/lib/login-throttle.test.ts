import { describe, expect, it } from "vitest";
import { EMAIL_MAX_FAILURES, afterFailure, clientIp, lockMinutesLeft, lockedMessage, type Throttle } from "./login-throttle";

const T0 = new Date("2026-11-01T10:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

function failTimes(times: number, start: Throttle | null = null): Throttle | null {
  let t = start;
  for (let i = 0; i < times; i++) t = afterFailure(t, min(i), EMAIL_MAX_FAILURES);
  return t;
}

describe("login throttle", () => {
  it("4 wrong passwords: not locked yet", () => {
    const t = failTimes(4);
    expect(t?.count).toBe(4);
    expect(lockMinutesLeft(t, min(4))).toBe(0);
  });

  it("5th wrong password locks for 15 minutes", () => {
    const t = failTimes(5); // 5th failure at minute 4
    expect(t?.lockedUntil).toEqual(min(19));
    expect(lockMinutesLeft(t, min(4))).toBe(15);
    expect(lockMinutesLeft(t, min(18.5))).toBe(1);
    expect(lockMinutesLeft(t, min(19))).toBe(0);
  });

  it("after the lock ends, counting starts again from 1", () => {
    const locked = failTimes(5);
    const next = afterFailure(locked, min(20), EMAIL_MAX_FAILURES);
    expect(next).toEqual({ count: 1, firstAt: min(20), lockedUntil: null });
  });

  it("failures spread over more than 15 minutes don't add up", () => {
    const t = afterFailure(failTimes(3), min(16), EMAIL_MAX_FAILURES);
    expect(t.count).toBe(1);
  });

  it("message reads naturally", () => {
    expect(lockedMessage(1)).toBe("Too many failed sign-in attempts. Please try again in 1 minute.");
    expect(lockedMessage(15)).toBe("Too many failed sign-in attempts. Please try again in 15 minutes.");
  });

  it("uses the proxy-appended (last) forwarded address, not a client-forged first one", () => {
    expect(clientIp("1.2.3.4, 203.0.113.9", null)).toBe("203.0.113.9");
    expect(clientIp("203.0.113.9", null)).toBe("203.0.113.9");
    expect(clientIp(null, "198.51.100.7")).toBe("198.51.100.7");
    expect(clientIp(null, null)).toBe("unknown");
  });
});
