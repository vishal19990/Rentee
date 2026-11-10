/**
 * Health / keep-awake endpoint for uptime pingers (e.g. every 14 minutes on Render's free plan).
 * No auth, no database, no personal data — just proves the server is up. Not rate-limited: it
 * does no work an attacker could amplify, and it returns nothing useful.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, time: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}

export function HEAD() {
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
