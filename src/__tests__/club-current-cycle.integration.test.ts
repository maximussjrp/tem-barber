import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";

const { getAdminSessionMock } = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  getAdminSession: getAdminSessionMock,
  requireOperationalSession: async () => {
    const res = await getAdminSessionMock();
    if (res.error) return { error: res.error, data: null };
    const data = res.data;
    if (!data || !data.barbershopId) {
      return {
        error: Response.json({ error: "Sem barbearia vinculada." }, { status: 403 }),
        data: null,
      };
    }
    if (!["OWNER", "MANAGER", "SUPER_ADMIN"].includes(data.role)) {
      return {
        error: Response.json({ error: "Acesso negado." }, { status: 403 }),
        data: null,
      };
    }
    return { error: null, data };
  },
}));

interface BarberItem {
  memberId: string;
  points: string;
  servicesCount: number;
  sharePercent: string;
  estimatedAmount: string;
}

let prisma: PrismaClient;
let currentCycleRoute: { GET: (req: NextRequest) => Promise<Response> };

async function truncateDatabase() {
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
      "commission_entries",
      "commission_periods",
      "financial_entries",
      "cash_movements",
      "cash_sessions",
      "command_payments",
      "comanda_items",
      "comandas",
      "services",
      "categories",
      "barbershop_members",
      "barbershops",
      "users"
    CASCADE
  `);
}

async function seedTenant() {
  const shop = await prisma.barbershop.create({
    data: {
      name: "Barbearia Ciclo Teste",
      slug: `shop-cycle-${Math.random().toString(36).substring(7)}`,
      phone: "11999998888",
      zipCode: "00000-000",
      street: "Rua do Ciclo",
      number: "50",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });

  const ownerUser = await prisma.user.create({ data: { name: "Dono Teste", phone: "11911112222" } });
  const managerUser = await prisma.user.create({ data: { name: "Gerente Teste", phone: "11922223333" } });
  const barber1User = await prisma.user.create({ data: { name: "Barbeiro Um", phone: "11933334444" } });
  const barber2User = await prisma.user.create({ data: { name: "Barbeiro Dois", phone: "11944445555" } });
  const customerUser = await prisma.user.create({ data: { name: "Cliente Teste", phone: "11955556666" } });

  const ownerMember = await prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: ownerUser.id, role: "OWNER" } });
  const managerMember = await prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: managerUser.id, role: "MANAGER" } });
  const barber1Member = await prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: barber1User.id, role: "BARBER" } });
  const barber2Member = await prisma.barbershopMember.create({ data: { barbershopId: shop.id, userId: barber2User.id, role: "BARBER" } });

  const clubPlan = await prisma.clubPlan.create({
    data: {
      barbershopId: shop.id,
      name: "Plano Vip 100",
      monthlyPrice: "100.00",
      shopSharePercent: "50.00",
      barberPoolPercent: "50.00",
    },
  });

  const sub = await prisma.customerClubSubscription.create({
    data: {
      barbershopId: shop.id,
      customerId: customerUser.id,
      clubPlanId: clubPlan.id,
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      gracePeriodEnd: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000),
    },
  });

  return {
    shop,
    ownerMember,
    managerMember,
    barber1Member,
    barber2Member,
    customerUser,
    clubPlan,
    sub,
  };
}

describe("LOTE A — Painel Read-Only do Ciclo Atual do Clube", () => {
  beforeAll(async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL;
    const isSafeTestDatabase =
      testDatabaseUrl &&
      /match_barber_test|localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) &&
      !/prod|production/i.test(testDatabaseUrl);
    if (!isSafeTestDatabase) {
      throw new Error("club-current-cycle.integration.test.ts requires a safe test database");
    }
    process.env.DATABASE_URL = testDatabaseUrl;
    prisma = (await import("@/lib/prisma")).default as unknown as PrismaClient;
    await prisma.$connect();
    currentCycleRoute = await import("@/app/api/admin/clube/settlements/current/route");
  });

  beforeEach(async () => {
    await truncateDatabase();
    vi.clearAllMocks();
  }, 30000);

  it("1. OWNER recebe totalRevenue e shopPool preenchidos", async () => {
    const { shop, ownerMember, sub, clubPlan } = await seedTenant();

    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: shop.id,
        subscriptionId: sub.id,
        customerId: sub.customerId,
        clubPlanId: clubPlan.id,
        amount: "100.00",
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-08",
        shopSharePercentSnapshot: "60.00",
        barberPoolPercentSnapshot: "40.00",
        paidAt: new Date(),
      },
    });

    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: ownerMember.userId, role: "OWNER", memberId: ownerMember.id, barbershopId: shop.id },
    });

    const res = await currentCycleRoute.GET(new NextRequest("http://localhost/api/admin/clube/settlements/current"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totals.totalRevenue).toBe("100.00");
    expect(body.totals.barberPool).toBe("40.00");
    expect(body.totals.shopPool).toBe("60.00");
  });

  it("2. MANAGER recebe totalRevenue = null e shopPool = null", async () => {
    const { shop, managerMember, sub, clubPlan } = await seedTenant();

    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: shop.id,
        subscriptionId: sub.id,
        customerId: sub.customerId,
        clubPlanId: clubPlan.id,
        amount: "100.00",
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-08",
        shopSharePercentSnapshot: "60.00",
        barberPoolPercentSnapshot: "40.00",
        paidAt: new Date(),
      },
    });

    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: managerMember.userId, role: "MANAGER", memberId: managerMember.id, barbershopId: shop.id },
    });

    const res = await currentCycleRoute.GET(new NextRequest("http://localhost/api/admin/clube/settlements/current"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totals.totalRevenue).toBeNull();
    expect(body.totals.barberPool).toBe("40.00");
    expect(body.totals.shopPool).toBeNull();
  });

  it("3. Zero pontos retorna todos os barbeiros ativos com valores zerados", async () => {
    const { shop, ownerMember } = await seedTenant();

    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: ownerMember.userId, role: "OWNER", memberId: ownerMember.id, barbershopId: shop.id },
    });

    const res = await currentCycleRoute.GET(new NextRequest("http://localhost/api/admin/clube/settlements/current"));
    const body = await res.json();

    expect(body.cycle.hasPoints).toBe(false);
    expect(body.cycle.canClose).toBe(false);
    expect(body.cycle.closedReason).toBe("ZERO_POINTS");
    expect(body.barbers.length).toBeGreaterThanOrEqual(4);

    for (const b of body.barbers) {
      expect(b.servicesCount).toBe(0);
      expect(b.points).toBe("0.0000");
      expect(b.sharePercent).toBe("0.00");
      expect(b.estimatedAmount).toBe("0.00");
    }
  });

  it("4. Filtro por corte temporal (lastPaidSettlement): pagamentos/pontos/serviços antigos não entram", async () => {
    const { shop, ownerMember, barber1Member, barber2Member, sub, clubPlan } = await seedTenant();

    const pastPaidDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const afterPaidDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

    await prisma.clubSettlement.create({
      data: {
        barbershopId: shop.id,
        competence: "2026-07",
        totalRevenue: "100.00",
        shopSharePercent: "50.00",
        shopAmount: "50.00",
        barberPoolAmount: "50.00",
        totalPoints: "10.0000",
        status: "PAID",
        updatedAt: pastPaidDate,
      },
    });

    // Pagamento 1: ANTES do corte
    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: shop.id,
        subscriptionId: sub.id,
        customerId: sub.customerId,
        clubPlanId: clubPlan.id,
        amount: "100.00",
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-07",
        shopSharePercentSnapshot: "50.00",
        barberPoolPercentSnapshot: "50.00",
        paidAt: new Date(pastPaidDate.getTime() - 10000),
      },
    });

    // Pagamento 2: DEPOIS do corte
    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: shop.id,
        subscriptionId: sub.id,
        customerId: sub.customerId,
        clubPlanId: clubPlan.id,
        amount: "200.00",
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-08",
        shopSharePercentSnapshot: "50.00",
        barberPoolPercentSnapshot: "50.00",
        paidAt: afterPaidDate,
      },
    });

    const comandaPast = await prisma.comanda.create({ data: { barbershopId: shop.id, customerName: "C", total: 0 } });
    const itemPast = await prisma.comandaItem.create({
      data: { comandaId: comandaPast.id, barbershopId: shop.id, type: "SERVICE", description: "Corte", unitPrice: 50, total: 50 },
    });

    const comandaAfter = await prisma.comanda.create({ data: { barbershopId: shop.id, customerName: "C", total: 0 } });
    const itemAfter = await prisma.comandaItem.create({
      data: { comandaId: comandaAfter.id, barbershopId: shop.id, type: "SERVICE", description: "Corte", unitPrice: 50, total: 50 },
    });

    // Ponto 1: ANTES do corte
    await prisma.clubPointEntry.create({
      data: {
        barbershopId: shop.id,
        comandaItemId: itemPast.id,
        memberId: barber1Member.id,
        points: "5.0000",
        status: "GENERATED",
        competence: "2026-07",
        createdAt: new Date(pastPaidDate.getTime() - 10000),
      },
    });

    // Ponto 2: DEPOIS do corte
    await prisma.clubPointEntry.create({
      data: {
        barbershopId: shop.id,
        comandaItemId: itemAfter.id,
        memberId: barber2Member.id,
        points: "10.0000",
        status: "GENERATED",
        competence: "2026-08",
        createdAt: afterPaidDate,
      },
    });

    // Uso de benefício ANTES do corte
    await prisma.clubBenefitUsage.create({
      data: {
        barbershopId: shop.id,
        subscriptionId: sub.id,
        clubPlanId: clubPlan.id,
        comandaItemId: itemPast.id,
        benefitType: "INCLUDED_SERVICE",
        status: "APPLIED",
        competence: "2026-07",
        usedAt: new Date(pastPaidDate.getTime() - 10000),
      },
    });

    // Uso de benefício DEPOIS do corte
    await prisma.clubBenefitUsage.create({
      data: {
        barbershopId: shop.id,
        subscriptionId: sub.id,
        clubPlanId: clubPlan.id,
        comandaItemId: itemAfter.id,
        benefitType: "INCLUDED_SERVICE",
        status: "APPLIED",
        competence: "2026-08",
        usedAt: afterPaidDate,
      },
    });

    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: ownerMember.userId, role: "OWNER", memberId: ownerMember.id, barbershopId: shop.id },
    });

    const res = await currentCycleRoute.GET(new NextRequest("http://localhost/api/admin/clube/settlements/current"));
    const body = await res.json();

    expect(body.totals.totalRevenue).toBe("200.00");
    expect(body.totals.barberPool).toBe("100.00");
    expect(body.totals.totalPoints).toBe("10.0000");
    expect(body.totals.totalServicesCount).toBe(1);

    const b1 = body.barbers.find((b: BarberItem) => b.memberId === barber1Member.id);
    const b2 = body.barbers.find((b: BarberItem) => b.memberId === barber2Member.id);

    expect(b1.points).toBe("0.0000");
    expect(b1.servicesCount).toBe(0);

    expect(b2.points).toBe("10.0000");
    expect(b2.servicesCount).toBe(1);
    expect(b2.estimatedAmount).toBe("100.00");
  });

  it("5. Dois barbeiros dividem barberPool proporcionalmente e soma dos estimatedAmount = barberPool", async () => {
    const { shop, ownerMember, barber1Member, barber2Member, sub, clubPlan } = await seedTenant();

    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: shop.id,
        subscriptionId: sub.id,
        customerId: sub.customerId,
        clubPlanId: clubPlan.id,
        amount: "100.00",
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-08",
        shopSharePercentSnapshot: "50.00",
        barberPoolPercentSnapshot: "50.00",
        paidAt: new Date(),
      },
    });

    const comanda1 = await prisma.comanda.create({ data: { barbershopId: shop.id, customerName: "C1", total: 0 } });
    const item1 = await prisma.comandaItem.create({
      data: { comandaId: comanda1.id, barbershopId: shop.id, type: "SERVICE", description: "Corte", unitPrice: 50, total: 50 },
    });

    const comanda2 = await prisma.comanda.create({ data: { barbershopId: shop.id, customerName: "C2", total: 0 } });
    const item2 = await prisma.comandaItem.create({
      data: { comandaId: comanda2.id, barbershopId: shop.id, type: "SERVICE", description: "Corte", unitPrice: 50, total: 50 },
    });

    await prisma.clubPointEntry.create({
      data: {
        barbershopId: shop.id,
        comandaItemId: item1.id,
        memberId: barber1Member.id,
        points: "30.0000",
        status: "GENERATED",
        competence: "2026-08",
      },
    });

    await prisma.clubPointEntry.create({
      data: {
        barbershopId: shop.id,
        comandaItemId: item2.id,
        memberId: barber2Member.id,
        points: "10.0000",
        status: "GENERATED",
        competence: "2026-08",
      },
    });

    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: ownerMember.userId, role: "OWNER", memberId: ownerMember.id, barbershopId: shop.id },
    });

    const res = await currentCycleRoute.GET(new NextRequest("http://localhost/api/admin/clube/settlements/current"));
    const body = await res.json();

    const b1 = body.barbers.find((b: BarberItem) => b.memberId === barber1Member.id);
    const b2 = body.barbers.find((b: BarberItem) => b.memberId === barber2Member.id);

    expect(b1.sharePercent).toBe("75.00");
    expect(b1.estimatedAmount).toBe("37.50");

    expect(b2.sharePercent).toBe("25.00");
    expect(b2.estimatedAmount).toBe("12.50");

    const totalBarberEstimated = Number(b1.estimatedAmount) + Number(b2.estimatedAmount);
    expect(totalBarberEstimated.toFixed(2)).toBe(body.totals.barberPool);
  });

  it("6. Idempotência estrita: GET /current chamado 2 vezes NÃO altera contagem de nenhuma tabela no banco", async () => {
    const { shop, ownerMember, sub, clubPlan } = await seedTenant();

    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: shop.id,
        subscriptionId: sub.id,
        customerId: sub.customerId,
        clubPlanId: clubPlan.id,
        amount: "100.00",
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-08",
        shopSharePercentSnapshot: "50.00",
        barberPoolPercentSnapshot: "50.00",
        paidAt: new Date(),
      },
    });

    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: { userId: ownerMember.userId, role: "OWNER", memberId: ownerMember.id, barbershopId: shop.id },
    });

    const countsBefore = {
      payments: await prisma.clubSubscriptionPayment.count(),
      usages: await prisma.clubBenefitUsage.count(),
      points: await prisma.clubPointEntry.count(),
      settlements: await prisma.clubSettlement.count(),
      settlementMembers: await prisma.clubSettlementMember.count(),
      financialEntries: await prisma.financialEntry.count(),
      cashMovements: await prisma.cashMovement.count(),
      commissionEntries: await prisma.commissionEntry.count(),
    };

    await currentCycleRoute.GET(new NextRequest("http://localhost/api/admin/clube/settlements/current"));
    await currentCycleRoute.GET(new NextRequest("http://localhost/api/admin/clube/settlements/current"));

    const countsAfter = {
      payments: await prisma.clubSubscriptionPayment.count(),
      usages: await prisma.clubBenefitUsage.count(),
      points: await prisma.clubPointEntry.count(),
      settlements: await prisma.clubSettlement.count(),
      settlementMembers: await prisma.clubSettlementMember.count(),
      financialEntries: await prisma.financialEntry.count(),
      cashMovements: await prisma.cashMovement.count(),
      commissionEntries: await prisma.commissionEntry.count(),
    };

    expect(countsAfter).toEqual(countsBefore);
  });
});
