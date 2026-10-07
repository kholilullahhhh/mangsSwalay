"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCurrency, formatNumber } from "@/lib/format";

import { approveOpnameAction, recordCountAction } from "../../actions";

export interface OpnameLineView {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  systemStock: number;
  physicalStock: number | null;
  difference: number | null;
  valueDifference: number | null;
  status: "PENDING" | "MATCHED" | "DIFFERENT";
}

/**
 * Counting sheet.
 *
 * Counts save per row rather than on one submit, so a part-finished count is
 * never lost if the terminal is closed mid-session.
 */
export function OpnameCounter({
  opnameId,
  readOnly,
  lines,
}: {
  opnameId: string;
  readOnly: boolean;
  lines: OpnameLineView[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Produk</th>
              <th className="px-3 py-2 text-right font-medium">Sistem</th>
              <th className="px-3 py-2 text-right font-medium">Fisik</th>
              <th className="px-3 py-2 text-right font-medium">Selisih</th>
              <th className="px-3 py-2 text-right font-medium">Nilai</th>
              <th className="px-3 py-2">Status</th>
              <th className="w-16 px-3 py-2" />
            </tr>
          </thead>

          <tbody>
            {lines.map((line) => {
              const draft = drafts[line.productId];
              const dirty = draft !== undefined;

              // While a row is being edited, the displayed difference is derived
              // from the draft so the operator sees the effect before saving.
              const effective =
                dirty && draft !== ""
                  ? Number(draft) - line.systemStock
                  : line.difference;


              return (
                <tr key={line.productId} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-medium">{line.name}</p>
                    {line.sku ? (
                      <p className="font-mono text-xs text-muted-foreground">
                        {line.sku}
                      </p>
                    ) : null}
                  </td>

                  <td className="tabular px-3 py-2 text-right">
                    {formatNumber(line.systemStock)}
                  </td>

                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number"
                      min={0}
                      disabled={readOnly}
                      value={draft ?? (line.physicalStock ?? "")}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [line.productId]: event.target.value,
                        }))
                      }
                      placeholder="-"
                      className="tabular h-8 w-24 text-right"
                      aria-label={"Jumlah fisik " + line.name}
                    />
                  </td>

                  <td className="px-3 py-2 text-right">
                    <DifferenceCell value={effective} />
                  </td>

                  <td className="tabular px-3 py-2 text-right text-muted-foreground">
                    {effective === null
                      ? "-"
                      : formatCurrency(effective)}
                  </td>

                  <td className="px-3 py-2">
                    {dirty ? (
                      <Badge variant="outline">Belum disimpan</Badge>
                    ) : line.status === "PENDING" ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        Belum dihitung
                      </Badge>
                    ) : line.status === "MATCHED" ? (
                      <Badge
                        variant="outline"
                        className="border-stock-ok/40 text-stock-ok"
                      >
                        Cocok
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-stock-low/40 text-stock-low"
                      >
                        Berbeda
                      </Badge>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right">
                    {dirty && !readOnly ? (
                      <SaveRowButton
                        opnameId={opnameId}
                        productId={line.productId}
                        value={draft}
                        pending={pendingId === line.productId}
                        onStart={() => setPendingId(line.productId)}
                        onDone={() => {
                          setPendingId(null);
                          setDrafts((current) => {
                            const next = { ...current };
                            delete next[line.productId];
                            return next;
                          });
                          router.refresh();
                        }}
                      />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {lines.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          Sesi ini tidak memiliki item.
        </p>
      ) : null}
    </div>
  );
}

function DifferenceCell({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-muted-foreground">-</span>;
  }

  if (value === 0) {
    return <span className="text-muted-foreground">0</span>;
  }

  return (
    <span
      className={
        value > 0 ? "font-medium text-stock-ok" : "font-medium text-stock-out"
      }
    >
      {value > 0 ? "+" + value : value}
    </span>
  );
}

function SaveRowButton({
  opnameId,
  productId,
  value,
  pending,
  onStart,
  onDone,
}: {
  opnameId: string;
  productId: string;
  value: string;
  pending: boolean;
  onStart: () => void;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending || isPending || value === ""}
      onClick={() => {
        const formData = new FormData();
        formData.set("opnameId", opnameId);
        formData.set("productId", productId);
        formData.set("physicalStock", value);

        onStart();

        startTransition(async () => {
          const result = await recordCountAction(formData);

          if (result.error) {
            toast.error(result.error);
            onDone();
            return;
          }

          toast.success("Hitungan disimpan.");
          onDone();
        });
      }}
      aria-label="Simpan hitungan"
    >
      {isPending || pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Save className="size-3.5" aria-hidden />
      )}
    </Button>
  );
}

/** Approves the session, writing the counted differences to stock. */
export function ApprovalActions({ opnameId }: { opnameId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Setujui &amp; Terapkan
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Setujui hasil opname?</AlertDialogTitle>
            <AlertDialogDescription>
              Setiap perbedaan stok akan diterapkan ke produk terkait dan
              tercatat sebagai pergerakan stok. Tindakan ini tidak bisa
              dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();

                const formData = new FormData();
                formData.set("opnameId", opnameId);

                startTransition(async () => {
                  const result = await approveOpnameAction(formData);

                  if (result.error) {
                    toast.error(result.error);
                    setOpen(false);
                    return;
                  }

                  toast.success("Opname disetujui. Stok telah disesuaikan.");
                  setOpen(false);
                  router.refresh();
                });
              }}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <AlertTriangle className="size-4" aria-hidden />
              )}
              Ya, setujui
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

