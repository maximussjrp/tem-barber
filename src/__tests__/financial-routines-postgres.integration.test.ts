import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

type PrismaInstance = typeof import("@/lib/prisma").default;
type RoutinesModule = typeof import("@/lib/financial/routines");

let prisma: PrismaInstance;
let createFinancialRoutine: RoutinesModule["createFinancialRoutine"];
let generateRoutineOccurrencesForMonth: RoutinesModule["generateRoutineOccurrencesForMonth"];

export function assertSafeTestDatabaseUrl(urlStr: string): { host: string; port: string; dbName: string } {
  if (!urlStr) {
    throw new Error("[POSTGRES_SAFETY_GUARD] TEST_DATABASE_URL is missing.");
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error("[POSTGRES_SAFETY_GUARD] TEST_DATABASE_URL is not a valid URL.");
  }

  const hostname = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();

  const forbiddenSubstrings = ["prod", "production", "app.tembarber.com.br", "49.13.217.235"];
  for (const forbidden of forbiddenSubstrings) {
    if (urlStr.toLowerCase().includes(forbidden)) {
      throw new Error(`[POSTGRES_SAFETY_GUARD] TEST_DATABASE_URL contains forbidden string "${forbidden}". Rejecting execution.`);
    }
  }

  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error(`[POSTGRES_SAFETY_GUARD] Hostname "${hostname}" is not localhost or 127.0.0.1. Rejecting execution.`);
  }

  if (!dbName.includes("test")) {
    throw new Error(`[POSTGRES_SAFETY_GUARD] Database name "${dbName}" does not contain "test". Rejecting execution.`);
  }

  return {
    host: hostname,
    port: parsed.port || "5432",
    dbName,
  };
}

const canRunPostgres = Boolean(process.env.TEST_DATABASE_URL);
const describeIf = canRunPostgres ? describe : describe.skip;

