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

describe("Unit: Lógica de Delta de Estoque (Decimal)", () => {
  it("getAppliedStockQuantityForComandaItem calcula saldo de Decimal(10,3) com exatidão", async () => {
    const tx = {
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          { type: StockMovementType.SALE, quantity: new Prisma.Decimal("0.100") },
          { type: StockMovementType.SALE, quantity: new Prisma.Decimal("0.200") },
        ]),
      },
    } as any;

    const qty = await getAppliedStockQuantityForComandaItem(tx, "item-a");
    expect(qty.toNumber()).toBe(0.3); // 0.100 + 0.200 = 0.300
  });

  it("calcula saldo líquido de SALE e REFUND com Decimal", async () => {
    const tx = {
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          { type: StockMovementType.SALE, quantity: new Prisma.Decimal("0.300") },
          { type: StockMovementType.REFUND, quantity: new Prisma.Decimal("0.100") },
        ]),
      },
    } as any;

    const qty = await getAppliedStockQuantityForComandaItem(tx, "item-a");
    expect(qty.toNumber()).toBe(0.2); // 0.300 - 0.100 = 0.200
  });

  it("delta === 0 com Decimais é no-op de estoque", async () => {
    const tx = {
      comandaItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: "item-a",
          type: "PRODUCT",
          productId: "prod-a",
          quantity: new Prisma.Decimal("0.300"),
          product: { id: "prod-a", trackStock: true },
        }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          { type: StockMovementType.SALE, quantity: new Prisma.Decimal("0.300") },
        ]),
      },
      product: {
        update: vi.fn(),
      },
    } as any;

    await syncStockForComandaItem(tx, "shop-a", "item-a", new Prisma.Decimal("0.300"), "teste");

    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it("delta > 0 com Decimais decrementa estoque e cria SALE", async () => {
    const tx = {
      comandaItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: "item-a",
          type: "PRODUCT",
          productId: "prod-a",
          quantity: new Prisma.Decimal("0.300"),
          product: { id: "prod-a", trackStock: true },
        }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          { type: StockMovementType.SALE, quantity: new Prisma.Decimal("0.100") },
        ]), // applied = 0.100, desired = 0.300 => delta = 0.200
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

    await syncStockForComandaItem(tx, "shop-a", "item-a", new Prisma.Decimal("0.300"), "teste");

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: "prod-a" },
      data: { currentStock: new Prisma.Decimal("9.800") }, // 10 - 0.2 = 9.8
    });

    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: {
        barbershopId: "shop-a",
        productId: "prod-a",
        comandaItemId: "item-a",
        type: StockMovementType.SALE,
        quantity: new Prisma.Decimal("0.200"),
        description: "teste",
      },
    });
  });

  it("delta < 0 com Decimais incrementa estoque e cria REFUND", async () => {
    const tx = {
      comandaItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: "item-a",
          type: "PRODUCT",
          productId: "prod-a",
          quantity: new Prisma.Decimal("0.100"),
          product: { id: "prod-a", trackStock: true },
        }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([
          { type: StockMovementType.SALE, quantity: new Prisma.Decimal("0.300") },
        ]), // applied = 0.300, desired = 0.100 => delta = -0.200
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

    await syncStockForComandaItem(tx, "shop-a", "item-a", new Prisma.Decimal("0.100"), "teste");

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: "prod-a" },
      data: { currentStock: new Prisma.Decimal("7.200") }, // 7 + 0.2 = 7.2
    });

    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: {
        barbershopId: "shop-a",
        productId: "prod-a",
        comandaItemId: "item-a",
        type: StockMovementType.REFUND,
        quantity: new Prisma.Decimal("0.200"),
        description: "teste",
      },
    });
  });

  it("lógica de sequenciamento fracionário: 0.300 -> 0.100 -> 0.200", async () => {
    const tx = {
      comandaItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: "item-a",
          type: "PRODUCT",
          productId: "prod-a",
          quantity: new Prisma.Decimal("0.100"),
          product: { id: "prod-a", trackStock: true },
        }),
      },
      stockMovement: {
        // Primeiro passo: applied = 0.300, desired = 0.100 => delta = -0.200 (REFUND)
        findMany: vi.fn().mockResolvedValue([
          { type: StockMovementType.SALE, quantity: new Prisma.Decimal("0.300") },
        ]),
        create: vi.fn(),
      },
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "prod-a",
          currentStock: new Prisma.Decimal("5.000"),
        }),
        update: vi.fn(),
      },
    } as any;

    // 0.300 -> 0.100
    await syncStockForComandaItem(tx, "shop-a", "item-a", new Prisma.Decimal("0.100"), "teste-refund");
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: "prod-a" },
      data: { currentStock: new Prisma.Decimal("5.200") },
    });

    // 0.100 -> 0.200
    tx.stockMovement.findMany.mockResolvedValue([
      { type: StockMovementType.SALE, quantity: new Prisma.Decimal("0.300") },
      { type: StockMovementType.REFUND, quantity: new Prisma.Decimal("0.200") },
    ]); // applied = 0.100, desired = 0.200 => delta = 0.100 (SALE)
    tx.product.findUniqueOrThrow.mockResolvedValue({
      id: "prod-a",
      currentStock: new Prisma.Decimal("5.200"),
    });

    await syncStockForComandaItem(tx, "shop-a", "item-a", new Prisma.Decimal("0.200"), "teste-sale");
    expect(tx.product.update).toHaveBeenLastCalledWith({
      where: { id: "prod-a" },
      data: { currentStock: new Prisma.Decimal("5.100") }, // 5.2 - 0.1 = 5.1
    });
  });

  it("syncStockForComanda ignora itens inativos ou sem controle de estoque", async () => {
    const tx = {
      comandaItem: {
        findMany: vi.fn().mockResolvedValue([
          { id: "item-1", type: "SERVICE", quantity: new Prisma.Decimal("1.000"), status: "DONE" },
          { id: "item-2", type: "PRODUCT", quantity: new Prisma.Decimal("2.000"), status: "DONE", productId: "p-2", product: { id: "p-2", trackStock: true } },
        ]),
        findUnique: vi.fn().mockResolvedValue({
          id: "item-2",
          type: "PRODUCT",
          productId: "p-2",
          quantity: new Prisma.Decimal("2.000"),
          product: { id: "p-2", trackStock: true },
        }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      product: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "p-2",
          currentStock: new Prisma.Decimal("10.000"),
        }),
        update: vi.fn(),
      },
    } as any;

    await syncStockForComanda(tx, "shop-a", "comanda-a", "cancelamento", false);

    expect(tx.product.update).toHaveBeenCalledTimes(1);
  });
});
