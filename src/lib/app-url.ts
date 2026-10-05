import "server-only";
import { headers } from "next/headers";

/**
 * Absolute base URL for links shared outside the app (receipt and pay links in WhatsApp
 * messages). Uses APP_URL when set (recommended in production), else the current request's
 * host. Must be called while handling a request (page, route handler or server action).
 */
export async function appBaseUrl(): Promise<string> {
  const fromEnv = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0].trim() || h.get("host") || "localhost:3000";
  const proto =
    h.get("x-forwarded-proto")?.split(",")[0].trim() || (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
