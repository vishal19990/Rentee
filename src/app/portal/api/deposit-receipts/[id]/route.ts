import { myDepositReceipt } from "@/lib/portal-data";
import { receiptFileName, renderReceiptPdf } from "@/lib/receipt-pdf";
import { getCurrentTenant } from "@/lib/tenant-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tenant portal: security deposit receipt PDF for one of the tenant's own deposit payments (else 404). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentTenant();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const receipt = await myDepositReceipt(me, id);
  if (!receipt) return new Response("Not found", { status: 404 });
  const pdf = await renderReceiptPdf(receipt);
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${receiptFileName(receipt.receiptNo)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
