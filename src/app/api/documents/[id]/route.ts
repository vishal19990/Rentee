import { getCurrentUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { readDocumentFile } from "@/lib/document-store";
import { documentFileName } from "@/lib/documents";
import { TenantDocument } from "@/models/TenantDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a tenant document (from GridFS bucket "documents") to signed-in admins only.
 * `?download=1` forces a download; otherwise it opens inline (PDF viewer / image).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) return new Response("Not found", { status: 404 });

  await connectDB();
  const doc = await TenantDocument.findById(_id).select("title file contentType").lean();
  if (!doc) return new Response("Not found", { status: 404 });
  const data = await readDocumentFile(doc.file);
  if (!data) return new Response("Not found", { status: 404 });

  const download = new URL(req.url).searchParams.get("download") === "1";
  const name = documentFileName(doc.title, doc.contentType);
  const headers: Record<string, string> = {
    "Content-Type": doc.contentType,
    "Content-Length": String(data.length),
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
    // Personal ID documents: never cache in shared caches or on disk.
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  // Images get a locked-down CSP; PDFs are left to the browser's PDF viewer, which a strict CSP can break.
  if (doc.contentType.startsWith("image/")) headers["Content-Security-Policy"] = "default-src 'none'";

  return new Response(new Uint8Array(data), { headers });
}
