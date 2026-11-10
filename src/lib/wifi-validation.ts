import { z } from "zod";
import { money } from "./validation";

/** Form schemas for WiFi plans and the WiFi price setting (people are picked separately, see pickPeople). */

const month = (message: string) => z.string({ required_error: message }).regex(/^\d{4}-(0[1-9]|1[0-2])$/, message);

export const wifiSettingsSchema = z.object({
  wifiRatePerPerson: money("WiFi price per person"),
});

export const wifiAddSchema = z.object({ fromMonth: month("Choose the month WiFi starts") });

export const wifiChangeSchema = z.object({
  planId: z.string().regex(/^[a-f\d]{24}$/i, "WiFi plan not found"),
  effectiveMonth: month("Choose the month the change starts"),
});

export const wifiStopSchema = z.object({
  planId: z.string().regex(/^[a-f\d]{24}$/i, "WiFi plan not found"),
  stopMonth: month("Choose the first month without WiFi"),
});
