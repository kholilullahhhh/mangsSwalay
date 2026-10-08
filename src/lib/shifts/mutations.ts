/**
 * Cash shift lifecycle.
 *
 * A shift is the unit of cash accountability: opening float in, movements and
 * cash sales recorded against it, counted cash out. The expected balance is
 * always derived from the ledger rather than trusted from the client, so a
 * tampered form cannot produce a "balanced" till.
 */

import "server-only";

import type { TxClient } from "@/lib/db-client";
import { prisma } from "@/lib/db";
import { BusinessRuleError, ValidationError } from "@/lib/error";
import { withDocumentNumber } from "@/lib/documents";
import {
  calculateVariance,
  validateClosingCash,
  type ShiftComponents,
} from "@/lib/shifts/rules";

/** Model delegates the ledger read needs, so it can join a caller's transaction. */
type ShiftLedgerClient = Pick<
  TxClient,
  "cashShift" | "sale" | "saleRefund" | "cashMovement"
>;

/**
 * Sales that represent money in the drawer.
 *
 * A voided sale put nothing in and a fully refunded sale put nothing in and took
 * everything back out, so neither belongs in cash-in. `PARTIALLY_REFUNDED` does:
 * the sale still happened, it was only partly given back. The refund side then
 * subtracts what went out, which is why the two lists have to match — using
 * different sets here is what makes a refunded sale come out as negative cash.
 */
const DRAWER_SALE_STATUSES = ["COMPLETED", "PARTIALLY_REFUNDED"] as const;

/** Only one shift may be open per user at a time. */
export async function getOpenShift(userId: string) {
  return prisma.cashShift.findFirst({
    where: { userId, status: "OPEN" },
    select: {
      id: true,
      number: true,
      openedAt: true,
      openingCash: true,
    },
  });
}

/**
 * Opening float.
 *
 * Refuses a second open shift for the same user, because two open shifts make
 * "the drawer" ambiguous and the variance meaningless.
 */
export async function openShift(
  userId: string,
  openingCash: number,
  options: { client?: ShiftLedgerClient } = {},
): Promise<{ id: string; number: string }> {
  if (!Number.isInteger(openingCash) || openingCash < 0) {
    throw new ValidationError(
      "Kas awal harus bilangan bulat dan tidak boleh negatif.",
      "openingCash",
    );
  }

  const existing = await getOpenShift(userId);

  if (existing) {
    throw new BusinessRuleError(
      "Anda masih memiliki shift terbuka (" +
        existing.number +
        "). Tutup shift tersebut sebelum membuka yang baru.",
    );
  }

  const run = async (tx: ShiftLedgerClient) => {
    // Re-checked here, inside the transaction that opens the shift, and backed by
    // a partial unique index on ("userId") WHERE status = 'OPEN'. The read above
    // is only there to give a useful message: two requests racing past it both see
    // "no shift", and only the database can settle which one gets to open the
    // till. Leaving "the drawer" ambiguous is the exact thing this guard exists to
    // prevent.
    const stillOpen = await tx.cashShift.findFirst({
      where: { userId, status: "OPEN" },
      select: { number: true },
    });

    if (stillOpen) {
      throw new BusinessRuleError(
        "Anda masih memiliki shift terbuka (" +
          stillOpen.number +
          "). Tutup shift tersebut sebelum membuka yang baru.",
      );
    }

    return withDocumentNumber("SFT", new Date(), async (number) =>
      tx.cashShift.create({
        data: {
          number,
          userId,
          status: "OPEN",
          openedAt: new Date(),
          openingCash,
        },
        select: { id: true, number: true },
      }),
    );
  };

  // `client` lets a caller open a shift inside its own transaction, so the till
  // and whatever it belongs to commit or roll back together.
  return options.client
    ? run(options.client)
    : prisma.$transaction(run, { timeout: 20_000, maxWait: 5_000 });
}

