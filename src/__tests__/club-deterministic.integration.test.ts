import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient, ClubSubscriptionStatus } from "@prisma/client";

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
    return { error: null, data };
  },
}));

vi.mock("@/lib/operations/permissions", () => ({
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
    return { error: null, data };
  },
  canManageComandas: () => true,
  forbidden: () => false,
}));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  testDatabaseUrl &&
  /match_barber_test|localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) &&
  !/prod|production/i.test(testDatabaseUrl);
const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;
let clubOps: any;
let balanceRoute: any;
let subscriptionRoute: any;
let comandaRoute: any;

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

describeIf("Club Deterministic, Duplicity & Preview Integration Tests", () => {
  let barbershop: any;
  let owner: any;
  let customer: any;
  let barber: any;
  let planActive: any;
  let planInactive: any;
  let service: any;
  let ownerMember: any;
  let barberMember: any;

  beforeAll(async () => {
    if (testDatabaseUrl) {
      process.env.DATABASE_URL = testDatabaseUrl;
    }
    prisma = (await import("@/lib/prisma")).default as any;

    // Import routes dynamically
    balanceRoute = await import("@/app/api/admin/clube/subscriptions/customer/[customerId]/balance/route");
    subscriptionRoute = await import("@/app/api/admin/clube/subscriptions/route");
    comandaRoute = await import("@/app/api/admin/comandas/route");
    clubOps = await import("@/lib/operations/club");
  });

  beforeEach(async () => {
    await truncateDatabase();

    // Seed mock data
    barbershop = await prisma.barbershop.create({
      data: {
        name: "Barbearia Teste",
        slug: "barbearia-teste",
        phone: "11999999999",
        zipCode: "00000-000",
        street: "Rua Teste",
        number: "123",
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
      },
    });

    owner = await prisma.user.create({
      data: { name: "Owner", email: "owner@teste.com", role: "USER", phone: "11911111111" },
    });

    ownerMember = await prisma.barbershopMember.create({
      data: { barbershopId: barbershop.id, userId: owner.id, role: "OWNER" },
    });

    customer = await prisma.user.create({
      data: { name: "Marllon Test", email: "marllon@teste.com", phone: "17988305151" },
    });

    barber = await prisma.user.create({
      data: { name: "Barbeiro", email: "barber@teste.com", role: "USER", phone: "11922222222" },
    });

    barberMember = await prisma.barbershopMember.create({
      data: { barbershopId: barbershop.id, userId: barber.id, role: "BARBER" },
    });

    // Create plans
    planActive = await prisma.clubPlan.create({
      data: {
        barbershopId: barbershop.id,
        name: "Plano Ativo",
        monthlyPrice: 99.9,
        shopSharePercent: 50,
        barberPoolPercent: 50,
        isActive: true,
      },
    });

    planInactive = await prisma.clubPlan.create({
      data: {
        barbershopId: barbershop.id,
        name: "Plano Inativo",
        monthlyPrice: 79.9,
        shopSharePercent: 50,
        barberPoolPercent: 50,
        isActive: false,
      },
    });

    const category = await prisma.category.create({
      data: { barbershopId: barbershop.id, name: "Serviços", slug: "servicos-teste" },
    });

    service = await prisma.service.create({
      data: {
        barbershopId: barbershop.id,
        categoryId: category.id,
        name: "Corte Masculino",
        price: 50.0,
        durationMin: 30,
      },
    });

    // Add service benefits
    await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: planActive.id,
        benefitType: "INCLUDED_SERVICE",
        serviceId: service.id,
        includedQty: 5,
        pointWeight: 10,
      },
    });

    // Setup mocks
    getAdminSessionMock.mockResolvedValue({
      error: null,
      data: {
        userId: owner.id,
        role: "OWNER",
        barbershopId: barbershop.id,
        memberId: owner.id,
      },
    });
  });

  it("should sort active subscriptions deterministically in memory", async () => {
    // 1. Create a subscription to an inactive plan
    const subInactive = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: barbershop.id,
        customerId: customer.id,
        clubPlanId: planInactive.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
        createdAt: new Date("2026-06-01T10:00:00Z"),
        updatedAt: new Date("2026-06-01T10:00:00Z"),
      },
    });

    // 2. Create a subscription to an active plan (should win because plan is active)
    const subActive = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: barbershop.id,
        customerId: customer.id,
        clubPlanId: planActive.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-10"),
        currentPeriodEnd: new Date("2026-07-10"),
        createdAt: new Date("2026-06-10T10:00:00Z"),
        updatedAt: new Date("2026-06-10T10:00:00Z"),
      },
    });

    const activeSub = await clubOps.getActiveCustomerClubSubscription({
      barbershopId: barbershop.id,
      customerId: customer.id,
      atDate: new Date("2026-06-15"),
    });

    expect(activeSub).not.toBeNull();
    expect(activeSub.id).toBe(subActive.id);
    expect(activeSub.clubPlanId).toBe(planActive.id);
  });

  it("should prioritize ACTIVE status over GRACE_PERIOD status", async () => {
    // 1. Create a grace period subscription on an active plan
    const subGrace = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: barbershop.id,
        customerId: customer.id,
        clubPlanId: planActive.id,
        status: "GRACE_PERIOD",
        currentPeriodStart: new Date("2026-06-20"),
        currentPeriodEnd: new Date("2026-07-20"),
        createdAt: new Date("2026-06-20T10:00:00Z"),
      },
    });

    // 2. Create an active subscription on the same plan (ACTIVE should win over GRACE_PERIOD)
    const subActive = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: barbershop.id,
        customerId: customer.id,
        clubPlanId: planActive.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
        createdAt: new Date("2026-06-01T10:00:00Z"),
      },
    });

    const activeSub = await clubOps.getActiveCustomerClubSubscription({
      barbershopId: barbershop.id,
      customerId: customer.id,
      atDate: new Date("2026-06-15"),
    });

    expect(activeSub).not.toBeNull();
    expect(activeSub.id).toBe(subActive.id);
    expect(activeSub.status).toBe("ACTIVE");
  });

  it("should return duplicate flags in balance API when multiple active subscriptions exist", async () => {
    // Create two active subscriptions
    await prisma.customerClubSubscription.create({
      data: {
        barbershopId: barbershop.id,
        customerId: customer.id,
        clubPlanId: planInactive.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    await prisma.customerClubSubscription.create({
      data: {
        barbershopId: barbershop.id,
        customerId: customer.id,
        clubPlanId: planActive.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-10"),
        currentPeriodEnd: new Date("2026-07-10"),
      },
    });

    const req = new NextRequest(`http://localhost/api/admin/clube/subscriptions/customer/${customer.id}/balance`);
    const res = await balanceRoute.GET(req, { params: Promise.resolve({ customerId: customer.id }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.duplicateActiveSubscriptions).toBe(true);
    expect(json.duplicateCount).toBe(2);
    // Should return benefits of active plan (Corte 2.0 / Plano Ativo)
    expect(json.clubPlan.id).toBe(planActive.id);
    expect(json.benefits.length).toBe(1);
  });

  it("should prevent creating overlapping active/grace period subscriptions", async () => {
    // 1. Create initial active subscription
    await prisma.customerClubSubscription.create({
      data: {
        barbershopId: barbershop.id,
        customerId: customer.id,
        clubPlanId: planActive.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01T00:00:00Z"),
        currentPeriodEnd: new Date("2026-06-30T00:00:00Z"),
      },
    });

    // 2. Try to create overlapping subscription via route
    const req = new NextRequest("http://localhost/api/admin/clube/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        customerId: customer.id,
        clubPlanId: planActive.id,
        status: "ACTIVE",
        currentPeriodStart: "2026-06-15T00:00:00Z",
        currentPeriodEnd: "2026-07-15T00:00:00Z",
      }),
    });

    const res = await subscriptionRoute.POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("OVERLAPPING_ACTIVE_SUBSCRIPTION");
  });

  it("should auto-mark clubBenefitRequested on comanda creation from eligible appointment", async () => {
    // 1. Set active subscription for customer
    await prisma.customerClubSubscription.create({
      data: {
        barbershopId: barbershop.id,
        customerId: customer.id,
        clubPlanId: planActive.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    // 2. Create appointment with the service
    const appointment = await prisma.appointment.create({
      data: {
        barbershopId: barbershop.id,
        customerId: customer.id,
        memberId: ownerMember.id,
        dateTime: new Date("2026-06-15T14:00:00Z"),
        status: "CONFIRMED",
        totalPrice: 50.00,
        durationMin: 30,
        services: {
          create: {
            serviceId: service.id,
            priceApplied: 50.00,
          },
        },
      },
    });

    // 3. Open comanda
    const req = new NextRequest("http://localhost/api/admin/comandas", {
      method: "POST",
      body: JSON.stringify({ appointmentId: appointment.id }),
    });

    const res = await comandaRoute.POST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.items[0].clubBenefitRequested).toBe(true);
    expect(json.items[0].requestedClubPlanBenefitId).not.toBeNull();
    // Subtotal and total should be R$ 0.00 in the comanda open state totals preview
    expect(Number(json.total)).toBe(0);
    expect(Number(json.subtotal)).toBe(0);
  });

  it("should calculate totals preview on open comanda and validate requested benefits", async () => {
    // 1. Create subscription
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: barbershop.id,
        customerId: customer.id,
        clubPlanId: planActive.id,
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-06-01"),
        currentPeriodEnd: new Date("2026-07-01"),
      },
    });

    const benefit = await prisma.clubPlanBenefit.findFirst({
      where: { clubPlanId: planActive.id },
    });

    // 2. Create open comanda
    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: barbershop.id,
        customerId: customer.id,
        customerName: customer.name,
        status: "OPEN",
        items: {
          create: {
            barbershopId: barbershop.id,
            type: "SERVICE",
            description: "Corte Masculino",
            quantity: 1,
            unitPrice: 50.00,
            total: 50.00,
            serviceId: service.id,
            executorId: ownerMember.id,
            clubBenefitRequested: true,
            requestedClubPlanBenefitId: benefit!.id,
          },
        },
      },
    });

    const { recalculateComandaTotals } = await import("@/lib/operations/comandas");
    const updated = await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda.id));

    // Verify preview total is R$ 0,00 and original item total is preserved
    expect(Number(updated.total)).toBe(0);
    const item = await prisma.comandaItem.findFirst({
      where: { comandaId: comanda.id },
    });
    expect(Number(item!.total)).toBe(50.00); // Preserved!
  });
});
