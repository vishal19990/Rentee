"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { revokeGrant } from "@/lib/oauth/store";
import type { ActionState } from "@/lib/validation";

/** Settings → Connected apps → Revoke: deletes every token of the grant. */
export async function revokeConnectedApp(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser();
  const family = String(fd.get("grant") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(family)) return { ok: false, message: "Connection not found." };
  await revokeGrant(family);
  revalidatePath("/settings");
  return { ok: true, message: "Disconnected." };
}
