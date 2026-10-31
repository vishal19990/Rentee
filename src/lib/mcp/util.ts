import "server-only";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { formatMoney } from "../money";
import type { AccessContext } from "../oauth/store";

/** Who is calling: the OAuth grant behind the bearer token. */
export type McpContext = AccessContext & { base: string };

/** Money for tool output: formatted (₹15,000.00) and as integer paise (minor units). */
export function money(minor: number): { formatted: string; paise: number } {
  return { formatted: formatMoney(minor), paise: minor };
}

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** First zod issue as "field: message" (tool inputs are re-validated with the app's form schemas). */
export function zodMessage(error: z.ZodError): string {
  const flat = error.flatten();
  const field = Object.entries(flat.fieldErrors).find(([, v]) => Array.isArray(v) && v.length)?.[0];
  const msg = field ? `${field}: ${(flat.fieldErrors as Record<string, string[]>)[field][0]}` : flat.formErrors[0];
  return msg ?? "Invalid input";
}

/** Major-unit number (e.g. 15000.5 rupees) -> the string the app's money() validator expects. */
export function moneyInput(major: number | undefined | null): string {
  if (major === undefined || major === null) return "";
  if (!Number.isFinite(major)) return "x";
  return major < 0 ? `-${Math.abs(major)}` : String(major);
}
