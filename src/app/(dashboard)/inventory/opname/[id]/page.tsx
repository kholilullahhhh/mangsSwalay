import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requirePagePermission, hasPermission } from "@/lib/auth/session";
import { getOpnameSummary } from "@/lib/inventory/mutations";
import { describeOpnameSummary } from "@/lib/inventory/rules";
import { formatDateTime, formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

import { ApprovalActions, CancelOpnameAction, OpnameCounter } from "./counter";

export const metadata: Metadata = {
  title: "Hitung Stok",
};

/**
 * Counting screen for one opname session.
 *
 * Read-only once the session is approved or cancelled: the counted figures are
 * frozen so the record of what was counted cannot be rewritten.
 */
export default async function OpnameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission("stock:view");

  const { id } = await params;
  const result = await getOpnameSummary(id);

  if (!result) {
    notFound();
  }

  const { opname, summary } = result;

  const canCount = await hasPermission("stock:opname");
  const canApprove = await hasPermission("stock:opname-approve");

  const isOpen = opname.status === "IN_PROGRESS";

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
          <Link href="/inventory/opname">
            <ArrowLeft className="size-4" aria-hidden />
            Kembali
          </Link>
        </Button>

        <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="font-mono">{opname.number}</span>
          <span className="text-muted-foreground">-</span>
          {opname.name}
          <Badge variant={isOpen ? "default" : "secondary"}>
            {isOpen ? "Berjalan" : opname.status === "APPROVED" ? "Disetujui" : "Dibatalkan"}
          </Badge>
        </h1>

<p className="text-sm text-muted-foreground">
          Dibuat oleh {opname.user.name} pada {formatDateTime(opname.createdAt)}
        {opname.approvedAt ? (
          <>
            {" · Disetujui oleh "}
            <span className="font-medium text-foreground">
              {opname.approver?.name ?? "tidak diketahui"}
            </span>{" "}
            pada {formatDateTime(opname.approvedAt)}
          </>
        ) : null}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Progres hitung"
          value={summary.progress + "%"}
          hint={summary.pendingLines + " produk belum dihitung"}
        />
        <Metric
          label="Cocok"
          value={formatNumber(summary.matchedLines)}
          tone="ok"
        />
        <Metric
          label="Berbeda"
          value={formatNumber(summary.differentLines)}
          tone={summary.differentLines > 0 ? "warning" : "default"}
        />
        <Metric
          label="Selisih unit"
          value={(summary.totalIncrease > 0 ? "+" : "") + summary.totalIncrease + " / -" + summary.totalDecrease}
        />
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Ringkasan</p>
            <p className="text-sm text-muted-foreground">
              {describeOpnameSummary(summary)}
            </p>
          </div>

{isOpen && canApprove ? <ApprovalActions opnameId={opname.id} /> : null}
          {isOpen && canCount ? (
            <div className="flex items-center gap-2">
              <CancelOpnameAction opnameId={opname.id} />
            </div>
          ) : null}
        </div>

        <Progress value={summary.progress} className="mt-3 h-2" />
      </div>

<OpnameCounter
        opnameId={opname.id}
        readOnly={!isOpen || !canCount}
        lines={summary.lines.map((line) => {
          const source = opname.items.find(
            (item) => item.productId === line.productId,
          );

          return {
            productId: line.productId,
            name: line.productName,
            sku: source?.product.sku ?? "",
            unit: source?.product.unit ?? "",
            systemStock: line.systemStock,
            physicalStock: line.physicalStock,
            difference: line.difference,
            valueDifference: line.valueDifference,
            unitCost:
              source?.purchasePriceSnapshot === null ||
              source?.purchasePriceSnapshot === undefined
                ? 0
                : Number(source.purchasePriceSnapshot),
            status: line.status,
          };
        })}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok" | "warning";
}) {
  const toneClass =
    tone === "ok"
      ? "text-stock-ok"
      : tone === "warning"
        ? "text-stock-low"
        : "";

  return (
    <div className="rounded-lg border p-4">
      <p className={"tabular text-xl font-semibold " + toneClass}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}


