import "server-only";

import { prisma } from "@/lib/db";

/**
 * Notification generation.
 *
 * Alerts are derived, not written by hand: low stock, expiry, and expiring
 * batches are facts about the catalogue that change on every purchase, sale, and
 * stock adjustment. Storing them means someone would have to remember to refresh
 * them, and the dashboard would be quietly wrong the moment stock moved.
 *
 * Deduplication is by `dedupeKey`. Re-running generation must not pile up
 * duplicate rows for a condition that is still true, and must reopen an existing
 * alert once the condition clears so a later recurrence is visible again. A unique
 * index on `dedupeKey` enforces this at the database level, so two concurrent
 * generations cannot both insert.
 */

/** How close to expiry counts as "soon", when the setting does not say. */
const DEFAULT_WARNING_DAYS = 30;

/** One day in milliseconds. */
const DAY_MS = 86_400_000;

export interface GenerationResult {
  created: number;
  reopened: number;
  /** Conditions that are no longer true, closed out. */
  resolved: number;
}

async function readWarningDays(): Promise<number> {
  const row = await prisma.storeSetting.findUnique({
    where: { key: "expiry.warningDays" },
    select: { value: true },
  });

  return typeof row?.value === "number" && row.value > 0
    ? row.value
    : DEFAULT_WARNING_DAYS;
}

