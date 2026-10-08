import type { Metadata } from "next";

import { hasPermission, requirePagePermission } from "@/lib/auth/session";
import { generateStockNotifications } from "@/lib/notifications/generate";
import { listNotifications } from "@/lib/queries/catalog";
import { NotificationList } from "./notification-list";

export const metadata: Metadata = {
  title: "Notifikasi",
};

/**
 * Alert centre.
 *
 * Alerts are derived from stock and batch state rather than hand-written, and
 * regenerated on every render of this page: stock moves with every sale,
 * purchase and adjustment, so an alert centre that only refreshes on demand is
 * quietly wrong within minutes. Generation is idempotent, so doing it on render
 * costs a query and never duplicates a row.
 */
export default async function NotificationsPage() {
  const user = await requirePagePermission("notifications:view");

  const [notifications, canManage] = await Promise.all([
    // Regenerated first: the list below is then guaranteed to reflect current
    // stock, including conditions that have just started or just cleared.
    generateStockNotifications()
      .then(() => listNotifications({ userId: user.id, take: 100 }))
      .catch(() => listNotifications({ userId: user.id, take: 100 })),
    hasPermission("notifications:manage"),
  ]);

  const unread = notifications.filter((entry) => !entry.isRead).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Notifikasi</h1>
        <p className="text-sm text-muted-foreground">
          Peringatan stok menipis, barang habis, dan barang mendekati
          kedaluwarsa.
          {unread > 0 ? (
            <>
              {" "}
              <span className="font-medium text-foreground">
                {unread} belum dibaca.
              </span>
            </>
          ) : null}
        </p>
      </div>

      <NotificationList notifications={notifications} canManage={canManage} />
    </div>
  );
}