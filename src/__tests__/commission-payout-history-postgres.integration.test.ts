import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, CommissionDisbursementMethod, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";

export function validateTestDatabaseUrl(url: string): { isValid: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const isTestPort = parsed.port === "55439" || parsed.port === "55499";
    const isExactTestUser = parsed.username === "match_barber_test_user";
    const isExactTestDb = parsed.pathname === "/match_barber_test";
    const hasProdWord = /prod|production/i.test(url);

    if (!isLocalhost) return { isValid: false, reason: "Host não é localhost/127.0.0.1" };
    if (!isTestPort) return { isValid: false, reason: "Porta não é 55439 ou 55499" };
    if (!isExactTestUser) return { isValid: false, reason: "Usuário não é match_barber_test_user" };
    if (!isExactTestDb) return { isValid: false, reason: "Database não é exatamente match_barber_test" };
    if (hasProdWord) return { isValid: false, reason: "URL contém palavra proibida prod/production" };

    return { isValid: true };
  } catch {
    return { isValid: false, reason: "URL inválida" };
  }
}

describe("validateTestDatabaseUrl security rules", () => {
  it("aceita URL válida e isolada", () => {
    const res = validateTestDatabaseUrl(
      "postgresql://match_barber_test_user:pass@localhost:55439/match_barber_test"
    );
    expect(res.isValid).toBe(true);
  });

  it("aceita porta alternativa 55499", () => {
    const res = validateTestDatabaseUrl(
      "postgresql://match_barber_test_user:pass@127.0.0.1:55499/match_barber_test"
    );
    expect(res.isValid).toBe(true);
  });

  it("rejeita usuário postgres", () => {
    const res = validateTestDatabaseUrl(
      "postgresql://postgres:pass@localhost:55439/match_barber_test"
    );
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain("match_barber_test_user");
  });

  it("rejeita banco com sufixo parcial ou genérico _test", () => {
    const res = validateTestDatabaseUrl(
      "postgresql://match_barber_test_user:pass@localhost:55439/other_test"
    );
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain("match_barber_test");
  });

  it("rejeita host remoto", () => {
    const res = validateTestDatabaseUrl(
      "postgresql://match_barber_test_user:pass@db.example.com:55439/match_barber_test"
    );
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain("localhost");
  });

  it("rejeita porta incorreta ou padrão de produção", () => {
    const res = validateTestDatabaseUrl(
      "postgresql://match_barber_test_user:pass@localhost:5432/match_barber_test"
    );
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain("55439");
  });

  it("rejeita palavras com prod/production", () => {
    const res = validateTestDatabaseUrl(
      "postgresql://match_barber_test_user:pass@localhost:55439/match_barber_test?app=production"
    );
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain("prod/production");
  });
});

describe("PostgreSQL safety & identity guards (Security Regression)", () => {
  it("aborta qualquer operação de limpeza se isIdentityVerified for false", async () => {
    const mockDeleteMany = vi.fn();
    const mockPrisma = {
      commissionPayout: { deleteMany: mockDeleteMany },
      commissionCycle: { deleteMany: mockDeleteMany },
      barbershopMember: { deleteMany: mockDeleteMany },
      user: { deleteMany: mockDeleteMany },
      barbershop: { deleteMany: mockDeleteMany },
    };

    let isIdentityVerified = false;
    const createdPayoutIds = ["payout-1", "payout-2"];

    async function guardedCleanup() {
      if (!isIdentityVerified) return;
      await mockPrisma.commissionPayout.deleteMany({
        where: { id: { in: createdPayoutIds } },
      });
    }

    // Com isIdentityVerified = false, nada deve ser chamado
    await guardedCleanup();
    expect(mockDeleteMany).not.toHaveBeenCalled();

    // Somente após verificação de identidade a operação é autorizada
    isIdentityVerified = true;
    await guardedCleanup();
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["payout-1", "payout-2"] } },
    });
  });
});

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const shouldRunRealPg = Boolean(TEST_DB_URL);
const describeRealPg = shouldRunRealPg ? describe : describe.skip;

