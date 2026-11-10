import { documentFileName } from "@/lib/documents";
import { myDocumentFile } from "@/lib/portal-data";
import { getCurrentTenant } from "@/lib/tenant-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tenant portal: one of the signed-in tenant's own documents (agreement scans included), else 404. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentTenant();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const doc = await myDocumentFile(me, id);
  if (!doc) return new Response("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": doc.contentType,
    "Content-Length": String(doc.data.length),
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${documentFileName(doc.title, doc.contentType)}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  if (doc.contentType.startsWith("image/")) headers["Content-Security-Policy"] = "default-src 'none'";
  return new Response(new Uint8Array(doc.data), { headers });
}
