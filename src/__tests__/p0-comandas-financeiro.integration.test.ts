import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";

const { getServerSessionMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  testDatabaseUrl &&
  /match_barber_test|localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) &&
  !/prod|production|app\.tembarber\.com\.br/i.test(testDatabaseUrl);

let prisma: PrismaClient;
let callNextWaitlistEntry: typeof import("@/lib/waitlist/call-next").callNextWaitlistEntry;
let itemsRoute: typeof import("@/app/api/admin/comandas/[id]/items/route");
let finalizeRoute: typeof import("@/app/api/admin/comandas/[id]/finalize/route");
let financialSummaryRoute: typeof import("@/app/api/admin/financial/summary/route");
let todayIsoBR: typeof import("@/lib/time-utils").todayIsoBR;

type SeedTenant = Awaited<ReturnType<typeof seedTenant>>;

function jsonRequest(url: string, body: unknown, key?: string) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key && { "Idempotency-Key": key }),
    },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string) {
  return new NextRequest(url);
}

async function truncateDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
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
      "online_waitlist_member_configs",
      "online_waitlist_entries",
      "online_waitlist_sessions",
      "appointment_services",
      "appointments",
      "barber_services",
      "working_hours",
      "services",
      "categories",
      "barbershop_members",
      "tenant_subscriptions",
      "barbershops",
      "plans",
      "users"
    CASCADE
  `);
}

async function seedTenant(label: string) {
  const plan = await prisma.plan.create({
    data: {
      name: `Plano P0 ${label}`,
      price: "49.90",
      maxMembers: 10,
      isActive: true,
    },
  });
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbearia P0 ${label}`,
      slug: `p0-${label}`,
      phone: `11988${label.charCodeAt(0)}`,
      zipCode: "00000-000",
      street: "Rua Teste",
      number: "1",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP",
    },
  });
  await prisma.tenantSubscription.create({
    data: {
      barbershopId: shop.id,
      planId: plan.id,
      status: "TRIAL",
      planName: plan.name,
      monthlyPrice: plan.price,
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
  });

  const ownerUser = await prisma.user.create({
    data: { name: `Owner P0 ${label}`, phone: `11991${label.charCodeAt(0)}` },
  });
  const barberUser = await prisma.user.create({
    data: { name: `Barber P0 ${label}`, phone: `11992${label.charCodeAt(0)}` },
  });
  const customer = await prisma.user.create({
    data: { name: `Cliente P0 ${label}`, phone: `11993${label.charCodeAt(0)}` },
  });
  const owner = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: ownerUser.id, role: "OWNER" },
  });
  const barber = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: barberUser.id, role: "BARBER" },
  });
  const category = await prisma.category.create({
    data: { barbershopId: shop.id, name: "Servicos", slug: `servicos-p0-${label}` },
  });
  const cut = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Corte", price: "50.00", durationMin: 30 },
  });
  const beard = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Barba", price: "30.00", durationMin: 30 },
  });
  await prisma.barberService.create({ data: { barberId: barber.id, serviceId: cut.id } });
  await prisma.barberService.create({ data: { barberId: barber.id, serviceId: beard.id } });
  return { plan, shop, ownerUser, owner, barber, customer, cut, beard };
}

async function seedWaitlistEntry(tenant: SeedTenant, queueNumber: number) {
  const session = await prisma.onlineWaitlistSession.create({
    data: {
      barbershopId: tenant.shop.id,
      status: "OPEN",
      defaultLockBeforeAppointmentMinutes: 0,
      createdById: tenant.ownerUser.id,
    },
  });
  const entry = await prisma.onlineWaitlistEntry.create({
    data: {
      sessionId: session.id,
      barbershopId: tenant.shop.id,
      customerId: tenant.customer.id,
      customerName: tenant.customer.name,
      customerPhone: tenant.customer.phone,
      serviceId: tenant.cut.id,
      queueNumber,
      positionWeight: queueNumber,
      publicTokenHash: `hash-p0-${queueNumber}`,
    },
  });
  return { session, entry };
}

async function markServicesDone(comandaId: string) {
  await prisma.comandaItem.updateMany({
    where: { comandaId, type: "SERVICE", status: "PENDING" },
    data: { status: "DONE", completedAt: new Date() },
  });
}

async function getSummary(tenant: SeedTenant, startDate: string, endDate = startDate) {
  getServerSessionMock.mockResolvedValue({
    user: { id: tenant.ownerUser.id, role: "OWNER", email: null },
  });
  const response = await financialSummaryRoute.GET(
    getRequest(`http://localhost/api/admin/financial/summary?startDate=${startDate}&endDate=${endDate}`)
  );
  expect(response.status).toBe(200);
  return response.json();
}

