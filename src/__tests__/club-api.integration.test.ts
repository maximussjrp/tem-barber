import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
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

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  testDatabaseUrl &&
  /match_barber_test|localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) &&
  !/prod|production/i.test(testDatabaseUrl);
const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;

let plansRoute: any;
let planIdRoute: any;
let benefitsRoute: any;
let benefitIdRoute: any;
let subscriptionsRoute: any;
let subIdRoute: any;
let paymentsRoute: any;
let balanceRoute: any;
let usageRoute: any;
let settlementsRoute: any;
let calculateRoute: any;
let approveRoute: any;
let payRoute: any;

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

function generateUniquePhone() {
  return "119" + Math.floor(10000000 + Math.random() * 90000000).toString();
}

async function seedUser(name: string, phone: string) {
  return prisma.user.create({
    data: { name, phone },
  });
}

async function seedBarbershop(label: string) {
  return prisma.barbershop.create({
    data: {
      name: `Barbearia ${label}`,
      slug: `api-shop-${label}-${Math.random().toString(36).substring(7)}`,
      phone: generateUniquePhone(),
      zipCode: "00000-000",
      street: "Rua do Clube API",
      number: "123",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });
}

async function seedTenant(label: string) {
  const shop = await seedBarbershop(label);
  const ownerUser = await seedUser(`Owner ${label}`, generateUniquePhone());
  const barberUser = await seedUser(`Barber ${label}`, generateUniquePhone());
  const customerUser = await seedUser(`Client ${label}`, generateUniquePhone());

  const owner = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: ownerUser.id, role: "OWNER" },
  });
  const barber = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: barberUser.id, role: "BARBER" },
  });

  const category = await prisma.category.create({
    data: { barbershopId: shop.id, name: "Serviços", slug: `svcs-${label}` },
  });
  const service = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Corte", price: "50.00", durationMin: 30 },
  });

  const product = await prisma.product.create({
    data: { barbershopId: shop.id, name: "Cera", salePrice: "30.00" },
  });

  return {
    shop,
    ownerUser,
    barberUser,
    customerUser,
    owner,
    barber,
    service,
    product,
  };
}

function mockSession(user: { id: string }, member: { id: string; barbershopId: string; role: string } | null) {
  getAdminSessionMock.mockResolvedValue({
    error: null,
    data: {
      userId: user.id,
      role: member?.role ?? "USER",
      memberId: member?.id ?? null,
      barbershopId: member?.barbershopId ?? null,
    },
  });
}

function mockErrorSession(status = 403, msg = "Acesso negado.") {
  getAdminSessionMock.mockResolvedValue({
    error: Response.json({ error: msg }, { status }),
    data: null,
  });
}

