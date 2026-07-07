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
  /match_barber_test|localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) &&
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
    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Maria" }));
    const comanda = await resComanda.json();

    // Adicionar prod1 (qty 1)
    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: prod1.id,
        quantity: 1
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Adicionar prod2 (qty 3)
    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: prod2.id,
        quantity: 3
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Finalizar comanda
    await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 150.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Verificar baixas
    const p1AfterClose = await prisma.product.findUnique({ where: { id: prod1.id } });
    const p2AfterClose = await prisma.product.findUnique({ where: { id: prod2.id } });
    expect(Number(p1AfterClose?.currentStock)).toBe(9);
    expect(Number(p2AfterClose?.currentStock)).toBe(7);

    // Cancelar comanda
    await comandaDetailRoute.PATCH(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}`, { status: "CANCELLED" }, "PATCH"),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Verificar retorno
    const p1AfterCancel = await prisma.product.findUnique({ where: { id: prod1.id } });
    const p2AfterCancel = await prisma.product.findUnique({ where: { id: prod2.id } });
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

    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Jose" }));
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
    await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 110.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Verificar
    expect(Number((await prisma.product.findUnique({ where: { id: prodTracked.id } }))?.currentStock)).toBe(3);
    expect(Number((await prisma.product.findUnique({ where: { id: prodUntracked.id } }))?.currentStock)).toBe(5); // Inalterado

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

    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Ana" }));
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
    const resC1 = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Paula" }));
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
    const resC2 = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Carlos" }));
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

    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "David" }));
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

    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Eduardo" }));
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

    const prod = await prisma.product.create({
      data: { barbershopId: t.shop.id, name: "Tesoura", salePrice: "50.00", currentStock: "2.000", trackStock: true },
    });

    const resComanda = await comandasRoute.POST(jsonRequest("http://localhost/api/admin/comandas", { customerName: "Vitor" }));
    const comanda = await resComanda.json();

    // Adiciona 3 itens (estoque é 2)
    await itemsRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/items`, {
        type: "PRODUCT",
        productId: prod.id,
        quantity: 3
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );

    // Fechar comanda deve retornar INSUFFICIENT_STOCK
    const finalizeRes = await finalizeRoute.POST(
      jsonRequest(`http://localhost/api/admin/comandas/${comanda.id}/finalize`, {
        payments: [{ method: "PIX", amount: 150.00 }]
      }),
      { params: Promise.resolve({ id: comanda.id }) }
    );
    expect(finalizeRes.status).toBe(422);
    const err = await finalizeRes.json();
    expect(err.error).toContain("Estoque insuficiente");

    // Verificar que estoque permaneceu 2 e nenhum movimento de estoque SALE foi gravado (rollback completo)
    expect(Number((await prisma.product.findUnique({ where: { id: prod.id } }))?.currentStock)).toBe(2);
    expect(await prisma.stockMovement.count({ where: { productId: prod.id } })).toBe(0);
  });
});
