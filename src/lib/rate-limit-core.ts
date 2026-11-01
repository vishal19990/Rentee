/** Pure fixed-window rate-limit maths (see rate-limit.ts). */

export type RateDecision = { allowed: boolean; remaining: number; retryAfterSec: number };

/** Requests per minute. Generous for real Claude use, tight enough to blunt floods. */
export const LIMITS = {
  /** Per connection (grant), valid token. */
  mcpPerGrant: 60,
  /** Per client address, missing or invalid token. */
  mcpUnauthenticatedPerIp: 30,
  /** Per client address. */
  oauthTokenPerIp: 30,
  oauthRevokePerIp: 30,
} as const;

export function fixedWindow(bucket: string, id: string, now: Date, windowSec: number) {
  const ms = windowSec * 1000;
  const start = Math.floor(now.getTime() / ms) * ms;
  const end = start + ms;
  return {
    key: `${bucket}:${id}:${start}`,
    // Keep the counter a minute past the window so a slow request still finds it.
    expiresAt: new Date(end + 60_000),
    decide(count: number, limit: number): RateDecision {
      const allowed = count <= limit;
      return {
        allowed,
        remaining: Math.max(limit - count, 0),
        retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((end - now.getTime()) / 1000)),
      };
    },
  };
}
