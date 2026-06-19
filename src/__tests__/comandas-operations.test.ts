import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { calculateItemTotal, recalculateComandaTotals } from "@/lib/operations/comandas";

describe("operacoes de comanda", () => {
  it("calcula item com desconto e acrescimo opcionais omitidos", () => {
    const total = calculateItemTotal({ quantity: 2, unitPrice: "15.50" });

    expect(total.toString()).toBe("31");
  });

  it("recalcula totais sem mover a comanda automaticamente para pagamento", async () => {
    const tx = {
      comandaItem: {
        findMany: vi.fn().mockResolvedValue([
          { type: "SERVICE", total: new Prisma.Decimal("80.00") },
          { type: "DISCOUNT", total: new Prisma.Decimal("10.00") },
        ]),
      },
      payment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      comanda: {
        update: vi.fn().mockResolvedValue({ id: "comanda-a" }),
      },
    } as unknown as Prisma.TransactionClient;

    await recalculateComandaTotals(tx, "comanda-a");

    expect((tx.comanda.update as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ status: expect.any(String) }),
      })
    );
  });
});
