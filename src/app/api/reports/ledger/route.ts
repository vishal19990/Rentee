import { getCurrentUser } from "@/lib/auth";
import { formatDate, formatStay } from "@/lib/format";
import { localToday } from "@/lib/rent";
import { ledgerPdf } from "@/lib/report-pdf";
import { badRequest, fileResponse, notFound, unauthorized, XLSX_TYPE } from "@/lib/report-response";
import { fileSlug } from "@/lib/reports";
import { loadLedger } from "@/lib/reports-data";
import { ledgerXlsx } from "@/lib/reports-xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One rental's ledger: ?rental=<id>&format=pdf|xlsx (default pdf). Signed-in admins only. */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return unauthorized();
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") ?? "pdf";
  if (format !== "pdf" && format !== "xlsx") return badRequest("format must be pdf or xlsx");
  const today = localToday();
  const data = await loadLedger(sp.get("rental") ?? "", today);
  if (!data) return notFound("Rental not found");
  const { rental, ledger } = data;
  const heading = {
    tenantName: rental.tenantName,
    propertyName: rental.propertyName,
    stay: formatStay(rental.moveInDate, rental.moveOutDate),
    generatedOn: formatDate(today),
  };
  const name = `ledger-${fileSlug(rental.tenantName, "tenant")}-${fileSlug(rental.propertyName, "property")}-${today}`;
  return format === "pdf"
    ? fileResponse(await ledgerPdf(heading, ledger), `${name}.pdf`, "application/pdf")
    : fileResponse(await ledgerXlsx(heading, ledger), `${name}.xlsx`, XLSX_TYPE);
}