describeRealPg("TEM BARBER — Commission Payment History (PostgreSQL Real Integration Suite)", () => {
  let pool: Pool;
  let prisma: PrismaClient;
  let isIdentityVerified = false;

  const createdBarbershopIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdMemberIds: string[] = [];
  const createdCycleIds: string[] = [];
  const createdPayoutIds: string[] = [];

  let shopAId: string;
  let shopBId: string;
  let userAdminId: string;
  let userActiveId: string;
  let userInactiveId: string;
  let userForeignId: string;
  let memberActiveId: string;
  let memberInactiveId: string;
  let memberForeignId: string;

  async function cleanupFixtures() {
    if (!prisma || !isIdentityVerified) return;

    if (createdPayoutIds.length > 0) {
      await prisma.commissionPayout.deleteMany({
        where: { id: { in: createdPayoutIds } },
      });
      createdPayoutIds.length = 0;
    }

    if (createdCycleIds.length > 0) {
      await prisma.commissionCycle.deleteMany({
        where: { id: { in: createdCycleIds } },
      });
      createdCycleIds.length = 0;
    }

    if (createdMemberIds.length > 0) {
      await prisma.barbershopMember.deleteMany({
        where: { id: { in: createdMemberIds } },
      });
      createdMemberIds.length = 0;
    }

    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
      createdUserIds.length = 0;
    }

    if (createdBarbershopIds.length > 0) {
      await prisma.barbershop.deleteMany({
        where: { id: { in: createdBarbershopIds } },
      });
      createdBarbershopIds.length = 0;
    }
  }

  beforeAll(async () => {
    isIdentityVerified = false;
    if (!TEST_DB_URL) {
      throw new Error("TEST_DATABASE_URL ausente.");
    }

    const validation = validateTestDatabaseUrl(TEST_DB_URL);
    if (!validation.isValid) {
      throw new Error(`TEST_DATABASE_URL inválida por segurança: ${validation.reason}`);
    }

    // 1. Construir PrismaClient isolado
    pool = new Pool({ connectionString: TEST_DB_URL });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // 2. Verificar a identidade efetiva da conexão antes de qualquer escrita
    const dbIdentity = await prisma.$queryRaw<Array<{ current_database: string; current_user: string }>>`
      SELECT current_database(), current_user
    `;

    if (!dbIdentity || dbIdentity.length === 0) {
      throw new Error("Falha ao verificar identidade do banco de testes PostgreSQL.");
    }

    const { current_database, current_user } = dbIdentity[0];
    if (current_database !== "match_barber_test") {
      throw new Error(
        `SEGURANÇA: Banco de dados inesperado '${current_database}'. Esperado 'match_barber_test'.`
      );
    }
    if (current_user !== "match_barber_test_user") {
      throw new Error(
        `SEGURANÇA: Usuário inesperado '${current_user}'. Esperado 'match_barber_test_user'.`
      );
    }

    isIdentityVerified = true;
  });

  afterAll(async () => {
    try {
      if (isIdentityVerified) {
        await cleanupFixtures();
      }
    } finally {
      if (prisma) {
        await prisma.$disconnect();
      }
      if (pool) {
        await pool.end();
      }
    }
  });

  beforeEach(async () => {
    await cleanupFixtures();

    shopAId = randomUUID();
    shopBId = randomUUID();
    userAdminId = randomUUID();
    userActiveId = randomUUID();
    userInactiveId = randomUUID();
    userForeignId = randomUUID();
    memberActiveId = randomUUID();
    memberInactiveId = randomUUID();
    memberForeignId = randomUUID();

    createdBarbershopIds.push(shopAId, shopBId);
    createdUserIds.push(userAdminId, userActiveId, userInactiveId, userForeignId);
    createdMemberIds.push(memberActiveId, memberInactiveId, memberForeignId);

    // Seed Barbershops
    await prisma.barbershop.createMany({
      data: [
        {
          id: shopAId,
          name: "Barbearia A",
          slug: `barbearia-a-${shopAId.slice(0, 8)}`,
          phone: "11999990001",
          zipCode: "01001-000",
          street: "Rua A",
          number: "100",
          neighborhood: "Centro",
          city: "São Paulo",
          state: "SP",
        },
        {
          id: shopBId,
          name: "Barbearia B",
          slug: `barbearia-b-${shopBId.slice(0, 8)}`,
          phone: "11999990002",
          zipCode: "01001-000",
          street: "Rua B",
          number: "200",
          neighborhood: "Centro",
          city: "São Paulo",
          state: "SP",
        },
      ],
    });

    // Seed Users
    await prisma.user.createMany({
      data: [
        { id: userAdminId, name: "Admin Geral", email: `admin-${userAdminId.slice(0, 8)}@a.com`, phone: "11999990001" },
        { id: userActiveId, name: "Barbeiro Ativo", email: `ativo-${userActiveId.slice(0, 8)}@a.com`, phone: "11999990002" },
        { id: userInactiveId, name: "Barbeiro Inativo", email: `inativo-${userInactiveId.slice(0, 8)}@a.com`, phone: "11999990003" },
        { id: userForeignId, name: "Barbeiro Outra Barbearia", email: `barber-${userForeignId.slice(0, 8)}@b.com`, phone: "11999990004" },
      ],
    });

    // Seed Members
    await prisma.barbershopMember.createMany({
      data: [
        { id: memberActiveId, barbershopId: shopAId, userId: userActiveId, role: "BARBER", isActive: true },
        { id: memberInactiveId, barbershopId: shopAId, userId: userInactiveId, role: "BARBER", isActive: false },
        { id: memberForeignId, barbershopId: shopBId, userId: userForeignId, role: "BARBER", isActive: true },
      ],
    });
  });

  it("1. Consulta agregada no PostgreSQL real com isolamento multi-tenant", async () => {
    // Cria ciclos e payouts para Shop A
    const cycle1 = await prisma.commissionCycle.create({
      data: {
        barbershopId: shopAId,
        memberId: memberActiveId,
        cycleNumber: 1,
        status: "PAID",
        grossCommission: new Prisma.Decimal("500.00"),
        finalPayoutAmount: new Prisma.Decimal("450.00"),
        remainingBalance: new Prisma.Decimal("0.00"),
        openedAt: new Date("2026-10-01T10:00:00Z"),
        closedAt: new Date("2026-10-10T18:00:00Z"),
        paidAt: new Date("2026-10-10T18:00:00Z"),
      },
    });
    createdCycleIds.push(cycle1.id);

    const payout1 = await prisma.commissionPayout.create({
      data: {
        barbershopId: shopAId,
        cycleId: cycle1.id,
        memberId: memberActiveId,
        amount: new Prisma.Decimal("450.00"),
        paymentMethod: CommissionDisbursementMethod.PIX,
        paidAt: new Date("2026-10-10T18:00:00Z"),
        idempotencyKey: `idem-payout-1-${randomUUID().slice(0, 8)}`,
        createdById: userAdminId,
      },
    });
    createdPayoutIds.push(payout1.id);

    // Cria ciclo e payout para Shop B (cross-tenant)
    const cycleB = await prisma.commissionCycle.create({
      data: {
        barbershopId: shopBId,
        memberId: memberForeignId,
        cycleNumber: 99,
        status: "PAID",
        grossCommission: new Prisma.Decimal("1000.00"),
        finalPayoutAmount: new Prisma.Decimal("1000.00"),
        remainingBalance: new Prisma.Decimal("0.00"),
        openedAt: new Date("2026-10-01T10:00:00Z"),
        closedAt: new Date("2026-10-10T18:00:00Z"),
        paidAt: new Date("2026-10-10T18:00:00Z"),
      },
    });
    createdCycleIds.push(cycleB.id);

    const payoutB = await prisma.commissionPayout.create({
      data: {
        barbershopId: shopBId,
        cycleId: cycleB.id,
        memberId: memberForeignId,
        amount: new Prisma.Decimal("1000.00"),
        paymentMethod: CommissionDisbursementMethod.PIX,
        paidAt: new Date("2026-10-10T18:00:00Z"),
        idempotencyKey: `idem-payout-b-${randomUUID().slice(0, 8)}`,
        createdById: userAdminId,
      },
    });
    createdPayoutIds.push(payoutB.id);

    // Executa aggregation estrita em Shop A
    const aggShopA = await prisma.commissionPayout.aggregate({
      where: { barbershopId: shopAId },
      _sum: { amount: true },
      _count: { id: true },
    });

    expect(Number(aggShopA._sum.amount)).toBe(450.0);
    expect(aggShopA._count.id).toBe(1);

    // Consulta findMany com scoping em Shop A
    const payoutsShopA = await prisma.commissionPayout.findMany({
      where: { barbershopId: shopAId },
      include: {
        member: { include: { user: true } },
        cycle: true,
      },
    });

    expect(payoutsShopA).toHaveLength(1);
    expect(payoutsShopA[0].barbershopId).toBe(shopAId);
    expect(payoutsShopA[0].member.user.name).toBe("Barbeiro Ativo");
  });

  it("2. Colaborador inativo com pagamento histórico é retornado e totalizado", async () => {
    const cycleInactive = await prisma.commissionCycle.create({
      data: {
        barbershopId: shopAId,
        memberId: memberInactiveId,
        cycleNumber: 2,
        status: "PAID",
        grossCommission: new Prisma.Decimal("300.00"),
        finalPayoutAmount: new Prisma.Decimal("300.00"),
        remainingBalance: new Prisma.Decimal("0.00"),
        openedAt: new Date("2026-09-01T10:00:00Z"),
        closedAt: new Date("2026-09-15T18:00:00Z"),
        paidAt: new Date("2026-09-15T18:00:00Z"),
      },
    });
    createdCycleIds.push(cycleInactive.id);

    const payoutInactive = await prisma.commissionPayout.create({
      data: {
        barbershopId: shopAId,
        cycleId: cycleInactive.id,
        memberId: memberInactiveId,
        amount: new Prisma.Decimal("300.00"),
        paymentMethod: CommissionDisbursementMethod.CASH,
        paidAt: new Date("2026-09-15T18:00:00Z"),
        idempotencyKey: `idem-payout-inactive-${randomUUID().slice(0, 8)}`,
        createdById: userAdminId,
      },
    });
    createdPayoutIds.push(payoutInactive.id);

    const result = await prisma.commissionPayout.findMany({
      where: { barbershopId: shopAId, memberId: memberInactiveId },
      include: {
        member: { select: { id: true, isActive: true, user: { select: { name: true } } } },
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0].member.isActive).toBe(false);
    expect(result[0].member.user.name).toBe("Barbeiro Inativo");
    expect(Number(result[0].amount)).toBe(300.0);
  });

  it("3. Pagamento de R$ 0,00 e método de pagamento nulo no PostgreSQL", async () => {
    const cycleZero = await prisma.commissionCycle.create({
      data: {
        barbershopId: shopAId,
        memberId: memberActiveId,
        cycleNumber: 3,
        status: "PAID",
        grossCommission: new Prisma.Decimal("200.00"),
        advancesTotal: new Prisma.Decimal("200.00"),
        finalPayoutAmount: new Prisma.Decimal("0.00"),
        remainingBalance: new Prisma.Decimal("0.00"),
        openedAt: new Date("2026-10-01T10:00:00Z"),
        closedAt: new Date("2026-10-05T18:00:00Z"),
        paidAt: new Date("2026-10-05T18:00:00Z"),
      },
    });
    createdCycleIds.push(cycleZero.id);

    const payoutZero = await prisma.commissionPayout.create({
      data: {
        barbershopId: shopAId,
        cycleId: cycleZero.id,
        memberId: memberActiveId,
        amount: new Prisma.Decimal("0.00"),
        paymentMethod: null,
        paidAt: new Date("2026-10-05T18:00:00Z"),
        idempotencyKey: `idem-payout-zero-${randomUUID().slice(0, 8)}`,
        createdById: userAdminId,
      },
    });
    createdPayoutIds.push(payoutZero.id);

    const result = await prisma.commissionPayout.findMany({
      where: { barbershopId: shopAId, cycleId: cycleZero.id },
    });

    expect(result).toHaveLength(1);
    expect(Number(result[0].amount)).toBe(0);
    expect(result[0].paymentMethod).toBeNull();
  });
});
