import { Prisma, StockMovementType } from "@prisma/client";
import prisma from "@/lib/prisma";
import { OperationalError } from "./comandas";

export function isRetryableTransactionError(error: unknown): boolean {
  const errStr = String(error);
  if (errStr.includes("TransactionWriteConflict") || errStr.includes("WriteConflict")) {
    return true;
  }

  if (error && typeof error === "object" && "message" in error) {
    const msg = String((error as any).message);
    if (
      msg.includes("TransactionWriteConflict") ||
      msg.includes("could not serialize access") ||
      msg.includes("write conflict") ||
      msg.includes("deadlock")
    ) {
      return true;
    }
  }

  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

  return (
    error.code === "P2034" ||
    error.message.includes("could not serialize access") ||
    error.message.includes("write conflict") ||
    error.message.includes("deadlock")
  );
}

export async function runSerializableTransaction<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw new OperationalError(
    "CONCURRENCY_ERROR",
    "A transação está sendo processada concorrentemente. Tente novamente em instantes.",
    409
  );
}

export async function getAppliedStockQuantityForComandaItem(
  tx: Prisma.TransactionClient,
  itemId: string
): Promise<Prisma.Decimal> {
  const movements = await tx.stockMovement.findMany({
    where: { comandaItemId: itemId },
    select: { type: true, quantity: true },
  });

  return movements.reduce((sum, m) => {
    const qty = new Prisma.Decimal(m.quantity);
    if (m.type === StockMovementType.SALE) return sum.plus(qty);
    if (m.type === StockMovementType.REFUND) return sum.minus(qty);
    return sum;
  }, new Prisma.Decimal(0));
}

export async function syncStockForComandaItem(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  itemId: string,
  desiredQuantity: Prisma.Decimal | number,
  reason: string
) {
  const item = await tx.comandaItem.findUnique({
    where: { id: itemId },
    include: { product: true },
  });

  if (!item || item.type !== "PRODUCT") return;
  if (!item.productId || !item.product || !item.product.trackStock) return;

  const product = item.product;
  const appliedQuantity = await getAppliedStockQuantityForComandaItem(tx, itemId);
  const desired = new Prisma.Decimal(desiredQuantity);
  const delta = desired.minus(appliedQuantity);

  if (delta.isZero()) return;

  if (delta.greaterThan(0)) {
    const currentProduct = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
    });

    const currentStock = new Prisma.Decimal(currentProduct.currentStock);
    const nextStock = currentStock.minus(delta);
    if (nextStock.lessThan(0)) {
      throw new OperationalError(
        "INSUFFICIENT_STOCK",
        `Estoque insuficiente para ${product.name}.`,
        422
      );
    }

    await tx.product.update({
      where: { id: product.id },
      data: { currentStock: nextStock },
    });

    await tx.stockMovement.create({
      data: {
        barbershopId,
        productId: product.id,
        comandaItemId: itemId,
        type: StockMovementType.SALE,
        quantity: delta,
        description: reason,
      },
    });
  } else {
    const absDelta = delta.abs();
    const currentProduct = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
    });

    const currentStock = new Prisma.Decimal(currentProduct.currentStock);
    const nextStock = currentStock.plus(absDelta);

    await tx.product.update({
      where: { id: product.id },
      data: { currentStock: nextStock },
    });

    await tx.stockMovement.create({
      data: {
        barbershopId,
        productId: product.id,
        comandaItemId: itemId,
        type: StockMovementType.REFUND,
        quantity: absDelta,
        description: reason,
      },
    });
  }
}

export async function syncStockForComanda(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  comandaId: string,
  reason: string,
  cancelAll = false
) {
  const items = await tx.comandaItem.findMany({
    where: { comandaId },
  });

  for (const item of items) {
    if (item.type !== "PRODUCT") continue;
    const isCancelled = item.status === "CANCELLED" || cancelAll;
    const desiredQuantity = isCancelled ? new Prisma.Decimal(0) : new Prisma.Decimal(item.quantity);
    await syncStockForComandaItem(tx, barbershopId, item.id, desiredQuantity, reason);
  }
}
