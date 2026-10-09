import { servePublicTourImage } from "@/lib/tour-serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Room panorama for a shared tour link (no login; the token is checked on every request). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; roomId: string }> }) {
  const { token, roomId } = await params;
  return servePublicTourImage(token, roomId, "image");
}
