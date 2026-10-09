import { getCurrentUser } from "@/lib/auth";
import { serveTourImage } from "@/lib/tour-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Virtual tour room panorama (/image) or thumbnail (/thumb), for signed-in admins only. */
export async function GET(_req: Request, { params }: { params: Promise<{ roomId: string; kind: string }> }) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { roomId, kind } = await params;
  if (kind !== "image" && kind !== "thumb") return new Response("Not found", { status: 404 });
  return serveTourImage(roomId, kind, { propertyId: null, cache: "private, max-age=86400" });
}
