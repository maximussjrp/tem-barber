import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FinancialCategoryClassification, Prisma, PrismaClient } from "@prisma/client";
import { moveCategory, retireCategory } from "@/lib/financial/categories";

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

function isIsolatedLocalTestDb(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const isTestPort = parsed.port === "55439";
    const isTestDb = parsed.pathname === "/match_barber_test";
    return isLocalhost && isTestPort && isTestDb;
  } catch {
    return false;
  }
}

const isSafe = isIsolatedLocalTestDb(TEST_DB_URL);

describe.runIf(isSafe)("Fase 2 — Integração PostgreSQL Real (Rollback & Concorrência)", () => {
  let prisma: PrismaClient;
  let pool: Pool;

  beforeAll(async () => {
    if (!isSafe) return;
    pool = new Pool({ connectionString: TEST_DB_URL });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
    if (pool) {
      await pool.end();
    }
  });

  it("ROLLBACK_TEST_REAL_DB: desfaz atômica e integralmente todas as migrações após aborto da transação PostgreSQL", async () => {
    // 1. Criar tenant e dados isolados no PostgreSQL real
    const shop = await prisma.barbershop.create({
      data: {
        name: `Shop Rollback Test ${Date.now()}`,
        slug: `shop-rollback-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        phone: "11999999999",
        zipCode: "00000000",
        street: "Rua Teste",
        number: "100",
        neighborhood: "Bairro",
        city: "Cidade",
        state: "SP",
      },
    });

    const user = await prisma.user.create({
      data: {
        name: "User Rollback Test",
        email: `user-rollback-${Date.now()}@test.local`,
        phone: `1198${Math.floor(1000000 + Math.random() * 9000000)}`,
        role: "USER",
      },
    });

    const sourceCat = await prisma.financialCategory.create({
      data: {
        barbershopId: shop.id,
        code: "01.01",
        name: "Source Receita Rollback",
        classification: FinancialCategoryClassification.REVENUE,
        isActive: true,
      },
    });

    const repCat = await prisma.financialCategory.create({
      data: {
        barbershopId: shop.id,
        code: "01.02",
        name: "Replacement Receita Rollback",
        classification: FinancialCategoryClassification.REVENUE,
        isActive: true,
      },
    });

    const title = await prisma.financialTitle.create({
      data: {
        barbershopId: shop.id,
        categoryId: sourceCat.id,
        kind: "RECEIVABLE",
        title: "Título Rollback Test",
        originalAmount: new Prisma.Decimal("100.00"),
        issuedOn: new Date(),
        dueOn: new Date(),
        createdById: user.id,
      },
    });

    const routine = await prisma.financialRoutine.create({
      data: {
        barbershopId: shop.id,
        categoryId: sourceCat.id,
        title: "Rotina Rollback Test",
        kind: "RECEIVABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("100.00"),
        dueDay: 10,
        startDate: new Date(),
        createdById: user.id,
      },
    });

    const mapping = await prisma.financialCategorySystemMapping.create({
      data: {
        barbershopId: shop.id,
        systemKey: "COMANDA_SERVICE_REVENUE",
        categoryId: sourceCat.id,
      },
    });

    const entry = await prisma.financialEntry.create({
      data: {
        barbershopId: shop.id,
        type: "COMMAND_REVENUE",
        category: "PIX",
        amount: new Prisma.Decimal("150.00"),
        description: "Entry Rollback Test",
      },
    });

    const sourceAlloc = await prisma.financialEntryAllocation.create({
      data: {
        barbershopId: shop.id,
        financialEntryId: entry.id,
        financialCategoryId: sourceCat.id,
        allocatedAmount: new Prisma.Decimal("50.00"),
      },
    });

    const targetAlloc = await prisma.financialEntryAllocation.create({
      data: {
        barbershopId: shop.id,
        financialEntryId: entry.id,
        financialCategoryId: repCat.id,
        allocatedAmount: new Prisma.Decimal("100.00"),
      },
    });

    // Abrir transação PostgreSQL real e abortar intencionalmente após chamar retireCategory
    let caughtError: unknown = null;
    try {
      await prisma.$transaction(async (tx) => {
        // Executar aposentadoria com substituição dentro do tx real
        await retireCategory(shop.id, sourceCat.id, repCat.id, tx);

        // Verificar que DENTRO da transação a migração ocorreu
        const titleInTx = await tx.financialTitle.findUnique({ where: { id: title.id } });
        expect(titleInTx?.categoryId).toBe(repCat.id);

        const targetAllocInTx = await tx.financialEntryAllocation.findUnique({ where: { id: targetAlloc.id } });
        expect(targetAllocInTx?.allocatedAmount.toString()).toBe("150");

        const sourceAllocInTx = await tx.financialEntryAllocation.findUnique({ where: { id: sourceAlloc.id } });
        expect(sourceAllocInTx).toBeNull();

        // Lançar erro intencional para forçar ROLLBACK da transação PostgreSQL
        throw new Error("INTENTIONAL_ROLLBACK_TEST_ERROR");
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).not.toBeNull();
    expect((caughtError as Error).message).toBe("INTENTIONAL_ROLLBACK_TEST_ERROR");

    // PROVA NO BANCO POSTGRESQL REAL APÓS O ROLLBACK
    const sourceDb = await prisma.financialCategory.findUnique({ where: { id: sourceCat.id } });
    const titleDb = await prisma.financialTitle.findUnique({ where: { id: title.id } });
    const routineDb = await prisma.financialRoutine.findUnique({ where: { id: routine.id } });
    const mappingDb = await prisma.financialCategorySystemMapping.findUnique({ where: { id: mapping.id } });
    const sourceAllocDb = await prisma.financialEntryAllocation.findUnique({ where: { id: sourceAlloc.id } });
    const targetAllocDb = await prisma.financialEntryAllocation.findUnique({ where: { id: targetAlloc.id } });

    // Assert explicit: Nenhum efeito parcial permaneceu no PostgreSQL!
    expect(sourceDb?.isActive).toBe(true);
    expect(titleDb?.categoryId).toBe(sourceCat.id);
    expect(routineDb?.categoryId).toBe(sourceCat.id);
    expect(titleDb?.categoryId).not.toBe(repCat.id);
    expect(mappingDb?.categoryId).toBe(sourceCat.id);

    // Asserts explícitos de alocação de entrada financeira
    expect(sourceAllocDb).not.toBeNull();
    expect(sourceAllocDb?.allocatedAmount.toString()).toBe("50");
    expect(targetAllocDb?.allocatedAmount.toString()).toBe("100");
  });

  it("REAL_CONCURRENT_MOVE_TEST & FINAL_TREE_NO_CYCLE: serializa requisições move A->B e B->A simultâneas e impede a criação de ciclos", async () => {
    const shop = await prisma.barbershop.create({
      data: {
        name: `Shop Concurrent Move ${Date.now()}`,
        slug: `shop-concurrent-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        phone: "11999999999",
        zipCode: "00000000",
        street: "Rua Teste",
        number: "200",
        neighborhood: "Bairro",
        city: "Cidade",
        state: "SP",
      },
    });

    const catA = await prisma.financialCategory.create({
      data: {
        barbershopId: shop.id,
        code: "CUSTOM-ROOT-A",
        name: "Root A",
        classification: FinancialCategoryClassification.REVENUE,
        parentCategoryId: null,
        isActive: true,
      },
    });

    const catB = await prisma.financialCategory.create({
      data: {
        barbershopId: shop.id,
        code: "CUSTOM-ROOT-B",
        name: "Root B",
        classification: FinancialCategoryClassification.REVENUE,
        parentCategoryId: null,
        isActive: true,
      },
    });

    // Disparar simultaneamente Move A -> B e Move B -> A no PostgreSQL real
    const results = await Promise.allSettled([
      moveCategory(shop.id, catA.id, catB.id, prisma),
      moveCategory(shop.id, catB.id, catA.id, prisma),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exatamente uma operação deve ter sido concluída com sucesso e a outra rejeitada por conflito de ciclo
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const errorReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(errorReason.message).toContain("ciclo");

    // PROVA NO BANCO POSTGRESQL REAL DE NÃO EXISTÊNCIA DE CICLO
    const freshA = await prisma.financialCategory.findUnique({ where: { id: catA.id } });
    const freshB = await prisma.financialCategory.findUnique({ where: { id: catB.id } });

    // Assert direto: A.parent == B XOR B.parent == A, NUNCA AMBOS
    const isAUnderB = freshA?.parentCategoryId === catB.id && freshB?.parentCategoryId === null;
    const isBUnderA = freshB?.parentCategoryId === catA.id && freshA?.parentCategoryId === null;

    expect(isAUnderB || isBUnderA).toBe(true);
    expect(freshA?.parentCategoryId === catB.id && freshB?.parentCategoryId === catA.id).toBe(false);
  });
});
