import { Types } from "mongoose";
import { getCurrentUser } from "@/lib/auth";
import { asObjectId } from "@/lib/data";
import { connectDB } from "@/lib/db";
import { readFile } from "@/lib/file-store";
import { Maintenance } from "@/models/Maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Photo a tenant attached to a repair request (encrypted bucket "maintenance"), signed-in admins only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const _id = asObjectId(id);
  if (!_id) return new Response("Not found", { status: 404 });
  await connectDB();
  const m = await Maintenance.findById(_id).select("photo photoType").lean();
  if (!m?.photo || !m.photoType) return new Response("Not found", { status: 404 });
  const data = await readFile("maintenance", m.photo as Types.ObjectId);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": m.photoType,
      "Content-Length": String(data.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
