/**
 * Cash shift lifecycle.
 *
 * A shift is the unit of cash accountability: opening float in, movements and
 * cash sales recorded against it, counted cash out. The expected balance is
 * always derived from the ledger rather than trusted from the client, so a
 * tampered form cannot produce a "balanced" till.
 */

import "server-only";

import { prisma } from "@/lib/db";
import { BusinessRuleError, ValidationError } from "@/lib/error";
import { withDocumentNumber } from "@/lib/documents";
import {
  calculateVariance,
  validateClosingCash,
  type ShiftComponents,
} from "@/lib/shifts/rules";

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

  return prisma.$transaction(async (tx) => {
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
  });
}

/**
 * Computes the shift's cash components straight from the ledger.
 *
 * Reads committed records rather than anything the caller supplies, so the
 * expected balance at close time cannot be influenced from the client.
 */
export async function getShiftComponents(
  shiftId: string,
): Promise<ShiftComponents> {
  const shift = await prisma.cashShift.findUnique({
    where: { id: shiftId },
    select: { openingCash: true },
  });

  if (!shift) {
    throw new ValidationError("Shift tidak ditemukan.");
  }

const [cashSales, cashRefunds, movements] = await Promise.all([
    prisma.sale.aggregate({
      where: { shiftId, paymentMethod: "CASH", status: "COMPLETED" },
      _sum: { amountPaid: true },
    }),
    // A refund only leaves the drawer if the original sale was paid in cash;
    // refunding a QRIS purchase moves money outside the till.
    prisma.saleRefund.aggregate({
      where: { sale: { shiftId, paymentMethod: "CASH" } },
      _sum: { totalRefund: true },
    }),
    prisma.cashMovement.groupBy({
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
    cashSales: Number(cashSales._sum.amountPaid ?? 0),
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

  return prisma.$transaction(
    async (tx) => {
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

      const components = await getShiftComponents(shiftId);
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

      await tx.cashShift.update({
        where: { id: shiftId },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closingCash: actualCash,
          expectedCash: result.expected,
          variance: result.variance,
          notes: combinedNotes || null,
        },
      });

      return {
        expected: result.expected,
        actual: result.actual,
        variance: result.variance,
        direction: result.direction,
      };
    },
    { timeout: 20_000, maxWait: 5_000 },
  );
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
}): Promise<{ rows: ShiftRow[]; total: number }> {
  const where = options.userId ? { userId: options.userId } : {};

  const [rows, total] = await Promise.all([
    prisma.cashShift.findMany({
      where,
      take: options.take ?? 50,
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
        _count: { select: { sales: true } },
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
