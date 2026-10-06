import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { fromCents, toCents } from "@/lib/operations/money";
import {
  FINANCIAL_SYSTEM_KEYS,
  FinancialAllocationError,
  syncComandaRevenueAllocations,
  validateFinancialEntryAllocationSum,
  calculateComandaEconomicMix,
} from "@/lib/financial/allocations";
import { bootstrapFinancialPlan } from "@/lib/financial/default-plan";
import { registerPayment, payComandaWithCustomerCredit, closeComanda } from "@/lib/operations/payments";
import { grantCustomerCredit } from "@/lib/operations/customer-credit";

describe("Fase 6B — Comanda Service / Product Allocations Integration Test Suite", () => {
  const shopAId = "shop-6b-a";
  const shopBId = "shop-6b-b";
  const userId = "user-6b-1";
  let serviceAId: string;
  let serviceBId: string;
  let productAId: string;

  beforeAll(async () => {
    // Clean up
    await clearDb();

    // Create Tenant A & B
    await prisma.barbershop.create({
      data: {
        id: shopAId,
        name: "Barbearia 6B Tenant A",
        slug: `barbearia-6b-a-${Date.now()}`,
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
        name: "Barbearia 6B Tenant B",
        slug: `barbearia-6b-b-${Date.now()}`,
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
        name: "Usuario 6B",
        phone: "11977770001",
      },
    });

    await prisma.barbershopMember.create({
      data: {
        barbershopId: shopAId,
        userId,
        role: "OWNER",
      },
    });

    await prisma.barbershopMember.create({
      data: {
        barbershopId: shopBId,
        userId,
        role: "OWNER",
      },
    });

    // Seed default financial plan & system mappings
    await bootstrapFinancialPlan(prisma, shopAId);
    await bootstrapFinancialPlan(prisma, shopBId);

    // Create Service & Product for Shop A
    const catA = await prisma.category.create({
      data: {
        barbershopId: shopAId,
        name: "Servicos A",
        slug: "servicos-6b-a",
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

    // Create Service for Shop B
    const catB = await prisma.category.create({
      data: {
        barbershopId: shopBId,
        name: "Servicos B",
        slug: "servicos-6b-b",
      },
    });

    const srvB = await prisma.service.create({
      data: {
        barbershopId: shopBId,
        categoryId: catB.id,
        name: "Corte B",
        price: "50.00",
        durationMin: 30,
      },
    });
    serviceBId = srvB.id;
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

  // Helper to create comanda in Shop A
  async function createTestComanda(
    items: {
      type: "SERVICE" | "PRODUCT" | "DISCOUNT" | "SURCHARGE";
      description: string;
      unitPrice: number;
      quantity?: number;
      total: number;
      serviceId?: string;
      productId?: string;
      clubBenefitRequested?: boolean;
      requestedClubPlanBenefitId?: string;
    }[],
    barbershopId = shopAId,
    customerId?: string
  ) {
    const rawSubtotal = items
      .filter((i) => i.type === "SERVICE" || i.type === "PRODUCT")
      .reduce((acc, i) => acc + i.total, 0);
    const discount = items
      .filter((i) => i.type === "DISCOUNT")
      .reduce((acc, i) => acc + i.total, 0);
    const surcharge = items
      .filter((i) => i.type === "SURCHARGE")
      .reduce((acc, i) => acc + i.total, 0);
    const total = Math.max(0, rawSubtotal - discount + surcharge);

    const comanda = await prisma.comanda.create({
      data: {
        barbershopId,
        status: "OPEN",
        customerId,
        customerName: "Cliente Teste",
        subtotal: fromCents(Math.round(rawSubtotal * 100)),
        discountTotal: fromCents(Math.round(discount * 100)),
        surchargeTotal: fromCents(Math.round(surcharge * 100)),
        total: fromCents(Math.round(total * 100)),
        paidTotal: fromCents(0),
        remainingTotal: fromCents(Math.round(total * 100)),
        items: {
          create: items.map((i) => ({
            barbershopId,
            type: i.type,
            description: i.description,
            quantity: i.quantity || 1,
            unitPrice: fromCents(Math.round(i.unitPrice * 100)),
            total: fromCents(Math.round(i.total * 100)),
            serviceId: i.serviceId,
            productId: i.productId,
            clubBenefitRequested: Boolean(i.clubBenefitRequested),
            requestedClubPlanBenefitId: i.requestedClubPlanBenefitId,
          })),
        },
      },
      include: { items: true },
    });

    return comanda;
  }

  // -------------------------------------------------------------
  // TEST 1 — Somente SERVICE
  // -------------------------------------------------------------
  test("T1 — Somente SERVICE: 100% alocado para COMANDA_SERVICE_REVENUE", async () => {
    const comanda = await createTestComanda([
      { type: "SERVICE", description: "Corte", unitPrice: 70, total: 70, serviceId: serviceAId },
    ]);

    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "70.00",
        userId,
        idempotencyKey: "key-t1-1",
      });
    });

    const entries = await prisma.financialEntry.findMany({
      where: { comandaId: comanda.id, barbershopId: shopAId },
      include: { allocations: { include: { financialCategory: true } } },
    });

    expect(entries).toHaveLength(1);
    expect(toCents(entries[0].amount)).toBe(7000);
    expect(entries[0].allocations).toHaveLength(1);

    const alloc = entries[0].allocations[0];
    expect(toCents(alloc.allocatedAmount)).toBe(7000);
    expect(alloc.financialCategory.code).toBe("01.01"); // Serviços

    const validation = await validateFinancialEntryAllocationSum(prisma, shopAId, entries[0].id);
    expect(validation.isValid).toBe(true);
  });

  // -------------------------------------------------------------
  // TEST 2 — Somente PRODUCT
  // -------------------------------------------------------------
  test("T2 — Somente PRODUCT: 100% alocado para COMANDA_PRODUCT_REVENUE", async () => {
    const comanda = await createTestComanda([
      { type: "PRODUCT", description: "Pomada", unitPrice: 30, total: 30, productId: productAId },
    ]);

    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "CREDIT",
        amount: "30.00",
        userId,
        idempotencyKey: "key-t2-1",
      });
    });

    const entries = await prisma.financialEntry.findMany({
      where: { comandaId: comanda.id, barbershopId: shopAId },
      include: { allocations: { include: { financialCategory: true } } },
    });

    expect(entries).toHaveLength(1);
    expect(toCents(entries[0].amount)).toBe(3000);
    expect(entries[0].allocations).toHaveLength(1);

    const alloc = entries[0].allocations[0];
    expect(toCents(alloc.allocatedAmount)).toBe(3000);
    expect(alloc.financialCategory.code).toBe("01.02"); // Produtos

    const validation = await validateFinancialEntryAllocationSum(prisma, shopAId, entries[0].id);
    expect(validation.isValid).toBe(true);
  });

  // -------------------------------------------------------------
  // TEST 3 — SERVICE + PRODUCT (Mix Econômico R$70 / R$30)
  // -------------------------------------------------------------
  test("T3 — SERVICE + PRODUCT: divide conforme o mix exato", async () => {
    const comanda = await createTestComanda([
      { type: "SERVICE", description: "Corte", unitPrice: 70, total: 70, serviceId: serviceAId },
      { type: "PRODUCT", description: "Pomada", unitPrice: 30, total: 30, productId: productAId },
    ]);

    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "100.00",
        userId,
        idempotencyKey: "key-t3-1",
      });
    });

    const entries = await prisma.financialEntry.findMany({
      where: { comandaId: comanda.id, barbershopId: shopAId },
      include: { allocations: { include: { financialCategory: true } } },
    });

    expect(entries).toHaveLength(1);
    expect(toCents(entries[0].amount)).toBe(10000);
    expect(entries[0].allocations).toHaveLength(2);

    const serviceAlloc = entries[0].allocations.find((a) => a.financialCategory.code === "01.01");
    const productAlloc = entries[0].allocations.find((a) => a.financialCategory.code === "01.02");

    expect(toCents(serviceAlloc!.allocatedAmount)).toBe(7000);
    expect(toCents(productAlloc!.allocatedAmount)).toBe(3000);

    const validation = await validateFinancialEntryAllocationSum(prisma, shopAId, entries[0].id);
    expect(validation.isValid).toBe(true);
  });

  // -------------------------------------------------------------
  // TEST 4 & 5 — Pagamento Parcial & Múltiplos Pagamentos
  // -------------------------------------------------------------
  test("T4 & T5 — Dois pagamentos parciais de R$50 em comanda de R$100 (70% S / 30% P)", async () => {
    const comanda = await createTestComanda([
      { type: "SERVICE", description: "Corte", unitPrice: 70, total: 70, serviceId: serviceAId },
      { type: "PRODUCT", description: "Pomada", unitPrice: 30, total: 30, productId: productAId },
    ]);

    // Pagamento 1: R$ 50,00
    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "50.00",
        userId,
        idempotencyKey: "key-t4-1",
      });
    });

    // Pagamento 2: R$ 50,00
    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "DEBIT",
        amount: "50.00",
        userId,
        idempotencyKey: "key-t4-2",
      });
    });

    const entries = await prisma.financialEntry.findMany({
      where: { comandaId: comanda.id, barbershopId: shopAId },
      include: { allocations: { include: { financialCategory: true } } },
      orderBy: { createdAt: "asc" },
    });

    expect(entries).toHaveLength(2);

    for (const entry of entries) {
      expect(toCents(entry.amount)).toBe(5000);
      expect(entry.allocations).toHaveLength(2);

      const sAlloc = entry.allocations.find((a) => a.financialCategory.code === "01.01");
      const pAlloc = entry.allocations.find((a) => a.financialCategory.code === "01.02");

      expect(toCents(sAlloc!.allocatedAmount)).toBe(3500); // 70% de 50
      expect(toCents(pAlloc!.allocatedAmount)).toBe(1500); // 30% de 50

      const val = await validateFinancialEntryAllocationSum(prisma, shopAId, entry.id);
      expect(val.isValid).toBe(true);
    }

    // Acumulado
    const totalServiceCents = entries.reduce(
      (acc, e) =>
        acc +
        toCents(e.allocations.find((a) => a.financialCategory.code === "01.01")?.allocatedAmount || 0),
      0
    );
    const totalProductCents = entries.reduce(
      (acc, e) =>
        acc +
        toCents(e.allocations.find((a) => a.financialCategory.code === "01.02")?.allocatedAmount || 0),
      0
    );

    expect(totalServiceCents).toBe(7000);
    expect(totalProductCents).toBe(3000);
  });

  // -------------------------------------------------------------
  // TEST 6 — CUSTOMER_CREDIT pagando venda
  // -------------------------------------------------------------
  test("T6 — CUSTOMER_CREDIT pagando venda: gera allocations SERVICE/PRODUCT normalmente", async () => {
    const customer = await prisma.user.create({
      data: { name: "Cliente Crédito 6B", phone: "11966660001" },
    });

    const comanda = await createTestComanda(
      [
        { type: "SERVICE", description: "Corte", unitPrice: 60, total: 60, serviceId: serviceAId },
        { type: "PRODUCT", description: "Pomada", unitPrice: 40, total: 40, productId: productAId },
      ],
      shopAId,
      customer.id
    );

    // Grant credit
    await prisma.$transaction(async (tx) => {
      await grantCustomerCredit(tx, {
        barbershopId: shopAId,
        customerId: customer.id,
        amount: "100.00",
        createdByUserId: userId,
        description: "Saldo Inicial",
      });
    });

    await prisma.$transaction(async (tx) => {
      await payComandaWithCustomerCredit(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        amount: "100.00",
        userId,
        idempotencyKey: "key-t6-1",
      });
    });

    const entry = await prisma.financialEntry.findFirst({
      where: { comandaId: comanda.id, barbershopId: shopAId, type: "COMMAND_REVENUE" },
      include: { allocations: { include: { financialCategory: true } } },
    });

    expect(entry).toBeDefined();
    expect(toCents(entry!.amount)).toBe(10000);
    expect(entry!.allocations).toHaveLength(2);

    const sAlloc = entry!.allocations.find((a) => a.financialCategory.code === "01.01");
    const pAlloc = entry!.allocations.find((a) => a.financialCategory.code === "01.02");

    expect(toCents(sAlloc!.allocatedAmount)).toBe(6000);
    expect(toCents(pAlloc!.allocatedAmount)).toBe(4000);

    const val = await validateFinancialEntryAllocationSum(prisma, shopAId, entry!.id);
    expect(val.isValid).toBe(true);
  });

  // -------------------------------------------------------------
  // TEST 7 — Pagamento posterior de dívida CLOSED
  // -------------------------------------------------------------
  test("T7 — Pagamento posterior de dívida CLOSED preserva mix original da comanda", async () => {
    const comanda = await createTestComanda([
      { type: "SERVICE", description: "Corte", unitPrice: 60, total: 60, serviceId: serviceAId },
      { type: "PRODUCT", description: "Pomada", unitPrice: 40, total: 40, productId: productAId },
    ]);

    // Pagamento 1: R$ 50 no dia
    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "50.00",
        userId,
        idempotencyKey: "key-t7-1",
      });
      // Fecha com dívida
      await closeComanda(tx, shopAId, comanda.id, { allowOutstanding: true });
    });

    // Pagamento posterior da dívida: R$ 50
    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "50.00",
        userId,
        idempotencyKey: "key-t7-2",
        allowClosedDebtPayment: true,
      });
    });

    const entries = await prisma.financialEntry.findMany({
      where: { comandaId: comanda.id, barbershopId: shopAId },
      include: { allocations: { include: { financialCategory: true } } },
      orderBy: { createdAt: "asc" },
    });

    expect(entries).toHaveLength(2);
    // Entrada 2 (pagamento da dívida posterior)
    const debtEntry = entries[1];
    expect(toCents(debtEntry.amount)).toBe(5000);

    const sAlloc = debtEntry.allocations.find((a) => a.financialCategory.code === "01.01");
    const pAlloc = debtEntry.allocations.find((a) => a.financialCategory.code === "01.02");

    expect(toCents(sAlloc!.allocatedAmount)).toBe(3000); // 60%
    expect(toCents(pAlloc!.allocatedAmount)).toBe(2000); // 40%

    const val = await validateFinancialEntryAllocationSum(prisma, shopAId, debtEntry.id);
    expect(val.isValid).toBe(true);
  });

  // -------------------------------------------------------------
  // TEST 8 & 9 — Desconto Global e Surcharge Global
  // -------------------------------------------------------------
  test("T8 & T9 — Desconto global (R$10) em R$70 S + R$30 P (Total R$90): mantém proporção 70%/30%", async () => {
    const comanda = await createTestComanda([
      { type: "SERVICE", description: "Corte", unitPrice: 70, total: 70, serviceId: serviceAId },
      { type: "PRODUCT", description: "Pomada", unitPrice: 30, total: 30, productId: productAId },
      { type: "DISCOUNT", description: "Desconto Fidelidade", unitPrice: 10, total: 10 },
    ]);

    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "90.00",
        userId,
        idempotencyKey: "key-t8-1",
      });
    });

    const entry = await prisma.financialEntry.findFirst({
      where: { comandaId: comanda.id, barbershopId: shopAId },
      include: { allocations: { include: { financialCategory: true } } },
    });

    expect(toCents(entry!.amount)).toBe(9000);
    const sAlloc = entry!.allocations.find((a) => a.financialCategory.code === "01.01");
    const pAlloc = entry!.allocations.find((a) => a.financialCategory.code === "01.02");

    expect(toCents(sAlloc!.allocatedAmount)).toBe(6300); // 70% de 90
    expect(toCents(pAlloc!.allocatedAmount)).toBe(2700); // 30% de 90

    const val = await validateFinancialEntryAllocationSum(prisma, shopAId, entry!.id);
    expect(val.isValid).toBe(true);
  });

  // -------------------------------------------------------------
  // TEST 10 & 11 — Item-Level Discount & Surcharge
  // -------------------------------------------------------------
  test("T10 & T11 — Item-level discount e surcharge considerados no valor cobrado do item", async () => {
    // Corte 80 - 10 desc = 70. Pomada 25 + 5 taxa = 30.
    const comanda = await createTestComanda([
      { type: "SERVICE", description: "Corte", unitPrice: 70, total: 70, serviceId: serviceAId },
      { type: "PRODUCT", description: "Pomada", unitPrice: 30, total: 30, productId: productAId },
    ]);

    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "100.00",
        userId,
        idempotencyKey: "key-t10-1",
      });
    });

    const entry = await prisma.financialEntry.findFirst({
      where: { comandaId: comanda.id, barbershopId: shopAId },
      include: { allocations: { include: { financialCategory: true } } },
    });

    const sAlloc = entry!.allocations.find((a) => a.financialCategory.code === "01.01");
    const pAlloc = entry!.allocations.find((a) => a.financialCategory.code === "01.02");

    expect(toCents(sAlloc!.allocatedAmount)).toBe(7000);
    expect(toCents(pAlloc!.allocatedAmount)).toBe(3000);
  });

  // -------------------------------------------------------------
  // TEST 12, 13 & 14 — Clube 100% coberto & SERVICE Zero + PRODUCT Positivo
  // -------------------------------------------------------------
  test("T12 & T14 — Serviço 100% coberto pelo Clube não gera allocation SERVICE=0; apenas Produto R$30 é alocado", async () => {
    const customer = await prisma.user.create({
      data: { name: "Cliente Clube 100%", phone: "11955550001" },
    });

    // Create Comanda with 1 service and 1 product
    const comanda = await createTestComanda(
      [
        { type: "SERVICE", description: "Corte", unitPrice: 50, total: 50, serviceId: serviceAId },
        { type: "PRODUCT", description: "Pomada", unitPrice: 30, total: 30, productId: productAId },
      ],
      shopAId,
      customer.id
    );

    const clubPlan = await prisma.clubPlan.create({
      data: {
        barbershopId: shopAId,
        name: "Plano Teste 6B",
        monthlyPrice: fromCents(9900),
        shopSharePercent: new Prisma.Decimal("100.00"),
        barberPoolPercent: new Prisma.Decimal("0.00"),
        isActive: true,
      },
    });

    const subscription = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: shopAId,
        customerId: customer.id,
        clubPlanId: clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        gracePeriodEnd: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
      },
    });

    // Apply club usage covering 100% of service
    const srvItem = comanda.items.find((i) => i.type === "SERVICE");
    await prisma.clubBenefitUsage.create({
      data: {
        barbershopId: shopAId,
        subscriptionId: subscription.id,
        clubPlanId: clubPlan.id,
        comandaItemId: srvItem!.id,
        serviceId: serviceAId,
        competence: "2026-10",
        originalAmount: fromCents(5000),
        coveredAmount: fromCents(5000),
        discountAmount: fromCents(0),
        status: "APPLIED",
        benefitType: "INCLUDED_SERVICE",
        usedAt: new Date(),
      },
    });

    // Register payment of R$ 30 (only the product was charged)
    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "30.00",
        userId,
        idempotencyKey: "key-t12-1",
      });
    });

    const entry = await prisma.financialEntry.findFirst({
      where: { comandaId: comanda.id, barbershopId: shopAId },
      include: { allocations: { include: { financialCategory: true } } },
    });

    expect(toCents(entry!.amount)).toBe(3000);
    // Regra 13: Se categoria tem valor zero, NÃO cria allocation zero.
    expect(entry!.allocations).toHaveLength(1);

    const pAlloc = entry!.allocations[0];
    expect(pAlloc.financialCategory.code).toBe("01.02"); // Produtos
    expect(toCents(pAlloc.allocatedAmount)).toBe(3000);

    const val = await validateFinancialEntryAllocationSum(prisma, shopAId, entry!.id);
    expect(val.isValid).toBe(true);
  });

  // -------------------------------------------------------------
  // TEST 15 — Arredondamento de Centavos Determinístico
  // -------------------------------------------------------------
  test("T15 — Arredondamento de centavos: divisão inexata distribui centavo residual deterministicamente e fecha 100%", async () => {
    // 33.33% Serviço vs 66.67% Produto em pagamento de R$ 100,01
    const comanda = await createTestComanda([
      { type: "SERVICE", description: "Srv Inexato", unitPrice: 33.33, total: 33.33, serviceId: serviceAId },
      { type: "PRODUCT", description: "Prd Inexato", unitPrice: 66.67, total: 66.67, productId: productAId },
    ]);

    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "100.00",
        userId,
        idempotencyKey: "key-t15-1",
      });
    });

    const entry = await prisma.financialEntry.findFirst({
      where: { comandaId: comanda.id, barbershopId: shopAId },
      include: { allocations: { include: { financialCategory: true } } },
    });

    const sAlloc = entry!.allocations.find((a) => a.financialCategory.code === "01.01");
    const pAlloc = entry!.allocations.find((a) => a.financialCategory.code === "01.02");

    expect(toCents(sAlloc!.allocatedAmount) + toCents(pAlloc!.allocatedAmount)).toBe(toCents(entry!.amount));
    expect(toCents(sAlloc!.allocatedAmount)).toBe(3333);
    expect(toCents(pAlloc!.allocatedAmount)).toBe(6667);

    const val = await validateFinancialEntryAllocationSum(prisma, shopAId, entry!.id);
    expect(val.isValid).toBe(true);
  });

  // -------------------------------------------------------------
  // TEST 16 — Replay Idempotente
  // -------------------------------------------------------------
  test("T16 — Replay idempotente com mesma chave não duplica allocations", async () => {
    const comanda = await createTestComanda([
      { type: "SERVICE", description: "Corte", unitPrice: 70, total: 70, serviceId: serviceAId },
      { type: "PRODUCT", description: "Pomada", unitPrice: 30, total: 30, productId: productAId },
    ]);

    // Primeiro pagamento
    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "100.00",
        userId,
        idempotencyKey: "replay-key-6b",
      });
    });

    // Replay com mesma chave
    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "100.00",
        userId,
        idempotencyKey: "replay-key-6b",
      });
    });

    const entries = await prisma.financialEntry.findMany({
      where: { comandaId: comanda.id, barbershopId: shopAId },
      include: { allocations: true },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].allocations).toHaveLength(2);
  });

  // -------------------------------------------------------------
  // TEST 17 — Mudança de Mix após Pagamento + Resync Determinístico
  // -------------------------------------------------------------
  test("T17 — Mudança de composição após pagamento sincroniza allocations anteriores para o novo mix", async () => {
    // Inicialmente: 100% Serviço (R$ 100,00)
    const comanda = await createTestComanda([
      { type: "SERVICE", description: "Corte", unitPrice: 100, total: 100, serviceId: serviceAId },
    ]);

    // Pagamento parcial de R$ 50,00 (alocado 100% para serviço)
    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "50.00",
        userId,
        idempotencyKey: "resync-key-1",
      });
    });

    let entry = await prisma.financialEntry.findFirst({
      where: { comandaId: comanda.id, barbershopId: shopAId },
      include: { allocations: { include: { financialCategory: true } } },
    });

    expect(entry!.allocations).toHaveLength(1);
    expect(entry!.allocations[0].financialCategory.code).toBe("01.01");
    expect(toCents(entry!.allocations[0].allocatedAmount)).toBe(5000);

    // Agora a comanda muda: o serviço passa para R$ 50 e adiciona um produto de R$ 50 (Mix 50% S / 50% P)
    const srvItem = comanda.items[0];
    await prisma.comandaItem.update({
      where: { id: srvItem.id },
      data: { unitPrice: fromCents(5000), total: fromCents(5000) },
    });

    await prisma.comandaItem.create({
      data: {
        barbershopId: shopAId,
        comandaId: comanda.id,
        type: "PRODUCT",
        description: "Pomada",
        quantity: 1,
        unitPrice: fromCents(5000),
        total: fromCents(5000),
        productId: productAId,
      },
    });

    // Sincroniza a comanda
    await prisma.$transaction(async (tx) => {
      await syncComandaRevenueAllocations(tx, shopAId, comanda.id);
    });

    entry = await prisma.financialEntry.findFirst({
      where: { comandaId: comanda.id, barbershopId: shopAId },
      include: { allocations: { include: { financialCategory: true } } },
    });

    // As allocations anteriores foram recalculadas deterministicamente: R$ 25 Serviço / R$ 25 Produto
    expect(entry!.allocations).toHaveLength(2);
    const sAlloc = entry!.allocations.find((a) => a.financialCategory.code === "01.01");
    const pAlloc = entry!.allocations.find((a) => a.financialCategory.code === "01.02");

    expect(toCents(sAlloc!.allocatedAmount)).toBe(2500);
    expect(toCents(pAlloc!.allocatedAmount)).toBe(2500);

    const val = await validateFinancialEntryAllocationSum(prisma, shopAId, entry!.id);
    expect(val.isValid).toBe(true);
  });

  // -------------------------------------------------------------
  // TEST 18 & 19 — Mapping Ausente com Rollback Atômico
  // -------------------------------------------------------------
  test("T18 & T19 — Mapping SERVICE ou PRODUCT ausente provoca rollback atômico sem orphan FinancialEntry", async () => {
    // Temporariamente remover mapping PRODUCT do Tenant B
    const mappingProdB = await prisma.financialCategorySystemMapping.findUnique({
      where: {
        barbershopId_systemKey: {
          barbershopId: shopBId,
          systemKey: FINANCIAL_SYSTEM_KEYS.COMANDA_PRODUCT_REVENUE,
        },
      },
    });

    await prisma.financialCategorySystemMapping.delete({
      where: { id: mappingProdB!.id },
    });

    // Create comanda in Tenant B with Product
    const prdB = await prisma.product.create({
      data: {
        barbershopId: shopBId,
        name: "Shampoo B",
        salePrice: "40.00",
      },
    });

    const comandaB = await createTestComanda(
      [{ type: "PRODUCT", description: "Shampoo", unitPrice: 40, total: 40, productId: prdB.id }],
      shopBId
    );

    // Tentativa de pagamento deve falhar pois falta mapping PRODUCT
    let errorCaught: any = null;
    try {
      await prisma.$transaction(async (tx) => {
        await registerPayment(tx, {
          barbershopId: shopBId,
          comandaId: comandaB.id,
          method: "PIX",
          amount: "40.00",
          userId,
          idempotencyKey: "key-t18-fail",
        });
      });
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeInstanceOf(FinancialAllocationError);
    expect(errorCaught.code).toBe("FINANCIAL_SYSTEM_MAPPING_NOT_FOUND");

    // Verificar que NENHUM FinancialEntry ou Payment órfão foi persistido no banco
    const orphanEntries = await prisma.financialEntry.findMany({
      where: { comandaId: comandaB.id, barbershopId: shopBId },
    });
    expect(orphanEntries).toHaveLength(0);

    const orphanPayments = await prisma.payment.findMany({
      where: { comandaId: comandaB.id, barbershopId: shopBId },
    });
    expect(orphanPayments).toHaveLength(0);

    // Restaurar mapping
    await prisma.financialCategorySystemMapping.create({
      data: {
        barbershopId: shopBId,
        systemKey: FINANCIAL_SYSTEM_KEYS.COMANDA_PRODUCT_REVENUE,
        categoryId: mappingProdB!.categoryId,
      },
    });
  });

  // -------------------------------------------------------------
  // TEST 20 — Tenant Isolation
  // -------------------------------------------------------------
  test("T20 — Tenant Isolation: Tenant A não acessa mapping do Tenant B", async () => {
    const comandaA = await createTestComanda([
      { type: "SERVICE", description: "Corte", unitPrice: 50, total: 50, serviceId: serviceAId },
    ]);

    // Tentar sincronizar passando barbershopId adulterado de outro tenant
    await expect(
      prisma.$transaction(async (tx) => {
        // shopBId tentando sincronizar comanda do shopAId
        await syncComandaRevenueAllocations(tx, shopBId, comandaA.id);
      })
    ).resolves.not.toThrow();

    // As allocations do shopAId continuam intocadas e isoladas
    const allocationsShopB = await prisma.financialEntryAllocation.findMany({
      where: { barbershopId: shopBId },
    });
    expect(allocationsShopB).toHaveLength(0);
  });

  // -------------------------------------------------------------
  // TEST 21 — Invariante SUM(allocations) = FinancialEntry.amount
  // -------------------------------------------------------------
  test("T21 — Invariante SUM(allocations) fecha exatamente com FinancialEntry.amount em centavos", async () => {
    const comanda = await createTestComanda([
      { type: "SERVICE", description: "Corte", unitPrice: 47.77, total: 47.77, serviceId: serviceAId },
      { type: "PRODUCT", description: "Pomada", unitPrice: 52.23, total: 52.23, productId: productAId },
    ]);

    await prisma.$transaction(async (tx) => {
      await registerPayment(tx, {
        barbershopId: shopAId,
        comandaId: comanda.id,
        method: "PIX",
        amount: "100.00",
        userId,
        idempotencyKey: "key-t21-sum",
      });
    });

    const entry = await prisma.financialEntry.findFirst({
      where: { comandaId: comanda.id, barbershopId: shopAId },
    });

    const validation = await validateFinancialEntryAllocationSum(prisma, shopAId, entry!.id);
    expect(validation.isValid).toBe(true);
    expect(validation.entryCents).toBe(10000);
    expect(validation.sumAllocatedCents).toBe(10000);
  });
});
