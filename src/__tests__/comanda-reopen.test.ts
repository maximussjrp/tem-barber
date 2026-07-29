import { NextRequest } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OperationalError, reopenComanda } from "@/lib/operations/comandas";
import { closeComanda } from "@/lib/operations/payments";
import { POST as reopenPost } from "@/app/api/admin/comandas/[id]/reopen/route";

const { prismaMock, requireOperationalSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    comanda: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    financialEntry: {
      create: vi.fn(),
    },
    comandaReopenAudit: {
      create: vi.fn(),
    },
  },
  requireOperationalSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/operations/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operations/permissions")>();
  return {
    ...actual,
    requireOperationalSession: requireOperationalSessionMock,
  };
});

const closedComanda = {
  id: "comanda-1",
  barbershopId: "shop-1",
  status: "CLOSED",
  total: new Prisma.Decimal("70.00"),
  paidTotal: new Prisma.Decimal("70.00"),
  remainingTotal: new Prisma.Decimal("0.00"),
};

function request(body: unknown) {
  return new NextRequest("http://localhost/api/admin/comandas/comanda-1/reopen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("reabertura segura de comanda fechada", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((callback) => callback(prismaMock));
    prismaMock.comanda.findFirst.mockResolvedValue(closedComanda);
    prismaMock.comanda.update.mockResolvedValue({
      ...closedComanda,
      status: "PENDING_PAYMENT",
      closedAt: null,
      paidTotal: new Prisma.Decimal("70.00"),
      remainingTotal: new Prisma.Decimal("0.00"),
      items: [],
      payments: [],
    });
    prismaMock.payment.findMany.mockResolvedValue([
      {
        amount: new Prisma.Decimal("70.00"),
        refundedAmount: new Prisma.Decimal("0.00"),
      },
    ]);
    prismaMock.comandaReopenAudit.create.mockResolvedValue({});
    requireOperationalSessionMock.mockResolvedValue({
      error: null,
      data: {
        userId: "owner-user",
        memberId: "owner-member",
        role: "OWNER",
        barbershopId: "shop-1",
      },
    });
  });

  it("OWNER consegue reabrir CLOSED com motivo e auditoria", async () => {
    const res = await reopenPost(request({ reason: "Corrigir item pago" }), {
      params: Promise.resolve({ id: "comanda-1" }),
    });

    expect(res.status).toBe(200);
    expect(prismaMock.comanda.findFirst).toHaveBeenCalledWith({
      where: { id: "comanda-1", barbershopId: "shop-1" },
    });
    expect(prismaMock.comanda.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "comanda-1" },
        data: expect.objectContaining({
          status: "PENDING_PAYMENT",
          closedAt: null,
          paidTotal: new Prisma.Decimal("70"),
          remainingTotal: new Prisma.Decimal("0"),
        }),
      })
    );
    expect(prismaMock.comandaReopenAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          barbershopId: "shop-1",
          comandaId: "comanda-1",
          reopenedByUserId: "owner-user",
          reopenedByMemberId: "owner-member",
          reason: "Corrigir item pago",
          previousStatus: "CLOSED",
          newStatus: "PENDING_PAYMENT",
        }),
      })
    );
  });

  it.each(["MANAGER", "SUPER_ADMIN"])("%s consegue reabrir CLOSED com motivo", async (role) => {
    requireOperationalSessionMock.mockResolvedValueOnce({
      error: null,
      data: {
        userId: `${role.toLowerCase()}-user`,
        memberId: `${role.toLowerCase()}-member`,
        role,
        barbershopId: "shop-1",
      },
    });

    const res = await reopenPost(request({ reason: "Corrigir item pago" }), {
      params: Promise.resolve({ id: "comanda-1" }),
    });

    expect(res.status).toBe(200);
    expect(prismaMock.comanda.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING_PAYMENT" }),
      })
    );
  });

  it("BARBER nao consegue reabrir CLOSED", async () => {
    requireOperationalSessionMock.mockResolvedValueOnce({
      error: null,
      data: {
        userId: "barber-user",
        memberId: "barber-member",
        role: "BARBER",
        barbershopId: "shop-1",
      },
    });

    const res = await reopenPost(request({ reason: "Corrigir item pago" }), {
      params: Promise.resolve({ id: "comanda-1" }),
    });

    expect(res.status).toBe(403);
    expect(prismaMock.comanda.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.comanda.update).not.toHaveBeenCalled();
  });

  it("motivo vazio retorna erro", async () => {
    const res = await reopenPost(request({ reason: "   " }), {
      params: Promise.resolve({ id: "comanda-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("REOPEN_REASON_REQUIRED");
    expect(prismaMock.comanda.update).not.toHaveBeenCalled();
  });

  it("CANCELLED nao reabre", async () => {
    prismaMock.comanda.findFirst.mockResolvedValueOnce({
      ...closedComanda,
      status: "CANCELLED",
    });

    await expect(
      reopenComanda(prismaMock as unknown as Prisma.TransactionClient, {
        barbershopId: "shop-1",
        comandaId: "comanda-1",
        reason: "Corrigir item pago",
        userId: "owner-user",
        memberId: "owner-member",
      })
    ).rejects.toMatchObject({ code: "COMANDA_CANCELLED" } satisfies Partial<OperationalError>);
    expect(prismaMock.comanda.update).not.toHaveBeenCalled();
  });

  it("preserva pagamentos e financeiro existentes durante a reabertura", async () => {
    await reopenComanda(prismaMock as unknown as Prisma.TransactionClient, {
      barbershopId: "shop-1",
      comandaId: "comanda-1",
      reason: "Corrigir item pago",
      userId: "owner-user",
      memberId: "owner-member",
    });

    expect(prismaMock.payment.findMany).toHaveBeenCalledWith({
      where: { comandaId: "comanda-1", barbershopId: "shop-1", status: "CONFIRMED" },
    });
    expect(prismaMock.payment.create).not.toHaveBeenCalled();
    expect(prismaMock.financialEntry.create).not.toHaveBeenCalled();
  });

  it("paidTotal permanece correto e remainingTotal e recalculado", async () => {
    prismaMock.payment.findMany.mockResolvedValueOnce([
      {
        amount: new Prisma.Decimal("40.00"),
        refundedAmount: new Prisma.Decimal("10.00"),
      },
    ]);

    await reopenComanda(prismaMock as unknown as Prisma.TransactionClient, {
      barbershopId: "shop-1",
      comandaId: "comanda-1",
      reason: "Corrigir item pago",
      userId: "owner-user",
      memberId: "owner-member",
    });

    expect(prismaMock.comanda.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paidTotal: new Prisma.Decimal("30"),
          remainingTotal: new Prisma.Decimal("40"),
        }),
      })
    );
  });

  it("nao permite reabrir quando total esta abaixo do pago", async () => {
    prismaMock.comanda.findFirst.mockResolvedValueOnce({
      ...closedComanda,
      total: new Prisma.Decimal("50.00"),
    });

    await expect(
      reopenComanda(prismaMock as unknown as Prisma.TransactionClient, {
        barbershopId: "shop-1",
        comandaId: "comanda-1",
        reason: "Corrigir item pago",
        userId: "owner-user",
        memberId: "owner-member",
      })
    ).rejects.toMatchObject({ code: "TOTAL_BELOW_PAID" } satisfies Partial<OperationalError>);
    expect(prismaMock.comanda.update).not.toHaveBeenCalled();
  });

  it("isola tenant na busca da comanda", async () => {
    prismaMock.comanda.findFirst.mockResolvedValueOnce(null);

    const res = await reopenPost(request({ reason: "Corrigir item pago" }), {
      params: Promise.resolve({ id: "comanda-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("COMANDA_NOT_FOUND");
    expect(prismaMock.comanda.findFirst).toHaveBeenCalledWith({
      where: { id: "comanda-1", barbershopId: "shop-1" },
    });
  });
});

function assertSafeTestDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL obrigatorio para o teste real de auditoria.");

  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, "");
  const safe =
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
    database.toLowerCase().includes("test") &&
    !/(prod|production|app\.tembarber\.com\.br|49\.13\.217\.235)/i.test(url);

  if (!safe) throw new Error("TEST_DATABASE_URL nao e seguro para teste local.");
  return url;
}

