import "server-only";
import { attachmentHeader } from "./reports";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A downloaded report file: never cached (it contains tenant and money data). */
export function fileResponse(body: Uint8Array, name: string, contentType: string): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.length),
      "Content-Disposition": attachmentHeader(name),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const unauthorized = () => new Response("Unauthorized", { status: 401 });
export const notFound = (msg = "Not found") => new Response(msg, { status: 404 });
export const badRequest = (msg: string) => new Response(msg, { status: 400 });
