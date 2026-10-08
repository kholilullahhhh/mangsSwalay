import type { Metadata } from "next";
import Link from "next/link";
import { Tags } from "lucide-react";

import { requirePagePermission, hasPermission } from "@/lib/auth/session";
import { listCategoriesWithCounts } from "@/lib/queries/catalog";
import { formatDate, formatNumber } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/data/empty-state";

import {
  CategoryDialog,
  DeleteCategoryButton,
} from "./category-controls";

export const metadata: Metadata = {
  title: "Kategori",
};

export default async function CategoriesPage() {
  await requirePagePermission("categories:view");

  const [categories, canManage] = await Promise.all([
    listCategoriesWithCounts(),
    hasPermission("categories:manage"),
  ]);

  const productTotal = categories.reduce(
    (sum, category) => sum + category.productCount,
    0,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Kategori</h1>
          <p className="text-sm text-muted-foreground">
            {formatNumber(categories.length)} kategori ·{" "}
            {formatNumber(productTotal)} produk
          </p>
        </div>


      </div>

      {/* Gated: without it a role that may view categories but not manage them
          gets a working "Tambah Kategori" button that only fails after the form
          has been filled in. */}
      {canManage ? <CategoryDialog /> : null}

      <Card>
        <CardContent className="px-0">
          {categories.length === 0 ? (
            <EmptyState
              icon={Tags}
              title="Belum ada kategori"
              description="Buat kategori untuk mengelompokkan produk."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead className="text-center">Produk</TableHead>
                  <TableHead>Dibuat</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage ? <TableHead className="text-right">Aksi</TableHead> : null}
                </TableRow>
              </TableHeader>

              <TableBody>
                {categories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>
                      <p className="font-medium">{category.name}</p>
                      {category.description ? (
                        <p className="text-xs text-muted-foreground">
                          {category.description}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {category.slug}
                    </TableCell>
                    <TableCell className="tabular text-center">
                      <Link
                        href={"/products?categoryId=" + category.id}
                        className="hover:underline"
                      >
                        {formatNumber(category.productCount)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(category.createdAt)}
                    </TableCell>
                    <TableCell>
                      {category.isActive ? (
                        <Badge variant="outline" className="text-stock-ok">
                          Aktif
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Nonaktif</Badge>
                      )}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <CategoryDialog
                            category={{
                              id: category.id,
                              name: category.name,
                              description: category.description ?? "",
                              isActive: category.isActive,
                            }}
                          />
                          <DeleteCategoryButton
                            id={category.id}
                            name={category.name}
                            productCount={category.productCount}
                          />
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


