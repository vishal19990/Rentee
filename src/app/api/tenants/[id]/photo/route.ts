import { Types } from "mongoose";
import { getCurrentUser } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { readFile } from "@/lib/file-store";
import { Tenant } from "@/models/Tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A tenant's profile photo, for signed-in admins only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) return new Response("Not found", { status: 404 });
  await connectDB();
  const tenant = await Tenant.findById(id).select("photo").lean();
  if (!tenant?.photo) return new Response("Not found", { status: 404 });
  const data = await readFile("avatars", tenant.photo);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": data[0] === 0x89 ? "image/png" : data[0] === 0x52 ? "image/webp" : "image/jpeg",
      "Content-Length": String(data.length),
      // The URL carries the photo id (?v=), so a changed photo is a new URL.
      "Cache-Control": "private, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
