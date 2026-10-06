import { describe, expect, it, beforeEach, beforeAll, afterAll } from "vitest";
import { PrismaClient, Prisma, CommissionDisbursementMethod, ClubSubscriptionStatus } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import prisma from "@/lib/prisma";
import { bootstrapFinancialPlan } from "@/lib/financial/default-plan";
import { createTitle } from "@/lib/financial/titles";
import { createSettlement, reverseSettlement } from "@/lib/financial/settlements";
import { registerManualClubSubscriptionPayment } from "@/lib/operations/club";
import { createCommissionAdvance, reverseCommissionAdvance, executeCommissionPayout } from "@/lib/operations/commissions";
import { refundPayment, registerPayment } from "@/lib/operations/payments";
import {
  FinancialAllocationError,
  FINANCIAL_SYSTEM_KEYS,
  validateFinancialEntryAllocationSum,
} from "@/lib/financial/allocations";
import { toCents } from "@/lib/operations/money";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

function isIsolatedLocalTestDb(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const isTestPort = parsed.port === "55439";
    const isTestDb = parsed.pathname === "/match_barber_test";
    return isLocalhost && isTestPort && isTestDb;
  } catch {
    return false;
  }
}

const isSafe = isIsolatedLocalTestDb(TEST_DB_URL);

