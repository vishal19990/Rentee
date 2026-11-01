import { describe, expect, it } from "vitest";
import { LIMITS, fixedWindow } from "./rate-limit-core";

const at = (iso: string) => new Date(iso);

describe("fixed-window rate limit", () => {
  it("allows up to the limit, then refuses with a Retry-After until the minute ends", () => {
    const w = fixedWindow("mcp-grant", "fam1", at("2026-11-01T10:00:15Z"), 60);
    expect(w.decide(60, LIMITS.mcpPerGrant)).toEqual({ allowed: true, remaining: 0, retryAfterSec: 0 });
    expect(w.decide(61, LIMITS.mcpPerGrant)).toEqual({ allowed: false, remaining: 0, retryAfterSec: 45 });
  });

  it("each minute gets its own counter, per bucket and id", () => {
    const a = fixedWindow("mcp-grant", "fam1", at("2026-11-01T10:00:59Z"), 60);
    const b = fixedWindow("mcp-grant", "fam1", at("2026-11-01T10:01:00Z"), 60);
    const c = fixedWindow("mcp-grant", "fam2", at("2026-11-01T10:00:59Z"), 60);
    const d = fixedWindow("mcp-unauth", "fam1", at("2026-11-01T10:00:59Z"), 60);
    expect(new Set([a.key, b.key, c.key, d.key]).size).toBe(4);
  });

  it("counters expire a minute after their window", () => {
    const w = fixedWindow("x", "y", at("2026-11-01T10:00:15Z"), 60);
    expect(w.expiresAt.toISOString()).toBe("2026-11-01T10:02:00.000Z");
  });

  it("retry-after is at least 1 second", () => {
    const w = fixedWindow("x", "y", at("2026-11-01T10:00:59.900Z"), 60);
    expect(w.decide(999, 1).retryAfterSec).toBe(1);
  });
});