describe("Gate P0 comandas e financeiro com PostgreSQL", () => {
  beforeAll(async () => {
    if (!canRunIntegration) return;
    process.env.DATABASE_URL = testDatabaseUrl;
    vi.resetModules();
    prisma = (await import("@/lib/prisma")).default as PrismaClient;
    callNextWaitlistEntry = (await import("@/lib/waitlist/call-next")).callNextWaitlistEntry;
    itemsRoute = await import("@/app/api/admin/comandas/[id]/items/route");
    finalizeRoute = await import("@/app/api/admin/comandas/[id]/finalize/route");
    financialSummaryRoute = await import("@/app/api/admin/financial/summary/route");
    todayIsoBR = (await import("@/lib/time-utils")).todayIsoBR;
  });

  beforeEach(async () => {
    if (!canRunIntegration) return;
    await truncateDatabase();
    getServerSessionMock.mockReset();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("cobre FIT_IN_WAITLIST, itens, fechamento, financeiro, timezone e tenant isolation", async () => {
    if (!canRunIntegration) return;
    const tenantA = await seedTenant("a");
    const tenantB = await seedTenant("b");
    await seedWaitlistEntry(tenantA, 1);

    const result = await callNextWaitlistEntry({
      barbershopId: tenantA.shop.id,
      memberId: tenantA.barber.id,
      calledByUserId: tenantA.ownerUser.id,
    });

    expect(result.appointment.bookingMode).toBe("FIT_IN");
    expect(result.comandaId).toBeTruthy();

    const createdComanda = await prisma.comanda.findFirstOrThrow({
      where: { appointmentId: result.appointment.id, barbershopId: tenantA.shop.id },
      include: { items: true },
    });
    expect(createdComanda.id).toBe(result.comandaId);
    expect(createdComanda.items).toHaveLength(1);
    expect(createdComanda.items[0].serviceId).toBe(tenantA.cut.id);

    const createdEntry = await prisma.onlineWaitlistEntry.findFirstOrThrow({
      where: { fitInAppointmentId: result.appointment.id },
    });
    expect(createdEntry.status).toBe("FIT_IN_CREATED");

    getServerSessionMock.mockResolvedValue({
      user: { id: tenantA.ownerUser.id, role: "OWNER", email: null },
    });

    const addService = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${createdComanda.id}/items`, {
        type: "SERVICE",
        serviceId: tenantA.beard.id,
        executorId: tenantA.barber.id,
      }),
      { params: Promise.resolve({ id: createdComanda.id }) }
    );
    expect(addService.status).toBe(201);

    const addSurcharge = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${createdComanda.id}/items`, {
        type: "SURCHARGE",
        amount: "5.00",
        description: "Ajuste P0",
      }),
      { params: Promise.resolve({ id: createdComanda.id }) }
    );
    expect(addSurcharge.status).toBe(201);

    await markServicesDone(createdComanda.id);

    const beforeFinalize = await prisma.comanda.findUniqueOrThrow({
      where: { id: createdComanda.id },
      include: { items: true },
    });
    expect(beforeFinalize.items.filter((item) => item.type === "SERVICE")).toHaveLength(2);
    expect(beforeFinalize.items.some((item) => item.serviceId === tenantA.cut.id)).toBe(true);
    expect(beforeFinalize.items.some((item) => item.serviceId === tenantA.beard.id)).toBe(true);
    expect(Number(beforeFinalize.subtotal)).toBe(30);
    expect(Number(beforeFinalize.surchargeTotal)).toBe(5);
    expect(Number(beforeFinalize.total)).toBe(35);

    const finalize = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${createdComanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 35 }],
      }),
      { params: Promise.resolve({ id: createdComanda.id }) }
    );
    expect(finalize.status).toBe(200);
    const finalized = await finalize.json();
    expect(finalized.status).toBe("CLOSED");

    expect(await prisma.payment.count({ where: { comandaId: createdComanda.id, status: "CONFIRMED" } })).toBe(1);
    expect(
      await prisma.financialEntry.count({
        where: { comandaId: createdComanda.id, type: "COMMAND_REVENUE", amount: "35.00" },
      })
    ).toBe(1);

    await prisma.financialEntry.create({
      data: {
        barbershopId: tenantA.shop.id,
        type: "MANUAL_IN",
        category: "Ajuste",
        amount: "12.00",
        description: "Entrada manual P0",
        userId: tenantA.ownerUser.id,
      },
    });

    const todaySummary = await getSummary(tenantA, todayIsoBR());
    expect(todaySummary.totals.commandReceived).toBe(35);
    expect(todaySummary.totals.manualIncome).toBe(12);
    expect(todaySummary.totals.totalReceived).toBe(47);
    expect(todaySummary.totals.totalSurcharges).toBe(5);
    expect(todaySummary.totals.netRevenue).toBe(35);

    const localLateNightUtc = new Date("2026-07-16T01:30:00.000Z");
    await prisma.comanda.create({
      data: {
        barbershopId: tenantA.shop.id,
        customerName: "Cliente local late",
        status: "CLOSED",
        subtotal: "10.00",
        total: "10.00",
        paidTotal: "10.00",
        remainingTotal: "0.00",
        openedAt: localLateNightUtc,
        closedAt: localLateNightUtc,
      },
    });
    await prisma.comanda.create({
      data: {
        barbershopId: tenantB.shop.id,
        customerName: "Cliente outro tenant",
        status: "CLOSED",
        subtotal: "999.00",
        total: "999.00",
        paidTotal: "999.00",
        remainingTotal: "0.00",
        openedAt: localLateNightUtc,
        closedAt: localLateNightUtc,
      },
    });

    const july15 = await getSummary(tenantA, "2026-07-15");
    expect(july15.totals.grossRevenue).toBe(10);
    expect(july15.closedCommands.amount).toBe(10);

    const july16 = await getSummary(tenantA, "2026-07-16");
    expect(july16.totals.grossRevenue).toBe(0);
    expect(july16.closedCommands.amount).toBe(0);
  });

  it("fecha comanda zero, bloqueia PAYMENT_REQUIRED/PENDING_ITEMS e permite DONE", async () => {
    if (!canRunIntegration) return;
    const tenant = await seedTenant("rules");
    getServerSessionMock.mockResolvedValue({
      user: { id: tenant.ownerUser.id, role: "OWNER", email: null },
    });

    const appointment = await prisma.appointment.create({
      data: {
        barbershopId: tenant.shop.id,
        memberId: tenant.barber.id,
        customerId: tenant.customer.id,
        dateTime: new Date("2026-07-29T13:00:00.000Z"),
        totalPrice: "50.00",
        durationMin: 30,
        services: { create: [{ serviceId: tenant.cut.id, priceApplied: "50.00" }] },
      },
    });

    const { ensureComandaForAppointment } = await import("@/lib/operations/comandas");
    const comanda = await prisma.$transaction((tx) =>
      ensureComandaForAppointment(tx, { barbershopId: tenant.shop.id, appointmentId: appointment.id })
    );

    const pending = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 50 }],
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(pending.status).toBe(422);
    expect((await pending.json()).error).toBe("PENDING_ITEMS");

    await markServicesDone(comanda.id);

    const positiveNoPayment = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, { payments: [] }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(positiveNoPayment.status).toBe(422);
    expect((await positiveNoPayment.json()).error).toBe("PAYMENT_REQUIRED");

    const discount = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "DISCOUNT",
        amount: "50.00",
        description: "Cortesia P0",
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(discount.status).toBe(201);

    const zero = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, { payments: [] }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(zero.status).toBe(200);
    expect((await zero.json()).status).toBe("CLOSED");
    expect(await prisma.payment.count({ where: { comandaId: comanda.id } })).toBe(0);
    expect(await prisma.financialEntry.count({ where: { comandaId: comanda.id } })).toBe(0);

    const paidAppointment = await prisma.appointment.create({
      data: {
        barbershopId: tenant.shop.id,
        memberId: tenant.barber.id,
        customerId: tenant.customer.id,
        dateTime: new Date("2026-07-29T14:00:00.000Z"),
        totalPrice: "50.00",
        durationMin: 30,
        services: { create: [{ serviceId: tenant.cut.id, priceApplied: "50.00" }] },
      },
    });
    const paidComanda = await prisma.$transaction((tx) =>
      ensureComandaForAppointment(tx, { barbershopId: tenant.shop.id, appointmentId: paidAppointment.id })
    );
    await markServicesDone(paidComanda.id);
    const done = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${paidComanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 50 }],
      }),
      { params: Promise.resolve({ id: paidComanda.id }) }
    );
    expect(done.status).toBe(200);
    expect((await done.json()).status).toBe("CLOSED");
  });

  it("reverte appointment e fila quando a etapa de comanda falha dentro da transacao", async () => {
    if (!canRunIntegration) return;
    const tenant = await seedTenant("rollback");
    const { entry } = await seedWaitlistEntry(tenant, 9);

    await vi.resetModules();
    vi.doMock("@/lib/operations/comandas", async (importOriginal) => {
      const original = await importOriginal<typeof import("@/lib/operations/comandas")>();
      return {
        ...original,
        ensureComandaForAppointment: vi.fn(async () => {
          throw new Error("SIMULATED_COMANDA_CREATE_FAILURE");
        }),
      };
    });
    const failingCallNext = (await import("@/lib/waitlist/call-next")).callNextWaitlistEntry;

    await expect(
      failingCallNext({
        barbershopId: tenant.shop.id,
        memberId: tenant.barber.id,
        calledByUserId: tenant.ownerUser.id,
      })
    ).rejects.toThrow("SIMULATED_COMANDA_CREATE_FAILURE");

    expect(await prisma.appointment.count({ where: { bookingMode: "FIT_IN", barbershopId: tenant.shop.id } })).toBe(0);
    expect(await prisma.comanda.count({ where: { barbershopId: tenant.shop.id } })).toBe(0);
    const dbEntry = await prisma.onlineWaitlistEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(dbEntry.status).toBe("WAITING");
    expect(dbEntry.fitInAppointmentId).toBeNull();
  });
});
