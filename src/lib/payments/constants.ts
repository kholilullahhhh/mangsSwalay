/**
 * Payment method labels and options.
 *
 * Client-safe by design: no database, no Prisma, no `server-only`.
 *
 * This lives apart from `lib/queries/sales.ts` because the receipt dialog is a
 * Client Component that needs these labels. Importing them from a query module
 * drags `pg` and the Prisma client into the browser bundle, which fails the
 * build and takes down every page that renders the POS.
 */

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Tunai",
  QRIS: "QRIS",
  DEBIT: "Kartu Debit",
  CREDIT_CARD: "Kartu Kredit",
  TRANSFER: "Transfer Bank",
  E_WALLET: "E-Wallet",
};

export interface PaymentMethodOption {
  value:
    | "CASH"
    | "QRIS"
    | "DEBIT"
    | "CREDIT_CARD"
    | "TRANSFER"
    | "E_WALLET";
  label: string;
}

/**
 * Offered methods, in the order a cashier should read them.
 *
 * Cash first because it is the overwhelming default in an Indonesian minimarket;
 * the rest follow by how often they are used.
 */
export const PAYMENT_METHODS: PaymentMethodOption[] = [
  { value: "CASH", label: PAYMENT_METHOD_LABEL.CASH },
  { value: "QRIS", label: PAYMENT_METHOD_LABEL.QRIS },
  { value: "E_WALLET", label: PAYMENT_METHOD_LABEL.E_WALLET },
  { value: "DEBIT", label: PAYMENT_METHOD_LABEL.DEBIT },
  { value: "CREDIT_CARD", label: PAYMENT_METHOD_LABEL.CREDIT_CARD },
  { value: "TRANSFER", label: PAYMENT_METHOD_LABEL.TRANSFER },
];

/** Indonesian label for a stored payment method value, with a safe fallback. */
export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "-";
  return PAYMENT_METHOD_LABEL[method] ?? method;
}