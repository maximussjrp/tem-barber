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
let balanceRoute: any;

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
      slug: `plans-${label}-${Math.random().toString(36).substring(7)}`,
      phone: generateUniquePhone(),
      zipCode: "00000-000",
      street: "Rua dos Planos",
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
  const service2 = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Barba", price: "30.00", durationMin: 20 },
  });

  return {
    shop,
    ownerUser,
    barberUser,
    customerUser,
    owner,
    barber,
    service,
    service2,
  };
}

async function seedComandaItem(barbershopId: string, customerId: string, serviceId: string) {
  const comanda = await prisma.comanda.create({
    data: {
      barbershopId,
      customerId,
      status: "OPEN",
      customerName: "Test Customer",
    }
  });

  const item = await prisma.comandaItem.create({
    data: {
      barbershopId,
      comandaId: comanda.id,
      serviceId,
      quantity: 1,
      unitPrice: 30.00,
      total: 30.00,
      type: "SERVICE",
      description: "Corte",
    }
  });

  return item;
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

function createReq(url: string, method: string, body?: any) {
  return new NextRequest(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

describeIf("Plano Clube — Configuração Simplificada (Fase 3 Integration)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    vi.resetModules();
    prisma = (await import("@/lib/prisma")).default as PrismaClient;

    plansRoute = await import("@/app/api/admin/clube/plans/route");
    planIdRoute = await import("@/app/api/admin/clube/plans/[id]/route");
    balanceRoute = await import("@/app/api/admin/clube/subscriptions/customer/[customerId]/balance/route");
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("1. criar plano com um serviço incluso", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const payload = {
      name: "Plano Um Serviço",
      monthlyPrice: 80.00,
      shopSharePercent: 50.00,
      barberPoolPercent: 50.00,
      isActive: true,
      benefits: [
        {
          serviceId: t.service.id,
          includedQty: 2,
          pointWeight: 1.0
        }
      ]
    };

    const req = createReq("http://localhost/api/admin/clube/plans", "POST", payload);
    const res = await plansRoute.POST(req);

    expect(res.status).toBe(201);
    const plan = await res.json();
    expect(plan.id).toBeDefined();
    expect(plan.benefits).toHaveLength(1);
    expect(plan.benefits[0].serviceId).toBe(t.service.id);
    expect(plan.benefits[0].includedQty).toBe(2);
    expect(Number(plan.benefits[0].pointWeight)).toBe(1.0);
  });

  it("2. criar plano com múltiplos serviços inclusos", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const payload = {
      name: "Plano Multi Serviços",
      monthlyPrice: 120.00,
      shopSharePercent: 60.00,
      barberPoolPercent: 40.00,
      isActive: true,
      benefits: [
        { serviceId: t.service.id, includedQty: 2, pointWeight: 1.0 },
        { serviceId: t.service2.id, includedQty: 4, pointWeight: 1.5 }
      ]
    };

    const req = createReq("http://localhost/api/admin/clube/plans", "POST", payload);
    const res = await plansRoute.POST(req);

    expect(res.status).toBe(201);
    const plan = await res.json();
    expect(plan.benefits).toHaveLength(2);
  });

  it("3. editar quantidade mensal e peso de rateio", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: t.shop.id,
        name: "Plano Teste",
        monthlyPrice: 90.00,
        shopSharePercent: 50.00,
        barberPoolPercent: 50.00,
        isActive: true,
      }
    });

    const benefit = await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: plan.id,
        benefitType: "INCLUDED_SERVICE",
        serviceId: t.service.id,
        includedQty: 1,
        pointWeight: 1.0,
      }
    });

    const payload = {
      benefits: [
        {
          benefitId: benefit.id,
          serviceId: t.service.id,
          includedQty: 3,
          pointWeight: 1.75
        }
      ]
    };

    const req = createReq(`http://localhost/api/admin/clube/plans/${plan.id}`, "PATCH", payload);
    const res = await planIdRoute.PATCH(req, { params: Promise.resolve({ id: plan.id }) });

    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.benefits).toHaveLength(1);
    expect(updated.benefits[0].includedQty).toBe(3);
    expect(Number(updated.benefits[0].pointWeight)).toBe(1.75);
  });

  it("4. impedir serviço duplicado e tenant invadir", async () => {
    const tA = await seedTenant("A");
    const tB = await seedTenant("B");
    mockSession(tA.ownerUser, tA.owner);

    const payloadDup = {
      name: "Plano Dup",
      monthlyPrice: 80.00,
      shopSharePercent: 50.00,
      barberPoolPercent: 50.00,
      benefits: [
        { serviceId: tA.service.id, includedQty: 1, pointWeight: 1.0 },
        { serviceId: tA.service.id, includedQty: 2, pointWeight: 1.0 }
      ]
    };

    const reqDup = createReq("http://localhost/api/admin/clube/plans", "POST", payloadDup);
    const resDup = await plansRoute.POST(reqDup);
    expect(resDup.status).toBe(400);

    const payloadTenant = {
      name: "Plano Invadido",
      monthlyPrice: 80.00,
      shopSharePercent: 50.00,
      barberPoolPercent: 50.00,
      benefits: [
        { serviceId: tB.service.id, includedQty: 1, pointWeight: 1.0 }
      ]
    };

    const reqTenant = createReq("http://localhost/api/admin/clube/plans", "POST", payloadTenant);
    const resTenant = await plansRoute.POST(reqTenant);
    expect(resTenant.status).toBe(404);
  });

  it("5. remover benefício INCLUDED_SERVICE sem histórico e bloquear se houver histórico", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: t.shop.id,
        name: "Plano Integridade",
        monthlyPrice: 90.00,
        shopSharePercent: 50.00,
        barberPoolPercent: 50.00,
        isActive: true,
      }
    });

    const b1 = await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: plan.id,
        benefitType: "INCLUDED_SERVICE",
        serviceId: t.service.id,
        includedQty: 1,
        pointWeight: 1.0,
      }
    });

    const b2 = await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: plan.id,
        benefitType: "INCLUDED_SERVICE",
        serviceId: t.service2.id,
        includedQty: 2,
        pointWeight: 1.0,
      }
    });

    const payload = {
      benefits: [
        { serviceId: t.service2.id, includedQty: 2, pointWeight: 1.0 }
      ]
    };

    const req = createReq(`http://localhost/api/admin/clube/plans/${plan.id}`, "PATCH", payload);
    const res = await planIdRoute.PATCH(req, { params: Promise.resolve({ id: plan.id }) });

    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.benefits).toHaveLength(1);
    expect(updated.benefits[0].serviceId).toBe(t.service2.id);

    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      }
    });

    const comandaItem = await seedComandaItem(t.shop.id, t.customerUser.id, t.service2.id);

    await prisma.clubBenefitUsage.create({
      data: {
        barbershopId: t.shop.id,
        subscriptionId: sub.id,
        clubPlanId: plan.id,
        clubPlanBenefitId: b2.id,
        comandaItemId: comandaItem.id,
        benefitType: "INCLUDED_SERVICE",
        originalAmount: 30.00,
        coveredAmount: 30.00,
        usedAt: new Date(),
        competence: "2026-07",
      }
    });

    const payloadBlocked = {
      benefits: []
    };

    const reqBlocked = createReq(`http://localhost/api/admin/clube/plans/${plan.id}`, "PATCH", payloadBlocked);
    const resBlocked = await planIdRoute.PATCH(reqBlocked, { params: Promise.resolve({ id: plan.id }) });

    expect(resBlocked.status).toBe(422);
    const err = await resBlocked.json();
    expect(err.error).toBe("AUDIT_LOCK");
  });

  it("6. garantir que SERVICE_DISCOUNT e PRODUCT_DISCOUNT não são afetados pelo modal", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: t.shop.id,
        name: "Plano Descontos",
        monthlyPrice: 95.00,
        shopSharePercent: 50.00,
        barberPoolPercent: 50.00,
        isActive: true,
      }
    });

    const bIncluded = await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: plan.id,
        benefitType: "INCLUDED_SERVICE",
        serviceId: t.service.id,
        includedQty: 1,
        pointWeight: 1.0,
      }
    });

    const bDiscount = await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: plan.id,
        benefitType: "SERVICE_DISCOUNT",
        serviceId: t.service2.id,
        discountPercent: 20.00,
      }
    });

    const payload = {
      benefits: [
        {
          benefitId: bIncluded.id,
          serviceId: t.service.id,
          includedQty: 2,
          pointWeight: 1.0
        }
      ]
    };

    const req = createReq(`http://localhost/api/admin/clube/plans/${plan.id}`, "PATCH", payload);
    const res = await planIdRoute.PATCH(req, { params: Promise.resolve({ id: plan.id }) });

    expect(res.status).toBe(200);

    const dbBenefits = await prisma.clubPlanBenefit.findMany({
      where: { clubPlanId: plan.id }
    });

    expect(dbBenefits).toHaveLength(2);
    const discountInDb = dbBenefits.find(b => b.benefitType === "SERVICE_DISCOUNT");
    expect(discountInDb).toBeDefined();
    expect(Number(discountInDb?.discountPercent)).toBe(20.00);
  });

  it("7. cliente com plano com benefício vs sem benefício no saldo", async () => {
    const t = await seedTenant("A");
    mockSession(t.ownerUser, t.owner);

    const planWith = await prisma.clubPlan.create({
      data: {
        barbershopId: t.shop.id,
        name: "Premium VIP",
        monthlyPrice: 100.00,
        shopSharePercent: 50.00,
        barberPoolPercent: 50.00,
      }
    });

    await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: planWith.id,
        benefitType: "INCLUDED_SERVICE",
        serviceId: t.service.id,
        includedQty: 3,
        pointWeight: 1.0,
      }
    });

    await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customerUser.id,
        clubPlanId: planWith.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      }
    });

    const reqWith = createReq(`http://localhost/api/admin/clube/subscriptions/customer/${t.customerUser.id}/balance`, "GET");
    const resWith = await balanceRoute.GET(reqWith, { params: Promise.resolve({ customerId: t.customerUser.id }) });
    expect(resWith.status).toBe(200);
    const balanceWith = await resWith.json();
    expect(balanceWith.benefits).toHaveLength(1);
    expect(balanceWith.benefits[0].serviceId).toBe(t.service.id);

    const planWithout = await prisma.clubPlan.create({
      data: {
        barbershopId: t.shop.id,
        name: "Plano Zerado",
        monthlyPrice: 50.00,
        shopSharePercent: 50.00,
        barberPoolPercent: 50.00,
      }
    });

    const customerUser2 = await seedUser("Client Sem Beneficios", generateUniquePhone());
    await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: customerUser2.id,
        clubPlanId: planWithout.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      }
    });

    const reqWithout = createReq(`http://localhost/api/admin/clube/subscriptions/customer/${customerUser2.id}/balance`, "GET");
    const resWithout = await balanceRoute.GET(reqWithout, { params: Promise.resolve({ customerId: customerUser2.id }) });
    expect(resWithout.status).toBe(200);
    const balanceWithout = await resWithout.json();
    expect(balanceWithout.benefits).toHaveLength(0);
  });
});
