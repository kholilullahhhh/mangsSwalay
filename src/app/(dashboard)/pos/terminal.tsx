"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Banknote,
  CreditCard,
  Loader2,
  Minus,
  Pause,
  Plus,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  PAYMENT_METHODS as PAYMENT_METHOD_OPTIONS,
} from "@/lib/payments/constants";
import {
  addToCart,
  calculateTotals,
  setQuantity as setCartQuantity,
  type AppliedPromotion,
  type CartLine,
} from "@/lib/pos/cart";

import { checkoutAction, type CheckoutResult } from "./actions";
import { previewPromotionAction } from "./promotion-actions";
import { PaymentDialog } from "./payment-dialog";
import { ReceiptDialog } from "./receipt-dialog";

export interface PosProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  categoryId: string;
  sellingPrice: number;
  stock: number;
}

export interface PosCustomer {
  id: string;
  name: string;
  phone: string | null;
  memberNumber: string | null;
  isMember: boolean;
}

export interface PosShift {
  id: string;
  number: string;
  openingCash: number;
}

/**
 * Payment options with their icons.
 *
 * The set of methods itself comes from `lib/payments/constants` so it cannot
 * drift from what the POS server and the reports accept; only the icon mapping is
 * local, because a lucide component cannot cross the server/client boundary.
 */
const PAYMENT_ICONS: Record<PaymentMethodKey, typeof Banknote> = {
  CASH: Banknote,
  QRIS: CreditCard,
  DEBIT: CreditCard,
  CREDIT_CARD: CreditCard,
  TRANSFER: CreditCard,
  E_WALLET: CreditCard,
};

const PAYMENT_METHODS = PAYMENT_METHOD_OPTIONS.map((method) => ({
  ...method,
  icon: PAYMENT_ICONS[method.value],
}));

type PaymentMethodKey = (typeof PAYMENT_METHOD_OPTIONS)[number]["value"];
type PaymentMethod = PaymentMethodKey;

interface HeldCart {
  id: string;
  label: string;
  lines: CartLine[];
  customerId: string | null;
  createdAt: number;
}

/**
 * POS terminal.
 *
 * Three panes on desktop (catalogue / cart / totals) collapsing to a stacked
 * single-column flow on mobile, where the register is expected to be a phone or
 * tablet rather than a desktop terminal.
 *
 * Two behaviours worth calling out:
 *
 * - **Barcode scanning.** A USB scanner types the barcode and presses Enter, so
 *   a hidden input that always has focus captures the keystrokes. That is the
 *   standard integration and requires no special scanner hardware. F2 focuses
 *   search, F4 opens the customer picker, F8 opens payment, Esc cancels.
 * - **Prices are never trusted from the client.** Totals shown here use the
 *   shared pure functions for a responsive preview, but checkout re-reads every
 *   price from the database.
 */