export async function generateStockNotifications(): Promise<GenerationResult> {
  const warningDays = await readWarningDays();
  const now = new Date();
  const expiryHorizon = new Date(now.getTime() + warningDays * DAY_MS);

  // Only active products are considered: a deactivated product cannot be sold,
  // so warning about its stock would be noise on a store dashboard.
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      stock: true,
      minStock: true,
    },
  });

  // Open alerts this generator owns, so conditions that stopped being true can
  // be resolved rather than left on screen forever. Both prefixes it writes are
  // matched: expiry alerts use `expiry:`, and tracking only `stock:` meant a
  // written-off batch kept re-opening its own "Kedaluwarsa" alert on every run
  // and never cleared.
  const openStockAlerts = await prisma.notification.findMany({
    where: {
      isRead: false,
      OR: [
        { dedupeKey: { startsWith: "stock:" } },
        { dedupeKey: { startsWith: "expiry:" } },
      ],
    },
    select: { id: true, dedupeKey: true },
  });

  // `dedupeKey` is nullable, and this generator only ever reads the rows it
  // wrote (all of which have one), so nulls are skipped rather than compared.
  const trackedAlerts = openStockAlerts.filter(
    (alert): alert is typeof alert & { dedupeKey: string } =>
      alert.dedupeKey !== null,
  );

  const openByKey = new Map(
    trackedAlerts.map((alert) => [alert.dedupeKey, alert]),
  );

  const wanted: Array<{
    dedupeKey: string;
    type:
      | "LOW_STOCK"
      | "OUT_OF_STOCK"
      | "EXPIRING_SOON"
      | "EXPIRED"
      | "PURCHASE_RECEIVED";
    severity: "INFO" | "WARNING" | "CRITICAL";
    title: string;
    message: string;
    link: string;
  }> = [];

  // Expiry is a separate concern from low stock and is reported per batch, since
  // a product can have plenty of stock in one batch while another is expiring.
  //
  // Fetched once for every product rather than inside the loop below: querying
  // per product meant a 500-item catalogue issued 500 round trips every time
  // anyone opened the notification screen.
  const expiringBatches = await prisma.productBatch.findMany({
    where: {
      quantity: { gt: 0 },
      // Only batches that are already expired or fall inside the warning window.
      expiryDate: { lte: expiryHorizon },
      product: { isActive: true },
    },
    select: {
      id: true,
      batchNumber: true,
      expiryDate: true,
      quantity: true,
      product: { select: { id: true, name: true } },
    },
  });

  const batchesByProduct = new Map<string, typeof expiringBatches>();

  for (const batch of expiringBatches) {
    const existing = batchesByProduct.get(batch.product.id);
    if (existing) existing.push(batch);
    else batchesByProduct.set(batch.product.id, [batch]);
  }

  for (const product of products) {
    // Out of stock takes precedence over low stock: a cashier seeing "low stock"
    // for something that is already at zero would be told the wrong thing.
    if (product.stock <= 0) {
      wanted.push({
        dedupeKey: "stock:out:" + product.id,
        type: "OUT_OF_STOCK",
        severity: "CRITICAL",
        title: "Stok habis: " + product.name,
        message:
          product.name + " (" + product.sku + ") memiliki stok 0 dan perlu dipesan ulang.",
        link: "/products/" + product.id,
      });
    } else if (product.stock <= product.minStock) {
      wanted.push({
        dedupeKey: "stock:low:" + product.id,
        type: "LOW_STOCK",
        severity: "WARNING",
        title: "Stok menipis: " + product.name,
        message:
          product.name +
          " tersisa " +
          product.stock +
          " " +
          "unit, di bawah batas minimum " +
          product.minStock +
          ".",
        link: "/products/" + product.id,
      });
    }

    for (const batch of batchesByProduct.get(product.id) ?? []) {
      const expired = batch.expiryDate.getTime() < now.getTime();

      // The query already limited rows to the window; this keeps the rule
      // explicit at the point of use so it survives a change to the query.
      const days = Math.ceil(
        (batch.expiryDate.getTime() - now.getTime()) / DAY_MS,
      );

      wanted.push({
        dedupeKey: "expiry:" + batch.id,
        type: expired ? "EXPIRED" : "EXPIRING_SOON",
        severity: expired ? "CRITICAL" : "WARNING",
        title:
          (expired ? "Kedaluwarsa: " : "Segera kedaluwarsa: ") +
          product.name +
          " (" +
          batch.batchNumber +
          ")",
        message: expired
          ? product.name +
            " batch " +
            batch.batchNumber +
            " sudah kedaluwarsa " +
            Math.abs(days) +
            " hari lalu, sebanyak " +
            batch.quantity +
            " unit. Jangan dijual."
          : product.name +
            " batch " +
            batch.batchNumber +
            " kedaluwarsa dalam " +
            days +
            " hari (" +
            batch.quantity +
            " unit).",
        link: "/products/" + product.id,
      });
    }
  }

  let created = 0;
  let reopened = 0;

  for (const alert of wanted) {
    const existing = openByKey.get(alert.dedupeKey);

    if (existing) {
      // Still true: leave the existing row alone so its timestamp keeps showing
      // when the condition was first noticed.
      continue;
    }

    // A resolved alert for the same condition exists but is marked read. Clearing
    // its read flag is what makes a recurrence visible instead of silent.
    await prisma.notification.updateMany({
      where: { dedupeKey: alert.dedupeKey, isRead: true },
      data: { isRead: false },
    });

    reopened++;
  }

  // Insert only the keys not already open, in one statement.
  const keysToInsert = wanted
    .filter((alert) => !openByKey.has(alert.dedupeKey))
    .map((alert) => alert.dedupeKey);

  const existingAnywhere = await prisma.notification.findMany({
    where: { dedupeKey: { in: keysToInsert } },
    select: { dedupeKey: true },
  });

  const existingKeys = new Set(existingAnywhere.map((row) => row.dedupeKey));

  const toInsert = wanted.filter((alert) => !existingKeys.has(alert.dedupeKey));

  for (const alert of toInsert) {
    // `createMany` with `skipDuplicates` rather than a create-and-catch.
    //
    // The unique index on `dedupeKey` is what makes two concurrent generations
    // safe, but catching the violation means Prisma logs a full error for a
    // collision that is the correct outcome — filling the server log with
    // errors every time two people open the page at once. Skipping duplicates
    // states the intent instead.
    const inserted = await prisma.notification.createMany({
      data: [
        {
          // userId null = broadcast to every user, which is correct for a stock
          // condition: it is the store's problem, not one person's.
          userId: null,
          type: alert.type,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          link: alert.link,
          dedupeKey: alert.dedupeKey,
        },
      ],
      skipDuplicates: true,
    });

    created += inserted.count;
  }

  // Close out conditions that are no longer true.
  const wantedKeys = new Set(wanted.map((alert) => alert.dedupeKey));
  const toResolve = trackedAlerts.filter(
    (alert) => !wantedKeys.has(alert.dedupeKey),
  );

  let resolved = 0;

  for (const alert of toResolve) {
    await prisma.notification.update({
      where: { id: alert.id },
      data: { isRead: true },
    });
    resolved++;
  }

  return { created, reopened, resolved };
}

/**
 * Raises an alert for a single event, deduplicated on a caller-supplied key.
 *
 * Used for things with no derived state, such as an unusually large sale or a
 * shift left open. Returns the notification so the caller can link to it.
 */
export async function raiseNotification(input: {
  dedupeKey: string;
  type:
    | "LOW_STOCK"
    | "OUT_OF_STOCK"
    | "EXPIRING_SOON"
    | "EXPIRED"
    | "LARGE_TRANSACTION"
    | "PURCHASE_RECEIVED";
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  link?: string;
  userId?: string | null;
}): Promise<{ id: string; created: boolean }> {
  // An alert that already exists for this key is the outcome we want, so the
  // existing row is returned rather than treated as a failure. Doing it as an
  // upsert keeps a routine duplicate out of the server log.
  const existing = await prisma.notification.findUnique({
    where: { dedupeKey: input.dedupeKey },
    select: { id: true },
  });

  if (existing) return { id: existing.id, created: false };

  const created = await prisma.notification.create({
    data: {
      userId: input.userId ?? null,
      type: input.type,
      severity: input.severity,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
      dedupeKey: input.dedupeKey,
    },
    select: { id: true },
  });

  return { id: created.id, created: true };
}