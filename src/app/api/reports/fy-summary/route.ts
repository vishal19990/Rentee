import { getCurrentUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { fyOf, isFy } from "@/lib/fy";
import { localToday } from "@/lib/rent";
import { fySummaryPdf } from "@/lib/report-pdf";
import { badRequest, fileResponse, unauthorized, XLSX_TYPE } from "@/lib/report-response";
import { loadFySummary } from "@/lib/reports-data";
import { fySummaryXlsx } from "@/lib/reports-xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Financial-year summary: ?fy=2026-27&format=pdf|xlsx (defaults: current FY, xlsx). Signed-in admins only. */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return unauthorized();
  const sp = new URL(req.url).searchParams;
  const today = localToday();
  const format = sp.get("format") ?? "xlsx";
  if (format !== "pdf" && format !== "xlsx") return badRequest("format must be pdf or xlsx");
  const param = sp.get("fy");
  if (param !== null && !isFy(param)) return badRequest("fy must look like 2026-27");
  const fy = param ?? fyOf(today);
  const summary = await loadFySummary(fy);
  const name = `fy-${fy}-summary`;
  return format === "pdf"
    ? fileResponse(await fySummaryPdf(summary, formatDate(today)), `${name}.pdf`, "application/pdf")
    : fileResponse(await fySummaryXlsx(summary), `${name}.xlsx`, XLSX_TYPE);
}