/**
 * Turns a duplicate-shift rejection into the same message the pre-flight check
 * gives, so racing requests produce one consistent explanation instead of a raw
 * constraint violation surfaced as a server error.
 */
export function isOpenShiftConflict(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";

  return code === "P2002";
}

/**
 * Computes the shift's cash components straight from the ledger.
 *
 * Reads committed records rather than anything the caller supplies, so the
 * expected balance at close time cannot be influenced from the client.
 *
 * Accepts a transaction client so the close path can derive the stored expected
 * cash and variance from the same consistent snapshot it writes them in.
 */
export async function getShiftComponents(
  shiftId: string,
  client: ShiftLedgerClient = prisma,
): Promise<ShiftComponents> {
  const shift = await client.cashShift.findUnique({
    where: { id: shiftId },
    select: { openingCash: true },
  });

  if (!shift) {
    throw new ValidationError("Shift tidak ditemukan.");
  }

  const [cashSales, cashRefunds, movements] = await Promise.all([
    client.sale.aggregate({
      where: {
        shiftId,
        paymentMethod: "CASH",
        status: { in: [...DRAWER_SALE_STATUSES] },
      },
      // `total`, not `amountPaid`: the drawer receives the cash handed over and
      // immediately gives back the change, so what stays in the till is the
      // amount of the sale. Summing `amountPaid` would count the change as money
      // left in the drawer and manufacture a phantom shortfall at close.
      _sum: { total: true },
    }),
    // A refund only leaves the drawer if the original sale was paid in cash;
    // refunding a QRIS purchase moves money outside the till. The sale's status
    // is deliberately not filtered: whatever came in has already been counted by
    // the aggregate above or excluded with it, and filtering here would subtract
    // the same refund from a sale that was never added.
    client.saleRefund.aggregate({
      where: { sale: { shiftId, paymentMethod: "CASH" } },
      _sum: { totalRefund: true },
    }),
    client.cashMovement.groupBy({
      by: ["type"],
      where: { shiftId },
      _sum: { amount: true },
    }),
  ]);

  const cashIn =
    movements.find((row) => row.type === "CASH_IN")?._sum.amount ?? 0;
  const cashOut =
    movements.find((row) => row.type === "CASH_OUT")?._sum.amount ?? 0;

  return {
    openingCash: Number(shift.openingCash),
    cashSales: Number(cashSales._sum.total ?? 0),
    cashRefunds: Number(cashRefunds._sum.totalRefund ?? 0),
    cashIn: Number(cashIn),
    cashOut: Number(cashOut),
  };
}

/** Records a cash-in or cash-out against an open shift. */
export async function recordCashMovement(
  shiftId: string,
  userId: string,
  type: "CASH_IN" | "CASH_OUT",
  amount: number,
  reason: string,
): Promise<void> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ValidationError("Nominal harus lebih dari nol.");
  }

  if (reason.trim().length < 3) {
    throw new ValidationError(
      "Alasan wajib diisi untuk setiap movements kas.",
      "reason",
    );
  }

  const shift = await prisma.cashShift.findFirst({
    where: { id: shiftId, userId, status: "OPEN" },
    select: { id: true },
  });

  if (!shift) {
    throw new BusinessRuleError(
      "Shift tidak ditemukan atau sudah ditutup. Buka shift sebelum mencatat movements kas.",
    );
  }

  await prisma.cashMovement.create({
    data: {
      shiftId,
      userId,
      type,
      amount,
      reason: reason.trim(),
    },
  });
}

/**
 * Closes the shift.
 *
 * The expected balance is recomputed from the ledger inside the transaction, so
 * the stored variance is derived, never supplied.
 */
