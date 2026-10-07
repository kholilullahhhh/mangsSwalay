"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCheck,
  Info,
  PackageX,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/data/empty-state";
import { formatDateTime } from "@/lib/format";

import {
  deleteNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/(dashboard)/admin/actions";
import { refreshNotificationsAction } from "./actions";

/**
 * Notification list with its actions.
 *
 * "Perbarui" regenerates the derived stock and expiry alerts. That is not a
 * convenience refresh: the conditions come from a scan of the catalogue, so this
 * is how the list stays honest, and the generator is idempotent so pressing it
 * twice changes nothing the second time.
 */

export interface NotificationRow {
  id: string;
  type: string;
  /** Mirrors the schema enum, including SUCCESS which this screen does not emit. */
  severity: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: Date;
}

const TYPE_LABEL: Record<string, string> = {
  LOW_STOCK: "Stok Menipis",
  OUT_OF_STOCK: "Stok Habis",
  EXPIRING_SOON: "Segera Kedaluwarsa",
  EXPIRED: "Kedaluwarsa",
  LARGE_TRANSACTION: "Transaksi Besar",
  PURCHASE_RECEIVED: "Penerimaan Barang",
};

const SEVERITY_VARIANT = {
  INFO: "secondary",
  SUCCESS: "secondary",
  WARNING: "default",
  CRITICAL: "destructive",
} as const;

function iconFor(type: string) {
  if (type === "OUT_OF_STOCK") return PackageX;
  if (type === "EXPIRED") return BellOff;
  if (type === "LOW_STOCK" || type === "EXPIRING_SOON") return AlertTriangle;
  return Info;
}

export function NotificationList({
  notifications,
  canManage,
}: {
  notifications: NotificationRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const visible =
    filter === "unread"
      ? notifications.filter((entry) => !entry.isRead)
      : notifications;

  function markRead(id: string) {
    const formData = new FormData();
    formData.set("id", id);

    startTransition(async () => {
      const result = await markNotificationReadAction(formData);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      router.refresh();
    });
  }

  function markAllRead() {
    startTransition(async () => {
      const result = await markAllNotificationsReadAction();

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Semua notifikasi ditandai sudah dibaca.");
      router.refresh();
    });
  }

  function remove(id: string) {
    const formData = new FormData();
    formData.set("id", id);

    startTransition(async () => {
      const result = await deleteNotificationAction(formData);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      router.refresh();
    });
  }

  function refresh() {
    startTransition(async () => {
      const result = await refreshNotificationsAction();

      toast.success(
        result.created > 0 || result.resolved > 0
          ? "Notifikasi diperbarui: " +
              result.created +
              " baru, " +
              result.resolved +
              " selesai."
          : "Semua kondisi stok masih sama.",
      );

      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={isPending}
        >
          <RefreshCw
            className={isPending ? "size-4 animate-spin" : "size-4"}
            aria-hidden
          />
          Perbarui
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={markAllRead}
          disabled={isPending}
        >
          <CheckCheck className="size-4" aria-hidden />
          Tandai semua dibaca
        </Button>

        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant={filter === "all" ? "secondary" : "ghost"}
            onClick={() => setFilter("all")}
          >
            Semua
          </Button>
          <Button
            size="sm"
            variant={filter === "unread" ? "secondary" : "ghost"}
            onClick={() => setFilter("unread")}
          >
            Belum dibaca
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              title={
                filter === "unread"
                  ? "Semua notifikasi sudah dibaca"
                  : "Tidak ada notifikasi"
              }
              description={
                filter === "unread"
                  ? "Ganti ke Semua untuk melihat notifikasi yang sudah dibaca."
                  : "Semua kondisi stok dalam batas aman."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {visible.map((entry) => {
            const Icon = iconFor(entry.type);

            const body = (
              <Card
                className={
                  "transition-colors " +
                  (entry.isRead
                    ? "opacity-70"
                    : "border-primary/30 bg-primary/5")
                }
              >
                <CardContent className="flex items-start gap-3 py-3">
                  <Icon
                    className={
                      "mt-0.5 size-4 shrink-0 " +
                      (entry.severity === "CRITICAL"
                        ? "text-destructive"
                        : entry.severity === "WARNING"
                          ? "text-stock-low"
                          : "text-muted-foreground")
                    }
                    aria-hidden
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{entry.title}</p>
                      <Badge variant={SEVERITY_VARIANT[entry.severity]}>
                        {TYPE_LABEL[entry.type] ?? entry.type}
                      </Badge>
                      {!entry.isRead ? (
                        <span className="size-1.5 rounded-full bg-primary" aria-label="Belum dibaca" />
                      ) : null}
                    </div>

                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {entry.message}
                    </p>

                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );

            return (
              <li key={entry.id} className="flex items-center gap-2">
                {entry.link ? (
                  <a href={entry.link} className="min-w-0 flex-1">
                    {body}
                  </a>
                ) : (
                  <div className="min-w-0 flex-1">{body}</div>
                )}

                <div className="flex shrink-0 flex-col gap-1">
                  {!entry.isRead ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Tandai "${entry.title}" sudah dibaca`}
                      onClick={() => markRead(entry.id)}
                      disabled={isPending}
                    >
                      <CheckCheck className="size-4" aria-hidden />
                    </Button>
                  ) : null}

                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Hapus notifikasi "${entry.title}"`}
                      onClick={() => remove(entry.id)}
                      disabled={isPending}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Bell className="size-3" aria-hidden />
        Notifikasi stok berlaku untuk seluruh pengguna toko.
      </p>
    </div>
  );
}