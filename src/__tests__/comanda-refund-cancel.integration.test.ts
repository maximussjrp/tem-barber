import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { ComandaStatus, ComandaItemStatus } from "@prisma/client";

const { getServerSessionMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  testDatabaseUrl &&
  /match_barber|localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) &&
  !/prod|production/i.test(testDatabaseUrl);
const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;
let comandasRoute: typeof import("@/app/api/admin/comandas/route");
let finalizeRoute: typeof import("@/app/api/admin/comandas/[id]/finalize/route");
let itemsRoute: typeof import("@/app/api/admin/comandas/[id]/items/route");
let cashOpenRoute: typeof import("@/app/api/admin/cash-sessions/open/route");
let refundRoute: typeof import("@/app/api/admin/comandas/[id]/payments/[paymentId]/refund/route");
let cancelRoute: typeof import("@/app/api/admin/comandas/[id]/cancel/route");

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
      "comanda_cancel_audits",
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

let seedCounter = 1000;

async function seedTenant(label: string) {
  seedCounter++;
  const suffix = seedCounter;

  const plan = await prisma.plan.create({
    data: {
      name: `Plano Refund ${label}-${suffix}`,
      price: "49.90",
      maxMembers: 10,
      isActive: true,
    },
  });
  const shop = await prisma.barbershop.create({
    data: {
      name: `Barbearia Refund ${label}-${suffix}`,
      slug: `refund-${label}-${suffix}`,
      phone: `11990${suffix}`,
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
    data: { name: `Owner ${label}`, phone: `11991${suffix}` },
  });
  const barberUser = await prisma.user.create({
    data: { name: `Barber ${label}`, phone: `11992${suffix}` },
  });
  const customer = await prisma.user.create({
    data: { name: `Cliente ${label}`, phone: `11993${suffix}` },
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
  await prisma.barberService.create({ data: { barberId: barber.id, serviceId: cut.id } });
  
  const product = await prisma.product.create({
    data: {
      barbershopId: shop.id,
      name: `Pomada ${label}`,
      salePrice: "30.00",
      currentStock: 10,
      trackStock: true,
    },
  });

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
  
  await prisma.commissionConfig.create({
    data: {
      barbershopId: shop.id,
      memberId: barber.id,
      scopeKey: `member:${barber.id}:default`,
      type: "PERCENTAGE",
      value: "50.00",
    }
  });

  return { shop, ownerUser, owner, barber, customer, cut, product, appointment };
}

describeIf("Fluxo de Estorno de Pagamento e Cancelamento Seguro de Comanda", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    vi.resetModules();
    prisma = (await import("@/lib/prisma")).default as PrismaClient;
    comandasRoute = await import("@/app/api/admin/comandas/route");
    finalizeRoute = await import("@/app/api/admin/comandas/[id]/finalize/route");
    itemsRoute = await import("@/app/api/admin/comandas/[id]/items/route");
    cashOpenRoute = await import("@/app/api/admin/cash-sessions/open/route");
    refundRoute = await import("@/app/api/admin/comandas/[id]/payments/[paymentId]/refund/route");
    cancelRoute = await import("@/app/api/admin/comandas/[id]/cancel/route");
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("permite estorno parcial e total de pagamento manual (CASH/CARD) com reflexo financeiro e de caixa", async () => {
    const tenant = await seedTenant("refund1");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    // 1. Abrir caixa
    const cashOpen = await cashOpenRoute.POST(jsonRequest("http://localhost/api/admin/cash-sessions/open", { openingAmount: "50.00" }));
    expect(cashOpen.status).toBe(201);

    // 2. Abrir comanda
    const createComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    expect(createComanda.status).toBe(201);
    const comanda = await createComanda.json();

    // Concluir o serviço
    await prisma.comandaItem.updateMany({
      where: { comandaId: comanda.id, type: "SERVICE" },
      data: { status: "DONE", completedAt: new Date() },
    });

    // 3. Finalizar comanda com CASH (R$ 50,00)
    const finalizeRes = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "CASH", amount: "50.00" }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(finalizeRes.status).toBe(200);

    const comandaFechada = await prisma.comanda.findUnique({
      where: { id: comanda.id },
      include: { payments: true }
    });
    expect(comandaFechada?.status).toBe("CLOSED");
    expect(comandaFechada?.payments.length).toBe(1);
    const payment = comandaFechada!.payments[0];

    // 4. Registrar estorno parcial de R$ 20,00
    const refundRes1 = await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment.id}/refund`, {
        amount: "20.00",
        reason: "Cliente reclamou do corte",
      }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment.id }) }
    );
    expect(refundRes1.status).toBe(200);

    const comandaEstornadaParcial = await prisma.comanda.findUnique({
      where: { id: comanda.id },
      include: { payments: true }
    });
    expect(comandaEstornadaParcial?.status).toBe("PENDING_PAYMENT");
    expect(Number(comandaEstornadaParcial?.paidTotal)).toBe(30);
    expect(Number(comandaEstornadaParcial?.remainingTotal)).toBe(20);

    // Verificar se gerou entrada financeira negativa do estorno
    const financialEntries = await prisma.financialEntry.findMany({
      where: { comandaId: comanda.id, type: "REFUND" }
    });
    expect(financialEntries.length).toBe(1);
    expect(Number(financialEntries[0].amount)).toBe(-20);

    // Verificar se movimentou o caixa
    const cashMovements = await prisma.cashMovement.findMany({
      where: { paymentId: financialEntries[0].paymentId }
    });
    expect(cashMovements.length).toBe(1);
    expect(Number(cashMovements[0].amount)).toBe(-20);

    // 5. Bloqueia estorno que excede o saldo estornável
    const refundResExceeds = await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment.id}/refund`, {
        amount: "40.00",
        reason: "Estorno incorreto",
      }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment.id }) }
    );
    expect(refundResExceeds.status).toBe(422);

    // 6. Testar idempotência com header Idempotency-Key
    const refundResIdempotente = await refundRoute.POST(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment.id}/refund`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "refund-idemp-1"
        },
        body: JSON.stringify({ amount: "10.00", reason: "Desistência parcial" })
      }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment.id }) }
    );
    expect(refundResIdempotente.status).toBe(200);

    const refundResIdempotenteRepeat = await refundRoute.POST(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment.id}/refund`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "refund-idemp-1"
        },
        body: JSON.stringify({ amount: "10.00", reason: "Desistência parcial" })
      }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment.id }) }
    );
    expect(refundResIdempotenteRepeat.status).toBe(200);

    const refundPayments = await prisma.payment.findMany({
      where: { comandaId: comanda.id, status: "REFUNDED" }
    });
    expect(refundPayments.length).toBe(2);
  });

  it("permite cancelamento seguro de comanda com pagamentos confirmados caso refundAll seja true", async () => {
    const tenant = await seedTenant("cancel1");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    // 1. Abrir caixa
    await cashOpenRoute.POST(jsonRequest("http://localhost/api/admin/cash-sessions/open", { openingAmount: "50.00" }));

    // 2. Abrir comanda
    const createComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    const comanda = await createComanda.json();

    // Adicionar um produto com controle de estoque
    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: tenant.product.id,
        quantity: 2,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Concluir os itens
    await prisma.comandaItem.updateMany({
      where: { comandaId: comanda.id },
      data: { status: "DONE", completedAt: new Date() },
    });

    // 3. Finalizar comanda
    await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "CASH", amount: "110.00" }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Validar estoque reduzido de 10 para 8 after finalization
    const productBefore = await prisma.product.findUnique({ where: { id: tenant.product.id } });
    expect(Number(productBefore?.currentStock)).toBe(8);

    // Validar comissão liberada para o barbeiro (50% de 50 = 25 reais)
    const commissionBefore = await prisma.commissionEntry.findFirst({
      where: {
        comandaItem: { comandaId: comanda.id },
        memberId: tenant.barber.id
      }
    });
    expect(commissionBefore?.status).toBe("RELEASED");
    expect(Number(commissionBefore?.releasedAmount)).toBe(25);

    // 4. Bloquear cancelamento de comanda paga sem estorno e sem refundAll
    const cancelFail = await cancelRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/cancel`, {
        reason: "Comanda de teste lançada erroneamente",
        refundAll: false,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(cancelFail.status).toBe(422);

    // 5. Cancelamento bem sucedido com refundAll: true
    const cancelSuccess = await cancelRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/cancel`, {
        reason: "Lançamento em duplicidade completo",
        refundAll: true,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(cancelSuccess.status).toBe(200);

    // 6. Verificar reversões completas
    // Status da comanda
    const comandaAfter = await prisma.comanda.findUnique({ where: { id: comanda.id } });
    expect(comandaAfter?.status).toBe("CANCELLED");
    expect(comandaAfter?.cancelledAt).not.toBeNull();
    expect(Number(comandaAfter?.total)).toBe(0);
    expect(Number(comandaAfter?.paidTotal)).toBe(0);

    // Reversão de estoque (deve voltar para 10)
    const productAfter = await prisma.product.findUnique({ where: { id: tenant.product.id } });
    expect(Number(productAfter?.currentStock)).toBe(10);

    // Reversão de comissão
    const commissionAfter = await prisma.commissionEntry.findFirst({
      where: {
        comandaItem: { comandaId: comanda.id },
        memberId: tenant.barber.id
      }
    });
    expect(commissionAfter?.status).toBe("REVERSED");
    expect(Number(commissionAfter?.releasedAmount)).toBe(0);

    // Log de auditoria criado
    const cancelAudits = await prisma.comandaCancelAudit.findMany({
      where: { comandaId: comanda.id }
    });
    expect(cancelAudits.length).toBe(1);
    expect(cancelAudits[0].reason).toBe("Lançamento em duplicidade completo");
    expect(cancelAudits[0].previousStatus).toBe(ComandaStatus.CLOSED);

    // Sem deleção física
    const comandaPhysical = await prisma.comanda.findUnique({ where: { id: comanda.id } });
    expect(comandaPhysical).not.toBeNull();

    const itemsPhysical = await prisma.comandaItem.findMany({ where: { comandaId: comanda.id } });
    expect(itemsPhysical.length).toBeGreaterThan(0);
    expect(itemsPhysical.every(i => i.status === "CANCELLED")).toBe(true);
  });

  it("valida regras de permissões, inputs, isolamento de tenant e URLs inconsistentes no estorno", async () => {
    const tenant = await seedTenant("refundrules");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });
    
    // Abrir caixa
    await cashOpenRoute.POST(jsonRequest("http://localhost/api/admin/cash-sessions/open", { openingAmount: "50.00" }));

    // Abrir comanda e adicionar produto
    const createComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    const comanda = await createComanda.json();

    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: tenant.product.id,
        quantity: 1,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Concluir itens
    await prisma.comandaItem.updateMany({
      where: { comandaId: comanda.id },
      data: { status: "DONE", completedAt: new Date() },
    });

    // Finalizar comanda com CASH (R$ 80,00)
    await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "CASH", amount: "80.00" }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    const comandaFechada = await prisma.comanda.findUnique({
      where: { id: comanda.id },
      include: { payments: true }
    });
    const payment = comandaFechada!.payments[0];

    // 1. MANAGER consegue estornar
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "MANAGER" } });
    const refundResManager = await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment.id}/refund`, {
        amount: "5.00",
        reason: "Estorno pelo Gerente",
      }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment.id }) }
    );
    expect(refundResManager.status).toBe(200);

    // 2. BARBER recebe 403 (Negado)
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "BARBER" } });
    const refundResBarber = await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment.id}/refund`, {
        amount: "5.00",
        reason: "Estorno pelo Barbeiro",
      }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment.id }) }
    );
    expect(refundResBarber.status).toBe(403);

    // Restaura role de OWNER para os demais testes
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    // 3. Motivo curto/vazio falha (menos de 5 chars)
    const refundResReasonShort = await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment.id}/refund`, {
        amount: "5.00",
        reason: "Ops",
      }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment.id }) }
    );
    expect(refundResReasonShort.status).toBe(400);

    // 4. Valor vazio falha
    const refundResAmountEmpty = await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment.id}/refund`, {
        amount: "",
        reason: "Estorno teste",
      }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment.id }) }
    );
    expect(refundResAmountEmpty.status).toBe(400);

    // 5. Valor menor ou igual a zero falha
    const refundResAmountNegative = await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment.id}/refund`, {
        amount: "-10.00",
        reason: "Estorno teste",
      }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment.id }) }
    );
    expect(refundResAmountNegative.status).toBe(400);

    // 6. paymentId de outra comanda na URL bloqueado (mismatch)
    const createComanda2 = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", {
        customerName: "Outro Cliente",
        customerPhone: "11999999999",
      })
    );
    const comanda2 = await createComanda2.json();

    const refundResUrlMismatch = await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda2.id}/payments/${payment.id}/refund`, {
        amount: "5.00",
        reason: "Estorno url incorreta",
      }),
      { params: Promise.resolve({ id: comanda2.id, paymentId: payment.id }) }
    );
    expect(refundResUrlMismatch.status).toBe(422);

    // 7. paymentId de outro tenant bloqueado
    const tenant2 = await seedTenant("refundtenant2");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant2.ownerUser.id, role: "OWNER" } });
    const createComandaTenant2 = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant2.appointment.id })
    );
    const comandaTenant2 = await createComandaTenant2.json();
    await prisma.comandaItem.updateMany({
      where: { comandaId: comandaTenant2.id },
      data: { status: "DONE", completedAt: new Date() },
    });
    await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comandaTenant2.id}/finalize`, {
        payments: [{ method: "PIX", amount: "50.00" }]
      }),
      { params: Promise.resolve({ id: comandaTenant2.id }) }
    );
    const comandaTenant2Fechada = await prisma.comanda.findUnique({
      where: { id: comandaTenant2.id },
      include: { payments: true }
    });
    const paymentTenant2 = comandaTenant2Fechada!.payments[0];

    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });
    const refundResTenantIsolation = await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comandaTenant2.id}/payments/${paymentTenant2.id}/refund`, {
        amount: "5.00",
        reason: "Estorno cruzado",
      }),
      { params: Promise.resolve({ id: comandaTenant2.id, paymentId: paymentTenant2.id }) }
    );
    expect(refundResTenantIsolation.status).toBe(404);
  });

  it("permite cancelamento de comanda OPEN e PENDING_PAYMENT sem pagamentos, e valida tenant isolation, motivo obrigatório e trava do clube", async () => {
    const tenant = await seedTenant("cancelrules");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });

    // 1. Cancela comanda OPEN sem pagamento
    const createComandaOpen = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant.appointment.id })
    );
    const comandaOpen = await createComandaOpen.json();

    const cancelOpenRes = await cancelRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comandaOpen.id}/cancel`, {
        reason: "Cancelando comanda aberta",
      }),
      { params: Promise.resolve({ id: comandaOpen.id }) }
    );
    expect(cancelOpenRes.status).toBe(200);
    const comandaOpenAfter = await prisma.comanda.findUnique({ where: { id: comandaOpen.id } });
    expect(comandaOpenAfter?.status).toBe("CANCELLED");

    // 2. Cancela comanda PENDING_PAYMENT sem pagamento
    const createComandaPending = await prisma.comanda.create({
      data: {
        barbershopId: tenant.shop.id,
        customerName: "Cliente Teste",
        status: "PENDING_PAYMENT",
        subtotal: "50.00",
        total: "50.00",
        paidTotal: "0.00",
        remainingTotal: "50.00",
      }
    });

    const cancelPendingRes = await cancelRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${createComandaPending.id}/cancel`, {
        reason: "Cancelando comanda pendente",
      }),
      { params: Promise.resolve({ id: createComandaPending.id }) }
    );
    expect(cancelPendingRes.status).toBe(200);
    const comandaPendingAfter = await prisma.comanda.findUnique({ where: { id: createComandaPending.id } });
    expect(comandaPendingAfter?.status).toBe("CANCELLED");

    // 3. Valida tenant isolation para cancelamento
    const tenant2 = await seedTenant("canceltenant2");
    getServerSessionMock.mockResolvedValue({ user: { id: tenant2.ownerUser.id, role: "OWNER" } });
    const createComandaTenant2 = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { appointmentId: tenant2.appointment.id })
    );
    const comandaTenant2 = await createComandaTenant2.json();

    getServerSessionMock.mockResolvedValue({ user: { id: tenant.ownerUser.id, role: "OWNER" } });
    const cancelResTenantIsolation = await cancelRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comandaTenant2.id}/cancel`, {
        reason: "Cancelamento cruzado",
      }),
      { params: Promise.resolve({ id: comandaTenant2.id }) }
    );
    expect(cancelResTenantIsolation.status).toBe(404);

    // 4. Motivo curto/vazio para cancelamento retorna 400
    const cancelResReasonShort = await cancelRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comandaOpen.id}/cancel`, {
        reason: "Ops",
      }),
      { params: Promise.resolve({ id: comandaOpen.id }) }
    );
    expect(cancelResReasonShort.status).toBe(400);

    // 5. Clube com SETTLEMENT_LOCKED bloqueia cancelamento com erro seguro
    const createComandaClub = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", {
        customerName: "Cliente Clube",
        customerPhone: "11999999998",
      })
    );
    const comandaClub = await createComandaClub.json();

    // Adicionar item de serviço do corte
    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comandaClub.id}/items`, {
        type: "SERVICE",
        serviceId: tenant.cut.id,
        executorId: tenant.barber.id,
      }),
      { params: Promise.resolve({ id: comandaClub.id }) }
    );

    const comandaItem = await prisma.comandaItem.findFirst({
      where: { comandaId: comandaClub.id }
    });

    const clubPlan = await prisma.clubPlan.create({
      data: {
        barbershopId: tenant.shop.id,
        name: "Plano Club Teste",
        monthlyPrice: "99.90",
        shopSharePercent: 60,
        barberPoolPercent: 40,
        isActive: true,
      }
    });

    const subscription = await prisma.customerClubSubscription.create({
      data: {
        barbershopId: tenant.shop.id,
        customerId: tenant.customer.id,
        clubPlanId: clubPlan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }
    });

    await prisma.clubBenefitUsage.create({
      data: {
        barbershopId: tenant.shop.id,
        subscriptionId: subscription.id,
        clubPlanId: clubPlan.id,
        comandaItemId: comandaItem!.id,
        benefitType: "INCLUDED_SERVICE",
        status: "APPLIED",
        competence: "2026-07",
        usedAt: new Date(),
      }
    });

    await prisma.clubPointEntry.create({
      data: {
        barbershopId: tenant.shop.id,
        subscriptionId: subscription.id,
        comandaItemId: comandaItem!.id,
        memberId: tenant.barber.id,
        points: 10,
        status: "SETTLED",
        competence: "2026-07",
      }
    });

    const cancelClubRes = await cancelRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comandaClub.id}/cancel`, {
        reason: "Cancelar comanda com clube liquidado",
        refundAll: true,
      }),
      { params: Promise.resolve({ id: comandaClub.id }) }
    );
    expect(cancelClubRes.status).toBe(422);
    const cancelClubData = await cancelClubRes.json();
    expect(cancelClubData.error).toBe("CLUB_USAGE_REVERSAL_REQUIRED");
  });
});
