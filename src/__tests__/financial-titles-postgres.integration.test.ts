/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, expect, it, beforeEach } from "vitest";
import prisma from "@/lib/prisma";
import { bootstrapFinancialPlan } from "@/lib/financial/default-plan";
import { cancelTitle, createTitle, updateTitle } from "@/lib/financial/titles";
import { createSettlement, reverseSettlement } from "@/lib/financial/settlements";

describe("Financial Titles PostgreSQL Integration & Concurrency Tests", () => {
  const barbershopId = "b1111111-1111-4111-a111-111111111111";
  const userId = "u1111111-1111-4111-a111-111111111111";

  let recCategoryId: string;

  beforeEach(async () => {
    // Safety check: ensure testing against test database
    const dbUrl = process.env.DATABASE_URL || "";
    if (dbUrl.includes("production") || dbUrl.includes("tembarber.com")) {
      throw new Error("CRITICAL SAFETY BLOCK: Integration tests must never run against production!");
    }

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
    if (!recCat) {
      throw new Error("Seed revenue category not found.");
    }
    recCategoryId = recCat.id;
  });

  it("A. CONCURRENT OVERPAYMENT: row locking prevents two concurrent settlements from overpaying", async () => {
    const title = await createTitle(barbershopId, userId, {
      kind: "RECEIVABLE",
      categoryId: recCategoryId,
      title: "Overpayment Concorrência",
      originalAmount: "100.00",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-15",
    });

    const key1 = "11111111-aaaa-4aaa-aaaa-111111111111";
    const key2 = "22222222-bbbb-4bbb-bbbb-222222222222";

    // Launch two parallel settlements of 70.00 each on a 100.00 title
    const results = await Promise.allSettled([
      createSettlement(barbershopId, title.id, userId, key1, { principalAmount: "70.00", method: "PIX" }),
      createSettlement(barbershopId, title.id, userId, key2, { principalAmount: "70.00", method: "PIX" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const activeSettlements = await prisma.financialSettlement.findMany({
      where: { titleId: title.id },
    });
    expect(activeSettlements.length).toBe(1);
    expect(activeSettlements[0].principalAmount.toFixed(2)).toBe("70.00");
  });

  it("B. SETTLEMENT VS CANCEL: row locking prevents inconsistent cancelled + active settlement state", async () => {
    const title = await createTitle(barbershopId, userId, {
      kind: "RECEIVABLE",
      categoryId: recCategoryId,
      title: "Cancel Race",
      originalAmount: "100.00",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-15",
    });

    const key = "33333333-3333-4333-a333-333333333333";

    const results = await Promise.allSettled([
      createSettlement(barbershopId, title.id, userId, key, { principalAmount: "100.00", method: "PIX" }),
      cancelTitle(barbershopId, title.id, userId, "Cancelar título"),
    ]);

    const titleAfter = await prisma.financialTitle.findUnique({
      where: { id: title.id },
      include: { settlements: true },
    });

    // Valid state: either title is cancelled with 0 settlements OR title has 1 settlement and cancelledAt is null
    if (titleAfter?.cancelledAt !== null) {
      expect(titleAfter?.settlements.length).toBe(0);
    } else {
      expect(titleAfter?.settlements.length).toBe(1);
    }
  });

  it("C. PATCH VS SETTLEMENT: row locking serializes title edit and settlement creation", async () => {
    const title = await createTitle(barbershopId, userId, {
      kind: "RECEIVABLE",
      categoryId: recCategoryId,
      title: "Patch Race",
      originalAmount: "100.00",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-15",
    });

    const key = "44444444-4444-4444-a444-444444444444";

    const results = await Promise.allSettled([
      updateTitle(barbershopId, title.id, userId, { title: "Patch Ganhou" }),
      createSettlement(barbershopId, title.id, userId, key, { principalAmount: "50.00", method: "PIX" }),
    ]);

    const titleAfter = await prisma.financialTitle.findUnique({
      where: { id: title.id },
      include: { settlements: true },
    });

    expect(titleAfter?.settlements.length).toBe(1);
  });

  it("D. SETTLEMENT ROLLBACK: transaction rollback leaves zero partial records", async () => {
    const title = await createTitle(barbershopId, userId, {
      kind: "RECEIVABLE",
      categoryId: recCategoryId,
      title: "Forced Rollback Test",
      originalAmount: "100.00",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-15",
    });

    const key = "55555555-5555-4555-a555-555555555555";

    try {
      await prisma.$transaction(async (tx) => {
        await createSettlement(barbershopId, title.id, userId, key, {
          principalAmount: "50.00",
          method: "PIX",
        }, tx);
        throw new Error("FORCED_TX_FAIL");
      });
    } catch (err: any) {
      expect(err.message).toBe("FORCED_TX_FAIL");
    }

    const settlements = await prisma.financialSettlement.findMany({ where: { titleId: title.id } });
    const entries = await prisma.financialEntry.findMany({ where: { barbershopId } });
    const events = await prisma.financialTitleEvent.findMany({ where: { titleId: title.id, type: "SETTLEMENT_CREATED" } });

    expect(settlements.length).toBe(0);
    expect(entries.length).toBe(0);
    expect(events.length).toBe(0);
  });

  it("E. REVERSAL ROLLBACK: transaction rollback leaves zero partial reversal records", async () => {
    const title = await createTitle(barbershopId, userId, {
      kind: "RECEIVABLE",
      categoryId: recCategoryId,
      title: "Reversal Rollback Test",
      originalAmount: "100.00",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-15",
    });

    const setKey = "66666666-6666-4666-a666-666666666666";
    const { result: settlement } = await createSettlement(barbershopId, title.id, userId, setKey, {
      principalAmount: "100.00",
      method: "PIX",
    });

    const revKey = "77777777-7777-4777-a777-777777777777";

    try {
      await prisma.$transaction(async (tx) => {
        await reverseSettlement(barbershopId, settlement.id, userId, revKey, {
          reason: "Erro forçado no estorno",
        }, tx);
        throw new Error("FORCED_REVERSAL_TX_FAIL");
      });
    } catch (err: any) {
      expect(err.message).toBe("FORCED_REVERSAL_TX_FAIL");
    }

    const reversals = await prisma.financialSettlementReversal.findMany({ where: { settlementId: settlement.id } });
    const revEntries = await prisma.financialEntry.findMany({ where: { financialSettlementReversalId: { not: null } } });

    expect(reversals.length).toBe(0);
    expect(revEntries.length).toBe(0);
  });

  it("F. CONCURRENT IDEMPOTENCY SAME PAYLOAD: exactly 1 creation and 1 replay", async () => {
    const title = await createTitle(barbershopId, userId, {
      kind: "RECEIVABLE",
      categoryId: recCategoryId,
      title: "Concurrent Idempotency Same",
      originalAmount: "100.00",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-15",
    });

    const key = "88888888-1111-4111-a111-888888888888";
    const payload = { principalAmount: "50.00", method: "PIX" };

    const results = await Promise.all([
      createSettlement(barbershopId, title.id, userId, key, payload),
      createSettlement(barbershopId, title.id, userId, key, payload),
    ]);

    const replays = results.filter((r) => r.isReplay);
    const newCreations = results.filter((r) => !r.isReplay);

    expect(newCreations.length).toBe(1);
    expect(replays.length).toBe(1);
    expect(newCreations[0].result.id).toBe(replays[0].result.id);

    const settlements = await prisma.financialSettlement.findMany({ where: { titleId: title.id } });
    expect(settlements.length).toBe(1);
  });

  it("G. CONCURRENT IDEMPOTENCY DIFFERENT PAYLOAD: exactly 1 creation and 1 409 error", async () => {
    const title = await createTitle(barbershopId, userId, {
      kind: "RECEIVABLE",
      categoryId: recCategoryId,
      title: "Concurrent Idempotency Diff",
      originalAmount: "100.00",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-15",
    });

    const key = "99999999-2222-4222-a222-999999999999";

    const results = await Promise.allSettled([
      createSettlement(barbershopId, title.id, userId, key, { principalAmount: "50.00", method: "PIX" }),
      createSettlement(barbershopId, title.id, userId, key, { principalAmount: "60.00", method: "PIX" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const settlements = await prisma.financialSettlement.findMany({ where: { titleId: title.id } });
    expect(settlements.length).toBe(1);
  });
});
