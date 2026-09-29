import { getCurrentUser } from "@/lib/auth";
import { readPhoto } from "@/lib/photo-store";
import { isUploadName } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves uploaded property photos (from MongoDB GridFS) to signed-in admins only. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });

  const { file } = await params;
  if (!isUploadName(file)) return new Response("Not found", { status: 404 });

  const photo = await readPhoto(file);
  if (!photo) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(photo.data.length),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
