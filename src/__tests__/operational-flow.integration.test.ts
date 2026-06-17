import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
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
  !/prod|production/i.test(testDatabaseUrl);
const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;
let comandasRoute: typeof import("@/app/api/admin/comandas/route");
let comandaRoute: typeof import("@/app/api/admin/comandas/[id]/route");
let itemsRoute: typeof import("@/app/api/admin/comandas/[id]/items/route");
let itemRoute: typeof import("@/app/api/admin/comandas/[id]/items/[itemId]/route");
let paymentsRoute: typeof import("@/app/api/admin/comandas/[id]/payments/route");
let refundRoute: typeof import("@/app/api/admin/comandas/[id]/payments/[paymentId]/refund/route");
let productsRoute: typeof import("@/app/api/admin/products/route");
let cashOpenRoute: typeof import("@/app/api/admin/cash-sessions/open/route");
let cashCloseRoute: typeof import("@/app/api/admin/cash-sessions/[id]/close/route");
let summaryRoute: typeof import("@/app/api/admin/financial/daily-summary/route");

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

async function truncateDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
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

async function seedTenant(label: string) {
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbearia ${label}`,
      slug: `release-${label}`,
      phone: `11990${label.charCodeAt(0)}`,
      zipCode: "00000-000",
      street: "Rua Teste",
      number: "1",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP",
    },
  });
  const ownerUser = await prisma.user.create({
    data: { name: `Owner ${label}`, phone: `11991${label.charCodeAt(0)}` },
  });
  const barberUser = await prisma.user.create({
    data: { name: `Barber ${label}`, phone: `11992${label.charCodeAt(0)}` },
  });
  const customer = await prisma.user.create({
    data: { name: `Cliente ${label}`, phone: `11993${label.charCodeAt(0)}` },
  });
  const owner = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: ownerUser.id, role: "OWNER" },
  });
  const barber = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: barberUser.id, role: "BARBER" },
  });
  const category = await prisma.category.create({
    data: { barbershopId: shop.id, name: "Servicos", slug: `servicos-${label}` },
  });
  const cut = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Corte", price: "50.00", durationMin: 30 },
  });
  const beard = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Barba", price: "30.00", durationMin: 30 },
  });
  await prisma.barberService.create({ data: { barberId: barber.id, serviceId: cut.id } });
  await prisma.barberService.create({ data: { barberId: barber.id, serviceId: beard.id } });
  const appointment = await prisma.appointment.create({
    data: {
      barbershopId: shop.id,
      memberId: barber.id,
      customerId: customer.id,
      dateTime: new Date("2026-07-20T13:00:00.000Z"),
      totalPrice: "50.00",
      durationMin: 30,
      services: { create: [{ serviceId: cut.id, priceApplied: "50.00" }] },
    },
  });
  return { shop, ownerUser, owner, barber, customer, cut, beard, appointment };
}

describeIf("release operacional 1A", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    vi.resetModules();
    prisma = (await import("@/lib/prisma")).default as PrismaClient;
    comandasRoute = await import("@/app/api/admin/comandas/route");
    comandaRoute = await import("@/app/api/admin/comandas/[id]/route");
    itemsRoute = await import("@/app/api/admin/comandas/[id]/items/route");
    itemRoute = await import("@/app/api/admin/comandas/[id]/items/[itemId]/route");
    paymentsRoute = await import("@/app/api/admin/comandas/[id]/payments/route");
    refundRoute = await import("@/app/api/admin/comandas/[id]/payments/[paymentId]/refund/route");
    productsRoute = await import("@/app/api/admin/products/route");
    cashOpenRoute = await import("@/app/api/admin/cash-sessions/open/route");
    cashCloseRoute = await import("@/app/api/admin/cash-sessions/[id]/close/route");
    summaryRoute = await import("@/app/api/admin/financial/daily-summary/route");
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("executa fluxo de aceite com comanda, pagamento, caixa, estoque e financeiro", async () => {
    const tenant = await seedTenant("a");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    const cashOpen = await cashOpenRoute.POST(jsonRequest("http://localhost/api/admin/cash-sessions/open", { openingAmount: "20.00" }));
    expect(cashOpen.status).toBe(201);

    const createComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    expect(createComanda.status).toBe(201);
    const comanda = await createComanda.json();
    expect(comanda.items).toHaveLength(1);

    const repeated = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    expect((await repeated.json()).id).toBe(comanda.id);
    expect(await prisma.comanda.count({ where: { appointmentId: tenant.appointment.id } })).toBe(1);

    await comandaRoute.PATCH(jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}`, { status: "IN_SERVICE" }), {
      params: Promise.resolve({ id: comanda.id }),
    });

    const addBeard = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "SERVICE",
        serviceId: tenant.beard.id,
        executorId: tenant.barber.id,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(addBeard.status).toBe(201);

    const productRes = await productsRoute.POST(
      jsonRequest("http://localhost/api/admin/products", {
        name: "Pomada",
        salePrice: "40.00",
        trackStock: true,
        currentStock: "5",
      })
    );
    const product = await productRes.json();

    const addProduct = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: product.id,
        quantity: 1,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(addProduct.status).toBe(201);

    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "DISCOUNT",
        amount: "10.00",
        description: "Desconto autorizado",
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    const latest = await prisma.comanda.findUniqueOrThrow({
      where: { id: comanda.id },
      include: { items: true },
    });
    for (const item of latest.items.filter((row) => row.type !== "DISCOUNT")) {
      await itemRoute.PATCH(
        jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item.id}`, { status: "DONE" }),
        { params: Promise.resolve({ id: comanda.id, itemId: item.id }) }
      );
    }

    await comandaRoute.PATCH(jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}`, { status: "PENDING_PAYMENT" }), {
      params: Promise.resolve({ id: comanda.id }),
    });

    const cashPayment = await paymentsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments`, { method: "CASH", amount: "30.00" }, "payment-cash"),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(cashPayment.status).toBe(201);
    await paymentsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments`, { method: "CASH", amount: "30.00" }, "payment-cash"),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(await prisma.payment.count({ where: { idempotencyKey: "payment-cash" } })).toBe(1);

    await paymentsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments`, { method: "PIX", amount: "80.00" }, "payment-pix"),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    const close = await comandaRoute.PATCH(jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}`, { status: "CLOSED" }), {
      params: Promise.resolve({ id: comanda.id }),
    });
    expect(close.status).toBe(200);
    expect(await prisma.stockMovement.count({ where: { productId: product.id, type: "SALE" } })).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock.toString()).toBe("4");

    const summary = await summaryRoute.GET(new NextRequest("http://localhost/api/admin/financial/daily-summary?date=2026-06-17"));
    expect(summary.status).toBe(200);
    expect(await prisma.financialEntry.count({ where: { comandaId: comanda.id, type: "COMMAND_REVENUE" } })).toBe(2);

    const cashSession = await prisma.cashSession.findFirstOrThrow({ where: { barbershopId: tenant.shop.id, status: "OPEN" } });
    const closedCash = await cashCloseRoute.POST(
      jsonRequest(`http://localhost/api/admin/cash-sessions/${cashSession.id}/close`, { closingAmount: "50.00" }),
      { params: Promise.resolve({ id: cashSession.id }) }
    );
    expect(closedCash.status).toBe(200);
  });

  it("permite comanda sem agendamento e bloqueia acesso cruzado entre tenants", async () => {
    const tenantA = await seedTenant("a");
    const tenantB = await seedTenant("b");
    getServerSessionMock.mockResolvedValue({ user: { id: tenantA.ownerUser.id, role: "OWNER" } });

    const walkIn = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", {
        customerName: "Cliente avulso",
        customerPhone: "11999990000",
      })
    );
    expect(walkIn.status).toBe(201);
    const comanda = await walkIn.json();
    expect(comanda.appointmentId).toBeNull();

    const crossTenant = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "SERVICE",
        serviceId: tenantB.cut.id,
        executorId: tenantA.barber.id,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(crossTenant.status).toBe(400);
  });

  it("estorna pagamento sem apagar historico e bloqueia excesso", async () => {
    const tenant = await seedTenant("a");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });
    await cashOpenRoute.POST(jsonRequest("http://localhost/api/admin/cash-sessions/open", { openingAmount: "10.00" }));
    const created = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    const comanda = await created.json();
    await paymentsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments`, { method: "CASH", amount: "50.00" }, "refund-base"),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    const payment = await prisma.payment.findFirstOrThrow({ where: { idempotencyKey: "refund-base" } });

    const refund = await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment.id}/refund`, {
        amount: "20.00",
        reason: "Ajuste",
      }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment.id }) }
    );
    expect(refund.status).toBe(200);
    const excess = await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment.id}/refund`, {
        amount: "40.00",
        reason: "Excesso",
      }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment.id }) }
    );
    expect(excess.status).toBe(422);
    expect(await prisma.payment.count({ where: { refundOfId: payment.id } })).toBe(1);
  });
});

