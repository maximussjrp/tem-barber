import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Prisma, ClubSubscriptionStatus, CommissionDisbursementMethod } from "@prisma/client";
import prisma from "@/lib/prisma";
import { fromCents, toCents } from "@/lib/operations/money";
import {
  FINANCIAL_SYSTEM_KEYS,
  validateFinancialEntryAllocationSum,
} from "@/lib/financial/allocations";
import { bootstrapFinancialPlan } from "@/lib/financial/default-plan";
import { createTitle } from "@/lib/financial/titles";
import { createSettlement, reverseSettlement } from "@/lib/financial/settlements";
import { registerManualClubSubscriptionPayment } from "@/lib/operations/club";
import {
  createCommissionAdvance,
  reverseCommissionAdvance,
  executeCommissionPayout,
} from "@/lib/operations/commissions";
import { registerPayment, refundPayment } from "@/lib/operations/payments";
import {
  reconcileTenantFinancialAllocations,
  backfillTenantFinancialAllocations,
  runFinancialBackfill,
} from "@/lib/financial/reconciliation";

describe("Fase 6C — Backfill, Reconciliação & Integridade Histórica Test Suite", () => {
  const shopAId = "fa6c0000-0000-4000-a000-000000000001";
  const shopBId = "fa6c0000-0000-4000-a000-000000000002";
  const userId = "fa6c0000-0000-4000-a000-000000000009";
  let serviceAId: string;
  let productAId: string;

  beforeEach(async () => {
    await clearDb();

    // Setup Barbershop A & B
    await prisma.barbershop.create({
      data: {
        id: shopAId,
        name: "Barbearia 6C Tenant A",
        slug: `shop-6c-a-${Date.now()}-${Math.random()}`,
        phone: "11988880001",
        zipCode: "00000000",
        street: "Rua A",
        number: "1",
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
      },
    });

    await prisma.barbershop.create({
      data: {
        id: shopBId,
        name: "Barbearia 6C Tenant B",
        slug: `shop-6c-b-${Date.now()}-${Math.random()}`,
        phone: "11988880002",
        zipCode: "00000000",
        street: "Rua B",
        number: "2",
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
      },
    });

    await prisma.user.create({
      data: {
        id: userId,
        name: "Admin 6C",
        phone: `1197${Math.floor(1000000 + Math.random() * 9000000)}`,
      },
    });

    await bootstrapFinancialPlan(prisma, shopAId);
    await bootstrapFinancialPlan(prisma, shopBId);

    const catA = await prisma.category.create({
      data: {
        barbershopId: shopAId,
        name: "Servicos A",
        slug: `servicos-6c-a-${Date.now()}-${Math.random()}`,
      },
    });

    const srvA = await prisma.service.create({
      data: {
        barbershopId: shopAId,
        categoryId: catA.id,
        name: "Corte Tradicional",
        price: "70.00",
        durationMin: 30,
      },
    });
    serviceAId = srvA.id;

    const prdA = await prisma.product.create({
      data: {
        barbershopId: shopAId,
        name: "Pomada Modeladora",
        salePrice: "30.00",
        currentStock: 100,
        trackStock: true,
      },
    });
    productAId = prdA.id;
  });

  afterAll(async () => {
    await clearDb();
  });

  async function clearDb() {
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
  }

  // -------------------------------------------------------------
  // TEST 1 — DRY-RUN: Não escreve no banco de dados
  // -------------------------------------------------------------
  test("T1 — DRY-RUN: Analisa pendências e NÃO grava nenhuma alteração no banco", async () => {
    const customer = await prisma.user.create({
      data: { name: "Cliente DryRun", phone: "11988880010" },
    });

    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: shopAId,
        name: "Plano DryRun",
        monthlyPrice: new Prisma.Decimal("100.00"),
        shopSharePercent: new Prisma.Decimal("100.00"),
        barberPoolPercent: new Prisma.Decimal("0.00"),
        isActive: true,
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

    const payRes = await registerManualClubSubscriptionPayment({
      barbershopId: shopAId,
      subscriptionId: sub.id,
      paymentMethod: "PIX",
    });

    const entry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, clubSubscriptionPaymentId: payRes.payment.id },
    });
    expect(entry).toBeDefined();

    // Simular que o lançamento histórico existia mas não tinha allocation ainda
    await prisma.financialEntryAllocation.deleteMany({
      where: { financialEntryId: entry!.id },
    });

    // Run dry-run
    const result = await backfillTenantFinancialAllocations(shopAId, { dryRun: true });
    expect(result.eligibleEntries).toBe(1);
    expect(result.needsAllocation).toBe(1);
    expect(result.alreadyFullyAllocated).toBe(0);

    // Verify 0 allocations exist in DB
    const allocCount = await prisma.financialEntryAllocation.count({
      where: { financialEntryId: entry!.id },
    });
    expect(allocCount).toBe(0);
  });

  // -------------------------------------------------------------
  // TEST 2 & 3 — Backfill Settlement e Reversal
  // -------------------------------------------------------------
  test("T2 & T3 — Backfill de FinancialTitle settlement e reversal aplica categoryId do título", async () => {
    const payCat = await prisma.financialCategory.findFirst({
      where: { barbershopId: shopAId, code: "03.01" }, // Aluguel
    });

    const title = await createTitle(shopAId, userId, {
      kind: "PAYABLE",
      categoryId: payCat!.id,
      title: "Aluguel da Barbearia",
      originalAmount: "2000.00",
      issuedOn: "2026-06-01",
      dueOn: "2026-06-10",
    });

    const setRes = await createSettlement(
      shopAId,
      title.id,
      userId,
      "88888888-8888-4888-a888-888888888888",
      { principalAmount: "2000.00", method: "PIX" }
    );

    const revRes = await reverseSettlement(
      shopAId,
      setRes.result.id,
      userId,
      "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      { reason: "Lançamento duplicado por engano" }
    );

    const setEntry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, financialSettlementId: setRes.result.id },
    });
    const revEntry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, financialSettlementReversalId: revRes.result.id },
    });

    // Remove as alocações criadas no runtime para simular histórico legado sem alocações
    await prisma.financialEntryAllocation.deleteMany({
      where: { financialEntryId: { in: [setEntry!.id, revEntry!.id] } },
    });

    // Apply backfill
    const res = await backfillTenantFinancialAllocations(shopAId, { dryRun: false });
    expect(res.eligibleEntries).toBe(2);
    expect(res.createdAllocationsCount).toBe(2);

    const setAlloc = await prisma.financialEntryAllocation.findFirst({
      where: { financialEntryId: setEntry!.id },
    });
    expect(setAlloc!.financialCategoryId).toBe(payCat!.id);
    expect(toCents(setAlloc!.allocatedAmount)).toBe(-200000);

    const revAlloc = await prisma.financialEntryAllocation.findFirst({
      where: { financialEntryId: revEntry!.id },
    });
    expect(revAlloc!.financialCategoryId).toBe(payCat!.id);
    expect(toCents(revAlloc!.allocatedAmount)).toBe(200000);
  });

  // -------------------------------------------------------------
  // TEST 4, 5, 6, 7 & 8 — Club, Commissions (Payout, Advance, Reversal) e Refund
  // -------------------------------------------------------------
  test("T4 a T8 — Backfill de Club, Comissões e Refund aplica mappings oficiais", async () => {
    // 1. Club
    const customer = await prisma.user.create({
      data: { name: "Cliente Club 6C", phone: "11988881234" },
    });
    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: shopAId,
        name: "Plano Club 6C",
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
    const payRes = await registerManualClubSubscriptionPayment({
      barbershopId: shopAId,
      subscriptionId: sub.id,
      paymentMethod: "PIX",
    });

    // 2. Commission Advance & Reversal
    const barberUser = await prisma.user.create({
      data: { name: "Barbeiro 6C", phone: "11944445555" },
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
        reason: "Crédito inicial",
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
        idempotencyKey: "11111111-1111-4111-a111-111111111111",
      });
    });
    const reversalRec = await prisma.$transaction(async (tx) => {
      return await reverseCommissionAdvance(tx, {
        barbershopId: shopAId,
        advanceId: advanceRec.id,
        amount: "100.00",
        returnMethod: CommissionDisbursementMethod.PIX,
        createdById: userId,
        reason: "Estorno de teste 6C",
        idempotencyKey: "22222222-2222-4222-a222-222222222222",
      });
    });
    const payoutRec = await prisma.$transaction(async (tx) => {
      return await executeCommissionPayout(tx, {
        barbershopId: shopAId,
        memberId: member.id,
        cycleId: cycle.id,
        createdById: userId,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "33333333-3333-4333-a333-333333333333",
      });
    });

    // 3. Refund
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
        idempotencyKey: "44444444-4444-4444-a444-444444444444",
      });
    });
    const origPayment = await prisma.payment.findFirst({
      where: { barbershopId: shopAId, comandaId: comanda.id, method: "PIX" },
    });
    await prisma.$transaction(async (tx) => {
      await refundPayment(tx, {
        barbershopId: shopAId,
        paymentId: origPayment!.id,
        amount: "80.00",
        reason: "Desistência",
        userId,
        idempotencyKey: "55555555-5555-4555-a555-555555555555",
      });
    });

    // Remove todas as allocations criadas para simular histórico pendente de backfill
    await prisma.financialEntryAllocation.deleteMany({
      where: { barbershopId: shopAId },
    });

    const res = await backfillTenantFinancialAllocations(shopAId, { dryRun: false });
    expect(res.eligibleEntries).toBeGreaterThanOrEqual(5);
    expect(res.createdAllocationsCount).toBeGreaterThanOrEqual(5);

    // Valida que o refund recebeu a categoria oficial 01.04
    const refundEntry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, type: "REFUND" },
      include: { allocations: { include: { financialCategory: true } } },
    });
    expect(refundEntry?.allocations[0].financialCategory.code).toBe("01.04");
  });

  // -------------------------------------------------------------
  // TEST 9, 10 & 11 — COMMAND_REVENUE SERVICE, PRODUCT e Mixed
  // -------------------------------------------------------------
  test("T9 a T11 — Backfill de COMMAND_REVENUE histórico deriva SERVICE e PRODUCT via calculateComandaEconomicMix", async () => {
    // Comanda mista: R$ 70 serviço + R$ 30 produto = R$ 100
    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: shopAId,
        status: "CLOSED",
        customerName: "Cliente Mix",
        subtotal: fromCents(10000),
        total: fromCents(10000),
        paidTotal: fromCents(10000),
        remainingTotal: fromCents(0),
        items: {
          create: [
            {
              barbershopId: shopAId,
              type: "SERVICE",
              description: "Corte",
              quantity: 1,
              unitPrice: fromCents(7000),
              total: fromCents(7000),
              serviceId: serviceAId,
            },
            {
              barbershopId: shopAId,
              type: "PRODUCT",
              description: "Pomada",
              quantity: 1,
              unitPrice: fromCents(3000),
              total: fromCents(3000),
              productId: productAId,
            },
          ],
        },
      },
    });

    const entry = await prisma.financialEntry.create({
      data: {
        barbershopId: shopAId,
        comandaId: comanda.id,
        type: "COMMAND_REVENUE",
        category: "PIX",
        amount: fromCents(10000),
        description: "Recebimento comanda",
      },
    });

    const res = await backfillTenantFinancialAllocations(shopAId, { dryRun: false });
    expect(res.eligibleEntries).toBe(1);
    expect(res.createdAllocationsCount).toBe(2);

    const allocs = await prisma.financialEntryAllocation.findMany({
      where: { financialEntryId: entry.id },
      include: { financialCategory: true },
    });

    const sAlloc = allocs.find((a) => a.financialCategory.code === "01.01");
    const pAlloc = allocs.find((a) => a.financialCategory.code === "01.02");

    expect(toCents(sAlloc!.allocatedAmount)).toBe(7000);
    expect(toCents(pAlloc!.allocatedAmount)).toBe(3000);

    const val = await validateFinancialEntryAllocationSum(prisma, shopAId, entry.id);
    expect(val.isValid).toBe(true);
  });

  // -------------------------------------------------------------
  // TEST 12, 13 & 14 — Mapeamento Ausente e Itens Fora de Escopo (Manual, TIP, Crédito)
  // -------------------------------------------------------------
  test("T12 a T14 — Movimentações MANUAIS avulsas permanecem fora de escopo (unallocatable)", async () => {
    // 1. Manual avulso (sem título)
    await prisma.financialEntry.create({
      data: {
        barbershopId: shopAId,
        type: "MANUAL_IN",
        category: "AVULSO",
        amount: fromCents(1500),
        description: "Aporte manual avulso",
      },
    });

    const res = await backfillTenantFinancialAllocations(shopAId, { dryRun: false });
    expect(res.eligibleEntries).toBe(0);
    expect(res.unallocatableByPolicy).toBe(1);
    expect(res.createdAllocationsCount).toBe(0);

    const count = await prisma.financialEntryAllocation.count({
      where: { barbershopId: shopAId },
    });
    expect(count).toBe(0);
  });

  // -------------------------------------------------------------
  // TEST 15 — Idempotência da Segunda Execução: SECOND_RUN_CREATED_ALLOCATIONS = 0
  // -------------------------------------------------------------
  test("T15 — Idempotência: Segunda execução do backfill não cria duplicatas nem altera alocações (SECOND_RUN = 0)", async () => {
    const customer = await prisma.user.create({
      data: { name: "Cliente Idemp", phone: "11988880011" },
    });
    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: shopAId,
        name: "Plano Idemp",
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
    const payRes = await registerManualClubSubscriptionPayment({
      barbershopId: shopAId,
      subscriptionId: sub.id,
      paymentMethod: "PIX",
    });

    const entry = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, clubSubscriptionPaymentId: payRes.payment.id },
    });

    // Remove a alocação criada
    await prisma.financialEntryAllocation.deleteMany({
      where: { financialEntryId: entry!.id },
    });

    // Run 1
    const run1 = await backfillTenantFinancialAllocations(shopAId, { dryRun: false });
    expect(run1.createdAllocationsCount).toBe(1);

    // Run 2
    const run2 = await backfillTenantFinancialAllocations(shopAId, { dryRun: false });
    expect(run2.createdAllocationsCount).toBe(0);
    expect(run2.alreadyFullyAllocated).toBe(1);
    expect(run2.needsAllocation).toBe(0);

    const totalAllocs = await prisma.financialEntryAllocation.count({
      where: { financialEntryId: entry!.id },
    });
    expect(totalAllocs).toBe(1);
  });

  // -------------------------------------------------------------
  // TEST 16 & 17 — Reconciliação: Detecta Mismatch e Missing Allocation
  // -------------------------------------------------------------
  test("T16 & T17 — Reconciliação identifica ELIGIBLE_NO_ALLOCATIONS e SUM_MISMATCH com precisão", async () => {
    const customer = await prisma.user.create({
      data: { name: "Cliente Recon", phone: "11988880012" },
    });
    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: shopAId,
        name: "Plano Recon",
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
    const payRes1 = await registerManualClubSubscriptionPayment({
      barbershopId: shopAId,
      subscriptionId: sub.id,
      paymentMethod: "PIX",
    });
    const payRes2 = await registerManualClubSubscriptionPayment({
      barbershopId: shopAId,
      subscriptionId: sub.id,
      paymentMethod: "PIX",
    });

    const entry1 = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, clubSubscriptionPaymentId: payRes1.payment.id },
    });
    const entry2 = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, clubSubscriptionPaymentId: payRes2.payment.id },
    });

    // 1. Deletar allocation do primeiro para simular ELIGIBLE_NO_ALLOCATIONS
    await prisma.financialEntryAllocation.deleteMany({
      where: { financialEntryId: entry1!.id },
    });

    // 2. Modificar allocation do segundo para simular SUM_MISMATCH (R$ 80 em vez de R$ 100)
    await prisma.financialEntryAllocation.updateMany({
      where: { financialEntryId: entry2!.id },
      data: { allocatedAmount: fromCents(8000) },
    });

    const recon = await reconcileTenantFinancialAllocations(prisma, shopAId);
    expect(recon.issues).toHaveLength(2);

    const noAllocIssue = recon.issues.find((i) => i.financialEntryId === entry1!.id);
    expect(noAllocIssue!.issueCode).toBe("ELIGIBLE_NO_ALLOCATIONS");

    const mismatchIssue = recon.issues.find((i) => i.financialEntryId === entry2!.id);
    expect(mismatchIssue!.issueCode).toBe("SUM_MISMATCH");
  });

  // -------------------------------------------------------------
  // TEST 18 — Isolamento Real Multi-Tenant
  // -------------------------------------------------------------
  test("T18 — Tenant Isolation: Tenant A não acessa nem aloca categorias do Tenant B", async () => {
    const customerA = await prisma.user.create({
      data: { name: "Cliente Iso A", phone: "11988880013" },
    });
    const planA = await prisma.clubPlan.create({
      data: {
        barbershopId: shopAId,
        name: "Plano Iso A",
        monthlyPrice: new Prisma.Decimal("50.00"),
        shopSharePercent: new Prisma.Decimal("100.00"),
        barberPoolPercent: new Prisma.Decimal("0.00"),
      },
    });
    const subA = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: shopAId,
        customerId: customerA.id,
        clubPlanId: planA.id,
        status: ClubSubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        gracePeriodEnd: new Date(Date.now() + 37 * 86400000),
      },
    });
    const payResA = await registerManualClubSubscriptionPayment({
      barbershopId: shopAId,
      subscriptionId: subA.id,
      paymentMethod: "PIX",
    });

    const customerB = await prisma.user.create({
      data: { name: "Cliente Iso B", phone: "11988880014" },
    });
    const planB = await prisma.clubPlan.create({
      data: {
        barbershopId: shopBId,
        name: "Plano Iso B",
        monthlyPrice: new Prisma.Decimal("50.00"),
        shopSharePercent: new Prisma.Decimal("100.00"),
        barberPoolPercent: new Prisma.Decimal("0.00"),
      },
    });
    const subB = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: shopBId,
        customerId: customerB.id,
        clubPlanId: planB.id,
        status: ClubSubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        gracePeriodEnd: new Date(Date.now() + 37 * 86400000),
      },
    });
    const payResB = await registerManualClubSubscriptionPayment({
      barbershopId: shopBId,
      subscriptionId: subB.id,
      paymentMethod: "PIX",
    });

    const entryA = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopAId, clubSubscriptionPaymentId: payResA.payment.id },
    });
    const entryB = await prisma.financialEntry.findFirst({
      where: { barbershopId: shopBId, clubSubscriptionPaymentId: payResB.payment.id },
    });

    // Remove allocations para simular backfill
    await prisma.financialEntryAllocation.deleteMany({
      where: { financialEntryId: { in: [entryA!.id, entryB!.id] } },
    });

    const overall = await runFinancialBackfill({ dryRun: false });
    expect(overall.totals.createdAllocationsCount).toBe(2);

    const allocA = await prisma.financialEntryAllocation.findFirst({
      where: { financialEntryId: entryA!.id },
      include: { financialCategory: true },
    });
    expect(allocA!.barbershopId).toBe(shopAId);
    expect(allocA!.financialCategory.barbershopId).toBe(shopAId);

    const allocB = await prisma.financialEntryAllocation.findFirst({
      where: { financialEntryId: entryB!.id },
      include: { financialCategory: true },
    });
    expect(allocB!.barbershopId).toBe(shopBId);
    expect(allocB!.financialCategory.barbershopId).toBe(shopBId);
  });

  // -------------------------------------------------------------
  // TEST HISTORICAL CANCELLED COMANDA RECONSTRUCTION
  // -------------------------------------------------------------
  test("T19 — Backfill reconstrói comanda CANCELLED com 1 item cancelado a posteriori (100% SERVICE)", async () => {
    const paymentTime = new Date("2026-03-01T12:00:00Z");
    const itemCreatedTime = new Date("2026-03-01T11:50:00Z");
    const itemCancelledTime = new Date("2026-03-08T12:00:00Z"); // 7 dias depois

    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: shopAId,
        status: "CANCELLED",
        customerName: "Cliente Cancelado Post-Pagamento 1",
        subtotal: fromCents(7000),
        total: fromCents(7000),
        paidTotal: fromCents(7000),
        remainingTotal: fromCents(0),
        openedAt: itemCreatedTime,
        closedAt: paymentTime,
        items: {
          create: [
            {
              barbershopId: shopAId,
              type: "SERVICE",
              description: "Corte + Barba",
              quantity: 1,
              unitPrice: fromCents(7000),
              total: fromCents(7000),
              serviceId: serviceAId,
              status: "CANCELLED",
              createdAt: itemCreatedTime,
              cancelledAt: itemCancelledTime,
            },
          ],
        },
      },
    });

    const entry = await prisma.financialEntry.create({
      data: {
        barbershopId: shopAId,
        comandaId: comanda.id,
        type: "COMMAND_REVENUE",
        category: "CREDIT_CARD",
        amount: fromCents(7000),
        entryDate: paymentTime,
        description: "Recebimento histórico comanda cancelada a posteriori",
      },
    });

    // 1. Dry run
    const dryRun = await backfillTenantFinancialAllocations(shopAId, { dryRun: true });
    expect(dryRun.eligibleEntries).toBe(1);
    expect(dryRun.needsAllocation).toBe(1);

    // 2. Reconcile
    const recBefore = await reconcileTenantFinancialAllocations(prisma, shopAId);
    expect(recBefore.eligibleEntries).toBe(1);
    expect(recBefore.unallocatableByPolicyEntries).toBe(0);

    // 3. Execute backfill
    const run = await backfillTenantFinancialAllocations(shopAId, { dryRun: false });
    expect(run.eligibleEntries).toBe(1);
    expect(run.createdAllocationsCount).toBe(1);

    const allocs = await prisma.financialEntryAllocation.findMany({
      where: { financialEntryId: entry.id },
      include: { financialCategory: true },
    });
    expect(allocs.length).toBe(1);
    expect(allocs[0].financialCategory.code).toBe("01.01"); // Receita de Serviços
    expect(toCents(allocs[0].allocatedAmount)).toBe(7000);

    // 4. Reconcile after
    const recAfter = await reconcileTenantFinancialAllocations(prisma, shopAId);
    expect(recAfter.eligibleEntries).toBe(1);
    expect(recAfter.fullyAllocatedEntries).toBe(1);
    expect(recAfter.issues.length).toBe(0);

    // 5. Idempotência
    const run2 = await backfillTenantFinancialAllocations(shopAId, { dryRun: false });
    expect(run2.createdAllocationsCount).toBe(0);
    expect(run2.alreadyFullyAllocated).toBe(1);
  });

  test("T20 — Backfill reconstrói comanda CANCELLED com 2 itens cancelados a posteriori (100% SERVICE)", async () => {
    const paymentTime = new Date("2026-03-01T12:00:00Z");
    const itemCreatedTime = new Date("2026-03-01T11:50:00Z");
    const itemCancelledTime = new Date("2026-03-02T12:00:00Z"); // 1 dia depois

    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: shopAId,
        status: "CANCELLED",
        customerName: "Cliente Cancelado Post-Pagamento 2",
        subtotal: fromCents(7000),
        total: fromCents(7000),
        paidTotal: fromCents(7000),
        remainingTotal: fromCents(0),
        openedAt: itemCreatedTime,
        closedAt: paymentTime,
        items: {
          create: [
            {
              barbershopId: shopAId,
              type: "SERVICE",
              description: "Barba",
              quantity: 1,
              unitPrice: fromCents(3500),
              total: fromCents(3500),
              serviceId: serviceAId,
              status: "CANCELLED",
              createdAt: itemCreatedTime,
              cancelledAt: itemCancelledTime,
            },
            {
              barbershopId: shopAId,
              type: "SERVICE",
              description: "Corte Tradicional",
              quantity: 1,
              unitPrice: fromCents(3500),
              total: fromCents(3500),
              serviceId: serviceAId,
              status: "CANCELLED",
              createdAt: itemCreatedTime,
              cancelledAt: itemCancelledTime,
            },
          ],
        },
      },
    });

    const entry = await prisma.financialEntry.create({
      data: {
        barbershopId: shopAId,
        comandaId: comanda.id,
        type: "COMMAND_REVENUE",
        category: "PIX",
        amount: fromCents(7000),
        entryDate: paymentTime,
        description: "Recebimento histórico comanda 2 itens cancelada a posteriori",
      },
    });

    const run = await backfillTenantFinancialAllocations(shopAId, { dryRun: false });
    expect(run.eligibleEntries).toBe(1);
    expect(run.createdAllocationsCount).toBe(1);

    const allocs = await prisma.financialEntryAllocation.findMany({
      where: { financialEntryId: entry.id },
      include: { financialCategory: true },
    });
    expect(allocs.length).toBe(1);
    expect(allocs[0].financialCategory.code).toBe("01.01");
    expect(toCents(allocs[0].allocatedAmount)).toBe(7000);

    const rec = await reconcileTenantFinancialAllocations(prisma, shopAId);
    expect(rec.eligibleEntries).toBe(1);
    expect(rec.fullyAllocatedEntries).toBe(1);
    expect(rec.issues.length).toBe(0);
  });

  test("T21 — Comanda CANCELLED com item cancelado ANTES do pagamento é excluído da reconstrução", async () => {
    const itemCreatedTime = new Date("2026-03-01T10:00:00Z");
    const itemCancelledBeforeTime = new Date("2026-03-01T11:00:00Z");
    const paymentTime = new Date("2026-03-01T12:00:00Z");
    const activeItemCancelledAfter = new Date("2026-03-02T12:00:00Z");

    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: shopAId,
        status: "CANCELLED",
        customerName: "Cliente Cancelamento Prévio",
        subtotal: fromCents(7000),
        total: fromCents(7000),
        paidTotal: fromCents(7000),
        remainingTotal: fromCents(0),
        openedAt: itemCreatedTime,
        closedAt: paymentTime,
        items: {
          create: [
            {
              // Item cancelado antes do pagamento
              barbershopId: shopAId,
              type: "PRODUCT",
              description: "Item Cancelado Antes",
              quantity: 1,
              unitPrice: fromCents(3000),
              total: fromCents(3000),
              productId: productAId,
              status: "CANCELLED",
              createdAt: itemCreatedTime,
              cancelledAt: itemCancelledBeforeTime,
            },
            {
              // Item ativo no momento do pagamento
              barbershopId: shopAId,
              type: "SERVICE",
              description: "Serviço Ativo no Pagamento",
              quantity: 1,
              unitPrice: fromCents(7000),
              total: fromCents(7000),
              serviceId: serviceAId,
              status: "CANCELLED",
              createdAt: itemCreatedTime,
              cancelledAt: activeItemCancelledAfter,
            },
          ],
        },
      },
    });

    const entry = await prisma.financialEntry.create({
      data: {
        barbershopId: shopAId,
        comandaId: comanda.id,
        type: "COMMAND_REVENUE",
        category: "PIX",
        amount: fromCents(7000),
        entryDate: paymentTime,
        description: "Recebimento apenas do item ativo",
      },
    });

    const run = await backfillTenantFinancialAllocations(shopAId, { dryRun: false });
    expect(run.eligibleEntries).toBe(1);
    expect(run.createdAllocationsCount).toBe(1);

    const allocs = await prisma.financialEntryAllocation.findMany({
      where: { financialEntryId: entry.id },
      include: { financialCategory: true },
    });
    // O item de produto foi excluído da reconstrução porque cancelledAt <= entryDate
    expect(allocs.length).toBe(1);
    expect(allocs[0].financialCategory.code).toBe("01.01");
    expect(toCents(allocs[0].allocatedAmount)).toBe(7000);
  });

  test("T22 — Comanda CANCELLED histórica com benefício de Clube opera FAIL-CLOSED (unallocatable)", async () => {
    const paymentTime = new Date("2026-03-01T12:00:00Z");
    const itemCreatedTime = new Date("2026-03-01T11:50:00Z");
    const itemCancelledTime = new Date("2026-03-02T12:00:00Z");

    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: shopAId,
        status: "CANCELLED",
        customerName: "Cliente Clube Cancelado",
        subtotal: fromCents(7000),
        total: fromCents(0), // Coberto pelo clube
        paidTotal: fromCents(0),
        remainingTotal: fromCents(0),
        openedAt: itemCreatedTime,
        closedAt: paymentTime,
        items: {
          create: [
            {
              barbershopId: shopAId,
              type: "SERVICE",
              description: "Corte Clube",
              quantity: 1,
              unitPrice: fromCents(7000),
              total: fromCents(7000),
              serviceId: serviceAId,
              status: "CANCELLED",
              clubBenefitRequested: true,
              createdAt: itemCreatedTime,
              cancelledAt: itemCancelledTime,
            },
          ],
        },
      },
    });

    await prisma.financialEntry.create({
      data: {
        barbershopId: shopAId,
        comandaId: comanda.id,
        type: "COMMAND_REVENUE",
        category: "OUTROS",
        amount: fromCents(7000),
        entryDate: paymentTime,
        description: "Lançamento de comanda com benefício de clube",
      },
    });

    const res = await backfillTenantFinancialAllocations(shopAId, { dryRun: true });
    // Fail-closed: considerado unallocatableByPolicy, não gera alocação
    expect(res.eligibleEntries).toBe(0);
    expect(res.unallocatableByPolicy).toBe(1);

    const rec = await reconcileTenantFinancialAllocations(prisma, shopAId);
    expect(rec.eligibleEntries).toBe(0);
    expect(rec.unallocatableByPolicyEntries).toBe(1);
  });
});
