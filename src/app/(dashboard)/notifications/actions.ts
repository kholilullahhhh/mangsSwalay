"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { generateStockNotifications } from "@/lib/notifications/generate";

/**
 * Regenerates derived stock and expiry alerts.
 *
 * Idempotent by construction: the generator keys every alert on the condition
 * that produced it, so pressing "Perbarui" repeatedly neither duplicates a row
 * nor hides a recurrence once the condition clears.
 */
export async function refreshNotificationsAction(): Promise<{
  created: number;
  resolved: number;
}> {
  const user = await requirePermission("notifications:view");

  const result = await generateStockNotifications();

  // Runs every time the page is opened, so only a run that actually changed
  // something is worth an audit row.
  if (result.created > 0 || result.resolved > 0) {
    await audit({
      userId: user.id,
      action: "NOTIFICATION_REFRESH",
      entity: "Notification",
      newData: result,
    });
  }

  revalidatePath("/notifications");
  revalidatePath("/dashboard");

  return { created: result.created, resolved: result.resolved };
}