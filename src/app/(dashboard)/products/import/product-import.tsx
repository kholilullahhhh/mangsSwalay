"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, Loader2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  importProductsAction,
  parseImportAction,
  type ImportRowError,
} from "./actions";

/**
 * CSV import screen.
 *
 * Two steps, both server-side: parse (validate everything, write nothing), then
 * confirm (write). Doing it in one shot would mean a 200-row file failing on row
 * 197 with 196 products already saved and no record of which ones.
 */
export function ProductImport() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [filename, setFilename] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ rows: number; total: number } | null>(null);
  const [errors, setErrors] = useState<ImportRowError[]>([]);
  const [error, setError] = useState<string | null>(null);

  function handleFile(file: File | undefined) {
    if (!file) return;

    setFilename(file.name);
    setParsed(null);
    setErrors([]);
    setError(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);

      const result = await parseImportAction(formData);

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.errors && result.errors.length > 0) {
        setErrors(result.errors);
        return;
      }

      setParsed({ rows: result.rows ?? 0, total: result.total ?? 0 });
    });
  }

  function confirm() {
    // Captured before the transition: the input is cleared on success, and
    // reading it inside the async callback would race with that.
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);

      const result = await importProductsAction(formData);

      if (result.error) {
        setError(result.error);
        return;
      }

      toast.success(result.imported + " produk berhasil diimpor.");
      setFilename(null);
      setParsed(null);
      setErrors([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Unggah berkas CSV</CardTitle>
          <CardDescription>
            Kolom wajib: sku, name, category, unit, purchasePrice, sellingPrice,
            stock. Kolom opsional: minStock, barcode, brand, description.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="import-file">Berkas CSV</Label>
            <Input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              ref={fileInputRef}
              onChange={(event) => handleFile(event.target.files?.[0])}
              disabled={isPending}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href="/api/products/import/template" download>
                <Download className="size-4" aria-hidden />
                Unduh template
              </a>
            </Button>

            {filename ? (
              <p className="text-sm text-muted-foreground">{filename}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {errors.length > 0 ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="size-4" aria-hidden />
              {errors.length} masalah ditemukan
            </CardTitle>
            <CardDescription>
              Tidak ada produk yang diimpor. Perbaiki semua baris di bawah lalu
              unggah ulang berkasnya.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
              {errors.map((entry, index) => (
                <li
                  key={index}
                  className="flex gap-2 rounded border border-destructive/20 bg-destructive/5 px-2 py-1.5"
                >
                  <Badge variant="outline" className="shrink-0">
                    Baris {entry.line}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{entry.field}</span>:{" "}
                    {entry.message}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {parsed ? (
        <Card className="border-stock-ok/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-stock-ok">
              <CheckCircle2 className="size-4" aria-hidden />
              {parsed.rows} produk siap diimpor
            </CardTitle>
            <CardDescription>
              Periksa sekali lagi. Setelah disimpan, produk baru bisa diubah lewat
              halaman produk.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button onClick={confirm} disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Mengimpor…
                  </>
                ) : (
                  <>
                    <Upload className="size-4" aria-hidden />
                    Impor {parsed.rows} produk
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  setParsed(null);
                  setErrors([]);
                  setFilename(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                disabled={isPending}
              >
                Batal
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}