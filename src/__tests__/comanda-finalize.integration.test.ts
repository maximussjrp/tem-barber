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

type CommissionReportRow = {
  id: string;
  generatedAmount: string | number;
  releasedAmount: string | number;
  status: string;
};

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
      code: `test_plan_finalize_${label}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      name: `Plano Finalize ${label}`,
      price: "49.90",
      maxMembers: 10,
      isActive: true,
    },
  });
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

async function markServicesDone(comandaId: string) {
  await prisma.comandaItem.updateMany({
    where: { comandaId, type: "SERVICE", status: "PENDING" },
    data: { status: "DONE", completedAt: new Date() },
  });
}

describeIf("Fluxo de Finalização de Comanda Simplificada e Relatórios", { timeout: 30000 }, () => {
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
    await markServicesDone(comanda.id);

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
    await markServicesDone(comanda.id);

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

  it("fecha comanda com total zero sem criar Payment ou FinancialEntry", async () => {
    const tenant = await seedTenant("zero");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    const createComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    const comanda = await createComanda.json();
    await markServicesDone(comanda.id);

    const discountRes = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "DISCOUNT",
        amount: 50.00,
        description: "Cortesia integral",
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(discountRes.status).toBe(201);

    const finalizeRes = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, { payments: [] }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    expect(finalizeRes.status).toBe(200);
    const finalized = await finalizeRes.json();
    expect(finalized.status).toBe("CLOSED");
    expect(Number(finalized.total)).toBe(0);
    expect(await prisma.payment.count({ where: { comandaId: comanda.id } })).toBe(0);
    expect(await prisma.financialEntry.count({ where: { comandaId: comanda.id } })).toBe(0);
    const appt = await prisma.appointment.findUnique({ where: { id: tenant.appointment.id } });
    expect(appt?.status).toBe("COMPLETED");
  });

  it("retorna PAYMENT_REQUIRED para comanda positiva com payments vazio", async () => {
    const tenant = await seedTenant("payment-required");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    const createComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    const comanda = await createComanda.json();
    await markServicesDone(comanda.id);

    const finalizeRes = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, { payments: [] }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    expect(finalizeRes.status).toBe(422);
    const errorBody = await finalizeRes.json();
    expect(errorBody.error).toBe("PAYMENT_REQUIRED");
    expect(await prisma.payment.count({ where: { comandaId: comanda.id } })).toBe(0);
    expect(await prisma.financialEntry.count({ where: { comandaId: comanda.id } })).toBe(0);
  });

  it("bloqueia finalize com servico PENDING sem criar efeitos financeiros", async () => {
    const tenant = await seedTenant("pending-service");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    const createComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    const comanda = await createComanda.json();

    const finalizeRes = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 50.00 }],
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    expect(finalizeRes.status).toBe(422);
    const errorBody = await finalizeRes.json();
    expect(errorBody.error).toBe("PENDING_ITEMS");
    expect(await prisma.payment.count({ where: { comandaId: comanda.id } })).toBe(0);
    expect(await prisma.financialEntry.count({ where: { comandaId: comanda.id } })).toBe(0);
    const dbComanda = await prisma.comanda.findUnique({ where: { id: comanda.id } });
    expect(dbComanda?.status).toBe("OPEN");
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
    await markServicesDone(comanda.id);

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
    await markServicesDone(comanda.id);

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
    await markServicesDone(comanda.id);

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
    await markServicesDone(comanda.id);
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
    const barberRep = (list as CommissionReportRow[]).find((item) => item.id === tenant.barber.id);
    if (!barberRep) throw new Error("Relatório do barbeiro não encontrado");
    expect(Number(barberRep.generatedAmount)).toBe(25.00);
    expect(Number(barberRep.releasedAmount)).toBe(25.00);

    // O status do objeto retornado pelo filtro de datas é "REPORT"
    expect(barberRep.status).toBe("REPORT");

    // 2. Filtrar por competência mensal (padrão)
    const curCompetence = new Date().toISOString().slice(0, 7);
    const reqMonthly = new NextRequest(`http://localhost/api/admin/commissions?competence=${curCompetence}`);
    const resMonthly = await commissionsRoute.GET(reqMonthly);
    const listMonthly = await resMonthly.json();
    expect(listMonthly).toHaveLength(0); // O redesenho não cria novos CommissionPeriod legados.
  });

  describe("Idempotência da Rota Finalize com Alocações (C1-C6 Root Idempotency Patch)", () => {
    it("1-3. OPEN com dívida, replay legítimo e rejeição de payload conflitante", async () => {
      const tenant = await seedTenant("idem-debt");
      getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

      const createComanda = await comandasRoute.POST(
        jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
      );
      expect(createComanda.status).toBe(201);
      const comanda = await createComanda.json();
      await markServicesDone(comanda.id);

      const keyABC = `idem-key-abc-${Date.now()}`;
      const body1 = {
        allocations: [{ method: "PIX", receivedAmount: 30.0 }],
        closeWithDebt: true,
        confirmOutstandingBalance: true,
      };

      // 1. OPEN + allocations + closeWithDebt -> 200, CLOSED com dívida
      const res1 = await finalizeRoute.POST(
        jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, body1, keyABC),
        { params: Promise.resolve({ id: comanda.id }) }
      );
      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.status).toBe("CLOSED");
      expect(Number(json1.paidTotal)).toBe(30.0);
      expect(Number(json1.remainingTotal)).toBe(20.0);

      // Contagens antes do replay
      const txCountBefore = await prisma.checkoutTransaction.count({ where: { comandaId: comanda.id } });
      const paymentCountBefore = await prisma.payment.count({ where: { comandaId: comanda.id } });
      const tipCountBefore = await prisma.tipEntry.count({ where: { comandaId: comanda.id } });
      const creditCountBefore = await prisma.customerCreditEntry.count({ where: { comandaId: comanda.id } });
      expect(txCountBefore).toBe(1);
      expect(paymentCountBefore).toBe(1);

      // 2. Repetir exatamente request #1 mesma key ABC após comanda já estar CLOSED
      const res2 = await finalizeRoute.POST(
        jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, body1, keyABC),
        { params: Promise.resolve({ id: comanda.id }) }
      );
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.status).toBe("CLOSED");
      expect(Number(json2.paidTotal)).toBe(30.0);
      expect(Number(json2.remainingTotal)).toBe(20.0);

      // Contagens após replay (nenhum efeito duplicado)
      const txCountAfter = await prisma.checkoutTransaction.count({ where: { comandaId: comanda.id } });
      const paymentCountAfter = await prisma.payment.count({ where: { comandaId: comanda.id } });
      const tipCountAfter = await prisma.tipEntry.count({ where: { comandaId: comanda.id } });
      const creditCountAfter = await prisma.customerCreditEntry.count({ where: { comandaId: comanda.id } });
      expect(txCountAfter).toBe(txCountBefore);
      expect(paymentCountAfter).toBe(paymentCountBefore);
      expect(tipCountAfter).toBe(tipCountBefore);
      expect(creditCountAfter).toBe(creditCountBefore);

      // 3. Após #1: mesma key ABC payload diferente -> 409 IDEMPOTENCY_KEY_CONFLICT
      const bodyDiff = {
        allocations: [{ method: "PIX", receivedAmount: 40.0 }],
        closeWithDebt: true,
        confirmOutstandingBalance: true,
      };
      const res3 = await finalizeRoute.POST(
        jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, bodyDiff, keyABC),
        { params: Promise.resolve({ id: comanda.id }) }
      );
      expect(res3.status).toBe(409);
      const json3 = await res3.json();
      expect(json3.error).toBe("IDEMPOTENCY_KEY_CONFLICT");
    });

    it("4-5. Comanda quitada: rejeição de key nova e replay de FINALIZE quitado", async () => {
      const tenant = await seedTenant("idem-settled");
      getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

      const createComanda = await comandasRoute.POST(
        jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
      );
      const comanda = await createComanda.json();
      await markServicesDone(comanda.id);

      const fullKey = `full-settle-key-${Date.now()}`;
      const fullBody = {
        allocations: [{ method: "PIX", receivedAmount: 50.0 }],
      };

      // 5. Finalizar com quitação total
      const resOrig = await finalizeRoute.POST(
        jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, fullBody, fullKey),
        { params: Promise.resolve({ id: comanda.id }) }
      );
      expect(resOrig.status).toBe(200);
      const jsonOrig = await resOrig.json();
      expect(jsonOrig.status).toBe("CLOSED");
      expect(Number(jsonOrig.remainingTotal)).toBe(0);

      // 4. Comanda CLOSED totalmente quitada: key NOVA + allocations -> 422 COMANDA_ALREADY_SETTLED
      const newKey = `brand-new-key-${Date.now()}`;
      const resNew = await finalizeRoute.POST(
        jsonRequest(
          `http://localhost/api/admin/comandas/${comanda.id}/finalize`,
          { allocations: [{ method: "PIX", receivedAmount: 10.0 }] },
          newKey
        ),
        { params: Promise.resolve({ id: comanda.id }) }
      );
      expect(resNew.status).toBe(422);
      const jsonNew = await resNew.json();
      expect(jsonNew.error).toBe("COMANDA_ALREADY_SETTLED");

      // 5. Replay normal de FINALIZE totalmente quitado: mesma key + mesmo payload -> success 200
      const resReplay = await finalizeRoute.POST(
        jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, fullBody, fullKey),
        { params: Promise.resolve({ id: comanda.id }) }
      );
      expect(resReplay.status).toBe(200);
      const jsonReplay = await resReplay.json();
      expect(jsonReplay.status).toBe("CLOSED");
      expect(Number(jsonReplay.remainingTotal)).toBe(0);
    });

    it("6. Replay DEBT_PAYMENT existente: mesma key + mesmo payload -> 200", async () => {
      const tenant = await seedTenant("idem-debt-payment");
      getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

      const createComanda = await comandasRoute.POST(
        jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
      );
      const comanda = await createComanda.json();
      await markServicesDone(comanda.id);

      // Fecha com dívida: total 50, pago 20, resta 30
      await finalizeRoute.POST(
        jsonRequest(
          `http://localhost/api/admin/comandas/${comanda.id}/finalize`,
          {
            allocations: [{ method: "PIX", receivedAmount: 20.0 }],
            closeWithDebt: true,
            confirmOutstandingBalance: true,
          },
          `init-debt-${Date.now()}`
        ),
        { params: Promise.resolve({ id: comanda.id }) }
      );

      // Pagamento parcial de dívida (15.0)
      const debtKey = `debt-pay-key-${Date.now()}`;
      const debtBody = {
        allocations: [{ method: "PIX", receivedAmount: 15.0 }],
      };

      const resDebt1 = await finalizeRoute.POST(
        jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, debtBody, debtKey),
        { params: Promise.resolve({ id: comanda.id }) }
      );
      expect(resDebt1.status).toBe(200);
      const jsonDebt1 = await resDebt1.json();
      expect(jsonDebt1.status).toBe("CLOSED");
      expect(Number(jsonDebt1.paidTotal)).toBe(35.0);
      expect(Number(jsonDebt1.remainingTotal)).toBe(15.0);

      // Replay do pagamento de dívida com mesma key e mesmo payload -> 200
      const resDebtReplay = await finalizeRoute.POST(
        jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, debtBody, debtKey),
        { params: Promise.resolve({ id: comanda.id }) }
      );
      expect(resDebtReplay.status).toBe(200);
      const jsonDebtReplay = await resDebtReplay.json();
      expect(jsonDebtReplay.status).toBe("CLOSED");
      expect(Number(jsonDebtReplay.paidTotal)).toBe(35.0);
      expect(Number(jsonDebtReplay.remainingTotal)).toBe(15.0);
    });
  });
});
