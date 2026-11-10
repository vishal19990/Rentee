import { describe, expect, it } from "vitest";
import {
  hashInviteToken,
  inviteExpiry,
  inviteUrl,
  isInviteTokenShape,
  newInviteToken,
  newPasswordSchema,
  passwordProblem,
  portalStatus,
  sessionStillValid,
} from "./portal-auth";

const NOW = new Date("2026-11-10T10:00:00Z");
const PHONE = "919845011223";

describe("invite tokens", () => {
  it("are 32 random bytes in base64url, stored only as a SHA-256 hash", () => {
    const t = newInviteToken();
    expect(isInviteTokenShape(t)).toBe(true);
    expect(newInviteToken()).not.toBe(t);
    const h = hashInviteToken(t);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toContain(t);
    expect(hashInviteToken(t)).toBe(h);
  });

  it("rejects junk before any lookup", () => {
    for (const bad of ["", "abc", "x".repeat(44), "../../etc/passwd", "a".repeat(42) + "=", null, 42]) expect(isInviteTokenShape(bad)).toBe(false);
  });

  it("expire after 7 days and build the link from APP_URL", () => {
    expect(inviteExpiry(NOW).toISOString()).toBe("2026-11-17T10:00:00.000Z");
    expect(inviteUrl("https://x.test/", "tok")).toBe("https://x.test/portal/invite/tok");
  });
});

describe("tenant password rules", () => {
  it("min 8 characters", () => expect(passwordProblem("abc12", PHONE)).toMatch(/at least 8/));
  it("not only digits", () => expect(passwordProblem("12345678", PHONE)).toMatch(/not only numbers/));
  it("not the phone number, however it's written", () => {
    expect(passwordProblem("9845011223", PHONE)).toMatch(/phone number/);
    expect(passwordProblem("+91 98450 11223", PHONE)).toMatch(/phone number/);
    expect(passwordProblem("98450-11223", PHONE)).toMatch(/phone number/);
  });
  it("accepts a normal password", () => expect(passwordProblem("blue-house-42", PHONE)).toBeNull());
  it("confirm must match", () => {
    const r = newPasswordSchema(PHONE).safeParse({ password: "blue-house-42", confirmPassword: "blue-house-43" });
    expect(r.success).toBe(false);
    expect(r.error?.flatten().fieldErrors.confirmPassword?.[0]).toMatch(/do not match/);
  });
});

describe("portal status", () => {
  const later = new Date(NOW.getTime() + 86_400_000);
  const earlier = new Date(NOW.getTime() - 1000);
  it("not invited", () => expect(portalStatus(undefined, NOW).kind).toBe("not_invited"));
  it("invited / invite expired", () => {
    expect(portalStatus({ inviteTokenHash: "h", inviteExpiresAt: later }, NOW)).toEqual({ kind: "invited", expiresAt: later });
    expect(portalStatus({ inviteTokenHash: "h", inviteExpiresAt: earlier }, NOW).kind).toBe("invite_expired");
  });
  it("active / disabled", () => {
    expect(portalStatus({ passwordHash: "x", enabled: true, lastLoginAt: earlier }, NOW)).toEqual({ kind: "active", lastLoginAt: earlier, pendingInviteExpiresAt: null });
    expect(portalStatus({ passwordHash: "x", enabled: false }, NOW).kind).toBe("disabled");
  });
});

describe("session re-check", () => {
  const acct = { enabled: true, passwordHash: "x", sessionVersion: 2 };
  it("valid only for the current version of an enabled account", () => {
    expect(sessionStillValid(acct, 2)).toBe(true);
    expect(sessionStillValid(acct, 1)).toBe(false); // older session after disable / password change
    expect(sessionStillValid({ ...acct, enabled: false }, 2)).toBe(false);
    expect(sessionStillValid({ ...acct, passwordHash: null }, 2)).toBe(false);
    expect(sessionStillValid(null, 0)).toBe(false);
  });
});
