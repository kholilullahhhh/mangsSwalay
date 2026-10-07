import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  Coins,
  Package,
  PackagePlus,
  Receipt,
  ScanBarcode,
  ShoppingCart,
  TrendingUp,
  Warehouse,
} from "lucide-react";

import { requirePagePermission } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/session";
import {
  getExpiringBatches,
  getLowStockItems,
  getOutOfStockItems,
  getPaymentBreakdown,
  getPurchaseVsSale,
  getRecentSales,
  getSalesByCategory,
  getSalesTrend,
  getSummary,
  getTopProducts,
} from "@/lib/queries/dashboard";
import {
  formatCurrency,
  formatCurrencyCompact,
  formatNumber,
  formatPercentChange,
  formatTime,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CategorySalesChart,
  PaymentMethodChart,
  PurchaseVsSaleChart,
  SalesTrendChart,
} from "@/components/charts";
import {
  AlertSummaryCard,
  StatCard,
  WidgetEmptyState,
} from "@/components/dashboard/stat-card";

export const metadata: Metadata = {
  title: "Dashboard",
};

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Tunai",
  QRIS: "QRIS",
  DEBIT: "Kartu Debit",
  CREDIT_CARD: "Kartu Kredit",
  TRANSFER: "Transfer Bank",
  E_WALLET: "E-Wallet",
};

const SALE_STATUS_VARIANTS = {
  COMPLETED: "outline",
  VOID: "destructive",
  REFUNDED: "secondary",
  PARTIALLY_REFUNDED: "secondary",
} as const;

