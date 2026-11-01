/**
 * Cloudflare Turnstile ("I'm not a robot") for the login page.
 *
 * Enabled only when both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set; otherwise the
 * login works exactly as before. The widget puts a one-time token in the form field
 * `cf-turnstile-response`; the server checks it with Cloudflare before looking at the password.
 * If Cloudflare can't be reached the check fails (closed), so bots can't slip through.
 */
export const TURNSTILE_FIELD = "cf-turnstile-response";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileSiteKey(): string | null {
  const site = process.env.TURNSTILE_SITE_KEY?.trim();
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  return site && secret ? site : null;
}

export type TurnstileResult = { ok: true } | { ok: false; reason: "missing" | "invalid" | "unavailable" };

export const TURNSTILE_MESSAGES: Record<Exclude<TurnstileResult, { ok: true }>["reason"], string> = {
  missing: "Please complete the “I'm not a robot” check.",
  invalid: "The “I'm not a robot” check failed or expired. Please try again.",
  unavailable: "Couldn't reach the robot check right now. Please try again in a moment.",
};

/** Verifies a Turnstile token with Cloudflare. `fetchImpl` is injectable for tests. */
export async function verifyTurnstile(
  token: string | null | undefined,
  remoteIp: string | null,
  secret = process.env.TURNSTILE_SECRET_KEY?.trim() ?? "",
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (!token || token.length > 2048) return { ok: false, reason: "missing" };
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);
  try {
    const res = await fetchImpl(VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const data = (await res.json()) as { success?: boolean; action?: string };
    if (!data.success) return { ok: false, reason: "invalid" };
    // The widget is rendered with action "login"; reject tokens minted for anything else.
    if (data.action && data.action !== "login") return { ok: false, reason: "invalid" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