describe("Fase 6A — Financial Entry Allocations & System Mappings Integration Test Suite", () => {
  const shopAId = "fa6a0000-0000-4000-a000-000000000001";
  const shopBId = "fa6a0000-0000-4000-a000-000000000002";
  const userId = "fa6a0000-0000-4000-a000-000000000009";

  beforeEach(async () => {
    // Clean tables with TRUNCATE CASCADE to prevent FK errors when tests run in sequence
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "financial_entry_allocations",
        "financial_entries",
        "financial_settlement_reversals",
        "financial_settlements",
        "financial_title_events",
        "financial_titles",
        "commission_payable_items",
        "commission_cycle_adjustments",
        "commission_payouts",
        "commission_advance_reversals",
        "commission_advances",
        "commission_cycles",
        "tip_refunds",
        "tip_payout_reversals",
        "tip_payouts",
        "tip_entries",
        "customer_credit_entries",
        "customer_credit_accounts",
        "command_payments",
        "checkout_allocations",
        "checkout_transactions",
        "club_benefit_usages",
        "club_subscription_payments",
        "customer_club_subscriptions",
        "comanda_items",
        "appointment_services",
        "appointments",
        "comandas",
        "products",
        "services",
        "categories",
        "financial_category_system_mappings",
        "financial_categories",
        "barbershop_members",
        "users",
        "barbershops"
      CASCADE
    `);

    // Setup base barbershop & user
    await prisma.barbershop.create({
      data: {
        id: shopAId,
        name: "Barbearia Fase 6A Tenant A",
        slug: `shop-6a-a-${Date.now()}`,
        phone: "11999999999",
        zipCode: "00000000",
        street: "Rua A",
        number: "1",
        neighborhood: "Bairro A",
        city: "São Paulo",
        state: "SP",
      },
    });

    await prisma.barbershop.create({
      data: {
        id: shopBId,
        name: "Barbearia Fase 6A Tenant B",
        slug: `shop-6a-b-${Date.now()}`,
        phone: "11988888888",
        zipCode: "00000000",
        street: "Rua B",
        number: "2",
        neighborhood: "Bairro B",
        city: "São Paulo",
        state: "SP",
      },
    });

    await prisma.user.create({
      data: {
        id: userId,
        name: "Admin User Fase 6A",
        phone: "11977777777",
      },
    });

    await bootstrapFinancialPlan(prisma, shopAId);
    await bootstrapFinancialPlan(prisma, shopBId);
  });

  it("T1 — CLUB_REVENUE: cria FinancialEntry e FinancialEntryAllocation de 100% com mapping CLUB_REVENUE", async () => {
    const customer = await prisma.user.create({
      data: {
        name: "Cliente Clube 6A",
        phone: `1196${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });

    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: shopAId,
        name: "Plano VIP 6A",
        monthlyPrice: new Prisma.Decimal("150.00"),
        shopSharePercent: new Prisma.Decimal("100.00"),
        barberPoolPercent: new Prisma.Decimal("0.00"),
      },
    });

    const now = new Date();
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: shopAId,
        customerId: customer.id,
        clubPlanId: plan.id,
        status: ClubSubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
        gracePeriodEnd: new Date(now.getTime() + 37 * 86400000),
      },
    });

    const paymentRes = await registerManualClubSubscriptionPayment({
      barbershopId: shopAId,
      subscriptionId: sub.id,
      paymentMethod: "PIX",
    });

    expect(paymentRes.payment.status).toBe("PAID");

    const entry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, clubSubscriptionPaymentId: paymentRes.payment.id },
      include: { allocations: { include: { financialCategory: true } } },
    });

    expect(entry).toBeDefined();
    expect(entry?.type).toBe("CLUB_REVENUE");
    expect(toCents(entry?.amount)).toBe(15000);
    expect(entry?.allocations).toHaveLength(1);

    const alloc = entry?.allocations[0];
    expect(toCents(alloc?.allocatedAmount)).toBe(15000);
    expect(alloc?.financialCategory.code).toBe("01.03"); // Official club revenue code

    // Check sum invariant
    const sumResult = await validateFinancialEntryAllocationSum(prisma, shopAId, entry!.id);
    expect(sumResult.isValid).toBe(true);
  });

  it("T2 — COMMISSION_PAYOUT: cria allocation negativa com mapping COMMISSION_PAYOUT", async () => {
    const barberUser = await prisma.user.create({
      data: { name: "Barbeiro Payout 6A", phone: "11955555555" },
    });

    const member = await prisma.barbershopMember.create({
      data: { barbershopId: shopAId, userId: barberUser.id, role: "BARBER" },
    });

    const cycle = await prisma.commissionCycle.create({
      data: {
        barbershopId: shopAId,
        memberId: member.id,
        cycleNumber: 1,
        openedAt: new Date("2026-01-01"),
        status: "OPEN",
        grossCommission: new Prisma.Decimal("500.00"),
        remainingBalance: new Prisma.Decimal("500.00"),
      },
    });

    await prisma.commissionCycleAdjustment.create({
      data: {
        barbershopId: shopAId,
        cycleId: cycle.id,
        type: "CREDIT",
        amount: new Prisma.Decimal("500.00"),
        reason: "Crédito de teste para payout",
        createdById: userId,
      },
    });

    const payoutRes = await prisma.$transaction(async (tx) => {
      return await executeCommissionPayout(tx, {
        barbershopId: shopAId,
        memberId: member.id,
        cycleId: cycle.id,
        createdById: userId,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "22222222-2222-4222-a222-222222222222",
      });
    });

    const entry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, commissionPayoutId: payoutRes.payout.id },
      include: { allocations: { include: { financialCategory: true } } },
    });

    expect(entry).toBeDefined();
    expect(entry?.type).toBe("COMMISSION_PAYOUT");
    expect(toCents(entry?.amount)).toBe(-50000); // Negative liability settlement
    expect(entry?.allocations).toHaveLength(1);

    const alloc = entry?.allocations[0];
    expect(toCents(alloc?.allocatedAmount)).toBe(-50000);
    expect(alloc?.financialCategory.code).toBe("02.01"); // Commissions code

    const sumResult = await validateFinancialEntryAllocationSum(prisma, shopAId, entry!.id);
    expect(sumResult.isValid).toBe(true);
  });

  it("T3 — COMMISSION_ADVANCE: cria allocation negativa com mapping COMMISSION_ADVANCE", async () => {
    const barberUser = await prisma.user.create({
      data: { name: "Barbeiro Advance 6A", phone: "11944444444" },
    });

    const member = await prisma.barbershopMember.create({
      data: { barbershopId: shopAId, userId: barberUser.id, role: "BARBER" },
    });

    const cycle = await prisma.commissionCycle.create({
      data: {
        barbershopId: shopAId,
        memberId: member.id,
        cycleNumber: 1,
        openedAt: new Date("2026-01-01"),
        status: "OPEN",
        grossCommission: new Prisma.Decimal("300.00"),
        remainingBalance: new Prisma.Decimal("300.00"),
      },
    });

    await prisma.commissionCycleAdjustment.create({
      data: {
        barbershopId: shopAId,
        cycleId: cycle.id,
        type: "CREDIT",
        amount: new Prisma.Decimal("300.00"),
        reason: "Crédito para adiantamento",
        createdById: userId,
      },
    });

    const advanceRec = await prisma.$transaction(async (tx) => {
      return await createCommissionAdvance(tx, {
        barbershopId: shopAId,
        memberId: member.id,
        amount: "100.00",
        createdById: userId,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "33333333-3333-4333-a333-333333333333",
      });
    });

    const entry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, commissionAdvanceId: advanceRec.id },
      include: { allocations: { include: { financialCategory: true } } },
    });

    expect(entry).toBeDefined();
    expect(entry?.type).toBe("COMMISSION_ADVANCE");
    expect(toCents(entry?.amount)).toBe(-10000);
    expect(entry?.allocations).toHaveLength(1);

    const alloc = entry?.allocations[0];
    expect(toCents(alloc?.allocatedAmount)).toBe(-10000);
    expect(alloc?.financialCategory.code).toBe("02.02");

    const sumResult = await validateFinancialEntryAllocationSum(prisma, shopAId, entry!.id);
    expect(sumResult.isValid).toBe(true);
  });

  it("T4 — COMMISSION_ADVANCE_REVERSAL: cria allocation positiva com mapping COMMISSION_ADVANCE_REVERSAL", async () => {
    const barberUser = await prisma.user.create({
      data: { name: "Barbeiro Rev 6A", phone: "11933333333" },
    });

    const member = await prisma.barbershopMember.create({
      data: { barbershopId: shopAId, userId: barberUser.id, role: "BARBER" },
    });

    const cycle = await prisma.commissionCycle.create({
      data: {
        barbershopId: shopAId,
        memberId: member.id,
        cycleNumber: 1,
        openedAt: new Date("2026-01-01"),
        status: "OPEN",
        grossCommission: new Prisma.Decimal("300.00"),
        remainingBalance: new Prisma.Decimal("200.00"),
        advancesTotal: new Prisma.Decimal("100.00"),
      },
    });

    await prisma.commissionCycleAdjustment.create({
      data: {
        barbershopId: shopAId,
        cycleId: cycle.id,
        type: "CREDIT",
        amount: new Prisma.Decimal("300.00"),
        reason: "Crédito para adiantamento",
        createdById: userId,
      },
    });

    const advanceRec = await prisma.$transaction(async (tx) => {
      return await createCommissionAdvance(tx, {
        barbershopId: shopAId,
        memberId: member.id,
        amount: "100.00",
        createdById: userId,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "44444444-4444-4444-a444-444444444444",
      });
    });

    const reversalRec = await prisma.$transaction(async (tx) => {
      return await reverseCommissionAdvance(tx, {
        barbershopId: shopAId,
        advanceId: advanceRec.id,
        amount: "100.00",
        returnMethod: CommissionDisbursementMethod.PIX,
        createdById: userId,
        reason: "Estorno de teste 6A",
        idempotencyKey: "55555555-5555-4555-a555-555555555555",
      });
    });

    const entry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, commissionAdvanceReversalId: reversalRec.id },
      include: { allocations: { include: { financialCategory: true } } },
    });

    expect(entry).toBeDefined();
    expect(entry?.type).toBe("COMMISSION_ADVANCE_REVERSAL");
    expect(toCents(entry?.amount)).toBe(10000);
    expect(entry?.allocations).toHaveLength(1);

    const alloc = entry?.allocations[0];
    expect(toCents(alloc?.allocatedAmount)).toBe(10000);
    expect(alloc?.financialCategory.code).toBe("02.02");

    const sumResult = await validateFinancialEntryAllocationSum(prisma, shopAId, entry!.id);
    expect(sumResult.isValid).toBe(true);
  });

  it("T5 — REFUND: cria allocation negativa com mapping REFUND", async () => {
    const customer = await prisma.user.create({
      data: { name: "Cliente Refund 6A", phone: "11922222222" },
    });

    const category = await prisma.category.create({
      data: { barbershopId: shopAId, name: "Corte", slug: `corte-ref-${Date.now()}` },
    });

    const service = await prisma.service.create({
      data: { barbershopId: shopAId, categoryId: category.id, name: "Corte Teste", price: 80.0, durationMin: 30 },
    });

    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: shopAId,
        customerId: customer.id,
        customerName: customer.name,
        total: new Prisma.Decimal("80.00"),
        remainingTotal: new Prisma.Decimal("80.00"),
      },
    });

    await prisma.comandaItem.create({
      data: {
        barbershopId: shopAId,
        comandaId: comanda.id,
        type: "SERVICE",
        serviceId: service.id,
        description: service.name,
        unitPrice: new Prisma.Decimal("80.00"),
        total: new Prisma.Decimal("80.00"),
      },
    });

    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "80.00",
        userId,
        idempotencyKey: "66666666-6666-4666-a666-666666666666",
      });
    });

    const origPayment = await prisma.payment.findFirst({
      where: { barbershopId: shopAId, comandaId: comanda.id, method: "PIX" },
    });
    expect(origPayment).toBeDefined();

    await prisma.$transaction(async (tx) => {
      await refundPayment(tx, {
        barbershopId: shopAId,
        paymentId: origPayment!.id,
        amount: "80.00",
        reason: "Desistência do atendimento",
        userId,
        idempotencyKey: "77777777-7777-4777-a777-777777777777",
      });
    });

    const refundRec = await prisma.payment.findFirst({
      where: { barbershopId: shopAId, refundOfId: origPayment!.id },
    });

    expect(refundRec).toBeDefined();

    const entry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, paymentId: refundRec!.id },
      include: { allocations: { include: { financialCategory: true } } },
    });

    expect(entry).toBeDefined();
    expect(entry?.type).toBe("REFUND");
    expect(toCents(entry?.amount)).toBe(-8000);
    expect(entry?.allocations).toHaveLength(1);

    const alloc = entry?.allocations[0];
    expect(toCents(alloc?.allocatedAmount)).toBe(-8000);
    expect(alloc?.financialCategory.code).toBe("01.04"); // Official REFUND category code

    const sumResult = await validateFinancialEntryAllocationSum(prisma, shopAId, entry!.id);
    expect(sumResult.isValid).toBe(true);
  });

  it("T6 — FinancialTitle PAYABLE settlement: usa categoria do título e valor negativo", async () => {
    const payCat = await prisma.financialCategory.findFirst({
      where: { barbershopId: shopAId, code: "03.01" }, // Aluguel
    });
    expect(payCat).toBeDefined();

    const title = await createTitle(shopAId, userId, {
      kind: "PAYABLE",
      categoryId: payCat!.id,
      title: "Aluguel da Barbearia",
      originalAmount: "1800.00",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-10",
    });

    const settlement = await createSettlement(
      shopAId,
      title.id,
      userId,
      "88888888-8888-4888-a888-888888888888",
      {
        principalAmount: "1800.00",
        method: "PIX",
      }
    );

    const entry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, financialSettlementId: settlement.result.id },
      include: { allocations: { include: { financialCategory: true } } },
    });

    expect(entry).toBeDefined();
    expect(entry?.type).toBe("MANUAL_OUT");
    expect(toCents(entry?.amount)).toBe(-180000);
    expect(entry?.allocations).toHaveLength(1);

    const alloc = entry?.allocations[0];
    expect(alloc?.financialCategoryId).toBe(payCat!.id);
    expect(toCents(alloc?.allocatedAmount)).toBe(-180000);

    const sumResult = await validateFinancialEntryAllocationSum(prisma, shopAId, entry!.id);
    expect(sumResult.isValid).toBe(true);
  });

  it("T7 & T8 — FinancialTitle RECEIVABLE settlement e Reversal: preserva categoria e inverte sinal", async () => {
    const recCat = await prisma.financialCategory.findFirst({
      where: { barbershopId: shopAId, code: "01.01" }, // Serviços
    });
    expect(recCat).toBeDefined();

    const title = await createTitle(shopAId, userId, {
      kind: "RECEIVABLE",
      categoryId: recCat!.id,
      title: "Venda Corporativa",
      originalAmount: "500.00",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-15",
    });

    // Settlement (T7)
    const settlement = await createSettlement(
      shopAId,
      title.id,
      userId,
      "99999999-9999-4999-a999-999999999999",
      {
        principalAmount: "500.00",
        method: "PIX",
      }
    );

    const setEntry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, financialSettlementId: settlement.result.id },
      include: { allocations: true },
    });

    expect(toCents(setEntry?.amount)).toBe(50000);
    expect(setEntry?.allocations[0].financialCategoryId).toBe(recCat!.id);
    expect(toCents(setEntry?.allocations[0].allocatedAmount)).toBe(50000);

    // Reversal (T8)
    const reversal = await reverseSettlement(
      shopAId,
      settlement.result.id,
      userId,
      "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      { reason: "Lançamento duplicado por engano" }
    );

    const revEntry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, financialSettlementReversalId: reversal.result.id },
      include: { allocations: true },
    });

    expect(toCents(revEntry?.amount)).toBe(-50000);
    expect(revEntry?.allocations[0].financialCategoryId).toBe(recCat!.id);
    expect(toCents(revEntry?.allocations[0].allocatedAmount)).toBe(-50000);

    const sumResultSet = await validateFinancialEntryAllocationSum(prisma, shopAId, setEntry!.id);
    expect(sumResultSet.isValid).toBe(true);

    const sumResultRev = await validateFinancialEntryAllocationSum(prisma, shopAId, revEntry!.id);
    expect(sumResultRev.isValid).toBe(true);
  });

  it("T9 — Mapping Ausente: rollback atômico na transação sem FinancialEntry órfão", async () => {
    // Delete official CLUB_REVENUE mapping for Tenant A
    await prisma.financialCategorySystemMapping.delete({
      where: {
        barbershopId_systemKey: {
          barbershopId: shopAId,
          systemKey: FINANCIAL_SYSTEM_KEYS.CLUB_REVENUE,
        },
      },
    });

    const customer = await prisma.user.create({
      data: { name: "Cliente Rollback Test", phone: "11911111111" },
    });

    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: shopAId,
        name: "Plano Rollback",
        monthlyPrice: new Prisma.Decimal("100.00"),
        shopSharePercent: new Prisma.Decimal("100.00"),
        barberPoolPercent: new Prisma.Decimal("0.00"),
      },
    });

    const now = new Date();
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: shopAId,
        customerId: customer.id,
        clubPlanId: plan.id,
        status: ClubSubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
        gracePeriodEnd: new Date(now.getTime() + 37 * 86400000),
      },
    });

    await expect(
      registerManualClubSubscriptionPayment({
        barbershopId: shopAId,
        subscriptionId: sub.id,
        paymentMethod: "PIX",
      })
    ).rejects.toThrow(FinancialAllocationError);

    // Verify 0 orphan FinancialEntry or ClubSubscriptionPayment were created
    const entryCount = await prisma.financialEntry.count({
      where: { barbershopId: shopAId },
    });
    const paymentCount = await prisma.clubSubscriptionPayment.count({
      where: { barbershopId: shopAId },
    });

    expect(entryCount).toBe(0);
    expect(paymentCount).toBe(0);
  });

  it("T10 — Cross-Tenant Mapping / Category: rejeitado se categoria pertencer a outro tenant", async () => {
    // Get category from Tenant B
    const catB = await prisma.financialCategory.findFirst({
      where: { barbershopId: shopBId, code: "01.03" },
    });
    expect(catB).toBeDefined();

    // Verify that mapping category to another tenant is blocked by schema DB constraint or validateCategoryTenant
    const customer = await prisma.user.create({
      data: { name: "Cliente Cross Tenant", phone: "11900000000" },
    });

    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: shopAId,
        name: "Plano Cross Tenant",
        monthlyPrice: new Prisma.Decimal("100.00"),
        shopSharePercent: new Prisma.Decimal("100.00"),
        barberPoolPercent: new Prisma.Decimal("0.00"),
      },
    });

    const now = new Date();
    await prisma.customerClubSubscription.create({
      data: {
        barbershopId: shopAId,
        customerId: customer.id,
        clubPlanId: plan.id,
        status: ClubSubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
        gracePeriodEnd: new Date(now.getTime() + 37 * 86400000),
      },
    });

    // Directly updating mapping categoryId to catB.id fails composite FK constraint
    await expect(
      prisma.financialCategorySystemMapping.update({
        where: {
          barbershopId_systemKey: {
            barbershopId: shopAId,
            systemKey: FINANCIAL_SYSTEM_KEYS.CLUB_REVENUE,
          },
        },
        data: {
          categoryId: catB!.id,
        },
      })
    ).rejects.toThrow();
  });

  it("T11 — Replay / Idempotência: não duplica FinancialEntry nem FinancialEntryAllocation", async () => {
    const payCat = await prisma.financialCategory.findFirst({
      where: { barbershopId: shopAId, code: "03.01" },
    });

    const title = await createTitle(shopAId, userId, {
      kind: "PAYABLE",
      categoryId: payCat!.id,
      title: "Manutenção Ar Condicionado",
      originalAmount: "300.00",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-10",
    });

    const key = "b1111111-1111-4111-a111-111111111111";

    const res1 = await createSettlement(shopAId, title.id, userId, key, {
      principalAmount: "300.00",
      method: "PIX",
    });
    expect(res1.isReplay).toBe(false);

    const res2 = await createSettlement(shopAId, title.id, userId, key, {
      principalAmount: "300.00",
      method: "PIX",
    });
    expect(res2.isReplay).toBe(true);

    const entries = await prisma.financialEntry.findMany({
      where: { barbershopId: shopAId, financialSettlementId: res1.result.id },
    });
    expect(entries).toHaveLength(1);

    const allocations = await prisma.financialEntryAllocation.findMany({
      where: { barbershopId: shopAId, financialEntryId: entries[0].id },
    });
    expect(allocations).toHaveLength(1);
  });

  it("T12 — Invariante SUM(allocations) = FinancialEntry.amount em centavos", async () => {
    const recCat = await prisma.financialCategory.findFirst({
      where: { barbershopId: shopAId, code: "01.01" },
    });

    const title = await createTitle(shopAId, userId, {
      kind: "RECEIVABLE",
      categoryId: recCat!.id,
      title: "Serviço Avulso",
      originalAmount: "123.45",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-15",
    });

    const settlement = await createSettlement(
      shopAId,
      title.id,
      userId,
      "c1111111-1111-4111-a111-111111111111",
      {
        principalAmount: "123.45",
        method: "PIX",
      }
    );

    const entry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, financialSettlementId: settlement.result.id },
    });

    expect(entry).toBeDefined();

    const check = await validateFinancialEntryAllocationSum(prisma, shopAId, entry!.id);
    expect(check.isValid).toBe(true);
    expect(check.entryCents).toBe(12345);
    expect(check.sumAllocatedCents).toBe(12345);
  });
});

