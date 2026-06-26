import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { todayIsoBR } from "@/lib/time-utils";

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
let finalizeRoute: typeof import("@/app/api/admin/comandas/[id]/finalize/route");
let itemsRoute: typeof import("@/app/api/admin/comandas/[id]/items/route");
let productsRoute: typeof import("@/app/api/admin/products/route");
let cashOpenRoute: typeof import("@/app/api/admin/cash-sessions/open/route");
let commissionsRoute: typeof import("@/app/api/admin/commissions/route");

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

async function seedTenant(label: string) {
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbearia ${label}`,
      slug: `finalize-${label}`,
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
      dateTime: new Date(),
      totalPrice: "50.00",
      durationMin: 30,
      services: { create: [{ serviceId: cut.id, priceApplied: "50.00" }] },
    },
  });
  
  // Rule for commission: 50% for barber on cut service
  await prisma.commissionConfig.create({
    data: {
      barbershopId: shop.id,
      memberId: barber.id,
      scopeKey: `member:${barber.id}:default`,
      type: "PERCENTAGE",
      value: "50.00",
    }
  });

  return { shop, ownerUser, owner, barber, customer, cut, beard, appointment };
}

describeIf("Fluxo de Finalização de Comanda Simplificada e Relatórios", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    vi.resetModules();
    prisma = (await import("@/lib/prisma")).default as PrismaClient;
    comandasRoute = await import("@/app/api/admin/comandas/route");
    finalizeRoute = await import("@/app/api/admin/comandas/[id]/finalize/route");
    itemsRoute = await import("@/app/api/admin/comandas/[id]/items/route");
    productsRoute = await import("@/app/api/admin/products/route");
    cashOpenRoute = await import("@/app/api/admin/cash-sessions/open/route");
    commissionsRoute = await import("@/app/api/admin/commissions/route");
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("finaliza comanda OPEN com Pix + Dinheiro (com caixa aberto)", async () => {
    const tenant = await seedTenant("mixed");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    // 1. Abrir caixa
    const cashOpen = await cashOpenRoute.POST(jsonRequest("http://localhost/api/admin/cash-sessions/open", { openingAmount: "20.00" }));
    expect(cashOpen.status).toBe(201);

    // 2. Abrir comanda
    const createComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    expect(createComanda.status).toBe(201);
    const comanda = await createComanda.json();

    // 3. Finalizar com Pix + Dinheiro
    const finalizeRes = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [
          { method: "PIX", amount: 30.00 },
          { method: "CASH", amount: 20.00 }
        ]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(finalizeRes.status).toBe(200);
    const finalized = await finalizeRes.json();
    
    // Verificações
    expect(finalized.status).toBe("CLOSED");
    expect(finalized.remainingTotal.toString()).toBe("0");
    expect(finalized.paidTotal.toString()).toBe("50");

    // Agendamento vira COMPLETED
    const appt = await prisma.appointment.findUnique({ where: { id: tenant.appointment.id } });
    expect(appt?.status).toBe("COMPLETED");

    // Comissão gerada e liberada (50% de 50.00 = 25.00)
    const entry = await prisma.commissionEntry.findFirst({ where: { memberId: tenant.barber.id } });
    expect(entry).not.toBeNull();
    expect(Number(entry?.generatedAmount)).toBe(25);
    expect(Number(entry?.releasedAmount)).toBe(25); // 100% liberado pois foi totalmente paga
    expect(entry?.status).toBe("RELEASED");
  });

  it("finaliza sem dinheiro apenas com Pix/Cartão (sem caixa aberto)", async () => {
    const tenant = seedTenant("no-cash");
    const { appointment } = await tenant;
    getServerSessionMock.mockResolvedValue({ user: { id: (await tenant).ownerUser.id, role: "OWNER" } });

    // Abrir comanda
    const createComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: appointment.id })
    );
    const comanda = await createComanda.json();

    // Finalizar com Pix (sem caixa aberto)
    const finalizeRes = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [
          { method: "PIX", amount: 50.00 }
        ]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(finalizeRes.status).toBe(200);
    const finalized = await finalizeRes.json();
    expect(finalized.status).toBe("CLOSED");
  });

  it("retorna CASH_SESSION_REQUIRED e faz rollback total se pagar CASH sem caixa aberto", async () => {
    const tenant = await seedTenant("cash-error");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    // Criar produto com controle de estoque
    const productRes = await productsRoute.POST(
      jsonRequest("http://localhost/api/admin/products", {
        name: "Shampoo",
        salePrice: "10.00",
        trackStock: true,
        currentStock: "10",
      })
    );
    const product = await productRes.json();

    // Abrir comanda
    const createComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    const comanda = await createComanda.json();

    // Adicionar produto
    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: product.id,
        quantity: 1,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Finalizar com Dinheiro sem abrir o caixa
    const finalizeRes = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [
          { method: "CASH", amount: 60.00 }
        ]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    
    expect(finalizeRes.status).toBe(422);
    const errorBody = await finalizeRes.json();
    expect(errorBody.error).toBe("CASH_SESSION_REQUIRED");

    // Valida rollback: estoque inalterado, comanda não fechada, sem pagamentos criados
    const dbComanda = await prisma.comanda.findUnique({ where: { id: comanda.id } });
    expect(dbComanda?.status).toBe("OPEN");
    
    const dbProduct = await prisma.product.findUnique({ where: { id: product.id } });
    expect(Number(dbProduct?.currentStock)).toBe(10); // não sofreu baixa!

    const paymentsCount = await prisma.payment.count({ where: { comandaId: comanda.id } });
    expect(paymentsCount).toBe(0);
  });

  it("retorna INSUFFICIENT_STOCK e faz rollback total se não houver estoque", async () => {
    const tenant = await seedTenant("stock-error");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    // Criar produto com estoque = 1
    const productRes = await productsRoute.POST(
      jsonRequest("http://localhost/api/admin/products", {
        name: "Cera",
        salePrice: "20.00",
        trackStock: true,
        currentStock: "1",
      })
    );
    const product = await productRes.json();

    // Abrir comanda
    const createComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    const comanda = await createComanda.json();

    // Adicionar 2 unidades (não dispara erro ao adicionar, mas sim na hora de fechar/finalizar)
    // Para contornar a validação do addProductItem que impede adicionar mais do que o estoque,
    // criamos diretamente um item na comanda com quantidade = 2.
    await prisma.comandaItem.create({
      data: {
        comandaId: comanda.id,
        barbershopId: tenant.shop.id,
        type: "PRODUCT",
        description: "Cera",
        quantity: 2,
        unitPrice: "20.00",
        total: "40.00",
        productId: product.id,
      }
    });

    // Abrir caixa para evitar erro de caixa
    await cashOpenRoute.POST(jsonRequest("http://localhost/api/admin/cash-sessions/open", { openingAmount: "10.00" }));

    // Tentar finalizar a comanda (total agora é 50.00 + 40.00 = 90.00)
    const finalizeRes = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [
          { method: "PIX", amount: 90.00 }
        ]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    
    expect(finalizeRes.status).toBe(422);
    const errorBody = await finalizeRes.json();
    expect(errorBody.error).toBe("INSUFFICIENT_STOCK");

    // Valida rollback: comanda permanece OPEN
    const dbComanda = await prisma.comanda.findUnique({ where: { id: comanda.id } });
    expect(dbComanda?.status).toBe("OPEN");
  });

  it("protege contra duplo clique/idempotência", async () => {
    const tenant = await seedTenant("idempotency");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    const createComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    const comanda = await createComanda.json();

    const idempotencyKey = "test-double-click-finalize";

    // Enviar primeiro request
    const res1 = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 50.00 }]
      }, idempotencyKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(res1.status).toBe(200);

    // Enviar segundo request
    const res2 = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 50.00 }]
      }, idempotencyKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(res2.status).toBe(200);

    // Deve ter criado exatamente 1 pagamento no banco
    const paymentsCount = await prisma.payment.count({ where: { comandaId: comanda.id } });
    expect(paymentsCount).toBe(1);
  });

  it("testa filtros de visualização por data (startDate/endDate) e mantém competência mensal", async () => {
    const tenant = await seedTenant("filters");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    // Criar uma comissão completada na semana atual
    const createComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    const comanda = await createComanda.json();
    await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 50.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Obter data de hoje no formato YYYY-MM-DD
    const today = todayIsoBR();
    
    // 1. Filtrar por data de hoje (startDate/endDate)
    const reqFilter = new NextRequest(`http://localhost/api/admin/commissions?startDate=${today}&endDate=${today}`);
    const resFilter = await commissionsRoute.GET(reqFilter);
    expect(resFilter.status).toBe(200);
    const list = await resFilter.json();
    expect(list).toHaveLength(2); // Retorna os members ativos (Owner e Barber)
    const barberRep = list.find((item: any) => item.id === tenant.barber.id);
    expect(Number(barberRep.generatedAmount)).toBe(25.00);
    expect(Number(barberRep.releasedAmount)).toBe(25.00);

    // O status do objeto retornado pelo filtro de datas é "REPORT"
    expect(barberRep.status).toBe("REPORT");

    // 2. Filtrar por competência mensal (padrão)
    const curCompetence = new Date().toISOString().slice(0, 7);
    const reqMonthly = new NextRequest(`http://localhost/api/admin/commissions?competence=${curCompetence}`);
    const resMonthly = await commissionsRoute.GET(reqMonthly);
    const listMonthly = await resMonthly.json();
    expect(listMonthly).toHaveLength(1); // Somente o barbeiro tem comissão gerada no período real
    expect(listMonthly[0].status).toBe("OPEN"); // O status do período mensal é "OPEN"
  });
});
