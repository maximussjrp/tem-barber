import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  testDatabaseUrl &&
  /match_barber_test|localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) &&
  !/prod|production/i.test(testDatabaseUrl);
const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;
let clubOps: typeof import("@/lib/operations/club");

async function truncateDatabase() {
  if (!testDatabaseUrl) {
    throw new Error("TRUNCATE_FAILED: TEST_DATABASE_URL is not set.");
  }
  if (!testDatabaseUrl.includes("match_barber_test")) {
    throw new Error("TRUNCATE_FAILED: URL must contain match_barber_test.");
  }
  if (!/localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl)) {
    throw new Error("TRUNCATE_FAILED: Host must be localhost or 127.0.0.1.");
  }
  if (process.env.ALLOW_TEST_DB_TRUNCATE !== "YES") {
    throw new Error("TRUNCATE_FAILED: ALLOW_TEST_DB_TRUNCATE=YES env var is required.");
  }

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "club_settlement_members",
      "club_settlements",
      "club_point_entries",
      "club_benefit_usages",
      "club_subscription_payments",
      "customer_club_subscriptions",
      "club_plan_benefits",
      "club_plans",
      "commission_adjustments",
      "commission_periods",
      "commission_entries",
      "commission_configs",
      "financial_entries",
      "cash_movements",
      "cash_sessions",
      "command_payments",
      "stock_movements",
      "comanda_items",
      "products",
      "comandas",
      "idempotency_keys",
      "appointment_services",
      "appointments",
      "barber_services",
      "working_hours",
      "services",
      "categories",
      "barbershop_members",
      "barbershops",
      "users"
    CASCADE
  `);
}

async function seedBarbershop(label: string) {
  return prisma.barbershop.create({
    data: {
      name: `Barbearia ${label}`,
      slug: `club-shop-${label}-${Math.random().toString(36).substring(7)}`,
      phone: `1199999000${label.charCodeAt(0) % 10}`,
      zipCode: "00000-000",
      street: "Rua do Clube",
      number: "100",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });
}

async function seedUser(name: string, phone: string) {
  return prisma.user.create({
    data: {
      name,
      phone,
    },
  });
}

async function seedTenantWithClub(label: string) {
  const shop = await seedBarbershop(label);
  
  const ownerUser = await seedUser(`Owner ${label}`, `119911${label.charCodeAt(0)}${Math.floor(Math.random() * 1000)}`);
  const barberUser = await seedUser(`Barbeiro ${label}`, `119922${label.charCodeAt(0)}${Math.floor(Math.random() * 1000)}`);
  const customerUser = await seedUser(`Cliente ${label}`, `119933${label.charCodeAt(0)}${Math.floor(Math.random() * 1000)}`);

  const owner = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: ownerUser.id, role: "OWNER" },
  });
  const barber = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: barberUser.id, role: "BARBER" },
  });

  const category = await prisma.category.create({
    data: { barbershopId: shop.id, name: "Serviços do Clube", slug: `servicos-clube-${label}` },
  });

  const service = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Corte Simples", price: "60.00", durationMin: 30 },
  });

  const anotherService = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Barba", price: "40.00", durationMin: 20 },
  });

  const product = await prisma.product.create({
    data: { barbershopId: shop.id, name: "Pomada Modeladora", salePrice: "30.00" },
  });

  const clubPlan = await prisma.clubPlan.create({
    data: {
      barbershopId: shop.id,
      name: "Plano Vip",
      monthlyPrice: "100.00",
      shopSharePercent: "60.00",
      barberPoolPercent: "40.00",
      isActive: true,
    },
  });

  const benefitService = await prisma.clubPlanBenefit.create({
    data: {
      clubPlanId: clubPlan.id,
      benefitType: "INCLUDED_SERVICE",
      serviceId: service.id,
      includedQty: 2,
      pointWeight: "1.5000",
    },
  });

  const benefitServiceDiscount = await prisma.clubPlanBenefit.create({
    data: {
      clubPlanId: clubPlan.id,
      benefitType: "SERVICE_DISCOUNT",
      serviceId: anotherService.id,
      discountPercent: "20.00",
      pointWeight: "0.5000",
    },
  });

  const benefitProductDiscount = await prisma.clubPlanBenefit.create({
    data: {
      clubPlanId: clubPlan.id,
      benefitType: "PRODUCT_DISCOUNT",
      productId: product.id,
      discountPercent: "10.00",
      pointWeight: "0.0000",
    },
  });

  // Configurar comissão de serviço de 50%
  await prisma.commissionConfig.create({
    data: {
      barbershopId: shop.id,
      scopeKey: `member:${barber.id}:default`,
      type: "PERCENTAGE",
      value: 50.00,
      active: true,
      memberId: barber.id,
    },
  });

  return {
    shop,
    ownerUser,
    barberUser,
    customerUser,
    owner,
    barber,
    category,
    service,
    anotherService,
    product,
    clubPlan,
    benefitService,
    benefitServiceDiscount,
    benefitProductDiscount,
  };
}

async function seedComandaItem(params: {
  barbershopId: string;
  customerId: string;
  executorId: string;
  serviceId?: string;
  productId?: string;
  unitPrice: number;
}) {
  const comanda = await prisma.comanda.create({
    data: {
      barbershopId: params.barbershopId,
      customerName: "Cliente Teste",
      customerId: params.customerId,
      status: "OPEN",
      subtotal: 0,
      total: 0,
    },
  });

  const { addServiceItem, addProductItem } = await import("@/lib/operations/comandas");

  if (params.serviceId) {
    const updated = await addServiceItem(prisma, {
      comandaId: comanda.id,
      barbershopId: params.barbershopId,
      serviceId: params.serviceId,
      executorId: params.executorId,
    });
    // Forçar status para DONE para bater com as premissas dos testes
    const item = await prisma.comandaItem.update({
      where: { id: updated.items[0].id },
      data: { status: "DONE" }
    });
    const finalComanda = await prisma.comanda.findUnique({
      where: { id: comanda.id },
      include: { items: true, payments: true }
    });
    return { comanda: finalComanda!, item };
  } else {
    const updated = await addProductItem(prisma, {
      comandaId: comanda.id,
      barbershopId: params.barbershopId,
      productId: params.productId!,
      quantity: 1,
    });
    // Forçar status para DONE e associar executor para bater com premissas
    const item = await prisma.comandaItem.update({
      where: { id: updated.items[0].id },
      data: { status: "DONE", executorId: params.executorId }
    });
    const finalComanda = await prisma.comanda.findUnique({
      where: { id: comanda.id },
      include: { items: true, payments: true }
    });
    return { comanda: finalComanda!, item };
  }
}

describeIf("Plano Clube — Testes de Domínio e Regras de Negócio", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    vi.resetModules();
    prisma = (await import("@/lib/prisma")).default as PrismaClient;
    clubOps = await import("@/lib/operations/club");
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("cross-tenant: garante isolamento absoluto de dados", async () => {
    const tA = await seedTenantWithClub("TenantA");
    const tB = await seedTenantWithClub("TenantB");

    const subA = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: tA.shop.id,
        customerId: tA.customerUser.id,
        clubPlanId: tA.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    const subQuery = await clubOps.getActiveCustomerClubSubscription({
      barbershopId: tB.shop.id,
      customerId: tA.customerUser.id,
      atDate: new Date("2026-06-15"),
    });
    expect(subQuery).toBeNull();

    await expect(
      clubOps.getClubBenefitsBalance({
        barbershopId: tB.shop.id,
        subscriptionId: subA.id,
        atDate: new Date("2026-06-15"),
      })
    ).rejects.toThrow("Assinatura não encontrada.");

    const resolved = await clubOps.resolveClubBenefitForComandaItem({
      barbershopId: tB.shop.id,
      customerId: tA.customerUser.id,
      serviceId: tB.service.id,
      itemType: "SERVICE",
      atDate: new Date("2026-06-15"),
    });
    expect(resolved.isApplicable).toBe(false);
    expect(resolved.blockedReason).toBe("NO_ACTIVE_SUBSCRIPTION");
  });

  it("ACTIVE libera benefício", async () => {
    const t = await seedTenantWithClub("ActiveSub");
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    const resolved = await clubOps.resolveClubBenefitForComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      serviceId: t.service.id,
      itemType: "SERVICE",
      atDate: new Date("2026-06-15"),
    });

    expect(resolved.hasActiveSubscription).toBe(true);
    expect(resolved.isApplicable).toBe(true);
    expect(resolved.benefitType).toBe("INCLUDED_SERVICE");
    expect(resolved.clubPlanBenefitId).toBe(t.benefitService.id);
    expect(resolved.coveredAmount).toBe(60.00);
    expect(resolved.pointWeight).toBe(1.5);
  });

  it("GRACE_PERIOD libera benefício", async () => {
    const t = await seedTenantWithClub("GraceSub");
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "GRACE_PERIOD",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    const resolved = await clubOps.resolveClubBenefitForComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      serviceId: t.service.id,
      itemType: "SERVICE",
      atDate: new Date("2026-06-15"),
    });

    expect(resolved.hasActiveSubscription).toBe(true);
    expect(resolved.isApplicable).toBe(true);
    expect(resolved.benefitType).toBe("INCLUDED_SERVICE");
  });

  it("status bloqueados não liberam benefício", async () => {
    const t = await seedTenantWithClub("BlockedSub");
    const blockedStatuses = ["PAST_DUE", "SUSPENDED", "CANCELED", "EXPIRED"] as const;

    for (const status of blockedStatuses) {
      await prisma.customerClubSubscription.deleteMany({});
      await prisma.customerClubSubscription.create({
        data: {
          barbershopId: t.shop.id,
          customerId: t.customerUser.id,
          clubPlanId: t.clubPlan.id,
          status,
          currentPeriodStart: new Date("2026-06-01"),
          currentPeriodEnd: new Date("2026-07-01"),
        },
      });

      const resolved = await clubOps.resolveClubBenefitForComandaItem({
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        serviceId: t.service.id,
        itemType: "SERVICE",
        atDate: new Date("2026-06-15"),
      });

      expect(resolved.isApplicable).toBe(false);
      expect(resolved.blockedReason).toBe("SUBSCRIPTION_NOT_USABLE");
    }
  });

  it("limite mensal de benefício", async () => {
    const t = await seedTenantWithClub("LimitSub");
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    for (let i = 1; i <= 2; i++) {
      const { item } = await seedComandaItem({
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        executorId: t.barber.id,
        serviceId: t.service.id,
        unitPrice: 60.00,
      });

      await clubOps.registerClubBenefitUsage({
        barbershopId: t.shop.id,
        subscriptionId: sub.id,
        comandaItemId: item.id,
        serviceId: t.service.id,
        memberId: t.barber.id,
        pointWeight: 1.5,
        competence: "2026-06",
        coveredAmount: 60.00,
      });
    }

    const resolved = await clubOps.resolveClubBenefitForComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      serviceId: t.service.id,
      itemType: "SERVICE",
      atDate: new Date("2026-06-15"),
    });

    expect(resolved.isApplicable).toBe(false);
    expect(resolved.blockedReason).toBe("BENEFIT_LIMIT_REACHED");
  });

  it("uso fora do ciclo não consome saldo atual", async () => {
    const t = await seedTenantWithClub("CycleSub");
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    const { item } = await seedComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      executorId: t.barber.id,
      serviceId: t.service.id,
      unitPrice: 60.00,
    });

    await prisma.clubBenefitUsage.create({
      data: {
        barbershopId: t.shop.id,
        subscriptionId: sub.id,
        clubPlanId: t.clubPlan.id,
        clubPlanBenefitId: t.benefitService.id,
        comandaItemId: item.id,
        serviceId: t.service.id,
        benefitType: "INCLUDED_SERVICE",
        coveredAmount: 60.00,
        pointWeightApplied: 1.5,
        status: "APPLIED",
        competence: "2026-05",
        usedAt: new Date("2026-05-15"),
      },
    });

    const balance = await clubOps.getClubBenefitsBalance({
      barbershopId: t.shop.id,
      subscriptionId: sub.id,
      atDate: new Date("2026-06-15"),
    });

    const benefit = balance.benefits.find((b) => b.serviceId === t.service.id);
    expect(benefit?.usedQty).toBe(0);
    expect(benefit?.availableQty).toBe(2);

    const resolved = await clubOps.resolveClubBenefitForComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      serviceId: t.service.id,
      itemType: "SERVICE",
      atDate: new Date("2026-06-15"),
    });
    expect(resolved.isApplicable).toBe(true);
  });

  it("idempotência por comandaItemId", async () => {
    const t = await seedTenantWithClub("IdempotencySub");
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    const { item } = await seedComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      executorId: t.barber.id,
      serviceId: t.service.id,
      unitPrice: 60.00,
    });

    const res1 = await clubOps.registerClubBenefitUsage({
      barbershopId: t.shop.id,
      subscriptionId: sub.id,
      comandaItemId: item.id,
      serviceId: t.service.id,
      memberId: t.barber.id,
      pointWeight: 1.5,
      competence: "2026-06",
      coveredAmount: 60.00,
    });

    const res2 = await clubOps.registerClubBenefitUsage({
      barbershopId: t.shop.id,
      subscriptionId: sub.id,
      comandaItemId: item.id,
      serviceId: t.service.id,
      memberId: t.barber.id,
      pointWeight: 1.5,
      competence: "2026-06",
      coveredAmount: 60.00,
    });

    expect(res1.usage.id).toBe(res2.usage.id);
    expect(res1.pointEntry?.id).toBe(res2.pointEntry?.id);

    const usageCount = await prisma.clubBenefitUsage.count({ where: { comandaItemId: item.id } });
    expect(usageCount).toBe(1);
  });

  it("desconto em serviço", async () => {
    const t = await seedTenantWithClub("ServiceDiscount");
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    const resolved = await clubOps.resolveClubBenefitForComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      serviceId: t.anotherService.id,
      itemType: "SERVICE",
      atDate: new Date("2026-06-15"),
    });

    expect(resolved.isApplicable).toBe(true);
    expect(resolved.benefitType).toBe("SERVICE_DISCOUNT");
    expect(resolved.discountPercent).toBe(20.00);
    expect(resolved.coveredAmount).toBeNull();
    expect(resolved.pointWeight).toBe(0.5);
  });

  it("desconto em produto", async () => {
    const t = await seedTenantWithClub("ProductDiscount");
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    const resolved = await clubOps.resolveClubBenefitForComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      productId: t.product.id,
      itemType: "PRODUCT",
      atDate: new Date("2026-06-15"),
    });

    expect(resolved.isApplicable).toBe(true);
    expect(resolved.benefitType).toBe("PRODUCT_DISCOUNT");
    expect(resolved.discountPercent).toBe(10.00);
    expect(resolved.coveredAmount).toBeNull();
  });

  it("benefício inexistente", async () => {
    const t = await seedTenantWithClub("NoBenefit");
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    const otherService = await prisma.service.create({
      data: {
        barbershopId: t.shop.id,
        categoryId: t.category.id,
        name: "Massagem",
        price: "100.00",
        durationMin: 45,
      },
    });

    const resolved = await clubOps.resolveClubBenefitForComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      serviceId: otherService.id,
      itemType: "SERVICE",
      atDate: new Date("2026-06-15"),
    });

    expect(resolved.isApplicable).toBe(false);
    expect(resolved.blockedReason).toBe("BENEFIT_NOT_FOUND");
  });

  it("cálculo de pontos por barbeiro e rateio em centavos sem perda", async () => {
    const t = await seedTenantWithClub("SettlementTest");

    const extraUser = await seedUser("Barbeiro B", "11995556666");
    const barberB = await prisma.barbershopMember.create({
      data: { barbershopId: t.shop.id, userId: extraUser.id, role: "BARBER" },
    });

    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    await prisma.clubPlanBenefit.update({
      where: { id: t.benefitService.id },
      data: { includedQty: 5 },
    });

    const { item: item1 } = await seedComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      executorId: t.barber.id,
      serviceId: t.service.id,
      unitPrice: 60.00,
    });
    await clubOps.registerClubBenefitUsage({
      barbershopId: t.shop.id,
      subscriptionId: sub.id,
      comandaItemId: item1.id,
      serviceId: t.service.id,
      memberId: t.barber.id,
      pointWeight: 1.5,
      competence: "2026-06",
      coveredAmount: 60.00,
    });

    const { item: item2 } = await seedComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      executorId: t.barber.id,
      serviceId: t.service.id,
      unitPrice: 60.00,
    });
    await clubOps.registerClubBenefitUsage({
      barbershopId: t.shop.id,
      subscriptionId: sub.id,
      comandaItemId: item2.id,
      serviceId: t.service.id,
      memberId: t.barber.id,
      pointWeight: 1.5,
      competence: "2026-06",
      coveredAmount: 60.00,
    });

    const { item: item3 } = await seedComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      executorId: barberB.id,
      serviceId: t.service.id,
      unitPrice: 60.00,
    });
    await clubOps.registerClubBenefitUsage({
      barbershopId: t.shop.id,
      subscriptionId: sub.id,
      comandaItemId: item3.id,
      serviceId: t.service.id,
      memberId: barberB.id,
      pointWeight: 1.5,
      competence: "2026-06",
      coveredAmount: 60.00,
    });

    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: t.shop.id,
        subscriptionId: sub.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        amount: "100.00",
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-06",
        shopSharePercentSnapshot: "60.00",
        barberPoolPercentSnapshot: "40.00",
        paidAt: new Date(),
      },
    });

    const settlement = await clubOps.calculateClubSettlement({
      barbershopId: t.shop.id,
      competence: "2026-06",
    });

    expect(settlement).not.toBeNull();
    expect(Number(settlement!.totalRevenue)).toBe(100.00);
    expect(Number(settlement!.shopAmount)).toBe(60.00);
    expect(Number(settlement!.barberPoolAmount)).toBe(40.00);
    expect(Number(settlement!.totalPoints)).toBe(4.5);

    const members = settlement!.members;
    expect(members.length).toBe(2);

    const sumAmounts = members.reduce((sum, m) => sum + Number(m.amount), 0);
    expect(sumAmounts).toBe(40.00);

    const memberA = members.find((m) => m.memberId === t.barber.id);
    const memberB = members.find((m) => m.memberId === barberB.id);

    expect(Number(memberA?.points)).toBe(3.0);
    expect(Number(memberB?.points)).toBe(1.5);

    if (t.barber.id < barberB.id) {
      expect(Number(memberA?.amount)).toBe(26.67);
      expect(Number(memberB?.amount)).toBe(13.33);
    } else {
      expect(Number(memberA?.amount)).toBe(26.66);
      expect(Number(memberB?.amount)).toBe(13.34);
    }
  });

  it("zero pontos sem divisão por zero e com carryOutAmount", async () => {
    const t = await seedTenantWithClub("ZeroPoints");

    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: t.shop.id,
        subscriptionId: sub.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        amount: "100.00",
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-06",
        shopSharePercentSnapshot: "60.00",
        barberPoolPercentSnapshot: "40.00",
        paidAt: new Date(),
      },
    });

    const settlement = await clubOps.calculateClubSettlement({
      barbershopId: t.shop.id,
      competence: "2026-06",
    });

    expect(settlement).not.toBeNull();
    expect(Number(settlement!.totalRevenue)).toBe(100.00);
    expect(Number(settlement!.totalPoints)).toBe(0);
    expect(settlement!.members.length).toBe(0);

    // carryOutAmount deve ser igual ao fundo de barbeiros (40.00)
    expect(Number(settlement!.carryOutAmount)).toBe(40.00);
    // a barbearia não deve absorver o fundo dos barbeiros (shopAmount deve ser 60.00)
    expect(Number(settlement!.shopAmount)).toBe(60.00);
    expect(Number(settlement!.barberPoolAmount)).toBe(40.00);
  });

  it("competência seguinte com pontos usa carryInAmount", async () => {
    const t = await seedTenantWithClub("NextCompetenceCarry");

    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-08-01"),
      },
    });

    // 1. Competência 2026-06 com receita e zero pontos -> carryOutAmount = 40.00
    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: t.shop.id,
        subscriptionId: sub.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        amount: "100.00",
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-06",
        shopSharePercentSnapshot: "60.00",
        barberPoolPercentSnapshot: "40.00",
        paidAt: new Date("2026-06-15"),
      },
    });

    const set1 = await clubOps.calculateClubSettlement({
      barbershopId: t.shop.id,
      competence: "2026-06",
    });
    expect(Number(set1!.carryOutAmount)).toBe(40.00);

    // 2. Competência 2026-07 com receita de 100.00 e uso de benefício (pontos)
    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: t.shop.id,
        subscriptionId: sub.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        amount: "100.00",
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-07",
        shopSharePercentSnapshot: "60.00",
        barberPoolPercentSnapshot: "40.00",
        paidAt: new Date("2026-07-15"),
      },
    });

    const { item } = await seedComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      executorId: t.barber.id,
      serviceId: t.service.id,
      unitPrice: 60.00,
    });

    await clubOps.registerClubBenefitUsage({
      barbershopId: t.shop.id,
      subscriptionId: sub.id,
      comandaItemId: item.id,
      serviceId: t.service.id,
      memberId: t.barber.id,
      pointWeight: 1.5000,
      competence: "2026-07",
      coveredAmount: 60.00,
    });

    const set2 = await clubOps.calculateClubSettlement({
      barbershopId: t.shop.id,
      competence: "2026-07",
    });

    expect(set2).not.toBeNull();
    // carryInAmount deve ter vindo do carryOut da competência anterior
    expect(Number(set2!.carryInAmount)).toBe(40.00);
    // barberPoolAmount = 40.00 (mês) + 40.00 (carryIn) = 80.00
    expect(Number(set2!.barberPoolAmount)).toBe(80.00);
    expect(Number(set2!.shopAmount)).toBe(60.00); // 100.00 * 60%
    expect(Number(set2!.carryOutAmount)).toBe(0.00); // Já que houve pontos, carryOut zerado
    expect(Number(set2!.totalPoints)).toBe(1.5);

    expect(set2!.members.length).toBe(1);
    expect(set2!.members[0].memberId).toBe(t.barber.id);
    expect(Number(set2!.members[0].amount)).toBe(80.00); // Deve receber os 80.00 totais
  });

  it("fechamento aprovado/pago não altera carry retroativamente", async () => {
    const t = await seedTenantWithClub("RetroactiveCarry");

    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-08-01"),
      },
    });

    // 1. Competência 2026-06 com receita e zero pontos -> carryOut = 40.00
    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: t.shop.id,
        subscriptionId: sub.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        amount: "100.00",
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-06",
        shopSharePercentSnapshot: "60.00",
        barberPoolPercentSnapshot: "40.00",
        paidAt: new Date("2026-06-15"),
      },
    });

    const set1 = await clubOps.calculateClubSettlement({
      barbershopId: t.shop.id,
      competence: "2026-06",
    });

    // 2. Competência 2026-07 com carryIn de 40.00, aprovado/pago
    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: t.shop.id,
        subscriptionId: sub.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        amount: "100.00",
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-07",
        shopSharePercentSnapshot: "60.00",
        barberPoolPercentSnapshot: "40.00",
        paidAt: new Date("2026-07-15"),
      },
    });

    const { item } = await seedComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      executorId: t.barber.id,
      serviceId: t.service.id,
      unitPrice: 60.00,
    });
    await clubOps.registerClubBenefitUsage({
      barbershopId: t.shop.id,
      subscriptionId: sub.id,
      comandaItemId: item.id,
      serviceId: t.service.id,
      memberId: t.barber.id,
      pointWeight: 1.0,
      competence: "2026-07",
      coveredAmount: 60.00,
    });

    const set2 = await clubOps.calculateClubSettlement({
      barbershopId: t.shop.id,
      competence: "2026-07",
    });

    // Aprovando o fechamento da competência 2026-07
    await clubOps.approveClubSettlement({
      barbershopId: t.shop.id,
      settlementId: set2!.id,
    });

    // 3. Adiciona mais receita retroativamente a 2026-06 (ex: pagamento atrasado inserido)
    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: t.shop.id,
        subscriptionId: sub.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        amount: "50.00",
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-06",
        shopSharePercentSnapshot: "60.00",
        barberPoolPercentSnapshot: "40.00",
        paidAt: new Date("2026-06-20"),
      },
    });

    // Recalcula competência 2026-06 (ela ainda está em status CALCULATED, não aprovada)
    const set1Recalc = await clubOps.calculateClubSettlement({
      barbershopId: t.shop.id,
      competence: "2026-06",
    });

    // carryOut de 2026-06 agora deve ter subido de 40.00 para 60.00 (40.00 + 40% de 50.00)
    expect(Number(set1Recalc!.carryOutAmount)).toBe(60.00);

    // 4. Verifica se o fechamento de 2026-07 (APPROVED) foi alterado retroativamente.
    // Ele NÃO deve ser alterado.
    const set2Final = await prisma.clubSettlement.findUnique({
      where: { id: set2!.id },
      include: { members: true },
    });

    expect(Number(set2Final!.carryInAmount)).toBe(40.00); // Mantém o original
    expect(Number(set2Final!.barberPoolAmount)).toBe(80.00); // Mantém o original
    expect(Number(set2Final!.members[0].amount)).toBe(80.00); // Mantém o original
  });

  it("APPROVED não recalcula silenciosamente", async () => {
    const t = await seedTenantWithClub("ApprovedRecalc");

    await prisma.clubSettlement.create({
      data: {
        barbershopId: t.shop.id,
        competence: "2026-06",
        totalRevenue: "100.00",
        shopAmount: "60.00",
        barberPoolAmount: "40.00",
        totalPoints: "0.0000",
        status: "APPROVED",
      },
    });

    await expect(
      clubOps.calculateClubSettlement({
        barbershopId: t.shop.id,
        competence: "2026-06",
      })
    ).rejects.toThrow("Não é permitido recalcular um fechamento aprovado.");
  });

  it("PAID não altera silenciosamente", async () => {
    const t = await seedTenantWithClub("PaidRecalc");

    const settlement = await prisma.clubSettlement.create({
      data: {
        barbershopId: t.shop.id,
        competence: "2026-06",
        totalRevenue: "100.00",
        shopAmount: "60.00",
        barberPoolAmount: "40.00",
        totalPoints: "0.0000",
        status: "PAID",
      },
    });

    await expect(
      clubOps.calculateClubSettlement({
        barbershopId: t.shop.id,
        competence: "2026-06",
      })
    ).rejects.toThrow("Não é permitido alterar um fechamento pago.");

    await expect(
      clubOps.approveClubSettlement({
        barbershopId: t.shop.id,
        settlementId: settlement.id,
      })
    ).rejects.toThrow("Somente fechamentos em status CALCULATED podem ser aprovados.");

    await expect(
      clubOps.markClubSettlementPaid({
        barbershopId: t.shop.id,
        settlementId: settlement.id,
      })
    ).rejects.toThrow("Somente fechamentos em status APPROVED podem ser pagos.");
  });

  it("reversão de ponto GENERATED", async () => {
    const t = await seedTenantWithClub("ReversalGenerated");
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    const { item } = await seedComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      executorId: t.barber.id,
      serviceId: t.service.id,
      unitPrice: 60.00,
    });

    await clubOps.registerClubBenefitUsage({
      barbershopId: t.shop.id,
      subscriptionId: sub.id,
      comandaItemId: item.id,
      serviceId: t.service.id,
      memberId: t.barber.id,
      pointWeight: 1.5,
      competence: "2026-06",
      coveredAmount: 60.00,
    });

    const rev = await clubOps.reverseClubBenefitUsage({
      barbershopId: t.shop.id,
      comandaItemId: item.id,
      reversalReason: "Erro no lançamento",
    });

    expect(rev.usage!.status).toBe("REVERSED");
    expect(rev.usage!.reversedAt).not.toBeNull();
    expect(rev.usage!.reversalReason).toBe("Erro no lançamento");
    expect(rev.pointEntry!.status).toBe("REVERSED");
  });

  it("bloqueio de reversão de ponto SETTLED", async () => {
    const t = await seedTenantWithClub("ReversalSettled");
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: t.clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    const { item } = await seedComandaItem({
      barbershopId: t.shop.id,
      customerId: t.customerUser.id,
      executorId: t.barber.id,
      serviceId: t.service.id,
      unitPrice: 60.00,
    });

    await clubOps.registerClubBenefitUsage({
      barbershopId: t.shop.id,
      subscriptionId: sub.id,
      comandaItemId: item.id,
      serviceId: t.service.id,
      memberId: t.barber.id,
      pointWeight: 1.5,
      competence: "2026-06",
      coveredAmount: 60.00,
    });

    const settlement = await clubOps.calculateClubSettlement({
      barbershopId: t.shop.id,
      competence: "2026-06",
    });

    await clubOps.approveClubSettlement({
      barbershopId: t.shop.id,
      settlementId: settlement!.id,
    });

    await expect(
      clubOps.reverseClubBenefitUsage({
        barbershopId: t.shop.id,
        comandaItemId: item.id,
      })
    ).rejects.toThrow("Ponto já liquidado em fechamento e não pode ser revertido.");
  });

  describe("Fase 5 — Integração com Comanda e Comissão", () => {
    it("cliente sem plano ativo: fluxo tradicional intocado", async () => {
      const t = await seedTenantWithClub("NoPlanCom");
      const { comanda, item } = await seedComandaItem({
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        executorId: t.barber.id,
        serviceId: t.service.id,
        unitPrice: 60.00,
      });

      // Registrar caixa aberto para cash/dinheiro funcionar, ou usar Pix diretamente
      const { registerPayment, closeComanda } = await import("@/lib/operations/payments");
      await registerPayment(prisma, {
        barbershopId: t.shop.id,
        comandaId: comanda.id,
        method: "PIX",
        amount: 60.00,
        userId: t.ownerUser.id,
      });

      const closed = await closeComanda(prisma, t.shop.id, comanda.id);
      expect(closed.status).toBe("CLOSED");

      // Deve gerar comissão tradicional
      const comEntries = await prisma.commissionEntry.findMany({ where: { comandaItemId: item.id } });
      expect(comEntries.length).toBe(1);
      expect(Number(comEntries[0].baseAmount)).toBe(60.00);

      // Não gera uso de clube
      const usages = await prisma.clubBenefitUsage.findMany({ where: { comandaItemId: item.id } });
      expect(usages.length).toBe(0);
    });

    it("cliente com plano ativo: aplica serviço incluso (cobertura)", async () => {
      const t = await seedTenantWithClub("ClubActiveCom");
      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: t.shop.id,
          customerId: t.customerUser.id,
          clubPlanId: t.clubPlan.id,
          status: "ACTIVE",
          currentPeriodStart: new Date("2026-06-01"),
          currentPeriodEnd: new Date("2026-07-01"),
        },
      });

      const { comanda, item } = await seedComandaItem({
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        executorId: t.barber.id,
        serviceId: t.service.id,
        unitPrice: 60.00,
      });

      // Solicita o benefício (marca intenção)
      await prisma.comandaItem.update({
        where: { id: item.id },
        data: {
          clubBenefitRequested: true,
          requestedClubPlanBenefitId: t.benefitService.id,
        },
      });

      const { recalculateComandaTotals } = await import("@/lib/operations/comandas");
      const { closeComanda } = await import("@/lib/operations/payments");

      // Forçar recálculo para registrar subtotal/total zero devido ao benefício do clube
      await recalculateComandaTotals(prisma, comanda.id);

      // Valor da comanda agora é R$ 0,00 porque está coberta. Pode fechar sem registrar pagamentos.
      const closed = await closeComanda(prisma, t.shop.id, comanda.id);
      expect(closed.status).toBe("CLOSED");
      expect(Number(closed.total)).toBe(0.00);

      // ClubBenefitUsage gerado como APPLIED e coveredAmount gravado
      const usages = await prisma.clubBenefitUsage.findMany({ where: { comandaItemId: item.id } });
      expect(usages.length).toBe(1);
      expect(usages[0].status).toBe("APPLIED");
      expect(Number(usages[0].coveredAmount)).toBe(60.00);
      expect(usages[0].discountAmount).toBeNull();

      // ClubPointEntry gerado para o barbeiro
      const pts = await prisma.clubPointEntry.findMany({ where: { comandaItemId: item.id } });
      expect(pts.length).toBe(1);
      expect(pts[0].status).toBe("GENERATED");
      expect(Number(pts[0].points)).toBe(1.5000);

      // Exclusão mútua: CommissionEntry tradicional não deve ser criada
      const comEntries = await prisma.commissionEntry.findMany({ where: { comandaItemId: item.id } });
      expect(comEntries.length).toBe(0);
    });

    it("cliente com plano ativo: aplica desconto em produto e comissão sobre base líquida", async () => {
      const t = await seedTenantWithClub("ClubDiscountProd");
      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: t.shop.id,
          customerId: t.customerUser.id,
          clubPlanId: t.clubPlan.id,
          status: "ACTIVE",
          currentPeriodStart: new Date("2026-06-01"),
          currentPeriodEnd: new Date("2026-07-01"),
        },
      });

      // Adicionar produto
      const prod = await prisma.product.create({
        data: { barbershopId: t.shop.id, name: "Pomada", salePrice: 50.00, isActive: true },
      });

      // Configurar comissão de produto
      await prisma.commissionConfig.create({
        data: {
          barbershopId: t.shop.id,
          scopeKey: `member:${t.barber.id}:product_default`,
          type: "PERCENTAGE",
          value: 10, // 10% de comissão
          active: true,
          memberId: t.barber.id,
        },
      });

      // Benefício de desconto de produto de 50%
      const discountBenefit = await prisma.clubPlanBenefit.create({
        data: {
          clubPlanId: t.clubPlan.id,
          benefitType: "PRODUCT_DISCOUNT",
          productId: prod.id,
          discountPercent: 50.00,
        },
      });

      const { comanda, item } = await seedComandaItem({
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        executorId: t.barber.id,
        productId: prod.id,
        unitPrice: 50.00,
      });

      // Solicita desconto
      await prisma.comandaItem.update({
        where: { id: item.id },
        data: {
          clubBenefitRequested: true,
          requestedClubPlanBenefitId: discountBenefit.id,
        },
      });

      const { registerPayment, closeComanda } = await import("@/lib/operations/payments");

      // Preço original R$ 50.00. Com 50% de desconto, fica R$ 25.00.
      await registerPayment(prisma, {
        barbershopId: t.shop.id,
        comandaId: comanda.id,
        method: "PIX",
        amount: 25.00,
        userId: t.ownerUser.id,
      });

      const closed = await closeComanda(prisma, t.shop.id, comanda.id);
      expect(closed.status).toBe("CLOSED");
      expect(Number(closed.total)).toBe(25.00);

      // Valida comissão calculada sobre a base líquida (R$ 25.00 * 10% = R$ 2.50)
      const comEntries = await prisma.commissionEntry.findMany({ where: { comandaItemId: item.id } });
      expect(comEntries.length).toBe(1);
      expect(Number(comEntries[0].baseAmount)).toBe(25.00);
      expect(Number(comEntries[0].generatedAmount)).toBe(2.50);
    });

    it("cancelamento da comanda reverte benefício do clube", async () => {
      const t = await seedTenantWithClub("CancelComRevert");
      const sub = await prisma.customerClubSubscription.create({
        data: {
          barbershopId: t.shop.id,
          customerId: t.customerUser.id,
          clubPlanId: t.clubPlan.id,
          status: "ACTIVE",
          currentPeriodStart: new Date("2026-06-01"),
          currentPeriodEnd: new Date("2026-07-01"),
        },
      });

      const { comanda, item } = await seedComandaItem({
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        executorId: t.barber.id,
        serviceId: t.service.id,
        unitPrice: 60.00,
      });

      await prisma.comandaItem.update({
        where: { id: item.id },
        data: {
          clubBenefitRequested: true,
          requestedClubPlanBenefitId: t.benefitService.id,
        },
      });

      const { recalculateComandaTotals } = await import("@/lib/operations/comandas");
      const { closeComanda } = await import("@/lib/operations/payments");

      await closeComanda(prisma, t.shop.id, comanda.id);

      // Agora que a comanda foi fechada (e consequentemente o ClubBenefitUsage e ClubPointEntry foram criados),
      // nós mudamos o status da comanda no banco para PENDING_PAYMENT para que o endpoint de PATCH /api/admin/comandas/[id]
      // permita a transição para CANCELLED (já que CLOSED -> CANCELLED é bloqueado, mas PENDING_PAYMENT -> CANCELLED é válido).
      await prisma.comanda.update({
        where: { id: comanda.id },
        data: { status: "PENDING_PAYMENT" },
      });

      // Mock getMemberSession to avoid headers request context error
      const memberApiAuth = await import("@/lib/member-api-auth");

      const sessionMock = {
        error: null,
        data: {
          userId: t.ownerUser.id,
          barbershopId: t.shop.id,
          role: "OWNER",
          memberId: t.owner.id,
        } as any,
      };

      vi.spyOn(memberApiAuth, "getMemberSession").mockResolvedValue(sessionMock);

      // Cancela a comanda via API PATCH
      const patchRoute = await import("@/app/api/admin/comandas/[id]/route");
      const req = new Request(`http://localhost/api/admin/comandas/${comanda.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "CANCELLED" }),
      });

      const res = await patchRoute.PATCH(req as any, { params: Promise.resolve({ id: comanda.id }) });
      if (res.status !== 200) {
        console.error(await res.text());
      }
      expect(res.status).toBe(200);

      // O uso do benefício e os pontos devem ter sido revertidos
      const usage = await prisma.clubBenefitUsage.findUnique({ where: { comandaItemId: item.id } });
      expect(usage!.status).toBe("REVERSED");
      expect(usage!.reversedAt).not.toBeNull();

      const pt = await prisma.clubPointEntry.findUnique({ where: { comandaItemId: item.id } });
      expect(pt!.status).toBe("REVERSED");
    });
  });
});
