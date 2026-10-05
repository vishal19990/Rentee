import { headers } from "next/headers";
import { verifyPayToken } from "@/lib/signed-links";

/**
 * Shown (with HTTP 404) for a pay link that is expired, tampered, or no longer usable.
 * A genuine but expired link (older than 45 days) says so; anything else is "not valid".
 */
export default async function PayLinkNotFound() {
  const path = (await headers()).get("x-rentee-path") ?? "";
  let token = "";
  try {
    token = path.startsWith("/p/") ? decodeURIComponent(path.slice(3).split("/")[0] ?? "") : "";
  } catch {
    token = "";
  }
  const check = token ? verifyPayToken(token) : null;
  const expired = !!check && !check.ok && check.reason === "expired";
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-sm text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          {expired ? "This link has expired" : "This link is not valid"}
        </h1>
        <p className="mt-2 text-sm text-slate-500">Ask your landlord for a new payment link.</p>
      </div>
    </main>
  );
}
