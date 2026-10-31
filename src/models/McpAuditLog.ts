import mongoose, { type InferSchemaType, type Model } from "mongoose";

const { Schema } = mongoose;

/** One write made through the MCP connector (shown under Settings → Connected apps). Kept 180 days. */
const mcpAuditLogSchema = new Schema(
  {
    tool: { type: String, required: true },
    summary: { type: String, default: "" },
    ok: { type: Boolean, required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    clientId: { type: String, required: true },
    clientName: { type: String, default: "" },
    at: { type: Date, required: true, default: () => new Date(), expires: 60 * 60 * 24 * 180 },
  },
  { versionKey: false, collection: "rentee_mcp_audit_logs" },
);

export type McpAuditLogDoc = InferSchemaType<typeof mcpAuditLogSchema>;

export const McpAuditLog: Model<McpAuditLogDoc> =
  (mongoose.models.McpAuditLog as Model<McpAuditLogDoc>) || mongoose.model<McpAuditLogDoc>("McpAuditLog", mcpAuditLogSchema);
