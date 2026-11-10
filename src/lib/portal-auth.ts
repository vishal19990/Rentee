/**
 * Tenant portal accounts: pure rules (no database access), shared by the admin "Tenant portal"
 * card, the invite page and the portal login.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const INVITE_DAYS = 7;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;
export const TENANT_MAX_FAILURES = 5;

export const INVALID_LOGIN = "Invalid phone or password";
export const FORGOT_PASSWORD = "Ask your landlord to send a new invite link.";
export const NO_PHONE_FOR_INVITE = "Add a phone number first";

/** A fresh invite token: 32 random bytes, base64url (43 characters). Only its hash is stored. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Shape check before any database lookup (rejects junk without touching the DB). */
export function isInviteTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_DAYS * 86_400_000);
}

export function inviteUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}/portal/invite/${token}`;
}

export function inviteMessage(tenantFirstName: string, link: string): string {
  return (
    `Hi ${tenantFirstName}, you can now see your rent, receipts and documents and report repairs on Rentee. ` +
    `Set your password here (link valid for ${INVITE_DAYS} days): ${link}`
  );
}

/**
 * Password rules for tenants: at least 8 characters, not only digits, and not the phone number.
 * `phoneDigits` is the normalized login phone (country code + number).
 */
export function passwordProblem(password: string, phoneDigits: string | null): string | null {
  if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  if (password.length > MAX_PASSWORD) return "Password is too long";
  // Only digits (perhaps written with spaces, +, - or brackets): refuse, naming the phone if it's theirs.
  const stripped = password.replace(/[\s+\-().]/g, "");
  if (/^\d+$/.test(stripped)) {
    const isPhone =
      !!phoneDigits && stripped.length >= 8 && (phoneDigits.endsWith(stripped) || stripped.endsWith(phoneDigits.slice(-10)));
    return isPhone ? "Don't use your phone number as the password" : "Use letters too, not only numbers";
  }
  return null;
}

/** Set-password form (invite page) and change-password form share these field rules. */
export function newPasswordSchema(phoneDigits: string | null) {
  return z
    .object({
      password: z.string().default(""),
      confirmPassword: z.string().default(""),
    })
    .superRefine((v, ctx) => {
      const problem = passwordProblem(v.password, phoneDigits);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: problem });
      else if (v.password !== v.confirmPassword) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmPassword"], message: "Passwords do not match" });
    });
}

export const portalLoginSchema = z.object({
  phone: z.string().trim().min(1, "Enter your phone number").max(30, "Enter a valid phone number"),
  password: z.string().min(1, "Enter your password").max(MAX_PASSWORD, "Password is too long"),
});

/** What is stored on Tenant.portal (all optional: tenants without an account have none). */
export type PortalAccount = {
  enabled?: boolean | null;
  passwordHash?: string | null;
  loginPhone?: string | null;
  inviteTokenHash?: string | null;
  inviteExpiresAt?: Date | null;
  sessionVersion?: number | null;
  lastLoginAt?: Date | null;
};

export type PortalStatus =
  | { kind: "not_invited" }
  | { kind: "invited"; expiresAt: Date }
  | { kind: "invite_expired"; expiredAt: Date }
  | { kind: "active"; lastLoginAt: Date | null; pendingInviteExpiresAt: Date | null }
  | { kind: "disabled" };

export function portalStatus(p: PortalAccount | null | undefined, now: Date = new Date()): PortalStatus {
  const pendingInvite = p?.inviteTokenHash && p.inviteExpiresAt && p.inviteExpiresAt > now ? p.inviteExpiresAt : null;
  if (p?.passwordHash) {
    if (!p.enabled) return { kind: "disabled" };
    return { kind: "active", lastLoginAt: p.lastLoginAt ?? null, pendingInviteExpiresAt: pendingInvite };
  }
  if (pendingInvite) return { kind: "invited", expiresAt: pendingInvite };
  if (p?.inviteTokenHash && p.inviteExpiresAt) return { kind: "invite_expired", expiredAt: p.inviteExpiresAt };
  return { kind: "not_invited" };
}

/**
 * Whether a verified session token still stands for a usable account: the account must be
 * enabled, have a password, and the token's version must match (disable / password change /
 * new password via invite bump it, ending older sessions).
 */
export function sessionStillValid(p: PortalAccount | null | undefined, tokenVersion: number): boolean {
  return !!p && p.enabled === true && !!p.passwordHash && (p.sessionVersion ?? 0) === tokenVersion;
}
