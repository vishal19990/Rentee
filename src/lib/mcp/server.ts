import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { touchGrant } from "../oauth/store";
import { registerReadTools } from "./tools/read";
import { registerWriteTools } from "./tools/write";
import { fail, ok, type McpContext } from "./util";

/**
 * A fresh MCP server per request (stateless Streamable HTTP), bound to the caller's grant.
 * Every tool call records the grant's last use; unexpected errors become tool errors.
 */
export function buildMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: "rentee", title: "Rentee", version: "1.0.0" },
    {
      instructions:
        "Rentee is a landlord's rental property manager (India: money in INR, Indian financial year April–March). Use the read tools to answer questions about properties, tenants, rentals, rent due/overdue, deposits, payments, expenses, profit, enquiries and maintenance. Money values come as { formatted, paise }. Write tools (record payments, deposits, enquiries, maintenance) need the rentee:write scope; confirm details with the user before writing — payments can't be deleted.",
    },
  );
  const run = async (fn: () => Promise<ReturnType<typeof ok>>) => {
    await touchGrant(ctx);
    try {
      return await fn();
    } catch (err) {
      console.error("[mcp] tool failed:", err);
      return fail("Something went wrong in Rentee while running this tool. Please try again.");
    }
  };
  registerReadTools(server, run, ctx);
  registerWriteTools(server, run, ctx);
  return server;
}
