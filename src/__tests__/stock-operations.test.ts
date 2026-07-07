import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, StockMovementType } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    comandaItem: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    product: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    stockMovement: { findMany: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import {
  getAppliedStockQuantityForComandaItem,
  syncStockForComandaItem,
  syncStockForComanda,
} from "@/lib/operations/stock";
import { OperationalError } from "@/lib/operations/comandas";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Unit: Lógica de Delta de Estoque", () => {
  it("getAppliedStockQuantityForComandaItem calcula corretamente saldo de SALE e REFUND", async () => {
    const tx = {
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          { type: StockMovementType.SALE, quantity: new Prisma.Decimal("3.000") },
          { type: StockMovementType.REFUND, quantity: new Prisma.Decimal("1.000") },
          { type: StockMovementType.SALE, quantity: new Prisma.Decimal("2.000") },
        ]),
      },
    } as any;

    const qty = await getAppliedStockQuantityForComandaItem(tx, "item-a");
    expect(qty).toBe(4); // 3 - 1 + 2 = 4
  });

  it("delta === 0: no-op de estoque", async () => {
    const tx = {
      comandaItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: "item-a",
          type: "PRODUCT",
          productId: "prod-a",
          quantity: new Prisma.Decimal("3.000"),
          product: { id: "prod-a", trackStock: true },
        }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          { type: StockMovementType.SALE, quantity: new Prisma.Decimal("3.000") },
        ]),
      },
    } as any;

    await syncStockForComandaItem(tx, "shop-a", "item-a", 3, "teste");

    // Nenhuma alteração no produto ou criação de movimentos
    expect(tx.product?.update).toBeUndefined();
    expect(tx.stockMovement?.create).toBeUndefined();
  });

  it("delta > 0: decrementa estoque e cria SALE", async () => {
    const tx = {
      comandaItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: "item-a",
          type: "PRODUCT",
          productId: "prod-a",
          quantity: new Prisma.Decimal("3.000"),
          product: { id: "prod-a", trackStock: true },
        }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([]), // applied = 0
        create: vi.fn(),
      },
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "prod-a",
          currentStock: new Prisma.Decimal("10.000"),
        }),
        update: vi.fn(),
      },
    } as any;

    await syncStockForComandaItem(tx, "shop-a", "item-a", 3, "teste");

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: "prod-a" },
      data: { currentStock: new Prisma.Decimal("7.000") }, // 10 - 3 = 7
    });

    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: {
        barbershopId: "shop-a",
        productId: "prod-a",
        comandaItemId: "item-a",
        type: StockMovementType.SALE,
        quantity: new Prisma.Decimal("3.000"),
        description: "teste",
      },
    });
  });

  it("delta > 0 com estoque insuficiente lança erro e impede alteração", async () => {
    const tx = {
      comandaItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: "item-a",
          type: "PRODUCT",
          productId: "prod-a",
          quantity: new Prisma.Decimal("3.000"),
          product: { id: "prod-a", trackStock: true },
        }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "prod-a",
          currentStock: new Prisma.Decimal("2.000"),
        }),
        update: vi.fn(),
      },
    } as any;

    await expect(
      syncStockForComandaItem(tx, "shop-a", "item-a", 3, "teste")
    ).rejects.toThrow(OperationalError);

    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it("delta < 0: incrementa estoque e cria REFUND", async () => {
    const tx = {
      comandaItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: "item-a",
          type: "PRODUCT",
          productId: "prod-a",
          quantity: new Prisma.Decimal("1.000"),
          product: { id: "prod-a", trackStock: true },
        }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          { type: StockMovementType.SALE, quantity: new Prisma.Decimal("3.000") },
        ]), // applied = 3, desired = 1 => delta = -2
        create: vi.fn(),
      },
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "prod-a",
          currentStock: new Prisma.Decimal("7.000"),
        }),
        update: vi.fn(),
      },
    } as any;

    await syncStockForComandaItem(tx, "shop-a", "item-a", 1, "teste");

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: "prod-a" },
      data: { currentStock: new Prisma.Decimal("9.000") }, // 7 + 2 = 9
    });

    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: {
        barbershopId: "shop-a",
        productId: "prod-a",
        comandaItemId: "item-a",
        type: StockMovementType.REFUND,
        quantity: new Prisma.Decimal("2.000"),
        description: "teste",
      },
    });
  });

  it("syncStockForComanda sincroniza todos os itens de produto da comanda", async () => {
    const tx = {
      comandaItem: {
        findMany: vi.fn().mockResolvedValue([
          { id: "item-1", type: "SERVICE", quantity: new Prisma.Decimal("1.000"), status: "DONE" },
          { id: "item-2", type: "PRODUCT", quantity: new Prisma.Decimal("2.000"), status: "DONE", productId: "p-2", product: { id: "p-2", trackStock: true } },
          { id: "item-3", type: "PRODUCT", quantity: new Prisma.Decimal("1.000"), status: "CANCELLED", productId: "p-3", product: { id: "p-3", trackStock: true } },
        ]),
        findUnique: vi.fn().mockImplementation(async ({ where }) => {
          if (where.id === "item-2") {
            return { id: "item-2", type: "PRODUCT", productId: "p-2", quantity: new Prisma.Decimal("2.000"), product: { id: "p-2", trackStock: true } };
          }
          if (where.id === "item-3") {
            return { id: "item-3", type: "PRODUCT", productId: "p-3", quantity: new Prisma.Decimal("1.000"), product: { id: "p-3", trackStock: true } };
          }
          return null;
        }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      product: {
        findUniqueOrThrow: vi.fn().mockImplementation(async ({ where }) => ({
          id: where.id,
          currentStock: new Prisma.Decimal("10.000"),
        })),
        update: vi.fn(),
      },
    } as any;

    await syncStockForComanda(tx, "shop-a", "comanda-a", "cancelamento", false);

    // item-1 (SERVICE) deve ser ignorado
    // item-2 deve receber desiredQuantity = 2 (delta = 2) -> decrementa estoque e cria SALE
    // item-3 (CANCELLED) deve receber desiredQuantity = 0 (delta = 0) -> no-op

    expect(tx.product.update).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: "p-2" },
      data: { currentStock: new Prisma.Decimal("8.000") },
    });
  });
});
