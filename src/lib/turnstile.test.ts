import { afterEach, describe, expect, it, vi } from "vitest";
import { turnstileSiteKey, verifyTurnstile } from "./turnstile";

const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

afterEach(() => vi.unstubAllEnvs());

describe("turnstile", () => {
  it("is off unless both keys are set", () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "site");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(turnstileSiteKey()).toBeNull();
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    expect(turnstileSiteKey()).toBe("site");
  });

  it("no token → missing, without calling Cloudflare", async () => {
    const f = reply({ success: true });
    expect(await verifyTurnstile("", "1.2.3.4", "s", f)).toEqual({ ok: false, reason: "missing" });
    expect(f).not.toHaveBeenCalled();
  });

  it("valid token passes and sends secret, token and IP", async () => {
    const f = reply({ success: true, action: "login" });
    expect(await verifyTurnstile("tok", "203.0.113.9", "sec", f)).toEqual({ ok: true });
    const body = (f.mock.calls[0] as unknown as [string, { body: URLSearchParams }])[1].body;
    expect(body.get("secret")).toBe("sec");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("203.0.113.9");
  });

  it("rejected token or a token for another action fails", async () => {
    expect(await verifyTurnstile("tok", null, "s", reply({ success: false }))).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyTurnstile("tok", null, "s", reply({ success: true, action: "signup" }))).toEqual({ ok: false, reason: "invalid" });
  });

  it("fails closed when Cloudflare can't be reached", async () => {
    const down = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await verifyTurnstile("tok", null, "s", down)).toEqual({ ok: false, reason: "unavailable" });
    expect(await verifyTurnstile("tok", null, "s", reply({}, 500))).toEqual({ ok: false, reason: "unavailable" });
  });
});
