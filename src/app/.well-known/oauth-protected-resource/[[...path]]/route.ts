import { protectedResourceMetadata } from "@/lib/oauth/core";
import { json, preflight, requestBase } from "@/lib/oauth/http";

export const dynamic = "force-dynamic";

/** RFC 9728 Protected Resource Metadata, at the root and path-suffixed (/…/api/mcp). */
export async function GET(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path } = await params;
  const suffix = (path ?? []).join("/");
  if (suffix !== "" && suffix !== "api/mcp") return json({ error: "not_found" }, 404);
  return json(protectedResourceMetadata(requestBase(req)), 200, { "Cache-Control": "public, max-age=300" });
}

export function OPTIONS() {
  return preflight();
}