export async function closeShift(
  shiftId: string,
  userId: string,
  actualCash: number,
  notes?: string,
  options: { client?: ShiftLedgerClient } = {},
): Promise<{
  expected: number;
  actual: number;
  variance: number;
  direction: "balanced" | "over" | "short";
}> {
  const validation = validateClosingCash(actualCash);

  if (!validation.valid) {
    throw new ValidationError(validation.error ?? "Jumlah kas tidak valid.", "actualCash");
  }

  const run = async (tx: ShiftLedgerClient) => {
      const shift = await tx.cashShift.findFirst({
        where: { id: shiftId, userId },
        select: { id: true, status: true },
      });

      if (!shift) {
        throw new ValidationError("Shift tidak ditemukan.");
      }

      if (shift.status !== "OPEN") {
        throw new BusinessRuleError("Shift ini sudah ditutup.");
      }

const components = await getShiftComponents(shiftId, tx);
      const result = calculateVariance(components, actualCash);

      // A variance that is not explained is a control failure: the note is
      // stored so it can be reviewed rather than quietly forgotten.
      const combinedNotes = [
        notes?.trim(),
        result.requiresExplanation
          ? "[selisih kas] " +
            result.direction +
            " Rp" +
            Math.abs(result.variance).toLocaleString("id-ID")
          : null,
      ]
        .filter(Boolean)
        .join(" ");

      // The status is the condition of the write, so a second close submitted at
      // the same moment matches nothing and is refused. Reading the status and
      // then writing it unconditionally would let two closes both succeed, with
      // the second silently overwriting the first one's counted cash.
      const closed = await tx.cashShift.updateMany({
        where: { id: shiftId, userId, status: "OPEN" },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closingCash: actualCash,
          expectedCash: result.expected,
          variance: result.variance,
          notes: combinedNotes || null,
        },
      });

      if (closed.count === 0) {
        throw new BusinessRuleError(
          "Shift ini sudah ditutup oleh proses lain. Muat ulang halaman.",
        );
      }

return {
        expected: result.expected,
        actual: result.actual,
        variance: result.variance,
        direction: result.direction,
      };
  };

  // As with `openShift`: a caller can supply its own client so the reconciliation
  // commits with whatever it is reconciling.
  return options.client
    ? run(options.client)
    : prisma.$transaction(run, { timeout: 20_000, maxWait: 5_000 });
}

export interface ShiftRow {
  id: string;
  number: string;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  openingCash: number;
  closingCash: number | null;
  expectedCash: number | null;
  variance: number | null;
  userName: string;
  saleCount: number;
}

/** Shift history, newest first, with aggregated sales per shift. */
export async function listShifts(options: {
  userId?: string;
  page?: string;
  perPage?: string;
  take?: number;
  skip?: number;
}): Promise<{ rows: ShiftRow[]; total: number }> {
  const where = options.userId ? { userId: options.userId } : {};

  const [rows, total] = await Promise.all([
    prisma.cashShift.findMany({
      where,
      // `skip` is what makes the history reachable beyond the first page — a
      // hard cap with no way past it silently hides every shift after the 50th.
      take: options.take ?? 20,
      ...(options.skip ? { skip: options.skip } : {}),
      orderBy: { openedAt: "desc" },
      select: {
        id: true,
        number: true,
        status: true,
        openedAt: true,
        closedAt: true,
        openingCash: true,
        closingCash: true,
        expectedCash: true,
        variance: true,
        user: { select: { name: true } },
        _count: { select: { sales: { where: { status: { not: "VOID" } } } } },
      },
    }),
    prisma.cashShift.count({ where }),
  ]);

  return {
    rows: rows.map((row) => ({
      ...row,
      openingCash: Number(row.openingCash),
      closingCash: row.closingCash === null ? null : Number(row.closingCash),
      expectedCash:
        row.expectedCash === null ? null : Number(row.expectedCash),
      variance: row.variance === null ? null : Number(row.variance),
      userName: row.user.name,
      saleCount: row._count.sales,
    })),
    total,
  };
}

/** Cash movements for one shift. */
export async function listCashMovements(shiftId: string) {
  return prisma.cashMovement.findMany({
    where: { shiftId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      amount: true,
      reason: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });
}

export { calculateVariance, expectedCash } from "@/lib/shifts/rules";