describe.runIf(isSafe)("Fase 6A — Prova em PostgreSQL Real (Rollback, Isolation, Atomicity)", () => {
  let realPrisma: PrismaClient;
  let pool: Pool;

  beforeAll(async () => {
    if (!isSafe) return;
    pool = new Pool({ connectionString: TEST_DB_URL });
    const adapter = new PrismaPg(pool);
    realPrisma = new PrismaClient({ adapter });
    await realPrisma.$connect();
  });

  afterAll(async () => {
    if (realPrisma) {
      await realPrisma.$disconnect();
    }
    if (pool) {
      await pool.end();
    }
  });

  it("POSTGRES_REAL_TENANT_ISOLATION: TENANT_A não usa mapping do TENANT_B", async () => {
    const time = Date.now();
    const shopA = await realPrisma.barbershop.create({
      data: {
        name: `Shop PG Real A ${time}`,
        slug: `shop-pg-a-${time}-${Math.floor(Math.random() * 10000)}`,
        phone: "11999999999",
        zipCode: "00000000",
        street: "Rua",
        number: "1",
        neighborhood: "B",
        city: "C",
        state: "SP",
      },
    });

    const shopB = await realPrisma.barbershop.create({
      data: {
        name: `Shop PG Real B ${time}`,
        slug: `shop-pg-b-${time}-${Math.floor(Math.random() * 10000)}`,
        phone: "11988888888",
        zipCode: "00000000",
        street: "Rua",
        number: "2",
        neighborhood: "B",
        city: "C",
        state: "SP",
      },
    });

    await bootstrapFinancialPlan(realPrisma, shopA.id);
    await bootstrapFinancialPlan(realPrisma, shopB.id);

    // Cross-tenant mapping attempt: map Tenant A's systemKey to Tenant B's category ID
    const catB = await realPrisma.financialCategory.findFirst({
      where: { barbershopId: shopB.id, code: "01.03" },
    });

    // Updating FK to category from another tenant must fail DB FK constraint
    await expect(
      realPrisma.financialCategorySystemMapping.update({
        where: { barbershopId_systemKey: { barbershopId: shopA.id, systemKey: FINANCIAL_SYSTEM_KEYS.CLUB_REVENUE } },
        data: { categoryId: catB!.id },
      })
    ).rejects.toThrow();
  });

  it("POSTGRES_REAL_ATOMICITY: Settlement cria entry + allocation atomicamente", async () => {
    const time = Date.now();
    const shop = await realPrisma.barbershop.create({
      data: {
        name: `Shop PG Settlement ${time}`,
        slug: `shop-pg-set-${time}-${Math.floor(Math.random() * 10000)}`,
        phone: "11999999999",
        zipCode: "00000000",
        street: "Rua",
        number: "1",
        neighborhood: "B",
        city: "C",
        state: "SP",
      },
    });

    const user = await realPrisma.user.create({
      data: { name: "PG Set User", phone: `1198${Math.floor(1000000 + Math.random() * 9000000)}` },
    });

    await bootstrapFinancialPlan(realPrisma, shop.id);

    const recCat = await realPrisma.financialCategory.findFirst({
      where: { barbershopId: shop.id, code: "01.01" },
    });

    const title = await createTitle(
      shop.id,
      user.id,
      {
        kind: "RECEIVABLE",
        categoryId: recCat!.id,
        title: "PG Real Title",
        originalAmount: "250.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      },
      realPrisma
    );

    const setRes = await createSettlement(
      shop.id,
      title.id,
      user.id,
      "d1111111-1111-4111-a111-111111111111",
      { principalAmount: "250.00", method: "PIX" },
      realPrisma
    );

    const entry = await realPrisma.financialEntry.findFirst({
      where: { barbershopId: shop.id, financialSettlementId: setRes.result.id },
      include: { allocations: true },
    });

    expect(entry).toBeDefined();
    expect(toCents(entry?.amount)).toBe(25000);
    expect(entry?.allocations).toHaveLength(1);
    expect(toCents(entry?.allocations[0].allocatedAmount)).toBe(25000);
  });
});
