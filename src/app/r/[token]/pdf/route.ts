import { loadReceipt } from "@/lib/receipt-store";
import { receiptFileName, renderReceiptPdf } from "@/lib/receipt-pdf";
import { verifyReceiptToken } from "@/lib/signed-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public receipt PDF for a signed /r/ link (tenant first name only). Invalid token -> 404. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = verifyReceiptToken(token);
  if (!v.ok) return new Response("Not found", { status: 404 });
  const receipt = await loadReceipt(v.link.paymentId, "public");
  if (!receipt) return new Response("Not found", { status: 404 });
  const pdf = await renderReceiptPdf(receipt);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${receiptFileName(receipt.receiptNo)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
