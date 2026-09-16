import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { bootstrapFinancialPlan } from "@/lib/financial/default-plan";
import { createTitle } from "@/lib/financial/titles";
import {
  createSettlement,
  reverseSettlement,
} from "@/lib/financial/settlements";

describe("Financial Settlements & Reversals Unit Tests", () => {
  const barbershopId = "b1111111-1111-4111-a111-111111111111";
  const userId = "u1111111-1111-4111-a111-111111111111";

  let recCategoryId: string;
  let payCategoryId: string;

  beforeEach(async () => {
    await prisma.financialTitleEvent.deleteMany({});
    await prisma.financialEntryAllocation.deleteMany({});
    await prisma.financialEntry.deleteMany({});
    await prisma.financialSettlementReversal.deleteMany({});
    await prisma.financialSettlement.deleteMany({});
    await prisma.financialTitle.deleteMany({});

    await prisma.barbershop.upsert({
      where: { id: barbershopId },
      create: {
        id: barbershopId,
        name: "Barbearia Teste",
        slug: `barbearia-teste-${barbershopId}`,
        phone: "11999999999",
        zipCode: "00000000",
        street: "Rua Teste",
        number: "123",
        neighborhood: "Bairro Teste",
        city: "Cidade Teste",
        state: "SP",
      },
      update: {},
    });

    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        name: "Usuario Teste",
        phone: "5511999999999",
      },
      update: {},
    });

    await bootstrapFinancialPlan(prisma, barbershopId);

    const recCat = await prisma.financialCategory.findFirst({
      where: { barbershopId, classification: "REVENUE", isActive: true, parentCategoryId: { not: null } },
    });
    const payCat = await prisma.financialCategory.findFirst({
      where: { barbershopId, classification: "FIXED_EXPENSE", isActive: true, parentCategoryId: { not: null } },
    });

    if (!recCat || !payCat) {
      throw new Error("Required seed categories not found.");
    }

    recCategoryId = recCat.id;
    payCategoryId = payCat.id;
  });

  describe("Settlement Creation & Idempotency", () => {
    it("creates a RECEIVABLE settlement with netCash > 0 and creates 1 MANUAL_IN FinancialEntry", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Mensalidade Cliente",
        originalAmount: "200.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      const idempotencyKey = "11111111-1111-4111-a111-111111111111";
      const { result, isReplay } = await createSettlement(
        barbershopId,
        title.id,
        userId,
        idempotencyKey,
        {
          principalAmount: "100.00",
          discountAmount: "10.00",
          interestAmount: "5.00",
          fineAmount: "0.00",
          method: "PIX",
          notes: "Liquidação parcial",
        }
      );

      expect(isReplay).toBe(false);
      expect(result.id).toBeDefined();
      expect(result.principalAmount.toFixed(2)).toBe("100.00");
      expect(result.discountAmount.toFixed(2)).toBe("10.00");

      // Verify FinancialEntry created
      const entry = await prisma.financialEntry.findUnique({
        where: { financialSettlementId_barbershopId: { financialSettlementId: result.id, barbershopId } },
      });
      expect(entry).not.toBeNull();
      expect(entry!.type).toBe("MANUAL_IN");
      expect(entry!.amount.toFixed(2)).toBe("95.00"); // 100 - 10 + 5 = 95.00
      expect(entry!.category).toBe("FINANCIAL_TITLE");
      expect(entry!.entryDate.getTime()).toBe(result.settledAt.getTime());

      // Verify event
      const event = await prisma.financialTitleEvent.findFirst({
        where: { titleId: title.id, type: "SETTLEMENT_CREATED" },
      });
      expect(event).not.toBeNull();
    });

    it("creates a PAYABLE settlement with netCash > 0 and creates 1 MANUAL_OUT FinancialEntry", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "PAYABLE",
        categoryId: payCategoryId,
        title: "Conta de Luz",
        originalAmount: "300.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      const idempotencyKey = "22222222-2222-4222-a222-222222222222";
      const { result } = await createSettlement(
        barbershopId,
        title.id,
        userId,
        idempotencyKey,
        {
          principalAmount: "300.00",
          method: "BOLETO",
        }
      );

      const entry = await prisma.financialEntry.findUnique({
        where: { financialSettlementId_barbershopId: { financialSettlementId: result.id, barbershopId } },
      });
      expect(entry).not.toBeNull();
      expect(entry!.type).toBe("MANUAL_OUT");
      expect(entry!.amount.toFixed(2)).toBe("-300.00");
    });

    it("allows zero-cash settlement (netCash = 0) with method null and creates NO FinancialEntry", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Perdão de Dívida",
        originalAmount: "100.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      const idempotencyKey = "33333333-3333-4333-a333-333333333333";
      const { result } = await createSettlement(
        barbershopId,
        title.id,
        userId,
        idempotencyKey,
        {
          principalAmount: "100.00",
          discountAmount: "100.00",
          method: null,
        }
      );

      expect(result.id).toBeDefined();

      const entry = await prisma.financialEntry.findUnique({
        where: { financialSettlementId_barbershopId: { financialSettlementId: result.id, barbershopId } },
      });
      expect(entry).toBeNull();
    });

    it("replays safely when same key and same canonical payload are sent", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Teste Replay",
        originalAmount: "100.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      const idempotencyKey = "44444444-4444-4444-a444-444444444444";
      const payload = {
        principalAmount: "50.00",
        method: "PIX",
      };

      const first = await createSettlement(barbershopId, title.id, userId, idempotencyKey, payload);
      expect(first.isReplay).toBe(false);

      const second = await createSettlement(barbershopId, title.id, userId, idempotencyKey, payload);
      expect(second.isReplay).toBe(true);
      expect(second.result.id).toBe(first.result.id);
    });

    it("rejects with 409 IDEMPOTENCY_KEY_REUSED when same key is sent with different payload", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Teste Mismatch",
        originalAmount: "100.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      const idempotencyKey = "55555555-5555-4555-a555-555555555555";
      await createSettlement(barbershopId, title.id, userId, idempotencyKey, {
        principalAmount: "50.00",
        method: "PIX",
      });

      await expect(
        createSettlement(barbershopId, title.id, userId, idempotencyKey, {
          principalAmount: "60.00", // Different principal
          method: "PIX",
        })
      ).rejects.toThrow("A chave de idempotência já foi utilizada com um payload diferente.");
    });

    it("blocks overpayment when principal exceeds outstanding balance", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Saldo Devedor",
        originalAmount: "100.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      await expect(
        createSettlement(
          barbershopId,
          title.id,
          userId,
          "66666666-6666-4666-a666-666666666666",
          { principalAmount: "150.00", method: "PIX" }
        )
      ).rejects.toThrow("excede o saldo devedor");
    });
  });

  describe("Reversals & Integrity Rules", () => {
    it("reverses a RECEIVABLE settlement and creates exact opposite MANUAL_OUT FinancialEntry", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Título a Estornar",
        originalAmount: "200.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      const settlementKey = "77777777-7777-4777-a777-777777777777";
      const { result: settlement } = await createSettlement(
        barbershopId,
        title.id,
        userId,
        settlementKey,
        { principalAmount: "100.00", method: "PIX" }
      );

      const reversalKey = "88888888-8888-4888-a888-888888888888";
      const { result: reversal, isReplay } = await reverseSettlement(
        barbershopId,
        settlement.id,
        userId,
        reversalKey,
        { reason: "Pagamento duplicado pelo cliente" }
      );

      expect(isReplay).toBe(false);
      expect(reversal.id).toBeDefined();

      // Verify reverse FinancialEntry
      const reverseEntry = await prisma.financialEntry.findUnique({
        where: {
          financialSettlementReversalId_barbershopId: {
            financialSettlementReversalId: reversal.id,
            barbershopId,
          },
        },
      });
      expect(reverseEntry).not.toBeNull();
      expect(reverseEntry!.type).toBe("MANUAL_OUT");
      expect(reverseEntry!.amount.toFixed(2)).toBe("-100.00");

      // Verify SETTLEMENT_REVERSED event
      const event = await prisma.financialTitleEvent.findFirst({
        where: { titleId: title.id, type: "SETTLEMENT_REVERSED" },
      });
      expect(event).not.toBeNull();
    });

    it("blocks double reversal on the same settlement", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Estorno Duplo",
        originalAmount: "100.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      const { result: settlement } = await createSettlement(
        barbershopId,
        title.id,
        userId,
        "99999999-9999-4999-a999-999999999999",
        { principalAmount: "100.00", method: "PIX" }
      );

      await reverseSettlement(
        barbershopId,
        settlement.id,
        userId,
        "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        { reason: "Primeiro estorno" }
      );

      await expect(
        reverseSettlement(
          barbershopId,
          settlement.id,
          userId,
          "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
          { reason: "Segundo estorno" }
        )
      ).rejects.toThrow("Esta liquidação já foi estornada anteriormente.");
    });

    it("fails closed (500) if original nonzero FinancialEntry is missing during reversal", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Entry Deletada",
        originalAmount: "100.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      const { result: settlement } = await createSettlement(
        barbershopId,
        title.id,
        userId,
        randomUUID(),
        { principalAmount: "100.00", method: "PIX" }
      );

      // Force delete original FinancialEntry to test Fail-Closed
      await prisma.financialEntry.deleteMany({
        where: { financialSettlementId: settlement.id },
      });

      await expect(
        reverseSettlement(
          barbershopId,
          settlement.id,
          userId,
          randomUUID(),
          { reason: "Estornar sem entry" }
        )
      ).rejects.toThrow("Lançamento de caixa original da liquidação não encontrado para estorno.");
    });
  });
});
