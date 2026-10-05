import "server-only";
import { connectDB } from "./db";
import { APP_SETTINGS_KEY, AppSettings } from "@/models/AppSettings";

/** Settings default electricity rate per unit (minor units), or null when not set. */
export async function getDefaultElectricityRate(): Promise<number | null> {
  await connectDB();
  const doc = await AppSettings.findOne({ key: APP_SETTINGS_KEY }).select("defaultElectricityRate").lean();
  return typeof doc?.defaultElectricityRate === "number" ? doc.defaultElectricityRate : null;
}
