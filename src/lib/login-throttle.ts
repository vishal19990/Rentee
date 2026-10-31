/**
 * Login brute-force protection (pure rules). Failed sign-ins are counted per email and per IP
 * address within a rolling window; reaching the limit locks that key for LOCK_MINUTES.
 * - Per email: 5 failures → locked 15 minutes (stops password guessing on one account).
 * - Per IP:   20 failures → locked 15 minutes (stops one machine trying many emails).
 * The lock applies whether or not the email exists, so it can't be used to discover accounts.
 */
export const EMAIL_MAX_FAILURES = 5;
export const IP_MAX_FAILURES = 20;
export const WINDOW_MINUTES = 15;
export const LOCK_MINUTES = 15;

export type Throttle = { count: number; firstAt: Date; lockedUntil: Date | null };

/** Minutes left on a lock (rounded up), or 0 when the key isn't locked. */
export function lockMinutesLeft(t: Throttle | null, now: Date): number {
  if (!t?.lockedUntil || t.lockedUntil <= now) return 0;
  return Math.ceil((t.lockedUntil.getTime() - now.getTime()) / 60_000);
}

/** The throttle after one more failure: a new window if the old one expired, locked at the limit. */
export function afterFailure(t: Throttle | null, now: Date, max: number): Throttle {
  const windowOpen = t && now.getTime() - t.firstAt.getTime() < WINDOW_MINUTES * 60_000 && !(t.lockedUntil && t.lockedUntil <= now);
  const count = windowOpen ? t.count + 1 : 1;
  const firstAt = windowOpen ? t.firstAt : now;
  const lockedUntil = count >= max ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null;
  return { count, firstAt, lockedUntil };
}

export function lockedMessage(minutes: number): string {
  return `Too many failed sign-in attempts. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/**
 * The client address for the per-IP limit: the **last** X-Forwarded-For entry, which is the one
 * the hosting proxy (Render) appends — earlier entries are whatever the client sent and could be
 * forged to dodge the limit. Falls back to X-Real-IP, then "unknown". The per-email limit doesn't
 * depend on this at all.
 */
export function clientIp(forwardedFor: string | null, realIp: string | null): string {
  const last = forwardedFor?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last || realIp?.trim() || "unknown";
}
