import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient, ComandaStatus, ComandaItemStatus } from "@prisma/client";

const { getServerSessionMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const canRunIntegration =
  testDatabaseUrl &&
  /match_barber_test|localhost|127\.0\.0\.1|55439|5434/.test(testDatabaseUrl) &&
  !/prod|production/i.test(testDatabaseUrl);
const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;
let comandasRoute: typeof import("@/app/api/admin/comandas/route");
let finalizeRoute: typeof import("@/app/api/admin/comandas/[id]/finalize/route");
let itemsRoute: typeof import("@/app/api/admin/comandas/[id]/items/route");
let itemDetailRoute: typeof import("@/app/api/admin/comandas/[id]/items/[itemId]/route");
let comandaDetailRoute: typeof import("@/app/api/admin/comandas/[id]/route");
let productsRoute: typeof import("@/app/api/admin/products/route");
let cashOpenRoute: typeof import("@/app/api/admin/cash-sessions/open/route");
let refundRoute: typeof import("@/app/api/admin/comandas/[id]/payments/[paymentId]/refund/route");

function jsonRequest(url: string, body: unknown, method = "POST") {
  return new NextRequest(url, {
    method,
    headers: {
      "Content-Type": "application/json",
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
      slug: `stock-${label}`,
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
  await prisma.barberService.create({ data: { barberId: barber.id, serviceId: cut.id } });
  
  await prisma.commissionConfig.create({
    data: {
      barbershopId: shop.id,
      memberId: barber.id,
      scopeKey: `member:${barber.id}:default`,
      type: "PERCENTAGE",
      value: "50.00",
    }
  });

  return { shop, ownerUser, owner, barber, customer, cut };
}

describeIf("Integração: Reversão de Estoque em Cancelamentos e Edições", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    vi.resetModules();
    prisma = (await import("@/lib/prisma")).default as PrismaClient;
    comandasRoute = await import("@/app/api/admin/comandas/route");
    finalizeRoute = await import("@/app/api/admin/comandas/[id]/finalize/route");
    itemsRoute = await import("@/app/api/admin/comandas/[id]/items/route");
    itemDetailRoute = await import("@/app/api/admin/comandas/[id]/items/[itemId]/route");
    comandaDetailRoute = await import("@/app/api/admin/comandas/[id]/route");
    productsRoute = await import("@/app/api/admin/products/route");
    cashOpenRoute = await import("@/app/api/admin/cash-sessions/open/route");
    refundRoute = await import("@/app/api/admin/comandas/[id]/payments/[paymentId]/refund/route");
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("1 e 2. qty 1 e qty 3: fecha e cancela comanda, o estoque retorna perfeitamente", async () => {
    const t = await seedTenant("q13");
    getServerSessionMock.mockResolvedValue({ user: { id: t.ownerUser.id, role: "OWNER" } });

    // Criar produtos com trackStock
    const prod1 = await prisma.product.create({
      data: { barbershopId: t.shop.id, name: "Shampoo", salePrice: "30.00", currentStock: "10.000", trackStock: true },
    });
    const prod2 = await prisma.product.create({
      data: { barbershopId: t.shop.id, name: "Condicionador", salePrice: "40.00", currentStock: "10.000", trackStock: true },
    });

    // Abrir comanda
    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Maria", customerPhone: "11999999999" }));
    console.log("CREATE COMANDA STATUS:", resComanda.status);
    const comanda = await resComanda.json();
    console.log("CREATE COMANDA BODY:", JSON.stringify(comanda));

    // Adicionar prod1 (qty 1)
    const resItem1 = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: prod1.id,
        quantity: 1
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    console.log("ADD ITEM 1 STATUS:", resItem1.status);
    console.log("ADD ITEM 1 BODY:", JSON.stringify(await resItem1.json()));

    // Adicionar prod2 (qty 3)
    const resItem2 = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: prod2.id,
        quantity: 3
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    console.log("ADD ITEM 2 STATUS:", resItem2.status);
    console.log("ADD ITEM 2 BODY:", JSON.stringify(await resItem2.json()));

    // Finalizar comanda
    const finalizeRes = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 150.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    console.log("FINALIZE STATUS:", finalizeRes.status);
    console.log("FINALIZE BODY:", JSON.stringify(await finalizeRes.json()));

    // Verificar baixas
    const p1AfterClose = await prisma.product.findUnique({ where: { id: prod1.id } });
    const p2AfterClose = await prisma.product.findUnique({ where: { id: prod2.id } });
    console.log("STOCK AFTER CLOSE:", Number(p1AfterClose?.currentStock), Number(p2AfterClose?.currentStock));
    expect(Number(p1AfterClose?.currentStock)).toBe(9);
    expect(Number(p2AfterClose?.currentStock)).toBe(7);

    // Reabrir via estorno do pagamento (CLOSED -> PENDING_PAYMENT)
    const payment = await prisma.payment.findFirst({ where: { comandaId: comanda.id } });
    const resRefund = await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment?.id}/refund`, { amount: 150.00, reason: "Estorno" }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment!.id }) }
    );
    console.log("REFUND STATUS:", resRefund.status);
    console.log("REFUND BODY:", JSON.stringify(await resRefund.json()));

    // Cancelar comanda
    const resCancel = await comandaDetailRoute.PATCH(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}`, { status: "CANCELLED" }, "PATCH"),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    console.log("CANCEL STATUS:", resCancel.status);
    console.log("CANCEL BODY:", JSON.stringify(await resCancel.json()));

    // Verificar retorno
    const p1AfterCancel = await prisma.product.findUnique({ where: { id: prod1.id } });
    const p2AfterCancel = await prisma.product.findUnique({ where: { id: prod2.id } });
    console.log("STOCK AFTER CANCEL:", Number(p1AfterCancel?.currentStock), Number(p2AfterCancel?.currentStock));
    expect(Number(p1AfterCancel?.currentStock)).toBe(10);
    expect(Number(p2AfterCancel?.currentStock)).toBe(10);

    // Verificar movimentos de estoque
    const m1 = await prisma.stockMovement.findMany({ where: { productId: prod1.id } });
    expect(m1.length).toBe(2); // SALE e REFUND
    expect(m1.map(m => m.type)).toContain("SALE");
    expect(m1.map(m => m.type)).toContain("REFUND");

    const m2 = await prisma.stockMovement.findMany({ where: { productId: prod2.id } });
    expect(m2.length).toBe(2); // SALE e REFUND
  });

  it("3 e 4. dois produtos + serviço + produto sem trackStock", async () => {
    const t = await seedTenant("mixed");
    getServerSessionMock.mockResolvedValue({ user: { id: t.ownerUser.id, role: "OWNER" } });

    const prodTracked = await prisma.product.create({
      data: { barbershopId: t.shop.id, name: "Gel", salePrice: "20.00", currentStock: "5.000", trackStock: true },
    });
    const prodUntracked = await prisma.product.create({
      data: { barbershopId: t.shop.id, name: "Pente", salePrice: "10.00", currentStock: "5.000", trackStock: false },
    });

    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Jose", customerPhone: "11999999999" }));
    expect(resComanda.status).toBe(201);
    const comanda = await resComanda.json();

    // Serviço (Sem estoque)
    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "SERVICE",
        serviceId: t.cut.id,
        executorId: t.barber.id,
        quantity: 1
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Produto Tracked (Com estoque)
    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: prodTracked.id,
        quantity: 2
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Produto Untracked (Sem estoque)
    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: prodUntracked.id,
        quantity: 2
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Fechar
    const finalizeRes = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 110.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(finalizeRes.status).toBe(200);

    // Verificar
    expect(Number((await prisma.product.findUnique({ where: { id: prodTracked.id } }))?.currentStock)).toBe(3);
    expect(Number((await prisma.product.findUnique({ where: { id: prodUntracked.id } }))?.currentStock)).toBe(5); // Inalterado

    // Reabrir
    const payment = await prisma.payment.findFirst({ where: { comandaId: comanda.id } });
    await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment?.id}/refund`, { amount: 110.00, reason: "Estorno" }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment!.id }) }
    );

    // Cancelar comanda
    await comandaDetailRoute.PATCH(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}`, { status: "CANCELLED" }, "PATCH"),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    expect(Number((await prisma.product.findUnique({ where: { id: prodTracked.id } }))?.currentStock)).toBe(5); // Revertido
    expect(Number((await prisma.product.findUnique({ where: { id: prodUntracked.id } }))?.currentStock)).toBe(5); // Continua 5
  });

  it("5. cancelar duas vezes: gera apenas um REFUND líquido e impede dupla devolução", async () => {
    const t = await seedTenant("double-cancel");
    getServerSessionMock.mockResolvedValue({ user: { id: t.ownerUser.id, role: "OWNER" } });

    const prod = await prisma.product.create({
      data: { barbershopId: t.shop.id, name: "Pomada", salePrice: "50.00", currentStock: "5.000", trackStock: true },
    });

    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Ana", customerPhone: "11999999999" }));
    expect(resComanda.status).toBe(201);
    const comanda = await resComanda.json();

    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: prod.id,
        quantity: 2
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 100.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Reabrir
    const payment = await prisma.payment.findFirst({ where: { comandaId: comanda.id } });
    await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment?.id}/refund`, { amount: 100.00, reason: "Estorno" }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment!.id }) }
    );

    // Primeiro cancelamento
    await comandaDetailRoute.PATCH(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}`, { status: "CANCELLED" }, "PATCH"),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(5);

    // Segundo cancelamento
    await comandaDetailRoute.PATCH(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}`, { status: "CANCELLED" }, "PATCH"),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(5);

    // Quantidade de REFUNDs
    const refunds = await prisma.stockMovement.count({
      where: { productId: prod.id, type: "REFUND" }
    });
    expect(refunds).toBe(1);
  });

  it("6 e 7. remoção de item antes vs. depois da baixa", async () => {
    const t = await seedTenant("removals");
    getServerSessionMock.mockResolvedValue({ user: { id: t.ownerUser.id, role: "OWNER" } });

    const prod = await prisma.product.create({
      data: { barbershopId: t.shop.id, name: "Cera", salePrice: "15.00", currentStock: "5.000", trackStock: true },
    });

    // Caso A: Removido antes do fechamento
    const resC1 = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Paula", customerPhone: "11999999999" }));
    expect(resC1.status).toBe(201);
    const c1 = await resC1.json();

    const resItem = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${c1.id}/items`, {
        type: "PRODUCT",
        productId: prod.id,
        quantity: 1
      }),
      { params: Promise.resolve({ id: c1.id }) }
    );
    const item = await resItem.json();

    // Remover item (DELETE) quando comanda está aberta
    await itemDetailRoute.DELETE(
      new NextRequest(`http://localhost/api/admin/comandas/${c1.id}/items/${item.items[0].id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: c1.id, itemId: item.items[0].id }) }
    );

    // Estoque inalterado e nenhum movimento
    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(5);
    expect(await prisma.stockMovement.count({ where: { productId: prod.id } })).toBe(0);

    // Caso B: Removido depois do fechamento e reabertura
    const resC2 = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Carlos", customerPhone: "11999999999" }));
    expect(resC2.status).toBe(201);
    const c2 = await resC2.json();

    const resItem2 = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${c2.id}/items`, {
        type: "PRODUCT",
        productId: prod.id,
        quantity: 1
      }),
      { params: Promise.resolve({ id: c2.id }) }
    );
    const item2 = await resItem2.json();

    // Fechar
    await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${c2.id}/finalize`, {
        payments: [{ method: "PIX", amount: 15.00 }]
      }),
      { params: Promise.resolve({ id: c2.id }) }
    );
    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(4);

    // Reabrir via estorno do pagamento
    const payment = await prisma.payment.findFirst({ where: { comandaId: c2.id } });
    await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${c2.id}/payments/${payment?.id}/refund`, { amount: 15.00, reason: "Estorno" }),
      { params: Promise.resolve({ id: c2.id, paymentId: payment!.id }) }
    );

    // Estoque ainda permanece baixado (4)
    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(4);

    // Agora deletamos o item com a comanda em PENDING_PAYMENT
    await itemDetailRoute.DELETE(
      new NextRequest(`http://localhost/api/admin/comandas/${c2.id}/items/${item2.items[0].id}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: c2.id, itemId: item2.items[0].id }) }
    );

    // Estoque deve retornar para 5!
    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(5);
  });

  it("10 e 11. Refechamento sem alterações vs. SALE -> REFUND -> SALE", async () => {
    const t = await seedTenant("reclose");
    getServerSessionMock.mockResolvedValue({ user: { id: t.ownerUser.id, role: "OWNER" } });

    const prod = await prisma.product.create({
      data: { barbershopId: t.shop.id, name: "Oleo", salePrice: "25.00", currentStock: "5.000", trackStock: true },
    });

    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "David", customerPhone: "11999999999" }));
    expect(resComanda.status).toBe(201);
    const comanda = await resComanda.json();

    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: prod.id,
        quantity: 1
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Fechamento 1 (SALE)
    await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 25.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(4);

    // Reabertura
    const payment = await prisma.payment.findFirst({ where: { comandaId: comanda.id } });
    await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment?.id}/refund`, { amount: 25.00, reason: "Estorno" }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment!.id }) }
    );

    // Refechamento sem alteração
    await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 25.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Estoque deve continuar 4 (não deve duplicar a baixa!)
    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(4);

    const salesCount = await prisma.stockMovement.count({ where: { productId: prod.id, type: "SALE" } });
    expect(salesCount).toBe(1); // Apenas 1 movimento de SALE
  });

  it("12, 13 e 14. Quantity edits delta sync: 3 -> 1 e 1 -> 3 e 3 -> 1 -> 2", async () => {
    const t = await seedTenant("qty-edits");
    getServerSessionMock.mockResolvedValue({ user: { id: t.ownerUser.id, role: "OWNER" } });

    const prod = await prisma.product.create({
      data: { barbershopId: t.shop.id, name: "Gillette", salePrice: "10.00", currentStock: "10.000", trackStock: true },
    });

    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Eduardo", customerPhone: "11999999999" }));
    expect(resComanda.status).toBe(201);
    const comanda = await resComanda.json();

    const resItem = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: prod.id,
        quantity: 3
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    const item = await resItem.json();
    const itemId = item.items[0].id;

    // Fechar comanda (SALE 3)
    await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 30.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(7);

    // Reabrir
    let payment = await prisma.payment.findFirst({ where: { comandaId: comanda.id, status: "CONFIRMED" } });
    await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment?.id}/refund`, { amount: 30.00, reason: "Estorno" }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment!.id }) }
    );

    // PATCH quantity 3 -> 1
    await itemDetailRoute.PATCH(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${itemId}`, { quantity: 1 }, "PATCH"),
      { params: Promise.resolve({ id: comanda.id, itemId }) }
    );

    // Estoque deve subir para 9 (+2 devolução)
    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(9);
    let refundMovements = await prisma.stockMovement.findMany({ where: { productId: prod.id, type: "REFUND" } });
    expect(refundMovements.length).toBe(1);
    expect(Number(refundMovements[0].quantity)).toBe(2);

    // PATCH quantity 1 -> 3
    await itemDetailRoute.PATCH(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${itemId}`, { quantity: 3 }, "PATCH"),
      { params: Promise.resolve({ id: comanda.id, itemId }) }
    );

    // Estoque deve descer para 7 (-2 baixa adicional)
    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(7);

    // PATCH quantity 3 -> 1 -> 2
    // 3 -> 1
    await itemDetailRoute.PATCH(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${itemId}`, { quantity: 1 }, "PATCH"),
      { params: Promise.resolve({ id: comanda.id, itemId }) }
    );
    // 1 -> 2
    await itemDetailRoute.PATCH(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${itemId}`, { quantity: 2 }, "PATCH"),
      { params: Promise.resolve({ id: comanda.id, itemId }) }
    );

    // Saldo final deve ser 8 (devolveu 2, baixou 1)
    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(8);
  });

  it("22. estoque insuficiente: rollback total", async () => {
    const t = await seedTenant("insufficient");
    getServerSessionMock.mockResolvedValue({ user: { id: t.ownerUser.id, role: "OWNER" } });

    // Iniciar produto com estoque 5
    const prod = await prisma.product.create({
      data: { barbershopId: t.shop.id, name: "Tesoura", salePrice: "50.00", currentStock: "5.000", trackStock: true },
    });

    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Vitor", customerPhone: "11999999999" }));
    expect(resComanda.status).toBe(201);
    const comanda = await resComanda.json();

    // Adiciona 3 itens (permitido, pois 3 <= 5)
    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: prod.id,
        quantity: 3
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Simula colisão concorrente/venda que reduziu o estoque físico para 1 antes de finalizarmos
    await prisma.product.update({
      where: { id: prod.id },
      data: { currentStock: "1.000" }
    });

    // Fechar comanda deve retornar erro 422 de estoque insuficiente
    const finalizeRes = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 150.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(finalizeRes.status).toBe(422);
    const err = await finalizeRes.json();
    expect(err.error).toBe("INSUFFICIENT_STOCK");

    // Verificar que estoque permaneceu 1 e nenhum movimento de estoque SALE foi gravado (rollback completo)
    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(1);
    expect(await prisma.stockMovement.count({ where: { productId: prod.id } })).toBe(0);
  });

  it("23. concorrência real: dois cancelamentos simultâneos", async () => {
    const t = await seedTenant("conc-cancel");
    getServerSessionMock.mockResolvedValue({ user: { id: t.ownerUser.id, role: "OWNER" } });

    const prod = await prisma.product.create({
      data: { barbershopId: t.shop.id, name: "Produto Concorrente", salePrice: "50.00", currentStock: "10.000", trackStock: true },
    });

    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Concorrente", customerPhone: "11999999999" }));
    const comanda = await resComanda.json();

    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: prod.id,
        quantity: 2
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 100.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    const payment = await prisma.payment.findFirst({ where: { comandaId: comanda.id } });
    await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment?.id}/refund`, { amount: 100.00, reason: "Estorno" }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment!.id }) }
    );

    const p1 = comandaDetailRoute.PATCH(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}`, { status: "CANCELLED" }, "PATCH"),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    const p2 = comandaDetailRoute.PATCH(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}`, { status: "CANCELLED" }, "PATCH"),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    const results = await Promise.allSettled([p1, p2]);

    const updatedProd = await prisma.product.findUnique({ where: { id: prod.id } });
    expect(Number(updatedProd?.currentStock)).toBe(10);

    const movements = await prisma.stockMovement.findMany({ where: { productId: prod.id } });
    const applied = movements.reduce((sum, m) => {
      const qty = Number(m.quantity);
      if (m.type === "SALE") return sum + qty;
      if (m.type === "REFUND") return sum - qty;
      return sum;
    }, 0);
    expect(applied).toBe(0);

    const sales = movements.filter(m => m.type === "SALE").length;
    const refunds = movements.filter(m => m.type === "REFUND").length;
    expect(sales).toBe(1);
    expect(refunds).toBe(1);
  });

  it("24. concorrência real: DELETE item + cancelar comanda simultâneos", async () => {
    const t = await seedTenant("conc-mixed");
    getServerSessionMock.mockResolvedValue({ user: { id: t.ownerUser.id, role: "OWNER" } });

    const prod = await prisma.product.create({
      data: { barbershopId: t.shop.id, name: "Produto Misto", salePrice: "20.00", currentStock: "5.000", trackStock: true },
    });

    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Misto", customerPhone: "11999999999" }));
    const comanda = await resComanda.json();

    const resItem = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: prod.id,
        quantity: 1
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    const item = await resItem.json();
    const itemId = item.items[0].id;

    await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 20.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    const payment = await prisma.payment.findFirst({ where: { comandaId: comanda.id } });
    await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment?.id}/refund`, { amount: 20.00, reason: "Estorno" }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment!.id }) }
    );

    const p1 = itemDetailRoute.DELETE(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${itemId}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: comanda.id, itemId }) }
    );
    const p2 = comandaDetailRoute.PATCH(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}`, { status: "CANCELLED" }, "PATCH"),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    await Promise.allSettled([p1, p2]);

    const updatedProd = await prisma.product.findUnique({ where: { id: prod.id } });
    expect(Number(updatedProd?.currentStock)).toBe(5);

    const movements = await prisma.stockMovement.findMany({ where: { productId: prod.id } });
    const refunds = movements.filter(m => m.type === "REFUND").length;
    expect(refunds).toBeLessThanOrEqual(1);
  });

  it("25. cancelamento com CommissionEntry e ClubBenefitUsage e assert explícito", async () => {
    const t = await seedTenant("comm-club");
    getServerSessionMock.mockResolvedValue({ user: { id: t.ownerUser.id, role: "OWNER" } });

    const plan = await prisma.clubPlan.create({
      data: {
        barbershopId: t.shop.id,
        name: "Plano Club",
        monthlyPrice: "80.00",
        shopSharePercent: "50.00",
        barberPoolPercent: "50.00",
        isActive: true,
      },
    });

    await prisma.clubPlanBenefit.create({
      data: {
        clubPlanId: plan.id,
        benefitType: "INCLUDED_SERVICE",
        serviceId: t.cut.id,
        includedQty: 2,
      },
    });

    await prisma.customerClubSubscription.create({
      data: {
        barbershopId: t.shop.id,
        customerId: t.customer.id,
        clubPlanId: plan.id,
        status: "ACTIVE",
        currentPeriodStart: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        currentPeriodEnd: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      },
    });

    const cut2 = await prisma.service.create({
      data: { barbershopId: t.shop.id, name: "Corte Pago", price: "30.00", durationMin: 30, categoryId: t.cut.categoryId },
    });

    await prisma.barberService.create({
      data: { barberId: t.barber.id, serviceId: cut2.id },
    });

    const resComanda = await comandasRoute.POST(
      jsonRequest("http://localhost/api/admin/comandas", { customerName: t.customer.name, customerPhone: t.customer.phone })
    );
    expect(resComanda.status).toBe(201);
    const comanda = await resComanda.json();

    const benefit = await prisma.clubPlanBenefit.findFirst({ where: { clubPlanId: plan.id } });

    // Serviço coberto pelo clube
    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "SERVICE",
        serviceId: t.cut.id,
        executorId: t.barber.id,
        quantity: 1,
        clubBenefitRequested: true,
        requestedClubPlanBenefitId: benefit!.id,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Serviço pago
    const cut2Res = await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "SERVICE",
        serviceId: cut2.id,
        executorId: t.barber.id,
        quantity: 1,
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    // Finalizar comanda pagando R$ 30
    const finalizeRes = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 30.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(finalizeRes.status).toBe(200);

    const commEntry = await prisma.commissionEntry.findFirst({ where: { comandaItem: { comandaId: comanda.id } } });
    expect(commEntry).not.toBeNull();
    expect(commEntry?.status).toBe("RELEASED");

    const clubUsageReal = await prisma.clubBenefitUsage.findFirst({
      where: { comandaItem: { comandaId: comanda.id } }
    });
    expect(clubUsageReal).not.toBeNull();
    expect(clubUsageReal?.status).toBe("APPLIED");

    // Reabrir via refund
    const payment = await prisma.payment.findFirst({ where: { comandaId: comanda.id } });
    await refundRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/payments/${payment?.id}/refund`, { amount: 30.00, reason: "Estorno" }),
      { params: Promise.resolve({ id: comanda.id, paymentId: payment!.id }) }
    );

    // Cancelar comanda
    const cancelRes = await comandaDetailRoute.PATCH(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}`, { status: "CANCELLED" }, "PATCH"),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(cancelRes.status).toBe(200);

    const commEntryAfter = await prisma.commissionEntry.findFirst({ where: { comandaItem: { comandaId: comanda.id } } });
    expect(commEntryAfter?.status).toBe("REVERSED");

    const clubUsageAfter = await prisma.clubBenefitUsage.findFirst({
      where: { comandaItem: { comandaId: comanda.id } }
    });
    expect(clubUsageAfter?.status).toBe("REVERSED");
  });
});
