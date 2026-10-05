import { getCurrentUser } from "@/lib/auth";
import { loadReceipt } from "@/lib/receipt-store";
import { receiptFileName, renderReceiptPdf } from "@/lib/receipt-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Receipt PDF for a payment (F1), signed-in admins only. `?inline=1` opens it in the browser. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const receipt = await loadReceipt(id, "admin");
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
