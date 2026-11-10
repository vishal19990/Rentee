import { myMaintenancePhoto } from "@/lib/portal-data";
import { getCurrentTenant } from "@/lib/tenant-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tenant portal: the photo on one of the signed-in tenant's own repair requests, else 404. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentTenant();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const photo = await myMaintenancePhoto(me, id);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.data.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