describe("reabertura de comanda fechada com PostgreSQL real", () => {
  let pool: Pool | null = null;
  let db: PrismaClient | null = null;

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) return;
    const connectionString = assertSafeTestDatabaseUrl();
    process.env.DATABASE_URL = connectionString;
    pool = new Pool({ connectionString });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    await db.barbershop.deleteMany({ where: { slug: { startsWith: "reopen-db-" } } });
    await db.user.deleteMany({ where: { phone: { startsWith: "reopen-db-" } } });
  });

  afterAll(async () => {
    await db?.barbershop.deleteMany({ where: { slug: { startsWith: "reopen-db-" } } });
    await db?.user.deleteMany({ where: { phone: { startsWith: "reopen-db-" } } });
    await db?.$disconnect();
    await pool?.end();
  });

  it("grava auditoria, preserva pagamentos e financeiro, e fecha novamente sem duplicar", async () => {
    if (!db) {
      expect(process.env.TEST_DATABASE_URL).toBeUndefined();
      return;
    }

    const suffix = `${Date.now()}-${Math.round(Math.random() * 100000)}`;
    const shop = await db.barbershop.create({
      data: {
        name: `Reopen DB ${suffix}`,
        slug: `reopen-db-${suffix}`,
        phone: `reopen-db-shop-${suffix}`,
        zipCode: "00000-000",
        street: "Rua Teste",
        number: "1",
        neighborhood: "Centro",
        city: "Sao Paulo",
        state: "SP",
      },
    });
    const ownerUser = await db.user.create({
      data: {
        name: "Owner Reopen DB",
        phone: `reopen-db-owner-${suffix}`,
      },
    });
    const ownerMember = await db.barbershopMember.create({
      data: {
        barbershopId: shop.id,
        userId: ownerUser.id,
        role: "OWNER",
      },
    });
    const comanda = await db.comanda.create({
      data: {
        barbershopId: shop.id,
        customerName: "Cliente Teste DB",
        status: "CLOSED",
        subtotal: "70.00",
        total: "70.00",
        paidTotal: "70.00",
        remainingTotal: "0.00",
        closedAt: new Date(),
        items: {
          create: [
            {
              barbershopId: shop.id,
              type: "SERVICE",
              status: "DONE",
              description: "Servico teste",
              quantity: "2",
              unitPrice: "35.00",
              total: "70.00",
              completedAt: new Date(),
            },
          ],
        },
      },
    });
    const payment = await db.payment.create({
      data: {
        barbershopId: shop.id,
        comandaId: comanda.id,
        method: "PIX",
        amount: "70.00",
        receivedById: ownerUser.id,
      },
    });
    await db.financialEntry.create({
      data: {
        barbershopId: shop.id,
        type: "COMMAND_REVENUE",
        category: "PIX",
        amount: "70.00",
        description: "Recebimento de teste da comanda",
        userId: ownerUser.id,
        comandaId: comanda.id,
        paymentId: payment.id,
      },
    });

    const paymentsBefore = await db.payment.count({ where: { comandaId: comanda.id } });
    const financialBefore = await db.financialEntry.count({ where: { comandaId: comanda.id } });

    const reopened = await db.$transaction((tx) =>
      reopenComanda(tx, {
        barbershopId: shop.id,
        comandaId: comanda.id,
        reason: "Corrigir teste real",
        userId: ownerUser.id,
        memberId: ownerMember.id,
      })
    );

    expect(reopened.status).toBe("PENDING_PAYMENT");
    expect(reopened.paidTotal.toString()).toBe("70");
    expect(reopened.remainingTotal.toString()).toBe("0");
    expect(await db.comandaReopenAudit.count({ where: { comandaId: comanda.id } })).toBe(1);
    expect(await db.payment.count({ where: { comandaId: comanda.id } })).toBe(paymentsBefore);
    expect(await db.financialEntry.count({ where: { comandaId: comanda.id } })).toBe(financialBefore);

    const closedAgain = await db.$transaction((tx) => closeComanda(tx, shop.id, comanda.id));

    expect(closedAgain.status).toBe("CLOSED");
    expect(await db.payment.count({ where: { comandaId: comanda.id } })).toBe(paymentsBefore);
    expect(await db.financialEntry.count({ where: { comandaId: comanda.id } })).toBe(financialBefore);
  });
});
