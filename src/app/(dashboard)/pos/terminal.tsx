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

import { checkoutAction, lookupPosBarcodeAction, type CheckoutResult } from "./actions";
import { previewPromotionAction } from "./promotion-actions";
import { CustomerPickerDialog } from "@/components/pos/customer-picker-dialog";
import { HeldCartsDialog } from "@/components/pos/held-carts-dialog";
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
  /** Loyalty balance, shown so the cashier knows what can be redeemed. */
  points: number;
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
  pointValue,
  taxRate,
  cashierName,
  store,
  canApplyDiscount,
}: {
  initialProducts: PosProduct[];
  categories: Array<{ id: string; name: string }>;
  customers: PosCustomer[];
  shift: PosShift | null;
  loyaltyRatio: number;
  /** Rupiah each loyalty point is worth, for the redemption preview. */
  pointValue: number;
  /** Store tax rate as a fraction, for the running-total preview only. */
  taxRate: number;
  cashierName: string;
  store: { name: string; address: string; phone: string; footer: string };
  /** Mirrors the server check, so the field is not offered where it is refused. */
  canApplyDiscount: boolean;
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
  const [redeemInput, setRedeemInput] = useState("");
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [promotion, setPromotion] = useState<AppliedPromotion | null>(null);
  const [promotionInput, setPromotionInput] = useState("");
  const [promotionError, setPromotionError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [receipt, setReceipt] = useState<CheckoutResult | null>(null);
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [holdOpen, setHoldOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
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
        pointsDiscount: redeemPoints * pointValue,
        taxRate,
      }),
    [lines, promotion, manualDiscount, redeemPoints, pointValue, taxRate],
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
    setRedeemInput("");
    setRedeemPoints(0);
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
  //
  // The lookup goes to the server rather than to the product grid already in
  // memory: the grid is only a slice of the catalogue, so matching locally would
  // make every product outside that slice unscannable — the scanner would
  // report "not found" for an item that is sitting on the shelf in front of the
  // cashier.
  const handleScan = useCallback(
    async (raw: string) => {
      const barcode = raw.trim();

      if (!barcode) return;

      // Exact match only. A partial match would add the wrong product
      // to the cart, which is far worse than a "not found" message.
      const local = initialProducts.find(
        (product) => product.barcode === barcode,
      );

      if (local) {
        addProduct(local);
        scanRef.current?.select();
        return;
      }

      setIsScanning(true);

      try {
        const found = await lookupPosBarcodeAction(barcode);

        if (!found) {
          setScanError(`Barcode ${barcode} tidak ditemukan.`);
        } else if (!found.isActive) {
          setScanError(`${found.name} sudah dinonaktifkan dan tidak bisa dijual.`);
        } else if (found.stock <= 0) {
          setScanError(`Stok ${found.name} habis.`);
        } else {
          addProduct(found);
        }
      } catch {
        setScanError("Gagal mencari barcode. Coba lagi.");
      } finally {
        setIsScanning(false);
        scanRef.current?.select();
      }
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
        redeemPoints,
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
          void handleScan(input.value);
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
            placeholder={
              isScanning ? "Mencari barcode…" : "Scan barcode atau ketik nomor barcode, lalu Enter"
            }
            className="pl-9 font-mono"
            autoFocus
            readOnly={isScanning}
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

      {/* Three panes on desktop, two from tablet width, one only on a phone.

          The intermediate step is the important one: `xl:` alone left 768px–1279px
          as a single column, so on the tablet a cashier actually works on, the
          whole cart and the payment button sat below ~120 product tiles. The
          `minmax` floor stops the catalogue collapsing to ~240px at 1280px once
          the 256px sidebar is subtracted, which is the width a small laptop has. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] xl:grid-cols-[minmax(0,1fr)_360px_300px]">
        {/* ── Catalogue ────────────────────────────────────────────────── */}
        <section aria-label="Katalog produk" className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <div className="relative min-w-0 flex-1 sm:min-w-52">
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
              <SelectTrigger className="w-full sm:w-44" aria-label="Filter kategori">
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visibleProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addProduct(product)}
                  disabled={product.stock <= 0}
                  className="flex min-w-0 flex-col justify-between gap-1.5 rounded-lg border bg-card p-2.5 text-left transition-colors hover:border-brand-500 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-3 sm:gap-2"
                >
                  <div className="min-w-0">
                    <p className="line-clamp-2 break-words text-xs font-medium leading-snug sm:text-sm">
                      {product.name}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {product.sku}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="tabular text-xs font-semibold sm:text-sm">
                      {formatCurrency(product.sellingPrice)}
                    </p>
                    <p className="text-[10px] text-muted-foreground sm:text-[11px]">
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
          // Sticky from tablet width so the cart and the payment button stay
          // reachable while the cashier scrolls the catalogue. On a phone it
          // simply sits below it, in the natural order.
          className="flex flex-col rounded-lg border bg-card lg:sticky lg:top-16 lg:max-h-[calc(100svh-5rem)] lg:overflow-hidden"
        >
          <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Keranjang</h2>
              <p className="text-xs text-muted-foreground">
                {totals.itemCount} item · {totals.totalQuantity} pcs
              </p>
            </div>

            <div className="flex shrink-0 gap-1">
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

          <div className="lg:flex-1 lg:overflow-y-auto">
              <div className="max-h-[28rem] lg:max-h-none overflow-y-auto">
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

            {totals.pointsDiscount > 0 ? (
              <div className="flex justify-between text-stock-ok">
                <dt>Poin ditukar</dt>
                <dd className="tabular">
                  -{formatCurrency(totals.pointsDiscount)}
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

          {customer?.isMember ? (
            <div className="space-y-1.5">
              <Label htmlFor="redeem-points">
                Tukar poin ({formatNumber(customer.points)} tersedia)
              </Label>
              <div className="flex gap-1">
                <Input
                  id="redeem-points"
                  type="number"
                  min={0}
                  step={1}
                  max={customer.points}
                  value={redeemInput}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setRedeemInput(raw);

                    const parsed = Number.parseInt(raw, 10);
                    setRedeemPoints(
                      Number.isFinite(parsed) && parsed > 0
                        ? Math.min(parsed, customer.points)
                        : 0,
                    );
                  }}
                  placeholder="0"
                  className="tabular"
                />
                {redeemPoints > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 px-2"
                    onClick={() => {
                      setRedeemInput("");
                      setRedeemPoints(0);
                    }}
                  >
                    Batal
                  </Button>
                ) : null}
              </div>
              <p className="text-[11px] text-muted-foreground">
                1 poin = {formatCurrency(pointValue)}
                {redeemPoints > 0
                  ? ` · potongan ${formatCurrency(totals.pointsDiscount)}`
                  : ""}
              </p>
            </div>
          ) : null}

          {canApplyDiscount ? (
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
          ) : null}

          {customer?.isMember && loyaltyRatio > 0 && totals.total > 0 ? (
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
      <CustomerPickerDialog
        open={customerOpen}
        onOpenChange={setCustomerOpen}
        customers={customers}
        query={customerQuery}
        onQueryChange={setCustomerQuery}
        selected={customer}
        onSelect={(entry) => {
          // The picker's own row type is the looser one; fill in the balance so
          // the redemption control has something to work with.
          setCustomer({
            ...entry,
            points: entry.points ?? 0,
          });
          setRedeemInput("");
          setRedeemPoints(0);
          setCustomerOpen(false);
          setCustomerQuery("");
        }}
        onClear={() => {
          setCustomer(null);
          setCustomerOpen(false);
        }}
      />

      {/* ── Hold / resume ───────────────────────────────────────────────── */}
      <HeldCartsDialog
        open={holdOpen}
        onOpenChange={setHoldOpen}
        held={heldCarts}
        onHoldCurrent={holdCart}
        onResume={resumeCart}
        onDiscard={(id) =>
          setHeldCarts((current) => current.filter((entry) => entry.id !== id))
        }
      />

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