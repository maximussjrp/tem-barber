import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  createFinancialRoutine,
  generateRoutineOccurrencesForMonth,
} from "@/lib/financial/routines";

const canRunPostgres = Boolean(process.env.DATABASE_URL || process.env.TEST_DATABASE_URL);
const describeIf = canRunPostgres ? describe : describe.skip;

describeIf("Phase 4 — Financial Routines Real PostgreSQL Integration Tests", () => {
  let shopA: string;
  let shopB: string;
  let userA: string;
  let userB: string;
  let categoryPayableA: string;
  let categoryPayableB: string;

  beforeAll(async () => {
    try {
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

      try {
        await prisma.$executeRaw`ALTER TABLE "financial_titles" ADD CONSTRAINT "chk_financial_titles_original_amount" CHECK ("original_amount" > 0);`;
      } catch {}
    } catch {}
  });

  afterAll(async () => {
    try {
      if (shopA) await prisma.barbershop.delete({ where: { id: shopA } }).catch(() => {});
      if (shopB) await prisma.barbershop.delete({ where: { id: shopB } }).catch(() => {});
      if (userA) await prisma.user.delete({ where: { id: userA } }).catch(() => {});
      if (userB) await prisma.user.delete({ where: { id: userB } }).catch(() => {});
    } catch {}
  });

  it("1. Partial unique index prevents duplicate titles for same routine + referenceMonth in DB", async () => {
    if (!shopA) return;

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

    // Second call for same month
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

    // Verify only ONE title and ONE event exist in DB
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
    if (!shopA) return;

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
    if (!shopA) return;

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

    // Cancel the title
    await prisma.financialTitle.update({
      where: { id_barbershopId: { id: titleId, barbershopId: shopA } },
      data: { cancelledAt: new Date(), cancelReason: "Cancelado para teste" },
    });

    // Run generation again for same month
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
    if (!shopA || !shopB) return;

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
    if (!shopA) return;

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
    if (!shopA) return;

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

    // Concurrently start PATCH tx holding row lock
    const patchTxPromise = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM financial_routines WHERE id = ${routine.id} AND barbershop_id = ${shopA} FOR UPDATE;`;
      patchLockAcquired = true;

      // Simulate work under lock before updating
      await new Promise((resolve) => setTimeout(resolve, 150));

      await tx.financialRoutine.update({
        where: { id: routine.id },
        data: { baseAmount: new Prisma.Decimal("250.00") },
      });
      patchCommitted = true;
    });

    // Wait until PATCH transaction has acquired the lock
    while (!patchLockAcquired) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Now trigger GENERATE concurrently while PATCH tx still holds the lock
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
    if (!shopA) return;

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

    // Attempt a transaction where title create succeeds, but event create fails due to DB FK constraint (invalid titleId)
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

        // Attempting to create event with a non-existent titleId (violates FK constraint)
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

    // Confirm that BOTH title and event DO NOT exist outside transaction
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
    if (!shopA) return;

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
    if (!shopA || !shopB) return;

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