export function PosTerminal({
  initialProducts,
  categories,
  customers,
  shift,
  loyaltyRatio,
  taxRate,
  cashierName,
  store,
}: {
  initialProducts: PosProduct[];
  categories: Array<{ id: string; name: string }>;
  customers: PosCustomer[];
  shift: PosShift | null;
  loyaltyRatio: number;
  /** Store tax rate as a fraction, for the running-total preview only. */
  taxRate: number;
  cashierName: string;
  store: { name: string; address: string; phone: string };
}) {
  const router = useRouter();

  const [lines, setLines] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [manualDiscount, setManualDiscount] = useState(0);
  const [discountInput, setDiscountInput] = useState("");
  const [promotion, setPromotion] = useState<AppliedPromotion | null>(null);
  const [promotionInput, setPromotionInput] = useState("");
  const [promotionError, setPromotionError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [receipt, setReceipt] = useState<CheckoutResult | null>(null);
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [holdOpen, setHoldOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  // ── Totals ───────────────────────────────────────────────────────────────
  // The preview mirrors the server's own calculation, including the promotion
  // the server granted. It is a preview only: checkout re-evaluates everything
  // from the database, so a stale or tampered client total cannot change what the
  // customer is charged.
  const totals = useMemo(
    () =>
      calculateTotals({
        lines,
        promotions: promotion ? [promotion] : [],
        manualDiscount,
        taxRate,
      }),
    [lines, promotion, manualDiscount, taxRate],
  );

  // ── Catalogue ────────────────────────────────────────────────────────────
  const visibleProducts = useMemo(() => {
    const trimmed = query.trim().toLowerCase();

    return initialProducts.filter((product) => {
      if (categoryFilter !== "all" && product.categoryId !== categoryFilter) {
        return false;
      }

      if (!trimmed) return true;

      return (
        product.name.toLowerCase().includes(trimmed) ||
        product.sku.toLowerCase().includes(trimmed) ||
        (product.barcode ? product.barcode.includes(trimmed) : false)
      );
    });
  }, [initialProducts, query, categoryFilter]);

  // ── Cart operations ──────────────────────────────────────────────────────
  const addProduct = useCallback(
    (product: PosProduct, quantity = 1) => {
      setScanError(null);

      if (product.stock <= 0) {
        setScanError(`Stok ${product.name} habis.`);
        return;
      }

      setLines((current) => {
        const result = addToCart(current, {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          unit: product.unit,
          quantity,
          unitPrice: product.sellingPrice,
          availableStock: product.stock,
        });

        if (result.error) {
          setScanError(result.error);
          return current;
        }

        return result.lines;
      });
    },
    [],
  );

  const changeQuantity = useCallback((productId: string, quantity: number) => {
    setLines((current) => {
      const result = setCartQuantity(current, productId, quantity);
      if (result.error) {
        toast.error(result.error);
        return current;
      }
      return result.lines;
    });
  }, []);

  const removeLine = useCallback((productId: string) => {
    setLines((current) =>
      current.filter((line) => line.productId !== productId),
    );
  }, []);

  const clearCart = useCallback(() => {
    setLines([]);
    setManualDiscount(0);
    setDiscountInput("");
    // Cleared with the cart: a promo applied to one basket must not silently
    // carry over to the next customer's basket.
    setPromotion(null);
    setPromotionInput("");
    setPromotionError(null);
    setCustomer(null);
  }, []);

  // ── Promotions ───────────────────────────────────────────────────────────
  // The client only ever learns whether a code is acceptable; the discount it
  // previews comes back from the server's own evaluation.
  const applyPromotion = useCallback(async () => {
    const code = promotionInput.trim().toUpperCase();

    setPromotionError(null);

    if (!code) {
      setPromotion(null);
      return;
    }

    const preview = lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      categoryId:
        initialProducts.find((product) => product.id === line.productId)
          ?.categoryId ?? "",
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    }));

    try {
      const result = await previewPromotionAction({
        code,
        lines: preview,
      });

      if (!result.ok) {
        setPromotion(null);
        setPromotionError(result.error);
        return;
      }

      setPromotion({
        code: result.code,
        name: result.name,
        discountAmount: result.discount,
      });
      setPromotionInput("");
    } catch {
      setPromotion(null);
      setPromotionError("Gagal memeriksa promo. Coba lagi.");
    }
  }, [promotionInput, lines, initialProducts]);

  // ── Barcode scanning ─────────────────────────────────────────────────────
  // A hardware scanner behaves like a keyboard: it types fast and finishes with
  // Enter. This handler captures that without needing a dedicated scanner API.
  const handleScan = useCallback(
    (raw: string) => {
      const barcode = raw.trim();

      if (!barcode) return;

      // Exact barcode match only. A partial match would add the wrong product
      // to the cart, which is far worse than a "not found" message.
      const match = initialProducts.find(
        (product) => product.barcode === barcode,
      );

      if (!match) {
        setScanError(
          barcode.length >= 6
            ? `Barcode ${barcode} tidak ditemukan.`
            : `Barcode tidak valid: ${barcode}`,
        );
        scanRef.current?.select();
        return;
      }

      addProduct(match);
      scanRef.current?.select();
    },
    [initialProducts, addProduct],
  );

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Never steal keys from a text field the cashier is typing into.
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      switch (event.key) {
        case "F2":
          event.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          break;

        case "F4":
          event.preventDefault();
          if (!typing || target?.id === "pos-scan") {
            setCustomerOpen(true);
          }
          break;

        case "F8":
          event.preventDefault();
          if (lines.length > 0) {
            setPaymentOpen(true);
          } else {
            toast.error("Keranjang masih kosong.");
          }
          break;

        case "Escape":
          // Clear the scan box first, then close any open dialog.
          if (document.activeElement === scanRef.current && scanRef.current) {
            scanRef.current.value = "";
            scanRef.current.blur();
          } else if (customerOpen) {
            setCustomerOpen(false);
          }
          break;

        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lines.length, customerOpen]);

  // ── Held carts ───────────────────────────────────────────────────────────
  function holdCart() {
    if (lines.length === 0) return;

    const held: HeldCart = {
      id: crypto.randomUUID(),
      label: `Transaksi ${heldCarts.length + 1}`,
      lines,
      customerId: customer?.id ?? null,
      createdAt: Date.now(),
    };

    setHeldCarts((current) => [held, ...current].slice(0, 10));
    clearCart();
    setHoldOpen(false);
    toast.success(`${held.label} disimpan.`);
  }

  function resumeCart(heldId: string) {
    const held = heldCarts.find((entry) => entry.id === heldId);
    if (!held) return;

    setLines(held.lines);
    setCustomer(
      held.customerId
        ? customers.find((entry) => entry.id === held.customerId) ?? null
        : null,
    );
    setHeldCarts((current) => current.filter((entry) => entry.id !== heldId));
    setHoldOpen(false);
  }

  // ── Checkout ─────────────────────────────────────────────────────────────
  async function handleCheckout(
    method: PaymentMethod,
    amountPaid: number,
  ) {
    setIsCheckingOut(true);

    try {
      const result = await checkoutAction({
        customerId: customer?.id,
        shiftId: shift?.id,
        // Only the code is sent. The discount itself is decided server-side.
        promotionCode: promotion?.code,
        paymentMethod: method,
        amountPaid,
        manualDiscount,
        taxRate,
        lines: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          lineDiscount: line.lineDiscount ?? 0,
        })),
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setPaymentOpen(false);
      setReceipt(result.data);
      clearCart();
      router.refresh();
    } catch {
      toast.error("Gagal memproses transaksi. Silakan coba lagi.");
    } finally {
      setIsCheckingOut(false);
    }
  }

  const filteredCustomers = useMemo(() => {
    const trimmed = customerQuery.trim().toLowerCase();
    if (!trimmed) return customers.slice(0, 50);

    return customers
      .filter(
        (entry) =>
          entry.name.toLowerCase().includes(trimmed) ||
          entry.phone?.includes(trimmed) ||
          entry.memberNumber?.toLowerCase().includes(trimmed),
      )
      .slice(0, 50);
  }, [customers, customerQuery]);

  return (
    <div className="space-y-4">
      {/* Barcode input: a real input so hardware scanners work, but visually
          compact and always focused so keystrokes land here. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem(
            "barcode",
          ) as HTMLInputElement;
          handleScan(input.value);
        }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <ScanHint />
          <Input
            ref={scanRef}
            id="pos-scan"
            name="barcode"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Scan barcode atau ketik nomor barcode, lalu Enter"
            className="pl-9 font-mono"
            autoFocus
            aria-label="Input barcode"
          />
        </div>

        <div className="hidden items-center gap-2 sm:flex">
          <ShortcutHint keys="F2" label="Cari" />
          <ShortcutHint keys="F4" label="Pelanggan" />
          <ShortcutHint keys="F8" label="Bayar" />
        </div>
      </form>

      {scanError ? (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>Barcode bermasalah</AlertTitle>
          <AlertDescription>{scanError}</AlertDescription>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-6"
            onClick={() => setScanError(null)}
            aria-label="Tutup peringatan"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </Alert>
      ) : null}

      {!shift ? (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>Shift kasir belum dibuka</AlertTitle>
          <AlertDescription>
            Buka shift sebelum menerima pembayaran tunai agar kas awal tercatat
            dan selisih saat tutup shift dapat dihitung.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px_320px]">
        {/* ── Catalogue ────────────────────────────────────────────────── */}
        <section aria-label="Katalog produk" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-52 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cari produk… (F2)"
                className="pl-9"
                aria-label="Cari produk"
              />
            </div>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-44" aria-label="Filter kategori">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua kategori</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {visibleProducts.length === 0 ? (
            <div className="rounded-lg border border-dashed py-16 text-center">
              <p className="text-sm font-medium">
                {query ? "Produk tidak ditemukan" : "Belum ada produk"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {query
                  ? "Coba kata kunci lain atau scan barcode."
                  : "Tambahkan produk sebelum membuka kasir."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {visibleProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addProduct(product)}
                  disabled={product.stock <= 0}
                  className="flex flex-col justify-between gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:border-brand-500 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-medium leading-snug">
                      {product.name}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {product.sku}
                    </p>
                  </div>

                  <div>
                    <p className="tabular text-sm font-semibold">
                      {formatCurrency(product.sellingPrice)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {product.stock > 0
                        ? `Stok ${product.stock}`
                        : "Stok habis"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Cart ─────────────────────────────────────────────────────── */}
        <section
          aria-label="Keranjang"
          className="flex flex-col rounded-lg border bg-card"
        >
          <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Keranjang</h2>
              <p className="text-xs text-muted-foreground">
                {totals.itemCount} item · {totals.totalQuantity} pcs
              </p>
            </div>

            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setHoldOpen(true)}
                disabled={lines.length === 0}
                aria-label="Simpan transaksi sementara"
                title="Simpan transaksi"
              >
                <Pause className="size-4" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={clearCart}
                disabled={lines.length === 0}
                aria-label="Kosongkan keranjang"
                title="Kosongkan"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </header>

          <div className="max-h-[28rem] flex-1 overflow-y-auto">
            {lines.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                Keranjang kosong. Scan barcode atau pilih produk.
              </p>
            ) : (
              <ul className="divide-y">
                {lines.map((line) => (
                  <li key={line.productId} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug">
                          {line.name}
                        </p>
                        <p className="tabular text-xs text-muted-foreground">
                          {formatCurrency(line.unitPrice)} × {line.quantity}
                        </p>
                      </div>

                      <span className="tabular shrink-0 text-sm font-semibold">
                        {formatCurrency(line.unitPrice * line.quantity)}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-7"
                        onClick={() =>
                          changeQuantity(line.productId, line.quantity - 1)
                        }
                        aria-label={`Kurangi jumlah ${line.name}`}
                      >
                        <Minus className="size-3.5" aria-hidden />
                      </Button>

                      <Input
                        type="number"
                        min={0}
                        value={line.quantity}
                        onChange={(event) =>
                          changeQuantity(
                            line.productId,
                            Number.parseInt(event.target.value, 10) || 0,
                          )
                        }
                        className="h-7 w-16 tabular text-center"
                        aria-label={`Jumlah ${line.name}`}
                      />

                      <Button
                        variant="outline"
                        size="icon"
                        className="size-7"
                        onClick={() =>
                          changeQuantity(line.productId, line.quantity + 1)
                        }
                        disabled={line.quantity >= line.availableStock}
                        aria-label={`Tambah jumlah ${line.name}`}
                      >
                        <Plus className="size-3.5" aria-hidden />
                      </Button>

                      {line.quantity >= line.availableStock ? (
                        <Badge
                          variant="outline"
                          className="ml-1 border-stock-low/40 text-stock-low text-[10px]"
                        >
                          Maks {line.availableStock}
                        </Badge>
                      ) : null}

                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeLine(line.productId)}
                        aria-label={`Hapus ${line.name}`}
                      >
                        <X className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="border-t px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => setCustomerOpen(true)}
            >
              <User className="size-4" aria-hidden />
              {customer ? (
                <span className="truncate">
                  {customer.name}
                  {customer.isMember ? (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      Member
                    </Badge>
                  ) : null}
                </span>
              ) : (
                "Pilih pelanggan (F4)"
              )}
            </Button>
          </footer>
        </section>

        {/* ── Totals + payment ────────────────────────────────────────── */}
        <section
          aria-label="Ringkasan pembayaran"
          className="flex flex-col gap-3 rounded-lg border bg-card p-4"
        >
          <h2 className="text-sm font-semibold">Ringkasan</h2>

          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular">
                {formatCurrency(totals.subtotal)}
              </dd>
            </div>

            {totals.lineDiscountTotal > 0 ? (
              <div className="flex justify-between text-stock-ok">
                <dt>Diskon item</dt>
                <dd className="tabular">
                  -{formatCurrency(totals.lineDiscountTotal)}
                </dd>
              </div>
            ) : null}

            {totals.promotionDiscount > 0 ? (
              <div className="flex justify-between text-stock-ok">
                <dt>Promo {promotion?.code}</dt>
                <dd className="tabular">
                  -{formatCurrency(totals.promotionDiscount)}
                </dd>
              </div>
            ) : null}

            {totals.manualDiscount > 0 ? (
              <div className="flex justify-between text-stock-ok">
                <dt>Diskon manual</dt>
                <dd className="tabular">
                  -{formatCurrency(totals.manualDiscount)}
                </dd>
              </div>
            ) : null}

            {totals.tax > 0 ? (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Pajak</dt>
                <dd className="tabular">{formatCurrency(totals.tax)}</dd>
              </div>
            ) : null}

            <Separator />

            <div className="flex items-baseline justify-between">
              <dt className="font-semibold">Total</dt>
              <dd className="tabular text-xl font-semibold">
                {formatCurrency(totals.total)}
              </dd>
            </div>
          </dl>

          <div className="space-y-1.5">
            <Label htmlFor="promotion-code">Kode promo</Label>

            {promotion ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-stock-ok/40 bg-stock-ok/5 px-2 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {promotion.code} · {promotion.name}
                  </p>
                  <p className="text-[11px] text-stock-ok">
                    -{formatCurrency(promotion.discountAmount)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-1 text-xs"
                  onClick={() => setPromotion(null)}
                >
                  Hapus
                </Button>
              </div>
            ) : (
              <div className="flex gap-1">
                <Input
                  id="promotion-code"
                  value={promotionInput}
                  disabled={lines.length === 0}
                  onChange={(event) => {
                    setPromotionInput(event.target.value);
                    setPromotionError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void applyPromotion();
                    }
                  }}
                  placeholder="HEMAT10"
                  className="uppercase"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={lines.length === 0 || !promotionInput.trim()}
                  onClick={() => void applyPromotion()}
                >
                  Pakai
                </Button>
              </div>
            )}

            {promotionError ? (
              <p className="text-[11px] text-stock-out">{promotionError}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="manual-discount">Diskon manual (Rp)</Label>
            <Input
              id="manual-discount"
              type="number"
              min={0}
              step={1000}
              value={discountInput}
              onChange={(event) => {
                const raw = event.target.value;
                setDiscountInput(raw);
                const parsed = Number.parseInt(raw, 10);
                setManualDiscount(
                  Number.isFinite(parsed) && parsed > 0
                    ? Math.min(parsed, totals.afterLineDiscount)
                    : 0,
                );
              }}
              placeholder="0"
              className="tabular"
            />
            {manualDiscount > 0 && manualDiscount < totals.afterLineDiscount ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1 text-xs text-muted-foreground"
                onClick={() => {
                  setDiscountInput("");
                  setManualDiscount(0);
                }}
              >
                Hapus diskon
              </Button>
            ) : null}
          </div>

          {customer?.isMember && totals.total > 0 ? (
            <p className="text-xs text-muted-foreground">
              Poin member: +{formatNumber(Math.floor(totals.total / loyaltyRatio))}
            </p>
          ) : null}

          <div className="mt-auto space-y-2">
            <Button
              className="h-12 w-full text-base"
              disabled={lines.length === 0 || isCheckingOut}
              onClick={() => setPaymentOpen(true)}
            >
              {isCheckingOut ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Memproses…
                </>
              ) : (
                <>Bayar (F8)</>
              )}
            </Button>

            <p className="text-center text-[11px] text-muted-foreground">
              Kasir: {cashierName}
              {shift ? ` · Shift ${shift.number}` : " · Tanpa shift"}
            </p>
          </div>
        </section>
      </div>

      {/* ── Customer picker ─────────────────────────────────────────────── */}
      <Dialog open={customerOpen} onOpenChange={setCustomerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pilih Pelanggan</DialogTitle>
            <DialogDescription>
              Member mendapat poin loyalitas. Pelanggan umum tetap boleh
              transact tanpa membership.
            </DialogDescription>
          </DialogHeader>

          <Input
            value={customerQuery}
            onChange={(event) => setCustomerQuery(event.target.value)}
            placeholder="Cari nama, nomor telepon, atau nomor member…"
            autoFocus
            aria-label="Cari pelanggan"
          />

          <div className="max-h-80 overflow-y-auto">
            {filteredCustomers.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Pelanggan tidak ditemukan.
              </p>
            ) : (
              <ul className="divide-y">
                {filteredCustomers.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-2 py-2.5 text-left text-sm hover:bg-accent"
                      onClick={() => {
                        setCustomer(entry);
                        setCustomerOpen(false);
                        setCustomerQuery("");
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {entry.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {entry.phone ?? "—"}
                        </span>
                      </span>
                      {entry.isMember ? (
                        <Badge variant="secondary" className="shrink-0">
                          {entry.memberNumber ?? "Member"}
                        </Badge>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {customer ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setCustomer(null);
                setCustomerOpen(false);
              }}
            >
              Hapus pelanggan
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Hold / resume ───────────────────────────────────────────────── */}
      <Dialog open={holdOpen} onOpenChange={setHoldOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transaksi Tersimpan</DialogTitle>
            <DialogDescription>
              Simpan keranjang sementara untuk dilayani pelanggan lain.
            </DialogDescription>
          </DialogHeader>

          <Button onClick={holdCart} className="w-full">
            <Pause className="size-4" aria-hidden />
            Simpan keranjang saat ini
          </Button>

          {heldCarts.length > 0 ? (
            <ul className="divide-y">
              {heldCarts.map((held) => (
                <li
                  key={held.id}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{held.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {held.lines.length} item ·{" "}
                      {formatCurrency(
                        calculateTotals({ lines: held.lines }).total,
                      )}
                    </span>
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => resumeCart(held.id)}
                    >
                      Lanjutkan
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        setHeldCarts((current) =>
                          current.filter((entry) => entry.id !== held.id),
                        )
                      }
                      aria-label={`Hapus ${held.label}`}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Belum ada transaksi tersimpan.
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Remounting on open resets the payment method and amount, so the next
          sale never inherits figures from the previous one. */}
      <PaymentDialog
        key={paymentOpen ? "payment-open" : "payment-closed"}
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        total={totals.total}
        hasOpenShift={Boolean(shift)}
        onConfirm={handleCheckout}
      />

      <ReceiptDialog
        result={receipt}
        store={store}
        onClose={() => {
          setReceipt(null);
          scanRef.current?.focus();
        }}
      />
    </div>
  );
}

function ScanHint() {
  return (
    <ScanLineIcon />
  );
}

function ScanLineIcon() {
  // Small inline barcode glyph marking the scan field.
  return (
    <svg
      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path d="M3 5v14M7 5v14M11 5v10M15 5v14M19 5v10" />
    </svg>
  );
}

function ShortcutHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

export { PAYMENT_METHODS };