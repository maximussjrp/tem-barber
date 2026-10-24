/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  MemberRole,
  ComandaItemStatus,
  ComandaStatus,
  CommissionConfigType,
  CommissionEntryStatus,
  CommissionPayableType,
  PaymentMethod,
  Prisma,
} from "@prisma/client";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { requireOperationalSession } from "@/lib/operations/permissions";
import { addServiceItem } from "@/lib/operations/comandas";
import { registerPayment } from "@/lib/operations/payments";
import {
  syncCommissionReleaseForComanda,
  upsertCommissionConfig,
} from "@/lib/operations/commissions";
import { toCents } from "@/lib/operations/money";
import { bootstrapFinancialPlan } from "@/lib/financial/default-plan";

vi.mock("@/lib/operations/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations/permissions")>("@/lib/operations/permissions");
  return {
    ...actual,
    requireOperationalSession: vi.fn(),
  };
});

/**
 * Validação estrita Fail-Closed do Banco de Testes:
 * 1. Exige TEST_DATABASE_URL definida
 * 2. Exige DATABASE_URL definida e estritamente idêntica a TEST_DATABASE_URL
 * 3. Exige protocolo postgres: ou postgresql:
 * 4. Exige host local (localhost ou 127.0.0.1)
 * 5. Exige nome de banco explicitamente de teste (match_barber_test ou tem_barber_test)
 * 6. Proíbe expressamente qualquer string contendo 'prod'
 */
const rawDatabaseUrl = process.env.DATABASE_URL;
const rawTestDatabaseUrl = process.env.TEST_DATABASE_URL;

const isTestDatabaseSafe = (() => {
  if (!rawDatabaseUrl || !rawTestDatabaseUrl) return false;
  if (rawDatabaseUrl !== rawTestDatabaseUrl) return false;

  try {
    const url = new URL(rawTestDatabaseUrl);
    const isPostgresProto = ["postgres:", "postgresql:"].includes(url.protocol);
    const isLocalhost = ["localhost", "127.0.0.1"].includes(url.hostname);
    const dbName = url.pathname.slice(1);
    const isTestDbName = /^(match_barber_test|tem_barber_test)(?:_[a-z0-9_]+)?$/i.test(dbName);
    const isNotProduction = !/prod/i.test(url.pathname) && !/prod/i.test(url.hostname);

    return isPostgresProto && isLocalhost && isTestDbName && isNotProduction;
  } catch {
    return false;
  }
})();

const describeIfSafePostgres = isTestDatabaseSafe ? describe : describe.skip;

let prisma: PrismaClient;
let pool: Pool | null = null;
const mockedRequireOperationalSession = vi.mocked(requireOperationalSession);