function createReq(url: string, method: string, body?: any) {
  return new NextRequest(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

describeIf("Plano Clube — Testes de Integração de Rotas API (Fase 3)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    vi.resetModules();
    prisma = (await import("@/lib/prisma")).default as PrismaClient;

    plansRoute = await import("@/app/api/admin/clube/plans/route");
    planIdRoute = await import("@/app/api/admin/clube/plans/[id]/route");
    benefitsRoute = await import("@/app/api/admin/clube/plans/[planId]/benefits/route");
    benefitIdRoute = await import("@/app/api/admin/clube/plans/[planId]/benefits/[benefitId]/route");
    subscriptionsRoute = await import("@/app/api/admin/clube/subscriptions/route");
    subIdRoute = await import("@/app/api/admin/clube/subscriptions/[id]/route");
    paymentsRoute = await import("@/app/api/admin/clube/subscriptions/[id]/payments/route");
    balanceRoute = await import("@/app/api/admin/clube/subscriptions/[id]/balance/route");
    usageRoute = await import("@/app/api/admin/clube/usage/route");
    settlementsRoute = await import("@/app/api/admin/clube/settlements/route");
    calculateRoute = await import("@/app/api/admin/clube/settlements/calculate/route");
    approveRoute = await import("@/app/api/admin/clube/settlements/[id]/approve/route");
    payRoute = await import("@/app/api/admin/clube/settlements/[id]/pay/route");
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("1. criar plano com benefícios válidos", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const payload = {
      name: "Plano Trimestral",
      description: "Acesso trimestral",
      monthlyPrice: 120.00,
      shopSharePercent: 60.00,
      barberPoolPercent: 40.00,
      isActive: true,
    };

    const req = createReq("http://localhost/api/admin/clube/plans", "POST", payload);
    const res = await plansRoute.POST(req);

    expect(res.status).toBe(201);
    const plan = await res.json();
    expect(plan.id).toBeDefined();
    expect(plan.name).toBe("Plano Trimestral");
    expect(Number(plan.monthlyPrice)).toBe(120.00);
    expect(Number(plan.shopSharePercent)).toBe(60.00);
    expect(Number(plan.barberPoolPercent)).toBe(40.00);
  });

  it("2. bloquear benefício inválido (Zod validate)", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: t.shop.id,
        name: "Plano Teste",
        monthlyPrice: "100.00",
        shopSharePercent: "50.00",
        barberPoolPercent: "50.00",
      },
    });

    // BENEFIT_TYPE = INCLUDED_SERVICE mas sem includedQty
    const badPayload = {
      benefitType: "INCLUDED_SERVICE",
      serviceId: t.service.id,
      pointWeight: 1.0,
    };

    const req = createReq(`http://localhost/api/admin/clube/plans/${plan.id}/benefits`, "POST", badPayload);
    const res = await benefitsRoute.POST(req, { params: Promise.resolve({ planId: plan.id }) });

    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.error).toBe("VALIDATION_ERROR");
  });

  it("3. listar apenas planos da barbearia logada", async () => {
    const tA = await seedTenant("TenantA");
    const tB = await seedTenant("TenantB");

    await prisma.clubPlan.create({
      data: {
        barbershopId: tA.shop.id,
        name: "Plano Tenant A",
        monthlyPrice: "100.00",
        shopSharePercent: "50.00",
        barberPoolPercent: "50.00",
      },
    });

    await prisma.clubPlan.create({
      data: {
        barbershopId: tB.shop.id,
        name: "Plano Tenant B",
        monthlyPrice: "100.00",
        shopSharePercent: "50.00",
        barberPoolPercent: "50.00",
      },
    });

    mockSession(tA.ownerUser, tA.owner);

    const req = createReq("http://localhost/api/admin/clube/plans", "GET");
    const res = await plansRoute.GET(req);

    expect(res.status).toBe(200);
    const plans = await res.json();
    expect(plans.length).toBe(1);
    expect(plans[0].name).toBe("Plano Tenant A");
  });

  it("4. impedir cross-tenant em plans", async () => {
    const tA = await seedTenant("TenantA");
    const tB = await seedTenant("TenantB");

    const planB = await prisma.clubPlan.create({
      data: {
        barbershopId: tB.shop.id,
        name: "Plano Tenant B",
        monthlyPrice: "100.00",
        shopSharePercent: "50.00",
        barberPoolPercent: "50.00",
      },
    });

    // Session logada no Tenant A tenta acessar plano do Tenant B
    mockSession(tA.ownerUser, tA.owner);

    const reqGet = createReq(`http://localhost/api/admin/clube/plans/${planB.id}`, "GET");
    const resGet = await planIdRoute.GET(reqGet, { params: Promise.resolve({ id: planB.id }) });
    expect(resGet.status).toBe(404);

    const reqPatch = createReq(`http://localhost/api/admin/clube/plans/${planB.id}`, "PATCH", { name: "Hackado" });
    const resPatch = await planIdRoute.PATCH(reqPatch, { params: Promise.resolve({ id: planB.id }) });
    expect(resPatch.status).toBe(404);
  });

  it("5. vincular cliente a plano", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: t.shop.id,
        name: "Plano Teste",
        monthlyPrice: "100.00",
        shopSharePercent: "50.00",
        barberPoolPercent: "50.00",
      },
    });

    const payload = {
      customerId: t.customerUser.id,
      clubPlanId: plan.id,
      status: "ACTIVE",
      currentPeriodStart: new Date("2026-06-01").toISOString(),
      currentPeriodEnd: new Date("2026-07-01").toISOString(),
    };

    const req = createReq("http://localhost/api/admin/clube/subscriptions", "POST", payload);
    const res = await subscriptionsRoute.POST(req);

    expect(res.status).toBe(201);
    const sub = await res.json();
    expect(sub.id).toBeDefined();
    expect(sub.customerId).toBe(t.customerUser.id);
  });

  it("6. bloquear assinatura para plano de outra barbearia (cross-tenant)", async () => {
    const tA = await seedTenant("TenantA");
    const tB = await seedTenant("TenantB");

    const planB = await prisma.clubPlan.create({
      data: {
        barbershopId: tB.shop.id,
        name: "Plano Tenant B",
        monthlyPrice: "100.00",
        shopSharePercent: "50.00",
        barberPoolPercent: "50.00",
      },
    });

    // Session logada no Tenant A tenta assinar plano do Tenant B
    mockSession(tA.ownerUser, tA.owner);

    const payload = {
      customerId: tA.customerUser.id,
      clubPlanId: planB.id,
      currentPeriodStart: new Date("2026-06-01").toISOString(),
      currentPeriodEnd: new Date("2026-07-01").toISOString(),
    };

    const req = createReq("http://localhost/api/admin/clube/subscriptions", "POST", payload);
    const res = await subscriptionsRoute.POST(req);

    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.error).toBe("PLAN_NOT_FOUND");
  });

  it("7. registrar pagamento manual com snapshot", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: t.shop.id,
        name: "Plano VIP",
        monthlyPrice: "150.00",
        shopSharePercent: "70.00",
        barberPoolPercent: "30.00",
      },
    });

    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    const payload = {
      amount: 150.00,
      paymentMethod: "PIX",
      competence: "2026-06",
      paidAt: new Date().toISOString(),
    };

    const req = createReq(`http://localhost/api/admin/clube/subscriptions/${sub.id}/payments`, "POST", payload);
    const res = await paymentsRoute.POST(req, { params: Promise.resolve({ id: sub.id }) });

    expect(res.status).toBe(201);
    const payment = await res.json();
    expect(payment.id).toBeDefined();
    // Validar snapshots corretos baseados no plano
    expect(Number(payment.shopSharePercentSnapshot)).toBe(70.00);
    expect(Number(payment.barberPoolPercentSnapshot)).toBe(30.00);
  });

  it("8. consultar saldo da assinatura", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: t.shop.id,
        name: "Plano VIP",
        monthlyPrice: "150.00",
        shopSharePercent: "60.00",
        barberPoolPercent: "40.00",
      },
    });

    const benefit = await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: plan.id,
        benefitType: "INCLUDED_SERVICE",
        serviceId: t.service.id,
        includedQty: 3,
        pointWeight: "1.0000",
      },
    });

    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    const req = createReq(`http://localhost/api/admin/clube/subscriptions/${sub.id}/balance?atDate=2026-06-15T00:00:00.000Z`, "GET");
    const res = await balanceRoute.GET(req, { params: Promise.resolve({ id: sub.id }) });

    expect(res.status).toBe(200);
    const balance = await res.json();
    expect(balance.subscriptionId).toBe(sub.id);
    expect(balance.benefits[0].availableQty).toBe(3);
  });

  it("9. listar usage filtrado por barbershopId", async () => {
    const tA = await seedTenant("TenantA");
    const tB = await seedTenant("TenantB");

    const planA = await prisma.clubPlan.create({
      data: { barbershopId: tA.shop.id, name: "Plan A", monthlyPrice: 100, shopSharePercent: 50, barberPoolPercent: 50 },
    });
    const subA = await prisma.customerClubSubscription.create({
      data: { barbershopId: tA.shop.id, customerId: tA.customerUser.id, clubPlanId: planA.id, status: "ACTIVE", currentPeriodStart: new Date("2026-06-01"), currentPeriodEnd: new Date("2026-07-01") },
    });

    const comanda = await prisma.comanda.create({
      data: { barbershopId: tA.shop.id, customerName: "Cliente A", status: "CLOSED" },
    });
    const item = await prisma.comandaItem.create({
      data: {
        comandaId: comanda.id,
        barbershopId: tA.shop.id,
        type: "SERVICE",
        quantity: 1,
        unitPrice: 50,
        total: 50,
        executorId: tA.barber.id,
        description: "Serviço Corte",
      },
    });

    await prisma.clubBenefitUsage.create({
      data: {
        barbershopId: tA.shop.id,
        subscriptionId: subA.id,
        clubPlanId: planA.id,
        comandaItemId: item.id,
        benefitType: "INCLUDED_SERVICE",
        status: "APPLIED",
        competence: "2026-06",
        usedAt: new Date(),
      },
    });

    mockSession(tB.ownerUser, tB.owner);

    const req = createReq("http://localhost/api/admin/clube/usage", "GET");
    const res = await usageRoute.GET(req);

    expect(res.status).toBe(200);
    const usages = await res.json();
    // B não deve ver o usage de A
    expect(usages.length).toBe(0);
  });

  it("10. calcular fechamento via API", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const plan = await prisma.clubPlan.create({
      data: { barbershopId: t.shop.id, name: "Plan", monthlyPrice: 100, shopSharePercent: 50, barberPoolPercent: 50 },
    });
    const sub = await prisma.customerClubSubscription.create({
      data: { barbershopId: t.shop.id, customerId: t.customerUser.id, clubPlanId: plan.id, status: "ACTIVE", currentPeriodStart: new Date("2026-06-01"), currentPeriodEnd: new Date("2026-07-01") },
    });

    await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: t.shop.id,
        subscriptionId: sub.id,
        customerId: t.customerUser.id,
        clubPlanId: plan.id,
        amount: 100.00,
        paymentMethod: "PIX",
        status: "PAID",
        competence: "2026-06",
        shopSharePercentSnapshot: 60.00,
        barberPoolPercentSnapshot: 40.00,
        paidAt: new Date(),
      },
    });

    const payload = { competence: "2026-06" };
    const req = createReq("http://localhost/api/admin/clube/settlements/calculate", "POST", payload);
    const res = await calculateRoute.POST(req);

    expect(res.status).toBe(200);
    const set = await res.json();
    expect(set.id).toBeDefined();
    expect(Number(set.totalRevenue)).toBe(100.00);
    expect(Number(set.barberPoolAmount)).toBe(40.00);
    expect(Number(set.carryOutAmount)).toBe(40.00); // 0 pontos -> acumula tudo
  });

  it("11. aprovar fechamento via API", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const settlement = await prisma.clubSettlement.create({
      data: {
        barbershopId: t.shop.id,
        competence: "2026-06",
        totalRevenue: 100.00,
        shopAmount: 60.00,
        barberPoolAmount: 40.00,
        totalPoints: 0.0000,
        status: "CALCULATED",
      },
    });

    const req = createReq(`http://localhost/api/admin/clube/settlements/${settlement.id}/approve`, "POST");
    const res = await approveRoute.POST(req, { params: Promise.resolve({ id: settlement.id }) });

    expect(res.status).toBe(200);
    const approved = await res.json();
    expect(approved.status).toBe("APPROVED");
  });

  it("12. marcar fechamento como pago via API", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const settlement = await prisma.clubSettlement.create({
      data: {
        barbershopId: t.shop.id,
        competence: "2026-06",
        totalRevenue: 100.00,
        shopAmount: 60.00,
        barberPoolAmount: 40.00,
        totalPoints: 0.0000,
        status: "APPROVED",
      },
    });

    const req = createReq(`http://localhost/api/admin/clube/settlements/${settlement.id}/pay`, "POST");
    const res = await payRoute.POST(req, { params: Promise.resolve({ id: settlement.id }) });

    expect(res.status).toBe(200);
    const paid = await res.json();
    expect(paid.status).toBe("PAID");
  });

  it("13. bloquear BARBER nas rotas administrativas", async () => {
    const t = await seedTenant("A");
    // Mocking user session as BARBER
    mockSession(t.barberUser, t.barber);

    const req = createReq("http://localhost/api/admin/clube/plans", "GET");
    const res = await plansRoute.GET(req);

    expect(res.status).toBe(403);
    const err = await res.json();
    expect(err.error).toBe("Acesso negado.");
  });

  it("14 & 15. rotas administrativas não alteram comandas ou CommissionEntry/CommissionPeriod", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    // Salvar contagem inicial das tabelas
    const initialComandas = await prisma.comanda.count();
    const initialCommissionEntries = await prisma.commissionEntry.count();
    const initialCommissionPeriods = await prisma.commissionPeriod.count();

    // Invocar rota de cálculo de fechamento
    const payload = { competence: "2026-06" };
    const req = createReq("http://localhost/api/admin/clube/settlements/calculate", "POST", payload);
    await calculateRoute.POST(req);

    // Validar que as tabelas de comandas e comissão normal não sofreram alteração
    expect(await prisma.comanda.count()).toBe(initialComandas);
    expect(await prisma.commissionEntry.count()).toBe(initialCommissionEntries);
    expect(await prisma.commissionPeriod.count()).toBe(initialCommissionPeriods);
  });
});
