import "server-only";
import type { Types } from "mongoose";
import { connectDB } from "./db";
import { DEFAULT_WIFI_RATE, type WifiPlanRow } from "./wifi";
import { APP_SETTINGS_KEY, AppSettings } from "@/models/AppSettings";
import { WifiPlan } from "@/models/WifiPlan";

/** WiFi plans per rental id (oldest first). */
export async function loadWifiPlans(rentalIds: Types.ObjectId[]): Promise<Map<string, WifiPlanRow[]>> {
  const out = new Map<string, WifiPlanRow[]>();
  if (rentalIds.length === 0) return out;
  await connectDB();
  const rows = await WifiPlan.find({ rental: { $in: rentalIds } }).sort({ fromMonth: 1 }).lean();
  for (const p of rows) {
    const k = String(p.rental);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({
      id: String(p._id),
      fromMonth: p.fromMonth,
      toMonth: p.toMonth ?? null,
      ratePerPerson: p.ratePerPerson,
      people: (p.people ?? []).map((x) => ({
        kind: x.kind === "occupant" ? "occupant" : "tenant",
        occupantId: x.occupantId ? String(x.occupantId) : null,
        name: x.name,
      })),
    });
  }
  return out;
}

/** Settings → WiFi price per person per month (minor units); default ₹100. */
export async function getWifiRate(): Promise<number> {
  await connectDB();
  const doc = await AppSettings.findOne({ key: APP_SETTINGS_KEY }).select("wifiRatePerPerson").lean();
  return typeof doc?.wifiRatePerPerson === "number" ? doc.wifiRatePerPerson : DEFAULT_WIFI_RATE;
}