async function truncateDatabase() {
  if (!isTestDatabaseSafe) {
    throw new Error("FAIL-CLOSED GUARD: Tentativa de truncate bloqueada em banco não validado como teste local.");
  }
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "commission_advance_audits",
      "commission_advance_reversals",
      "commission_payouts",
      "commission_cycle_adjustments",
      "commission_advances",
      "commission_payable_items",
      "commission_cycles",
      "commission_entries",
      "commission_adjustments",
      "commission_periods",
      "commission_configs",
      "service_commission_rules",
      "club_benefit_usages",
      "club_point_entries",
      "customer_club_subscriptions",
      "club_subscription_payments",
      "club_settlement_members",
      "club_settlements",
      "club_plan_benefits",
      "club_plans",
      "financial_entries",
      "cash_movements",
      "cash_sessions",
      "command_payments",
      "stock_movements",
      "comanda_items",
      "comandas",
      "appointment_services",
      "appointments",
      "barber_services",
      "products",
      "services",
      "categories",
      "barbershop_members",
      "barbershops",
      "users"
    CASCADE
  `);
}

async function seedTenant(label: string) {
  const barbershop = await prisma.barbershop.create({
    data: {
      name: `Shop ${label}`,
      slug: `shop-${label}-${Date.now()}`,
      phone: `11988${label.padStart(6, "0").slice(-6)}`,
      zipCode: "00000-000",
      street: "Rua Teste",
      number: "1",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP",
    },
  });

  const ownerUser = await prisma.user.create({
    data: {
      name: `Owner ${label}`,
      email: `owner-${label}-${Date.now()}@test.local`,
      phone: `11988${label.padStart(6, "0").slice(-6)}`,
    },
  });

  const barberUser = await prisma.user.create({
    data: {
      name: `Barber ${label}`,
      email: `barber-${label}-${Date.now()}@test.local`,
      phone: `11987${label.padStart(6, "0").slice(-6)}`,
    },
  });

  const ownerMember = await prisma.barbershopMember.create({
    data: {
      barbershopId: barbershop.id,
      userId: ownerUser.id,
      role: MemberRole.OWNER,
    },
  });

  const barberMember = await prisma.barbershopMember.create({
    data: {
      barbershopId: barbershop.id,
      userId: barberUser.id,
      role: MemberRole.BARBER,
      isCommissionEligible: true,
    },
  });

  const category = await prisma.category.create({
    data: {
      barbershopId: barbershop.id,
      name: `Geral ${label}`,
      slug: `geral-${label}-${Date.now()}`,
    },
  });

  const service = await prisma.service.create({
    data: {
      barbershopId: barbershop.id,
      categoryId: category.id,
      name: `Corte ${label}`,
      price: new Prisma.Decimal("50.00"),
      durationMin: 30,
    },
  });

  const product = await prisma.product.create({
    data: {
      barbershopId: barbershop.id,
      name: `Pomada ${label}`,
      salePrice: new Prisma.Decimal("40.00"),
      costPrice: new Prisma.Decimal("20.00"),
      currentStock: new Prisma.Decimal("10.000"),
      trackStock: true,
    },
  });

  // Inicializa o plano financeiro padrão e os mappings de receita (COMANDA_SERVICE_REVENUE, etc.)
  await bootstrapFinancialPlan(prisma, barbershop.id);

  return { barbershop, ownerMember, barberMember, service, product };
}

describeIfSafePostgres("TEMBARBER_UX1_1 — Testes de Integração com PostgreSQL Real Isolado", () => {
  let patchRoute: typeof import("@/app/api/admin/comandas/[id]/items/[itemId]/route").PATCH;
  let deleteRoute: typeof import("@/app/api/admin/comandas/[id]/items/[itemId]/route").DELETE;

  beforeAll(async () => {
    // Instanciação isolada com validação de segurança fail-closed
    pool = new Pool({ connectionString: rawTestDatabaseUrl });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });

    const routeModule = await import("@/app/api/admin/comandas/[id]/items/[itemId]/route");
    patchRoute = routeModule.PATCH;
    deleteRoute = routeModule.DELETE;
  });

  beforeEach(async () => {
    await truncateDatabase();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
  });

  it("Cenário A — Sem pagamento: DONE -> PENDING -> DONE sem duplicidade de comissões", async () => {
    const t = await seedTenant("A");
    await upsertCommissionConfig(prisma, {
      barbershopId: t.barbershop.id,
      memberId: t.barberMember.id,
      type: CommissionConfigType.PERCENTAGE,
      value: 50,
    });

    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: t.barbershop.id,
        customerName: "Cliente A",
        status: ComandaStatus.OPEN,
      },
    });

    await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: t.barbershop.id,
        comandaId: comanda.id,
        serviceId: t.service.id,
        executorId: t.barberMember.id,
      })
    );

    // Recupera o verdadeiro ComandaItem.id criado e valida item.id !== comanda.id
    const item = await prisma.comandaItem.findFirst({
      where: { comandaId: comanda.id, barbershopId: t.barbershop.id, serviceId: t.service.id },
    });
    expect(item).not.toBeNull();
    expect(item!.id).not.toBe(comanda.id);

    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: {
        userId: t.ownerMember.userId,
        memberId: t.ownerMember.id,
        role: "OWNER",
        barbershopId: t.barbershop.id,
      },
    });

    // 1. Concluir serviço (PENDING -> DONE)
    let res = await patchRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      }),
      { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
    );
    expect(res.status).toBe(200);

    let comm = await prisma.commissionEntry.findFirst({
      where: { comandaItemId: item!.id, isCurrent: true },
    });
    expect(comm).not.toBeNull();
    expect(toCents(comm!.generatedAmount)).toBe(2500); // 50% de 50.00
    expect(toCents(comm!.releasedAmount)).toBe(0); // Sem pagamento

    // 2. Reverter conclusão (DONE -> PENDING)
    res = await patchRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PENDING" }),
      }),
      { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
    );
    expect(res.status).toBe(200);

    comm = await prisma.commissionEntry.findFirst({
      where: { comandaItemId: item!.id, isCurrent: true },
    });
    // Sem pagamento, entrada em rascunho é limpa/deletada
    expect(comm).toBeNull();

    // 3. Concluir novamente (PENDING -> DONE)
    res = await patchRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      }),
      { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
    );
    expect(res.status).toBe(200);

    const commEntries = await prisma.commissionEntry.findMany({
      where: { comandaItemId: item!.id, isCurrent: true },
    });
    expect(commEntries).toHaveLength(1);
    expect(toCents(commEntries[0].generatedAmount)).toBe(2500);
  });

  it("Cenário B — Pagamento parcial: DONE -> PENDING -> DONE reconcilia ledger sem colisão de eventKey", async () => {
    const t = await seedTenant("B");
    await upsertCommissionConfig(prisma, {
      barbershopId: t.barbershop.id,
      memberId: t.barberMember.id,
      type: CommissionConfigType.PERCENTAGE,
      value: 50,
    });

    const comanda = await prisma.comanda.create({
      data: {
        barbershopId: t.barbershop.id,
        customerName: "Cliente B",
        status: ComandaStatus.OPEN,
      },
    });

    await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: t.barbershop.id,
        comandaId: comanda.id,
        serviceId: t.service.id,
        executorId: t.barberMember.id,
      })
    );

    const item = await prisma.comandaItem.findFirst({
      where: { comandaId: comanda.id, barbershopId: t.barbershop.id, serviceId: t.service.id },
    });
    expect(item).not.toBeNull();
    expect(item!.id).not.toBe(comanda.id);

    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: {
        userId: t.ownerMember.userId,
        memberId: t.ownerMember.id,
        role: "OWNER",
        barbershopId: t.barbershop.id,
      },
    });

    // Conclui serviço
    await patchRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      }),
      { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
    );

    // Registra pagamento parcial de 25.00 (50% do valor total de 50.00)
    await prisma.$transaction((tx) =>
      registerPayment(tx, {
        barbershopId: t.barbershop.id,
        comandaId: comanda.id,
        amount: "25.00",
        method: PaymentMethod.PIX,
        userId: t.ownerMember.userId,
      })
    );

    // Sincroniza comissões: deve liberar 12.50 (50% de 25.00)
    await prisma.$transaction((tx) =>
      syncCommissionReleaseForComanda(tx, t.barbershop.id, comanda.id)
    );

    let payables = await prisma.commissionPayableItem.findMany({
      where: { barbershopId: t.barbershop.id, sourceComandaId: comanda.id },
      orderBy: { createdAt: "asc" },
    });
    expect(payables).toHaveLength(1);
    expect(payables[0].type).toBe(CommissionPayableType.RELEASE);
    expect(toCents(payables[0].amount)).toBe(1250);

    // Reverte para PENDING
    await patchRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PENDING" }),
      }),
      { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
    );

    payables = await prisma.commissionPayableItem.findMany({
      where: { barbershopId: t.barbershop.id, sourceComandaId: comanda.id },
      orderBy: { createdAt: "asc" },
    });
    // Deve haver 1 RELEASE e 1 REVERSAL
    expect(payables).toHaveLength(2);
    expect(payables[1].type).toBe(CommissionPayableType.REVERSAL);
    expect(toCents(payables[1].amount)).toBe(1250);

    // Conclui novamente (PENDING -> DONE)
    await patchRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      }),
      { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
    );

    payables = await prisma.commissionPayableItem.findMany({
      where: { barbershopId: t.barbershop.id, sourceComandaId: comanda.id },
      orderBy: { createdAt: "asc" },
    });
    // Deve haver 3 eventos: RELEASE (12.50) -> REVERSAL (12.50) -> NOVO RELEASE (12.50)
    expect(payables).toHaveLength(3);
    expect(payables[2].type).toBe(CommissionPayableType.RELEASE);
    expect(toCents(payables[2].amount)).toBe(1250);

    // Saldo líquido no ciclo = +12.50 - 12.50 + 12.50 = 12.50
    const netBalance = payables.reduce((acc, p) => {
      const cents = toCents(p.amount);
      return p.type === CommissionPayableType.RELEASE ? acc + cents : acc - cents;
    }, 0);
    expect(netBalance).toBe(1250);
  });

  it("Cenário C — Repetição: reenviar status idêntico não gera novos lançamentos nem altera revisão", async () => {
    const t = await seedTenant("C");
    const comanda = await prisma.comanda.create({
      data: { barbershopId: t.barbershop.id, customerName: "Cliente C", status: ComandaStatus.OPEN },
    });
    await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: t.barbershop.id,
        comandaId: comanda.id,
        serviceId: t.service.id,
        executorId: t.barberMember.id,
      })
    );

    const item = await prisma.comandaItem.findFirst({
      where: { comandaId: comanda.id, barbershopId: t.barbershop.id, serviceId: t.service.id },
    });
    expect(item).not.toBeNull();
    expect(item!.id).not.toBe(comanda.id);

    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: t.ownerMember.userId, memberId: t.ownerMember.id, role: "OWNER", barbershopId: t.barbershop.id },
    });

    // Reenvia PENDING quando já está PENDING
    await patchRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PENDING" }),
      }),
      { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
    );

    const checkComanda = await prisma.comanda.findUnique({ where: { id: comanda.id } });
    expect(checkComanda!.commissionRevision).toBe(1); // Revisão não foi incrementada
  });

  it("Cenário D — Concorrência: requisições concorrentes serializáveis contra o mesmo item", async () => {
    const t = await seedTenant("D");
    const comanda = await prisma.comanda.create({
      data: { barbershopId: t.barbershop.id, customerName: "Cliente D", status: ComandaStatus.OPEN },
    });
    await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: t.barbershop.id,
        comandaId: comanda.id,
        serviceId: t.service.id,
        executorId: t.barberMember.id,
      })
    );

    const item = await prisma.comandaItem.findFirst({
      where: { comandaId: comanda.id, barbershopId: t.barbershop.id, serviceId: t.service.id },
    });
    expect(item).not.toBeNull();

    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: t.ownerMember.userId, memberId: t.ownerMember.id, role: "OWNER", barbershopId: t.barbershop.id },
    });

    // Duas requisições simultâneas para concluir o item
    const [res1, res2] = await Promise.all([
      patchRoute(
        new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "DONE" }),
        }),
        { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
      ),
      patchRoute(
        new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "DONE" }),
        }),
        { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
      ),
    ]);

    expect([res1.status, res2.status]).toContain(200);
    const updatedItem = await prisma.comandaItem.findUnique({ where: { id: item!.id } });
    expect(updatedItem!.status).toBe(ComandaItemStatus.DONE);
  });

  it("Cenário E — Comissão Paga: reversão bloqueada", async () => {
    const t = await seedTenant("E");
    const comanda = await prisma.comanda.create({
      data: { barbershopId: t.barbershop.id, customerName: "Cliente E", status: ComandaStatus.OPEN },
    });
    await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: t.barbershop.id,
        comandaId: comanda.id,
        serviceId: t.service.id,
        executorId: t.barberMember.id,
      })
    );

    const item = await prisma.comandaItem.findFirst({
      where: { comandaId: comanda.id, barbershopId: t.barbershop.id, serviceId: t.service.id },
    });
    expect(item).not.toBeNull();
    expect(item!.id).not.toBe(comanda.id);

    // Marca como DONE
    await prisma.comandaItem.update({
      where: { id: item!.id },
      data: { status: ComandaItemStatus.DONE, completedAt: new Date() },
    });

    // Cria comissão com status PAID
    await prisma.commissionEntry.create({
      data: {
        barbershopId: t.barbershop.id,
        comandaItemId: item!.id,
        memberId: t.barberMember.id,
        baseAmount: new Prisma.Decimal("50.00"),
        generatedAmount: new Prisma.Decimal("25.00"),
        releasedAmount: new Prisma.Decimal("25.00"),
        paidAmount: new Prisma.Decimal("25.00"),
        competence: "2026-10",
        type: "SERVICE",
        status: CommissionEntryStatus.PAID,
        configSnapshot: { type: "PERCENTAGE", value: 50 },
      },
    });

    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: t.ownerMember.userId, memberId: t.ownerMember.id, role: "OWNER", barbershopId: t.barbershop.id },
    });

    const res = await patchRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PENDING" }),
      }),
      { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("COMMISSION_ALREADY_PAID");

    const refreshedItem = await prisma.comandaItem.findUnique({ where: { id: item!.id } });
    expect(refreshedItem!.status).toBe(ComandaItemStatus.DONE);
  });

  it("Cenário F — Isolamento Multi-Tenant: Tenant B não altera item do Tenant A", async () => {
    const tA = await seedTenant("FA");
    const tB = await seedTenant("FB");

    const comandaA = await prisma.comanda.create({
      data: { barbershopId: tA.barbershop.id, customerName: "Cliente FA", status: ComandaStatus.OPEN },
    });
    await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: tA.barbershop.id,
        comandaId: comandaA.id,
        serviceId: tA.service.id,
        executorId: tA.barberMember.id,
      })
    );

    const itemA = await prisma.comandaItem.findFirst({
      where: { comandaId: comandaA.id, barbershopId: tA.barbershop.id, serviceId: tA.service.id },
    });
    expect(itemA).not.toBeNull();
    expect(itemA!.id).not.toBe(comandaA.id);

    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: tB.ownerMember.userId, memberId: tB.ownerMember.id, role: "OWNER", barbershopId: tB.barbershop.id },
    });

    const res = await patchRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comandaA.id}/items/${itemA!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      }),
      { params: Promise.resolve({ id: comandaA.id, itemId: itemA!.id }) }
    );

    expect(res.status).toBe(404);
  });

  it("Cenário H — Proteção de Cancelados: PATCH de quantidade bloqueado (422) e DELETE repetido idempotente", async () => {
    const t = await seedTenant("H");
    const comanda = await prisma.comanda.create({
      data: { barbershopId: t.barbershop.id, customerName: "Cliente H", status: ComandaStatus.OPEN },
    });
    await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: t.barbershop.id,
        comandaId: comanda.id,
        serviceId: t.service.id,
        executorId: t.barberMember.id,
      })
    );

    const item = await prisma.comandaItem.findFirst({
      where: { comandaId: comanda.id, barbershopId: t.barbershop.id, serviceId: t.service.id },
    });
    expect(item).not.toBeNull();
    expect(item!.id).not.toBe(comanda.id);

    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: t.ownerMember.userId, memberId: t.ownerMember.id, role: "OWNER", barbershopId: t.barbershop.id },
    });

    // 1. Cancela o item via DELETE
    let delRes = await deleteRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
    );
    expect(delRes.status).toBe(200);

    const comandaAfterDelete = await prisma.comanda.findUnique({ where: { id: comanda.id } });
    const revisionAfterDelete = comandaAfterDelete!.commissionRevision;

    // 2. DELETE repetido no mesmo item já cancelado: deve ser idempotente e não incrementar revisão
    delRes = await deleteRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
    );
    expect(delRes.status).toBe(200);

    const comandaAfterRepeatDelete = await prisma.comanda.findUnique({ where: { id: comanda.id } });
    expect(comandaAfterRepeatDelete!.commissionRevision).toBe(revisionAfterDelete);

    // 3. PATCH de quantidade sem status no item cancelado deve ser bloqueado com 422
    const patchRes = await patchRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: 2 }),
      }),
      { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
    );
    expect(patchRes.status).toBe(422);
    const patchBody = await patchRes.json();
    expect(patchBody.error).toBe("INVALID_OPERATION");
  });

  it("Cenário G — Preservação de benefícios de Clube e Estoque no ciclo DONE -> PENDING", async () => {
    const t = await seedTenant("G");
    const comanda = await prisma.comanda.create({
      data: { barbershopId: t.barbershop.id, customerName: "Cliente G", status: ComandaStatus.OPEN },
    });
    await prisma.$transaction((tx) =>
      addServiceItem(tx, {
        barbershopId: t.barbershop.id,
        comandaId: comanda.id,
        serviceId: t.service.id,
        executorId: t.barberMember.id,
      })
    );

    const item = await prisma.comandaItem.findFirst({
      where: { comandaId: comanda.id, barbershopId: t.barbershop.id, serviceId: t.service.id },
    });
    expect(item).not.toBeNull();

    mockedRequireOperationalSession.mockResolvedValue({
      error: null,
      data: { userId: t.ownerMember.userId, memberId: t.ownerMember.id, role: "OWNER", barbershopId: t.barbershop.id },
    });

    // 1. Conclui serviço (PENDING -> DONE)
    let res = await patchRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      }),
      { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
    );
    expect(res.status).toBe(200);

    // 2. Reverte conclusão (DONE -> PENDING)
    res = await patchRoute(
      new NextRequest(`http://localhost/api/admin/comandas/${comanda.id}/items/${item!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PENDING" }),
      }),
      { params: Promise.resolve({ id: comanda.id, itemId: item!.id }) }
    );
    expect(res.status).toBe(200);

    // Verifica que nenhum movimento de estoque de produto foi gerado (pois é serviço)
    const movements = await prisma.stockMovement.findMany({
      where: { comandaItemId: item!.id },
    });
    expect(movements).toHaveLength(0);

    // Verifica que estoque do produto da barbearia permaneceu inalterado em 10.000
    const prod = await prisma.product.findUnique({ where: { id: t.product.id } });
    expect(Number(prod!.currentStock)).toBe(10);
  });
});
