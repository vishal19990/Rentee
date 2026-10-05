import { getCurrentUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { readFile } from "@/lib/file-store";
import { Expense } from "@/models/Expense";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves an expense's bill attachment (GridFS bucket "bills") to signed-in admins only. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) return new Response("Not found", { status: 404 });
  await connectDB();
  const expense = await Expense.findById(_id).select("bill").lean();
  if (!expense?.bill) return new Response("Not found", { status: 404 });
  const data = await readFile("bills", expense.bill.fileId);
  if (!data) return new Response("Not found", { status: 404 });

  const download = new URL(req.url).searchParams.has("download");
  const name = expense.bill.name.replace(/[^\w.\- ]/g, "_");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": expense.bill.contentType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(expense.bill.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Images can't run script anyway; PDFs open in the browser's sandboxed viewer (a strict CSP breaks it).
      ...(expense.bill.contentType.startsWith("image/") ? { "Content-Security-Policy": "default-src 'none'" } : {}),
    },
  });
}