describeIf("Phase 4 — Financial Routines Real PostgreSQL Integration Tests", () => {
  let shopA: string;
  let shopB: string;
  let userA: string;
  let userB: string;
  let categoryPayableA: string;
  let categoryPayableB: string;
  let originalDatabaseUrl: string | undefined;
  let hadOriginalPrismaGlobal = false;
  let originalPrismaGlobal: unknown;

  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    hadOriginalPrismaGlobal = Object.prototype.hasOwnProperty.call(globalThis, "prismaGlobal");
    originalPrismaGlobal = (globalThis as typeof globalThis & { prismaGlobal?: unknown }).prismaGlobal;

    const rawUrl = process.env.TEST_DATABASE_URL;
    if (!rawUrl) {
      throw new Error("[POSTGRES_HARNESS] TEST_DATABASE_URL is missing in beforeAll.");
    }

    const { dbName: expectedDbName } = assertSafeTestDatabaseUrl(rawUrl);

    process.env.DATABASE_URL = rawUrl;

    delete (globalThis as typeof globalThis & { prismaGlobal?: unknown }).prismaGlobal;
    vi.resetModules();

    const prismaModule = await import("@/lib/prisma");
    prisma = prismaModule.default;

    const routinesModule = await import("@/lib/financial/routines");
    createFinancialRoutine = routinesModule.createFinancialRoutine;
    generateRoutineOccurrencesForMonth = routinesModule.generateRoutineOccurrencesForMonth;

    const identityResult = await prisma.$queryRaw<Array<{ current_database: string; server_addr: string | null; server_port: number | null }>>`
      SELECT current_database(), inet_server_addr()::text as server_addr, inet_server_port() as server_port;
    `;
    const connectedDb = identityResult[0]?.current_database;
    if (!connectedDb || connectedDb.toLowerCase() !== expectedDbName.toLowerCase()) {
      throw new Error(`[POSTGRES_HARNESS] Connected database "${connectedDb}" does not match expected database "${expectedDbName}". FAILED.`);
    }

    const serverAddr = identityResult[0]?.server_addr;
    if (serverAddr) {
      const cleanAddr = serverAddr.split("/")[0].trim().toLowerCase();
      const isLocalOrDocker =
        ["127.0.0.1", "::1", "localhost"].includes(cleanAddr) ||
        cleanAddr.startsWith("172.") ||
        cleanAddr.startsWith("10.") ||
        cleanAddr.startsWith("192.168.") ||
        cleanAddr.startsWith("127.");
      if (!isLocalOrDocker) {
        throw new Error(`[POSTGRES_HARNESS] Server address "${serverAddr}" is non-local public IP. FAILED.`);
      }
    }

    const constraintCheck = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int as count FROM pg_constraint WHERE conname = 'chk_financial_titles_original_amount';
    `;
    if (Number(constraintCheck[0]?.count ?? 0) === 0) {
      throw new Error("[POSTGRES_HARNESS] Constraint chk_financial_titles_original_amount is missing in test database. FAILED.");
    }

    const indexCheck = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int as count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = 'financial_titles_barbershop_routine_reference_month_uidx';
    `;
    if (Number(indexCheck[0]?.count ?? 0) === 0) {
      throw new Error("[POSTGRES_HARNESS] Index financial_titles_barbershop_routine_reference_month_uidx is missing in test database. FAILED.");
    }

    const uA = await prisma.user.create({
      data: {
        name: "Owner Tenant A",
        phone: `+55119${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `owner.a.${Date.now()}@test.com`,
        role: "USER",
      },
    });
    userA = uA.id;

    const uB = await prisma.user.create({
      data: {
        name: "Owner Tenant B",
        phone: `+55119${Math.floor(10000000 + Math.random() * 90000000)}`,
        email: `owner.b.${Date.now()}@test.com`,
        role: "USER",
      },
    });
    userB = uB.id;

    const sA = await prisma.barbershop.create({
      data: {
        name: "Barbearia A",
        slug: `barbearia-a-${Date.now()}`,
        phone: "11999990001",
        zipCode: "01000-000",
        street: "Rua A",
        number: "10",
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
      },
    });
    shopA = sA.id;

    const sB = await prisma.barbershop.create({
      data: {
        name: "Barbearia B",
        slug: `barbearia-b-${Date.now()}`,
        phone: "11999990002",
        zipCode: "02000-000",
        street: "Rua B",
        number: "20",
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
      },
    });
    shopB = sB.id;

    const catA = await prisma.financialCategory.create({
      data: {
        barbershopId: shopA,
        code: "2.1.01",
        name: "Aluguel A",
        classification: "FIXED_EXPENSE",
        isActive: true,
      },
    });
    categoryPayableA = catA.id;

    const catB = await prisma.financialCategory.create({
      data: {
        barbershopId: shopB,
        code: "2.1.01",
        name: "Aluguel B",
        classification: "FIXED_EXPENSE",
        isActive: true,
      },
    });
    categoryPayableB = catB.id;
  });

  afterAll(async () => {
    try {
      if (process.env.TEST_DATABASE_URL && prisma) {
        if (shopA) await prisma.barbershop.delete({ where: { id: shopA } });
        if (shopB) await prisma.barbershop.delete({ where: { id: shopB } });
        if (userA) await prisma.user.delete({ where: { id: userA } });
        if (userB) await prisma.user.delete({ where: { id: userB } });
        await prisma.$disconnect();
      }
    } finally {
      delete (globalThis as typeof globalThis & { prismaGlobal?: unknown }).prismaGlobal;
      if (hadOriginalPrismaGlobal) {
        (globalThis as typeof globalThis & { prismaGlobal?: unknown }).prismaGlobal = originalPrismaGlobal;
      }
      if (originalDatabaseUrl !== undefined) {
        process.env.DATABASE_URL = originalDatabaseUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
      vi.resetModules();
    }
  });

  it("1. Partial unique index prevents duplicate titles for same routine + referenceMonth in DB", async () => {
    const routine = await createFinancialRoutine({
      barbershopId: shopA,
      createdById: userA,
      categoryId: categoryPayableA,
      title: "Aluguel Mensal Sede",
      kind: "PAYABLE",
      amountMode: "FIXED",
      baseAmount: "1500.00",
      dueDay: 10,
      startDate: "2026-01-01",
    });

    const out1 = await generateRoutineOccurrencesForMonth({
      barbershopId: shopA,
      referenceMonth: "2026-10",
      source: "ROUTINE_ON_DEMAND",
      routineId: routine.id,
      actorUserId: userA,
    });

    expect(out1.summary.generated).toBe(1);
    expect(out1.results[0].status).toBe("GENERATED");
    const titleId1 = out1.results[0].titleId!;

    const out2 = await generateRoutineOccurrencesForMonth({
      barbershopId: shopA,
      referenceMonth: "2026-10",
      source: "ROUTINE_ON_DEMAND",
      routineId: routine.id,
      actorUserId: userA,
    });

    expect(out2.summary.replayed).toBe(1);
    expect(out2.results[0].status).toBe("REPLAYED");
    expect(out2.results[0].titleId).toBe(titleId1);

    const titlesCount = await prisma.financialTitle.count({
      where: { barbershopId: shopA, routineId: routine.id, referenceMonth: "2026-10" },
    });
    expect(titlesCount).toBe(1);

    const eventsCount = await prisma.financialTitleEvent.count({
      where: { barbershopId: shopA, titleId: titleId1, type: "CREATED" },
    });
    expect(eventsCount).toBe(1);
  });

  it("2. Real concurrent executions for same routine produce only 1 title (P2002 / lock handling)", async () => {
    const routine = await createFinancialRoutine({
      barbershopId: shopA,
      createdById: userA,
      categoryId: categoryPayableA,
      title: "Internet Fibra",
      kind: "PAYABLE",
      amountMode: "FIXED",
      baseAmount: "200.00",
      dueDay: 15,
      startDate: "2026-01-01",
    });

    const [res1, res2, res3] = await Promise.all([
      generateRoutineOccurrencesForMonth({
        barbershopId: shopA,
        referenceMonth: "2026-10",
        source: "ROUTINE_ON_DEMAND",
        routineId: routine.id,
        actorUserId: userA,
      }),
      generateRoutineOccurrencesForMonth({
        barbershopId: shopA,
        referenceMonth: "2026-10",
        source: "ROUTINE_ON_DEMAND",
        routineId: routine.id,
        actorUserId: userA,
      }),
      generateRoutineOccurrencesForMonth({
        barbershopId: shopA,
        referenceMonth: "2026-10",
        source: "ROUTINE_ON_DEMAND",
        routineId: routine.id,
        actorUserId: userA,
      }),
    ]);

    const generatedCount = [res1, res2, res3].filter((r) => r.summary.generated === 1).length;
    const replayedCount = [res1, res2, res3].filter((r) => r.summary.replayed === 1).length;

    expect(generatedCount).toBe(1);
    expect(replayedCount).toBe(2);

    const countInDb = await prisma.financialTitle.count({
      where: { barbershopId: shopA, routineId: routine.id, referenceMonth: "2026-10" },
    });
    expect(countInDb).toBe(1);
  });

  it("3. Cancelled title continues to block new generation (returns REPLAYED)", async () => {
    const routine = await createFinancialRoutine({
      barbershopId: shopA,
      createdById: userA,
      categoryId: categoryPayableA,
      title: "Serviço Limpeza",
      kind: "PAYABLE",
      amountMode: "FIXED",
      baseAmount: "300.00",
      dueDay: 20,
      startDate: "2026-01-01",
    });

    const out1 = await generateRoutineOccurrencesForMonth({
      barbershopId: shopA,
      referenceMonth: "2026-10",
      source: "ROUTINE_ON_DEMAND",
      routineId: routine.id,
    });
    const titleId = out1.results[0].titleId!;

    await prisma.financialTitle.update({
      where: { id_barbershopId: { id: titleId, barbershopId: shopA } },
      data: { cancelledAt: new Date(), cancelReason: "Cancelado para teste" },
    });

    const out2 = await generateRoutineOccurrencesForMonth({
      barbershopId: shopA,
      referenceMonth: "2026-10",
      source: "ROUTINE_ON_DEMAND",
      routineId: routine.id,
    });

    expect(out2.results[0].status).toBe("REPLAYED");
    expect(out2.results[0].titleId).toBe(titleId);
  });

  it("4. Tenant A generation does not interfere with Tenant B", async () => {
    const routineA = await createFinancialRoutine({
      barbershopId: shopA,
      createdById: userA,
      categoryId: categoryPayableA,
      title: "Lixo Hospitalar A",
      kind: "PAYABLE",
      amountMode: "FIXED",
      baseAmount: "100.00",
      dueDay: 5,
      startDate: "2026-01-01",
    });

    const routineB = await createFinancialRoutine({
      barbershopId: shopB,
      createdById: userB,
      categoryId: categoryPayableB,
      title: "Lixo Hospitalar B",
      kind: "PAYABLE",
      amountMode: "FIXED",
      baseAmount: "100.00",
      dueDay: 5,
      startDate: "2026-01-01",
    });

    const outA = await generateRoutineOccurrencesForMonth({
      barbershopId: shopA,
      referenceMonth: "2026-11",
      routineId: routineA.id,
      source: "ROUTINE_ON_DEMAND",
    });

    const outB = await generateRoutineOccurrencesForMonth({
      barbershopId: shopB,
      referenceMonth: "2026-11",
      routineId: routineB.id,
      source: "ROUTINE_ON_DEMAND",
    });

    expect(outA.summary.generated).toBe(1);
    expect(outA.results[0].routineId).toBe(routineA.id);

    expect(outB.summary.generated).toBe(1);
    expect(outB.results[0].routineId).toBe(routineB.id);
  });

  it("5. Routine domain creation enforces dueDay validation", async () => {
    await expect(
      createFinancialRoutine({
        barbershopId: shopA,
        createdById: userA,
        categoryId: categoryPayableA,
        title: "Inválido DueDay",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: "100.00",
        dueDay: 35,
        startDate: "2026-01-01",
      })
    ).rejects.toThrow("Dia de vencimento deve ser um inteiro entre 1 e 31.");
  });

  it("6. Real PATCH x GENERATE concurrency: GENERATE waits for PATCH row lock release and sees updated baseAmount", async () => {
    const routine = await createFinancialRoutine({
      barbershopId: shopA,
      createdById: userA,
      categoryId: categoryPayableA,
      title: "Aluguel Concorrente",
      kind: "PAYABLE",
      amountMode: "FIXED",
      baseAmount: "100.00",
      dueDay: 10,
      startDate: "2026-01-01",
    });

    let patchLockAcquired = false;
    let patchCommitted = false;

    const patchTxPromise = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM financial_routines WHERE id = ${routine.id} AND barbershop_id = ${shopA} FOR UPDATE;`;
      patchLockAcquired = true;

      await new Promise((resolve) => setTimeout(resolve, 150));

      await tx.financialRoutine.update({
        where: { id: routine.id },
        data: { baseAmount: new Prisma.Decimal("250.00") },
      });
      patchCommitted = true;
    });

    while (!patchLockAcquired) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const generatePromise = generateRoutineOccurrencesForMonth({
      barbershopId: shopA,
      referenceMonth: "2026-12",
      source: "ROUTINE_ON_DEMAND",
      routineId: routine.id,
      actorUserId: userA,
    });

    const [, genResult] = await Promise.all([patchTxPromise, generatePromise]);

    expect(patchCommitted).toBe(true);
    expect(genResult.summary.generated).toBe(1);
    expect(genResult.results[0].status).toBe("GENERATED");

    const createdTitle = await prisma.financialTitle.findUnique({
      where: { id: genResult.results[0].titleId! },
    });

    expect(createdTitle?.originalAmount.toString()).toBe("250");
  });

  it("7. Atomic rollback: FinancialTitleEvent creation failure causes transaction rollback of created title", async () => {
    const routine = await createFinancialRoutine({
      barbershopId: shopA,
      createdById: userA,
      categoryId: categoryPayableA,
      title: "Rotina Event Fail Rollback",
      kind: "PAYABLE",
      amountMode: "FIXED",
      baseAmount: "150.00",
      dueDay: 15,
      startDate: "2026-01-01",
    });

    await expect(
      prisma.$transaction(async (tx) => {
        const title = await tx.financialTitle.create({
          data: {
            barbershopId: shopA,
            routineId: routine.id,
            categoryId: categoryPayableA,
            kind: "PAYABLE",
            title: "Título Event Fail",
            originalAmount: new Prisma.Decimal("150.00"),
            issuedOn: new Date(),
            dueOn: new Date(),
            referenceMonth: "2026-11",
            createdById: userA,
          },
        });

        expect(title.id).toBeDefined();

        await tx.financialTitleEvent.create({
          data: {
            barbershopId: shopA,
            titleId: "00000000-0000-0000-0000-000000000000",
            type: "CREATED",
            payload: { source: "ROUTINE_ON_DEMAND", routineId: routine.id, referenceMonth: "2026-11" },
            actorUserId: userA,
          },
        });
      })
    ).rejects.toThrow();

    const titlesCount = await prisma.financialTitle.count({
      where: { barbershopId: shopA, routineId: routine.id, referenceMonth: "2026-11" },
    });
    expect(titlesCount).toBe(0);

    const eventsCount = await prisma.financialTitleEvent.count({
      where: { barbershopId: shopA, payload: { path: ["routineId"], equals: routine.id } },
    });
    expect(eventsCount).toBe(0);
  });

  it("8. PostgreSQL originalAmount CHECK constraint rejects originalAmount <= 0", async () => {
    const routine = await createFinancialRoutine({
      barbershopId: shopA,
      createdById: userA,
      categoryId: categoryPayableA,
      title: "Rotina Check Constraint Test",
      kind: "PAYABLE",
      amountMode: "FIXED",
      baseAmount: "100.00",
      dueDay: 10,
      startDate: "2026-01-01",
    });

    await expect(
      prisma.financialTitle.create({
        data: {
          barbershopId: shopA,
          routineId: routine.id,
          categoryId: categoryPayableA,
          kind: "PAYABLE",
          title: "Zero Amount Invalid Title",
          originalAmount: new Prisma.Decimal("0.00"),
          issuedOn: new Date(),
          dueOn: new Date(),
          referenceMonth: "2026-10",
          createdById: userA,
        },
      })
    ).rejects.toThrow();

    const count = await prisma.financialTitle.count({
      where: { barbershopId: shopA, title: "Zero Amount Invalid Title" },
    });
    expect(count).toBe(0);
  });

  it("9. Cross-tenant isolation: Tenant B cannot access or modify Tenant A routine", async () => {
    const routineA = await createFinancialRoutine({
      barbershopId: shopA,
      createdById: userA,
      categoryId: categoryPayableA,
      title: "Isolamento Tenant A",
      kind: "PAYABLE",
      amountMode: "FIXED",
      baseAmount: "100.00",
      dueDay: 10,
      startDate: "2026-01-01",
    });

    const genOut = await generateRoutineOccurrencesForMonth({
      barbershopId: shopB,
      referenceMonth: "2026-10",
      routineId: routineA.id,
      source: "ROUTINE_ON_DEMAND",
    });

    expect(genOut.summary.total).toBe(0);
    expect(genOut.results.length).toBe(0);
  });
});
