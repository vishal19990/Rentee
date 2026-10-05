import { getCurrentUser } from "@/lib/auth";
import { fyOf } from "@/lib/fy";
import { localToday, monthOf } from "@/lib/rent";
import { badRequest, fileResponse, unauthorized, XLSX_TYPE } from "@/lib/report-response";
import { isMonthKey, loadCollections } from "@/lib/reports-data";
import { collectionsXlsx } from "@/lib/reports-xlsx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Monthly collections as Excel: ?month=YYYY-MM (default: this month). Signed-in admins only. */
export async function GET(req: Request) {
  if (!(await getCurrentUser())) return unauthorized();
  const today = localToday();
  const param = new URL(req.url).searchParams.get("month");
  if (param !== null && !isMonthKey(param)) return badRequest("month must be YYYY-MM");
  const month = param ?? monthOf(today);
  const fy = fyOf(`${month}-01`);
  const data = await loadCollections(month, fy, today);
  const body = await collectionsXlsx({ ...data, fy });
  return fileResponse(body, `collections-${month}.xlsx`, XLSX_TYPE);
}
