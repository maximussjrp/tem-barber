import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { todayIsoBR, shiftDateISO, formatTimestampToCivilDateBR } from "@/lib/time-utils";
import { bootstrapFinancialPlan } from "@/lib/financial/default-plan";
import { getCashFlowReport } from "@/lib/financial/cash-flow";
import { getCustomerCreditAccount } from "@/lib/operations/customer-credit";

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
let paymentsRoute: typeof import("@/app/api/admin/comandas/[id]/payments/route");
let cashOpenRoute: typeof import("@/app/api/admin/cash-sessions/open/route");

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
      "checkout_allocations",
      "checkout_transactions",
      "customer_credit_entries",
      "customer_credit_accounts",
      "tip_entries",
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
      code: `test_plan_eff_${label}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      name: `Plano Effective Date ${label}`,
      price: "49.90",
      maxMembers: 10,
      isActive: true,
    },
  });
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbearia ${label}`,
      slug: `eff-date-${label}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      phone: `11990${Math.floor(Math.random() * 100000)}`,
      zipCode: "00000-000",
      street: "Rua Teste",
      number: "1",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP",
    },
  });
  await bootstrapFinancialPlan(prisma, shop.id);
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
    data: { name: `Owner ${label}`, phone: `11991${Math.floor(Math.random() * 100000)}` },
  });
  const barberUser = await prisma.user.create({
    data: { name: `Barber ${label}`, phone: `11992${Math.floor(Math.random() * 100000)}` },
  });
  const customer = await prisma.user.create({
    data: { name: `Cliente ${label}`, phone: `11993${Math.floor(Math.random() * 100000)}` },
  });
  const owner = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: ownerUser.id, role: "OWNER" },
  });
  const barber = await prisma.barbershopMember.create({
    data: { barbershopId: shop.id, userId: barberUser.id, role: "BARBER" },
  });
  const category = await prisma.category.create({
    data: { barbershopId: shop.id, name: "Servicos", slug: `servicos-${label}-${Date.now()}` },
  });
  const cut = await prisma.service.create({
    data: { barbershopId: shop.id, categoryId: category.id, name: "Corte", price: "50.00", durationMin: 30 },
  });
  await prisma.barberService.create({ data: { barberId: barber.id, serviceId: cut.id } });

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

  return { shop, ownerUser, owner, barberUser, barber, customer, cut, appointment };
}

async function createAppointmentForTenant(tenant: any, dateIso: string) {
  return prisma.appointment.create({
    data: {
      barbershopId: tenant.shop.id,
      memberId: tenant.barber.id,
      customerId: tenant.customer.id,
      dateTime: new Date(`${dateIso}T14:00:00.000Z`),
      totalPrice: "50.00",
      durationMin: 30,
      services: { create: [{ serviceId: tenant.cut.id, priceApplied: "50.00" }] },
    },
  });
}

async function markServicesDone(comandaId: string) {
  await prisma.comandaItem.updateMany({
    where: { comandaId, type: "SERVICE", status: "PENDING" },
    data: { status: "DONE", completedAt: new Date() },
  });
}

describeIf("UX1.2 PostgreSQL Real Integration Tests (TEMBARBER_UX1_2_PAYMENT_EFFECTIVE_DATE)", { timeout: 45000 }, () => {
  const today = todayIsoBR();
  const yesterday = shiftDateISO(today, -1);
  const tomorrow = shiftDateISO(today, 1);

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    vi.resetModules();
    prisma = (await import("@/lib/prisma")).default as PrismaClient;
    comandasRoute = await import("@/app/api/admin/comandas/route");
    finalizeRoute = await import("@/app/api/admin/comandas/[id]/finalize/route");
    paymentsRoute = await import("@/app/api/admin/comandas/[id]/payments/route");
    cashOpenRoute = await import("@/app/api/admin/cash-sessions/open/route");
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("1. Comanda de ontem recebida ontem e fechada hoje (relatório financeiro reflete data efetiva)", async () => {
    const tenant = await seedTenant("ontem-ontem");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    // 1. Cria agendamento de ontem e abre comanda
    const appt = await createAppointmentForTenant(tenant, yesterday);
    const resCreate = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: appt.id })
    );
    expect(resCreate.status).toBe(201);
    const comanda = await resCreate.json();
    await markServicesDone(comanda.id);

    // 2. Finaliza hoje com data efetiva de ontem (PIX)
    const resFinalize = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: "50.00" }],
        paidAt: yesterday,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resFinalize.status).toBe(200);

    // 3. Valida no banco: Payment e FinancialEntry com paidAt/entryDate de ontem, createdAt de hoje
    const payment = await prisma.payment.findFirst({ where: { comandaId: comanda.id } });
    expect(payment).toBeDefined();
    expect(formatTimestampToCivilDateBR(payment!.paidAt)).toBe(yesterday);
    expect(formatTimestampToCivilDateBR(payment!.createdAt)).toBe(today);

    const fe = await prisma.financialEntry.findFirst({ where: { comandaId: comanda.id } });
    expect(fe).toBeDefined();
    expect(formatTimestampToCivilDateBR(fe!.entryDate)).toBe(yesterday);
    expect(formatTimestampToCivilDateBR(fe!.createdAt)).toBe(today);

    // Comanda encerrada hoje
    const closedComanda = await prisma.comanda.findUnique({ where: { id: comanda.id } });
    expect(closedComanda!.status).toBe("CLOSED");
    expect(formatTimestampToCivilDateBR(closedComanda!.closedAt!)).toBe(today);

    // 4. Validação de Relatório / Fluxo de Caixa:
    // Ontem deve conter o recebimento
    const flowYesterday = await getCashFlowReport({
      barbershopId: tenant.shop.id,
      startDate: yesterday,
      endDate: yesterday,
    }, prisma);
    expect(Number(flowYesterday.realized.inflow)).toBe(50);

    // Hoje NÃO deve conter o recebimento
    const flowToday = await getCashFlowReport({
      barbershopId: tenant.shop.id,
      startDate: today,
      endDate: today,
    }, prisma);
    expect(Number(flowToday.realized.inflow)).toBe(0);
  });

  it("2. Comanda de ontem recebida hoje (data efetiva de hoje)", async () => {
    const tenant = await seedTenant("ontem-hoje");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    const appt = await createAppointmentForTenant(tenant, yesterday);
    const resCreate = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: appt.id })
    );
    expect(resCreate.status).toBe(201);
    const comanda = await resCreate.json();
    await markServicesDone(comanda.id);

    // Finaliza com opção padrão (Recebi hoje)
    const resFinalize = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: "50.00" }],
        paidAt: today,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resFinalize.status).toBe(200);

    const payment = await prisma.payment.findFirst({ where: { comandaId: comanda.id } });
    expect(formatTimestampToCivilDateBR(payment!.paidAt)).toBe(today);

    const flowToday = await getCashFlowReport({
      barbershopId: tenant.shop.id,
      startDate: today,
      endDate: today,
    }, prisma);
    expect(Number(flowToday.realized.inflow)).toBe(50);
  });

  it("3. Pagamento parcial e recebimento posterior de saldo em comanda fechada com dívida", async () => {
    const tenant = await seedTenant("debt-subsequent");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    const resCreate = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    expect(resCreate.status).toBe(201);
    const comanda = await resCreate.json();
    await markServicesDone(comanda.id);

    // 1. Fecha com pagamento parcial (R$ 20 de R$ 50) e dívida
    const resPartial = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: "20.00" }],
        closeWithDebt: true,
        confirmOutstandingBalance: true,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resPartial.status).toBe(200);

    const comandaClosed = await prisma.comanda.findUnique({ where: { id: comanda.id } });
    expect(comandaClosed!.status).toBe("CLOSED");
    expect(Number(comandaClosed!.remainingTotal)).toBe(30);

    // 2. Recebimento posterior do saldo restante (R$ 30) via rota /payments com paidAt retroativo
    const resDebtPay = await paymentsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments`, {
        method: "PIX",
        amount: "30.00",
        paidAt: yesterday,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resDebtPay.status).toBe(201);

    const payments = await prisma.payment.findMany({
      where: { comandaId: comanda.id },
      orderBy: { createdAt: "asc" },
    });
    expect(payments.length).toBe(2);
    expect(Number(payments[0].amount)).toBe(20);
    expect(formatTimestampToCivilDateBR(payments[0].paidAt)).toBe(today);

    expect(Number(payments[1].amount)).toBe(30);
    expect(formatTimestampToCivilDateBR(payments[1].paidAt)).toBe(yesterday);

    const comandaFinal = await prisma.comanda.findUnique({ where: { id: comanda.id } });
    expect(Number(comandaFinal!.remainingTotal)).toBe(0);
  });

  it("4. Checkout misto com alocação e bloqueio de DINHEIRO retroativo", async () => {
    const tenant = await seedTenant("mixed-cash-guard");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    // Abrir caixa para testar que mesmo com caixa aberto, dinheiro retroativo é bloqueado
    await cashOpenRoute.POST(jsonRequest("http://localhost/api/admin/cash-sessions/open", { openingAmount: "50.00" }));

    const resCreate = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    expect(resCreate.status).toBe(201);
    const comanda = await resCreate.json();
    await markServicesDone(comanda.id);

    // Tentativa de checkout com DINHEIRO retroativo via allocations -> deve falhar com CASH_BACKDATING_NOT_SUPPORTED
    const resBlocked = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        allocations: [
          { method: "PIX", receivedAmount: "30.00" },
          { method: "CASH", receivedAmount: "20.00" },
        ],
        paidAt: yesterday,
      }, "idemp-cash-retro"),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resBlocked.status).toBe(422);
    const blockedBody = await resBlocked.json();
    expect(blockedBody.error).toBe("CASH_BACKDATING_NOT_SUPPORTED");

    // Garante rollback total: nenhum pagamento registrado
    const paymentCount = await prisma.payment.count({ where: { comandaId: comanda.id } });
    expect(paymentCount).toBe(0);

    // Agora, checkout misto sem dinheiro retroativo (ex: PIX 30 + CARTAO 20) -> deve suceder
    const resSuccess = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        allocations: [
          { method: "PIX", receivedAmount: "30.00" },
          { method: "CREDIT", receivedAmount: "20.00" },
        ],
        paidAt: yesterday,
      }, "idemp-mixed-retro"),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resSuccess.status).toBe(200);

    const savedPayments = await prisma.payment.findMany({ where: { comandaId: comanda.id } });
    expect(savedPayments.length).toBe(2);
    savedPayments.forEach((p) => {
      expect(formatTimestampToCivilDateBR(p.paidAt)).toBe(yesterday);
    });
  });

  it("5. Sem pagamento: fechamento com 100% dívida não gera pagamentos fictícios", async () => {
    const tenant = await seedTenant("zero-payment-debt");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    const resCreate = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    expect(resCreate.status).toBe(201);
    const comanda = await resCreate.json();
    await markServicesDone(comanda.id);

    const resFinalize = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [],
        closeWithDebt: true,
        confirmOutstandingBalance: true,
        paidAt: yesterday,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resFinalize.status).toBe(200);

    const payments = await prisma.payment.findMany({ where: { comandaId: comanda.id } });
    expect(payments.length).toBe(0);

    const fes = await prisma.financialEntry.findMany({ where: { comandaId: comanda.id } });
    expect(fes.length).toBe(0);
  });

  it("6. Rejeita data no futuro com INVALID_PAYMENT_DATE (422)", async () => {
    const tenant = await seedTenant("future-date");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    const resCreate = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    expect(resCreate.status).toBe(201);
    const comanda = await resCreate.json();
    await markServicesDone(comanda.id);

    const resFinalize = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: "50.00" }],
        paidAt: tomorrow,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resFinalize.status).toBe(422);
    const body = await resFinalize.json();
    expect(body.error).toBe("INVALID_PAYMENT_DATE");
  });

  it("7. RBAC: BARBER não pode retroagir data de pagamento (403 BACKDATE_PERMISSION_REQUIRED)", async () => {
    const tenant = await seedTenant("barber-rbac");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    const resCreate = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    expect(resCreate.status).toBe(201);
    const comanda = await resCreate.json();
    await markServicesDone(comanda.id);

    // Autentica como BARBER
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.barberUser.id, role: "BARBER" } });

    const resFinalize = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: "50.00" }],
        paidAt: yesterday,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resFinalize.status).toBe(403);
    const body = await resFinalize.json();
    expect(body.error).toBe("BACKDATE_PERMISSION_REQUIRED");
  });

  it("8. Multi-tenant isolation: tentativa de finalizar comanda de outra barbearia é bloqueada", async () => {
    const tenantA = await seedTenant("tenant-a");
    const tenantB = await seedTenant("tenant-b");

    // Cria comanda na Barbearia A
    getServerSessionMock.mockResolvedValue({ user: { id: tenantA.ownerUser.id, role: "OWNER" } });
    const resCreate = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenantA.appointment.id })
    );
    expect(resCreate.status).toBe(201);
    const comandaA = await resCreate.json();

    // Tenta finalizar com sessão da Barbearia B
    getServerSessionMock.mockResolvedValue({ user: { id: tenantB.ownerUser.id, role: "OWNER" } });
    const resFinalize = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comandaA.id}/finalize`, {
        payments: [{ method: "PIX", amount: "50.00" }],
        paidAt: yesterday,
      }),
      { params: Promise.resolve({ id: comandaA.id }) }
    );
    expect(resFinalize.status).toBe(404);
  });

  it("9. Idempotência: repetição idêntica é segura; reutilização da mesma chave com data diferente gera 409", async () => {
    const tenant = await seedTenant("idemp-test");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    const resCreate = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    expect(resCreate.status).toBe(201);
    const comanda = await resCreate.json();
    await markServicesDone(comanda.id);

    const idempotencyKey = "idemp-key-unique-12345";

    // Primeira chamada com data de ontem via allocations
    const res1 = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        allocations: [{ method: "PIX", receivedAmount: "50.00" }],
        paidAt: yesterday,
      }, idempotencyKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(res1.status).toBe(200);

    // Replay idêntico (mesma key, mesmo payload, mesma data) -> 200 idempotente
    const res2 = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        allocations: [{ method: "PIX", receivedAmount: "50.00" }],
        paidAt: yesterday,
      }, idempotencyKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(res2.status).toBe(200);

    // Pagamentos não duplicados no banco
    const count = await prisma.payment.count({ where: { comandaId: comanda.id } });
    expect(count).toBe(1);

    // Tentativa de reutilizar a mesma chave com outra data -> 409 IDEMPOTENCY_KEY_CONFLICT
    const resConflict = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        allocations: [{ method: "PIX", receivedAmount: "50.00" }],
        paidAt: today,
      }, idempotencyKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resConflict.status).toBe(409);
    const bodyConflict = await resConflict.json();
    expect(bodyConflict.error).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });

  it("10. Diagnóstico 1 — Depósito em crédito financiado por recebimento retroativo (PostgreSQL Real)", async () => {
    const tenant = await seedTenant("diag1-credit");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    // Atualiza o preço do serviço para R$ 60.00
    await prisma.service.update({
      where: { id: tenant.cut.id },
      data: { price: "60.00" },
    });

    // Cria agendamento de ontem com o serviço de R$ 60.00
    const appt = await prisma.appointment.create({
      data: {
        barbershopId: tenant.shop.id,
        memberId: tenant.barber.id,
        customerId: tenant.customer.id,
        dateTime: new Date(`${yesterday}T14:00:00.000Z`),
        totalPrice: "60.00",
        durationMin: 30,
        services: { create: [{ serviceId: tenant.cut.id, priceApplied: "60.00" }] },
      },
    });

    // Garante que o cliente possui conta de crédito vinculada à barbearia
    await getCustomerCreditAccount(tenant.shop.id, tenant.customer.id, prisma);

    const resCreate = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: appt.id })
    );
    expect(resCreate.status).toBe(201);
    const comanda = await resCreate.json();
    await markServicesDone(comanda.id);

    // Cenário:
    // - Serviço de R$ 60.00
    // - Pix recebido ontem de R$ 100.00: R$ 60 aplicado à venda, R$ 40 depositado em crédito do cliente
    // - Operação realizada hoje
    const idempotencyKey = `diag1-idemp-${Date.now()}`;
    const resFinalize = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        allocations: [
          {
            method: "PIX",
            receivedAmount: "100.00",
            creditDepositAmount: "40.00",
          },
        ],
        paidAt: yesterday,
      }, idempotencyKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resFinalize.status).toBe(200);

    // 1. Pagamento da venda com data efetiva de ontem
    const payments = await prisma.payment.findMany({ where: { comandaId: comanda.id } });
    expect(payments).toHaveLength(1);
    expect(Number(payments[0].amount)).toBe(60);
    expect(formatTimestampToCivilDateBR(payments[0].paidAt)).toBe(yesterday);

    // 2. FinancialEntry da venda com data de ontem
    const saleEntry = await prisma.financialEntry.findFirst({
      where: { comandaId: comanda.id, type: "COMMAND_REVENUE" },
    });
    expect(saleEntry).not.toBeNull();
    expect(Number(saleEntry!.amount)).toBe(60);
    expect(formatTimestampToCivilDateBR(saleEntry!.entryDate)).toBe(yesterday);

    // 3. FinancialEntry do depósito com data de ontem
    const depositEntry = await prisma.financialEntry.findFirst({
      where: { comandaId: comanda.id, type: "CUSTOMER_CREDIT_DEPOSIT" },
    });
    expect(depositEntry).not.toBeNull();
    expect(Number(depositEntry!.amount)).toBe(40);
    expect(formatTimestampToCivilDateBR(depositEntry!.entryDate)).toBe(yesterday);

    // 4. Saldo de crédito do cliente correto (+40.00)
    const creditAccount = await prisma.customerCreditAccount.findUnique({
      where: { barbershopId_customerId: { barbershopId: tenant.shop.id, customerId: tenant.customer.id } },
    });
    expect(Number(creditAccount!.balance)).toBe(40);

    // 5. Datas de criação preservadas como hoje (createdAt)
    expect(formatTimestampToCivilDateBR(saleEntry!.createdAt)).toBe(today);
    expect(formatTimestampToCivilDateBR(depositEntry!.createdAt)).toBe(today);
    expect(formatTimestampToCivilDateBR(payments[0].createdAt)).toBe(today);

    // 6. Fluxo de caixa de ontem reflete R$ 100.00 no total (60 venda + 40 depósito), sem duplicações
    const flowYesterday = await getCashFlowReport({
      barbershopId: tenant.shop.id,
      startDate: yesterday,
      endDate: yesterday,
    });
    expect(Number(flowYesterday.realized.inflow)).toBe(100);

    // Fluxo de caixa de hoje reflete 0
    const flowToday = await getCashFlowReport({
      barbershopId: tenant.shop.id,
      startDate: today,
      endDate: today,
    });
    expect(Number(flowToday.realized.inflow)).toBe(0);
  });

  it("11. Diagnóstico 2 — Idempotência com payments em comanda quitada e conflito quando paidAt é omitido", async () => {
    const tenant = await seedTenant("diag2-settled");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    const appt = await createAppointmentForTenant(tenant, yesterday);
    const resCreate = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: appt.id })
    );
    expect(resCreate.status).toBe(201);
    const comanda = await resCreate.json();
    await markServicesDone(comanda.id);

    const idempotencyKey = `diag2-key-${Date.now()}`;

    // 1. Quita a comanda via rota finalize com payments retroativo
    const res1 = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "CREDIT", amount: "50.00", paidAt: yesterday }],
        paidAt: yesterday,
      }, idempotencyKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(res1.status).toBe(200);

    const settled = await prisma.comanda.findUnique({ where: { id: comanda.id } });
    expect(settled!.status).toBe("CLOSED");
    expect(Number(settled!.remainingTotal)).toBe(0);

    // 2. Replay com MESMA chave, MESMO payload e MESMA data -> 200 (sucesso idempotente)
    const resReplay = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "CREDIT", amount: "50.00", paidAt: yesterday }],
        paidAt: yesterday,
      }, idempotencyKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resReplay.status).toBe(200);

    // 3. Replay com MESMA chave, mas DATA DIFERENTE (hoje) -> 409 (não pode retornar 200!)
    const resConflictDate = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "CREDIT", amount: "50.00", paidAt: today }],
        paidAt: today,
      }, idempotencyKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resConflictDate.status).toBe(409);
    const conflictBody = await resConflictDate.json();
    expect(conflictBody.error).toBe("IDEMPOTENCY_KEY_CONFLICT");

    // 4. Replay com MESMA chave, mas SEM paidAt (default hoje) -> 409
    const resConflictOmitted = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "CREDIT", amount: "50.00" }],
      }, idempotencyKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resConflictOmitted.status).toBe(409);
    const omittedBody = await resConflictOmitted.json();
    expect(omittedBody.error).toBe("IDEMPOTENCY_KEY_CONFLICT");

    // 5. Replay com NOVA chave em comanda já quitada -> 422 COMANDA_ALREADY_SETTLED
    const resNewKey = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "CREDIT", amount: "50.00" }],
      }, `new-key-${Date.now()}`),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resNewKey.status).toBe(422);
    const newKeyBody = await resNewKey.json();
    expect(newKeyBody.error).toBe("COMANDA_ALREADY_SETTLED");

    // 6. Confirma integridade: exatamente 1 pagamento no banco
    const totalPayments = await prisma.payment.count({ where: { comandaId: comanda.id } });
    expect(totalPayments).toBe(1);
  });

  it("12. Diagnóstico 2 — Idempotência no endpoint direto /payments e com CUSTOMER_CREDIT", async () => {
    const tenant = await seedTenant("diag2-direct");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    // Comanda aberta com serviço de R$ 50.00
    const appt = await createAppointmentForTenant(tenant, yesterday);
    const resCreate = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: appt.id })
    );
    expect(resCreate.status).toBe(201);
    const comanda = await resCreate.json();
    await markServicesDone(comanda.id);

    const directKey = `direct-pay-key-${Date.now()}`;

    // 1. Pagamento direto de R$ 20 via PIX retroativo
    const resPay1 = await paymentsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments`, {
        method: "PIX",
        amount: "20.00",
        paidAt: yesterday,
      }, directKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resPay1.status).toBe(201);

    // 2. Replay com mesma chave, mesmo payload, mesma data -> sucesso idempotente
    const resPayReplay = await paymentsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments`, {
        method: "PIX",
        amount: "20.00",
        paidAt: yesterday,
      }, directKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resPayReplay.status).toBe(201);

    // 3. Replay com mesma chave mas sem paidAt (default hoje) -> 409
    const resPayConflictOmitted = await paymentsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments`, {
        method: "PIX",
        amount: "20.00",
      }, directKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resPayConflictOmitted.status).toBe(409);
    const payConflictBody = await resPayConflictOmitted.json();
    expect(payConflictBody.error).toBe("IDEMPOTENCY_KEY_CONFLICT");

    // 4. Teste com CUSTOMER_CREDIT
    const ccAccount = await getCustomerCreditAccount(tenant.shop.id, tenant.customer.id, prisma);
    await prisma.customerCreditAccount.update({
      where: { id: ccAccount.id },
      data: { balance: "50.00" },
    });

    const ccKey = `cc-pay-key-${Date.now()}`;
    const resCc1 = await paymentsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments`, {
        method: "CUSTOMER_CREDIT",
        amount: "15.00",
        paidAt: yesterday,
      }, ccKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resCc1.status).toBe(201);

    // Replay com mesma chave e mesma data -> 201
    const resCcReplay = await paymentsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments`, {
        method: "CUSTOMER_CREDIT",
        amount: "15.00",
        paidAt: yesterday,
      }, ccKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resCcReplay.status).toBe(201);

    // Replay com mesma chave e sem paidAt -> 409
    const resCcConflict = await paymentsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments`, {
        method: "CUSTOMER_CREDIT",
        amount: "15.00",
      }, ccKey),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(resCcConflict.status).toBe(409);

    // Total de pagamentos na comanda: exatamente 2 (1 PIX de 20 e 1 CUSTOMER_CREDIT de 15)
    const countPayments = await prisma.payment.count({ where: { comandaId: comanda.id } });
    expect(countPayments).toBe(2);
  });
});