export default async function DashboardPage() {
  // Server-side authorisation. The sidebar already hides what this role cannot
  // reach, but this check is what actually protects the data.
  await requirePagePermission("dashboard:view");

  const [
    summary,
    trend7,
    trend30,
    byCategory,
    payments,
    topProducts,
    purchaseVsSale,
    recentSales,
    lowStock,
    outOfStock,
    expiring,
    canSeeReports,
    canManageStock,
    canCreatePurchase,
    canSeeAllSales,
  ] = await Promise.all([
    getSummary(),
    getSalesTrend(7),
    getSalesTrend(30),
    getSalesByCategory(30),
    getPaymentBreakdown(30),
    getTopProducts(30, 6),
    getPurchaseVsSale(14),
    getRecentSales(8),
    getLowStockItems(6),
    getOutOfStockItems(6),
    getExpiringBatches(30, 6),
    hasPermission("reports:sales"),
    hasPermission("stock:adjust"),
    hasPermission("purchases:create"),
    hasPermission("sales:view"),
  ]);

  const todayChange = formatPercentChange(
    summary.salesToday,
    summary.salesTodayPrevious,
  );

  return (
    <div className="space-y-6">
      <QuickActions
        canUsePos={await hasPermission("pos:use")}
        canManageStock={canManageStock}
        canCreatePurchase={canCreatePurchase}
        canSeeReports={canSeeReports}
      />

      <section aria-labelledby="ringkasan-heading">
        <h2 id="ringkasan-heading" className="sr-only">
          Ringkasan
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Penjualan Hari Ini"
            value={formatCurrency(summary.salesToday)}
            icon={TrendingUp}
            change={todayChange}
            hint="vs kemarin"
          />
          <StatCard
            label="Penjualan Bulan Ini"
            value={formatCurrency(summary.salesMonth)}
            icon={Coins}
            hint={`${formatNumber(summary.salesMonthCount)} transaksi`}
          />
          <StatCard
            label="Produk Terjual Hari Ini"
            value={formatNumber(summary.productsSoldToday)}
            icon={Package}
            hint={`${formatNumber(summary.salesTodayCount)} transaksi`}
          />
          <StatCard
            label="Total Stok"
            value={formatNumber(summary.totalStock)}
            icon={Warehouse}
            hint={`${summary.lowStockCount} perlu restock`}
          />
        </div>
      </section>

      <section
        aria-label="Peringatan operasional"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <AlertSummaryCard
          label="produk perlu restock"
          count={summary.lowStockCount}
          icon={AlertTriangle}
          tone="warning"
          href="/inventory?filter=low"
        />
        <AlertSummaryCard
          label="produk habis"
          count={summary.outOfStockCount}
          icon={AlertTriangle}
          tone="danger"
          href="/inventory?filter=out"
        />
        <AlertSummaryCard
          label="batch mendekati kedaluwarsa"
          count={expiring.length}
          icon={CalendarClock}
          tone="info"
          href="/inventory/batches"
        />
        <AlertSummaryCard
          label="transaksi hari ini"
          count={summary.salesTodayCount}
          icon={Receipt}
          tone="info"
          href="/sales"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Tren Penjualan</CardTitle>
            <CardDescription>
              Pendapatan harian, tidak termasuk transaksi void dan retur.
            </CardDescription>
            <CardAction>
              <Tabs defaultValue="7">
                <TabsList>
                  <TabsTrigger value="7">7 Hari</TabsTrigger>
                  <TabsTrigger value="30">30 Hari</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardAction>
          </CardHeader>

          <CardContent>
            <Tabs defaultValue="7">
              <TabsContent value="7">
                {trend7.some((point) => point.total > 0) ? (
                  <SalesTrendChart data={trend7} />
                ) : (
                  <WidgetEmptyState
                    title="Belum ada penjualan 7 hari terakhir"
                    description="Grafik akan muncul setelah transaksi pertama tercatat."
                  />
                )}
              </TabsContent>
              <TabsContent value="30">
                {trend30.some((point) => point.total > 0) ? (
                  <SalesTrendChart data={trend30} />
                ) : (
                  <WidgetEmptyState
                    title="Belum ada penjualan 30 hari terakhir"
                    description="Grafik akan muncul setelah transaksi pertama tercatat."
                  />
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Metode Pembayaran</CardTitle>
            <CardDescription>Komposisi 30 hari terakhir.</CardDescription>
          </CardHeader>
          <CardContent>
            {payments.length > 0 ? (
              <PaymentMethodChart
                data={payments.map((entry) => ({
                  method: PAYMENT_LABELS[entry.method] ?? entry.method,
                  total: entry.total,
                }))}
              />
            ) : (
              <WidgetEmptyState title="Belum ada data pembayaran" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Penjualan per Kategori</CardTitle>
            <CardDescription>8 kategori teratas, 30 hari terakhir.</CardDescription>
          </CardHeader>
          <CardContent>
            {byCategory.length > 0 ? (
              <CategorySalesChart data={byCategory} />
            ) : (
              <WidgetEmptyState title="Belum ada penjualan per kategori" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Produk Terlaris</CardTitle>
            <CardDescription>Berdasarkan quantity, 30 hari terakhir.</CardDescription>
          </CardHeader>
          <CardContent>
            {topProducts.length > 0 ? (
              <ol className="space-y-3">
                {topProducts.map((product, index) => (
                  <li key={product.id} className="flex items-center gap-3">
                    <span className="tabular w-5 shrink-0 text-sm font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/products/${product.id}`}
                        className="block truncate text-sm font-medium hover:underline"
                      >
                        {product.name}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {product.sku} Â· {formatNumber(product.quantity)} terjual
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-sm font-medium">
                      {formatCurrencyCompact(product.total)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <WidgetEmptyState title="Belum ada produk terjual" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transaksi Terbaru</CardTitle>
            <CardDescription>8 transaksi terakhir.</CardDescription>
            {canSeeAllSales ? (
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/sales">
                    Semua
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>

          <CardContent className="px-0">
            {recentSales.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Kasir</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentSales.map((sale) => (
                    <TableRow key={sale.id}>
                      <TableCell>
                        <Link
                          href={`/sales/${sale.id}`}
                          className="font-mono text-xs hover:underline"
                        >
                          {sale.invoiceNumber}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {formatTime(sale.date)} Â·{" "}
                          {PAYMENT_LABELS[sale.paymentMethod] ??
                            sale.paymentMethod}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {sale.user.name}
                        {sale.customer ? (
                          <p className="text-xs text-muted-foreground">
                            {sale.customer.name}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="tabular text-right font-medium">
                        {formatCurrency(sale.total)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            SALE_STATUS_VARIANTS[
                              sale.status as keyof typeof SALE_STATUS_VARIANTS
                            ] ?? "outline"
                          }
                          className="text-xs"
                        >
                          {sale.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <WidgetEmptyState
                title="Belum ada transaksi"
                description="Transaksi hari ini akan muncul di sini."
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Perlu Restock</CardTitle>
              <CardDescription>
                Produk dengan stok di bawah atau sama dengan stok minimum.
              </CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/inventory">
                    Semua
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>

            <CardContent className="px-0">
              {lowStock.length > 0 ? (
                <ul className="divide-y">
                  {lowStock.map((item) => {
                    const ratio =
                      item.minStock > 0 ? item.stock / item.minStock : 0;

                    return (
                      <li key={item.id} className="px-6 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link
                              href={`/products/${item.id}`}
                              className="block truncate text-sm font-medium hover:underline"
                            >
                              {item.name}
                            </Link>
                            <p className="truncate text-xs text-muted-foreground">
                              {item.sku}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className="tabular shrink-0 border-stock-low/40 text-stock-low"
                          >
                            {item.stock} / {item.minStock}
                          </Badge>
                        </div>
                        <Progress
                          value={Math.min(100, Math.round(ratio * 100))}
                          className="mt-2 h-1.5"
                        />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <WidgetEmptyState
                  title="Semua stok aman"
                  description="Tidak ada produk di bawah stok minimum."
                />
              )}
            </CardContent>
          </Card>

          {outOfStock.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Stok Habis</CardTitle>
                <CardDescription>Produk yang tidak bisa terjual.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-wrap gap-2">
                  {outOfStock.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/products/${item.id}`}
                        className="inline-block rounded-md border border-stock-out/40 bg-stock-out/10 px-2 py-1 text-xs font-medium text-stock-out hover:bg-stock-out/20"
                      >
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {expiring.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Mendekati Kedaluwarsa</CardTitle>
                <CardDescription>30 hari sebelum tanggal kedaluwarsa.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {expiring.map((batch) => (
                    <li
                      key={batch.id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {batch.productName}
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({batch.batchNumber})
                        </span>
                      </span>
                      <Badge
                        variant={batch.daysRemaining <= 7 ? "destructive" : "secondary"}
                        className="tabular shrink-0 text-xs"
                      >
                        {batch.daysRemaining < 0
                          ? "Kedaluwarsa"
                          : `${batch.daysRemaining} hari`}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {canSeeReports ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pembelian vs Penjualan</CardTitle>
            <CardDescription>
              Perbandingan belanja dan pemasukan, 14 hari terakhir.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {purchaseVsSale.some(
              (point) => point.purchase > 0 || point.sale > 0,
            ) ? (
              <PurchaseVsSaleChart data={purchaseVsSale} />
            ) : (
              <WidgetEmptyState
                title="Belum ada data"
                description="Grafik muncul setelah ada transaksi pembelian atau penjualan."
              />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function QuickActions({
  canUsePos,
  canManageStock,
  canCreatePurchase,
  canSeeReports,
}: {
  canUsePos: boolean;
  canManageStock: boolean;
  canCreatePurchase: boolean;
  canSeeReports: boolean;
}) {
  const actions = [
    canUsePos && {
      href: "/pos",
      label: "Transaksi Baru",
      icon: ScanBarcode,
      primary: true,
    },
    canManageStock && {
      href: "/inventory/adjustment",
      label: "Adjustment Stok",
      icon: PackagePlus,
    },
    canCreatePurchase && {
      href: "/purchases/new",
      label: "Pembelian Baru",
      icon: ShoppingCart,
    },
    canSeeReports && {
      href: "/reports/sales",
      label: "Lihat Laporan",
      icon: BarChart3,
    },
  ].filter(Boolean) as Array<{
    href: string;
    label: string;
    icon: typeof ScanBarcode;
    primary?: boolean;
  }>;

  return (
    <nav aria-label="Aksi cepat">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.href}
            variant={action.primary ? "default" : "outline"}
            size="sm"
            asChild
          >
            <Link href={action.href}>
              <action.icon className="size-4" aria-hidden />
              {action.label}
            </Link>
          </Button>
        ))}
      </div>
    </nav>
  );
}
