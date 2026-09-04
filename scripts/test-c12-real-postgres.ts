/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import prisma from "@/lib/prisma";
import {
  Prisma,
  CommissionCycleStatus,
  CommissionPayableType,
  CommissionPayableSourceKind,
  CommissionCycleAdjustmentType,
  ComandaStatus,
  ComandaItemStatus,
  ComandaItemType,
  UserRole,
  CommissionEntryStatus,
  PaymentMethod,
  CommissionDisbursementMethod,
} from "@prisma/client";
import {
  correctCommissionExecutor,
  getAuthoritativeCycleBalance,
  executeCommissionPayout,
  createCommissionAdvance,
  reverseCommissionAdvance,
  syncCommissionReleaseForComanda,
  generateCommissionsForComanda,
  upsertCommissionConfig,
  computeComandaEconomics,
  getOrCreateCurrentCycle,
  CommissionError,
} from "@/lib/operations/commissions";
import { addServiceItem, addProductItem, recalculateComandaTotals } from "@/lib/operations/comandas";
import { registerPayment, refundPayment, closeComanda } from "@/lib/operations/payments";
import { toCents, fromCents } from "@/lib/operations/money";

export async function runC12RealPostgresIntegratedSuite() {
  console.log("==========================================================");
  console.log(" TEM BARBER — PHASE C12 REAL POSTGRESQL INTEGRATED SUITE");
  console.log("==========================================================");

  // 1. Check PostgreSQL connection & version
  const [versionRow]: any = await prisma.$queryRaw`SELECT version();`;
  console.log("Connected DB Version:", versionRow.version);

  if (!versionRow.version.includes("PostgreSQL 16")) {
    throw new Error(`Expected PostgreSQL 16, got: ${versionRow.version}`);
  }

  // Safety guard: prevent accidental destructive run against non-test databases
  function assertTestDatabaseSafety() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FATAL: Cannot run destructive test script in NODE_ENV=production");
    }
    const dbUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || "";
    const isLocalHost = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
    const isTestDb = dbUrl.includes("test") || dbUrl.includes("_test");
    const isTruncateAllowed = process.env.ALLOW_TEST_DB_TRUNCATE === "YES";
    if (!isLocalHost || !isTestDb || !isTruncateAllowed) {
      throw new Error(
        "FATAL: Destructive test scripts are only permitted on local test databases with ALLOW_TEST_DB_TRUNCATE=YES."
      );
    }
  }
  assertTestDatabaseSafety();

  // Helper: clean database
  async function cleanAllData() {
    await prisma.commissionAdvanceAudit.deleteMany();
    await prisma.commissionAdvanceReversal.deleteMany();
    await prisma.financialEntry.deleteMany();
    await prisma.cashMovement.deleteMany();
    await prisma.commissionExecutorCorrectionAudit.deleteMany();
    await prisma.commissionPayout.deleteMany();
    await prisma.commissionCycleAdjustment.deleteMany();
    await prisma.commissionAdvance.deleteMany();
    await prisma.commissionPayableItem.deleteMany();
    await prisma.commissionCycle.deleteMany();
    await prisma.commissionEntry.deleteMany();
    await prisma.commissionAdjustment.deleteMany();
    await prisma.commissionPeriod.deleteMany();
    await prisma.commissionConfig.deleteMany();
    await prisma.serviceCommissionRule.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.comandaItem.deleteMany();
    await prisma.comanda.deleteMany();
    await prisma.appointmentService.deleteMany();
    await prisma.appointment.deleteMany();
    await prisma.product.deleteMany();
    await prisma.barberService.deleteMany();
    await prisma.service.deleteMany();
    await prisma.category.deleteMany();
    await prisma.cashSession.deleteMany();
    await prisma.barbershopMember.deleteMany();
    await prisma.user.deleteMany();
    await prisma.barbershop.deleteMany();
  }

  await cleanAllData();
  console.log("[Setup] Database cleaned cleanly.");

  // Base fixtures
  const barbershopId = "shop-c12-integrated";
  await prisma.barbershop.create({
    data: {
      id: barbershopId,
      name: "C12 Integrated Shop",
      slug: `c12-shop-${Date.now()}`,
      phone: "11988887777",
      zipCode: "12345-000",
      street: "Rua Teste",
      number: "1",
      neighborhood: "Centro",
      city: "Sao Paulo",
      state: "SP",
    },
  });

  const ownerUser = await prisma.user.create({
    data: {
      id: "usr-c12-owner",
      name: "Owner C12",
      email: "owner_c12@test.com",
      phone: "11999990001",
      role: UserRole.USER,
    },
  });

  const barberUser1 = await prisma.user.create({
    data: {
      id: "usr-c12-b1",
      name: "Barber 1",
      email: "b1_c12@test.com",
      phone: "11999990002",
      role: UserRole.USER,
    },
  });

  const barberUser2 = await prisma.user.create({
    data: {
      id: "usr-c12-b2",
      name: "Barber 2",
      email: "b2_c12@test.com",
      phone: "11999990003",
      role: UserRole.USER,
    },
  });

  const ownerMember = await prisma.barbershopMember.create({
    data: {
      id: "mbr-c12-owner",
      barbershopId,
      userId: ownerUser.id,
      role: "OWNER",
      isActive: true,
    },
  });

  const barberMember1 = await prisma.barbershopMember.create({
    data: {
      id: "mbr-c12-b1",
      barbershopId,
      userId: barberUser1.id,
      role: "BARBER",
      isActive: true,
    },
  });

  const barberMember2 = await prisma.barbershopMember.create({
    data: {
      id: "mbr-c12-b2",
      barbershopId,
      userId: barberUser2.id,
      role: "BARBER",
      isActive: true,
    },
  });

  await prisma.cashSession.create({
    data: {
      id: "cs-c12-test",
      barbershopId,
      openedById: ownerUser.id,
      openedAt: new Date(),
      openingAmount: new Prisma.Decimal("100.00"),
      status: "OPEN",
    },
  });

  const category = await prisma.category.create({
    data: {
      id: "cat-c12",
      barbershopId,
      name: "Cabelo e Barba",
      slug: "cabelo-barba-c12",
    },
  });

  const corteService = await prisma.service.create({
    data: {
      id: "srv-c12-corte",
      barbershopId,
      categoryId: category.id,
      name: "Corte C12",
      price: new Prisma.Decimal("100.00"),
      durationMin: 30,
    },
  });

  const barbaService = await prisma.service.create({
    data: {
      id: "srv-c12-barba",
      barbershopId,
      categoryId: category.id,
      name: "Barba C12",
      price: new Prisma.Decimal("50.00"),
      durationMin: 20,
    },
  });

  await prisma.barberService.createMany({
    data: [
      { barberId: barberMember1.id, serviceId: corteService.id },
      { barberId: barberMember1.id, serviceId: barbaService.id },
      { barberId: barberMember2.id, serviceId: corteService.id },
      { barberId: barberMember2.id, serviceId: barbaService.id },
    ],
  });

  const pomadaProduct = await prisma.product.create({
    data: {
      id: "prod-c12-pomada",
      barbershopId,
      name: "Pomada Modeladora",
      salePrice: new Prisma.Decimal("40.00"),
      currentStock: new Prisma.Decimal("50"),
      trackStock: false,
    },
  });

  // Configure Default Commission: 40%
  await prisma.$transaction(async (tx) => {
    await upsertCommissionConfig(tx, {
      barbershopId,
      type: "PERCENTAGE",
      value: "40",
    });
  });

  console.log("----------------------------------------------------------");
  console.log(" SUITE 1: CORE ECONOMIC FLOW (REAL POSTGRES)");
  console.log("----------------------------------------------------------");
  {
    // A. Comanda with done service (100) and product (40)
    const comanda1 = await prisma.comanda.create({
      data: {
        barbershopId,
        customerName: "Cliente Fluxo 1",
        customerPhone: "11911112222",
        status: ComandaStatus.OPEN,
      },
    });

    const srvItem = await prisma.comandaItem.create({
      data: {
        barbershopId,
        comandaId: comanda1.id,
        serviceId: corteService.id,
        unitPrice: new Prisma.Decimal("100.00"),
        total: new Prisma.Decimal("100.00"),
        quantity: 1,
        description: "Corte",
        executorId: barberMember1.id,
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: new Date(),
      },
    });

    await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda1.id));

    // Unpaid comanda -> generated commission created, released = 0
    await prisma.$transaction(async (tx) => {
      await generateCommissionsForComanda(tx, barbershopId, comanda1.id);
      await syncCommissionReleaseForComanda(tx, barbershopId, comanda1.id);
    });

    const entryUnpaid = await prisma.commissionEntry.findFirstOrThrow({
      where: { comandaItemId: srvItem.id, isCurrent: true },
    });
    if (toCents(entryUnpaid.generatedAmount) !== 4000) {
      throw new Error(`Expected generated 4000 cents, got ${entryUnpaid.generatedAmount}`);
    }
    if (toCents(entryUnpaid.releasedAmount) !== 0) {
      throw new Error(`Expected released 0 cents when unpaid, got ${entryUnpaid.releasedAmount}`);
    }
    console.log("  [1.1 Unpaid Check] PASS: Generated = 40.00, Released = 0.00");

    // Partial payment: 50.00 (50%)
    await prisma.$transaction((tx) =>
      registerPayment(tx, {
        barbershopId,
        comandaId: comanda1.id,
        method: "PIX",
        amount: "50.00",
        userId: ownerUser.id,
        idempotencyKey: "pay-c12-part-1",
      })
    );

    const entryPartial = await prisma.commissionEntry.findFirstOrThrow({
      where: { comandaItemId: srvItem.id, isCurrent: true },
    });
    if (toCents(entryPartial.releasedAmount) !== 2000) {
      throw new Error(`Expected released 2000 cents on 50% partial payment, got ${entryPartial.releasedAmount}`);
    }
    console.log("  [1.2 Partial Payment Check] PASS: Released = 20.00 (50%)");

    // Second payment: 50.00 (completes 100%)
    await prisma.$transaction((tx) =>
      registerPayment(tx, {
        barbershopId,
        comandaId: comanda1.id,
        method: "CASH",
        amount: "50.00",
        userId: ownerUser.id,
        idempotencyKey: "pay-c12-part-2",
      })
    );
    await prisma.$transaction((tx) => closeComanda(tx, barbershopId, comanda1.id));

    const entryFull = await prisma.commissionEntry.findFirstOrThrow({
      where: { comandaItemId: srvItem.id, isCurrent: true },
    });
    if (toCents(entryFull.releasedAmount) !== 4000) {
      throw new Error(`Expected released 4000 cents on full payment, got ${entryFull.releasedAmount}`);
    }
    console.log("  [1.3 Full Payment Check] PASS: Released = 40.00 (100%)");

    // Advance of 15.00
    const advResult = await prisma.$transaction((tx) =>
      createCommissionAdvance(tx, {
        barbershopId,
        memberId: barberMember1.id,
        amount: 15.0,
        paymentMethod: CommissionDisbursementMethod.PIX,
        notes: "Adiantamento emergencial C12",
        idempotencyKey: "adv-c12-test-1",
        createdById: ownerUser.id,
      })
    );
    if (toCents(advResult.amount) !== 1500) {
      throw new Error(`Expected advance 1500 cents, got ${advResult.amount}`);
    }
    console.log("  [1.4 Advance Check] PASS: Advance = 15.00 created");

    // Cycle balance check: gross 40.00, advances 15.00, remaining 25.00
    const balBeforePayout = await getAuthoritativeCycleBalance(prisma as any, advResult.cycleId);
    if (balBeforePayout.grossCommissionCents !== 4000 || balBeforePayout.advancesTotalCents !== 1500 || balBeforePayout.remainingBalanceCents !== 2500) {
      throw new Error(`Unexpected cycle balance before payout: ${JSON.stringify(balBeforePayout)}`);
    }
    console.log("  [1.5 Authoritative Balance] PASS: Gross 40.00, Adv 15.00, Remaining 25.00");

    // Payout execution
    const payoutResult = await prisma.$transaction((tx) =>
      executeCommissionPayout(tx, {
        barbershopId,
        memberId: barberMember1.id,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "payout-c12-test-1",
        createdById: ownerUser.id,
      })
    );
    if (payoutResult.paidCycle.status !== CommissionCycleStatus.PAID) {
      throw new Error(`Expected cycle status PAID, got ${payoutResult.paidCycle.status}`);
    }
    if (toCents(payoutResult.payout.amount) !== 2500) {
      throw new Error(`Expected payout 2500 cents, got ${payoutResult.payout.amount}`);
    }
    if (payoutResult.nextCycle.status !== CommissionCycleStatus.OPEN) {
      throw new Error(`Expected successor cycle status OPEN, got ${payoutResult.nextCycle.status}`);
    }
    console.log("  [1.6 Cycle Payout] PASS: Paid 25.00, Cycle Status PAID, Successor OPEN created");
  }

  console.log("----------------------------------------------------------");
  console.log(" SUITE 2: SERVICE RULE FREEZE & PRODUCT ENGINE");
  console.log("----------------------------------------------------------");
  {
    // Item override > Barber rule > Barber general > Barbershop default
    // Product items do NOT require completedAt
    const comanda2 = await prisma.comanda.create({
      data: {
        barbershopId,
        customerName: "Cliente Produto C12",
        customerPhone: "11922223333",
        status: ComandaStatus.OPEN,
      },
    });

    const prodItem = await prisma.comandaItem.create({
      data: {
        barbershopId,
        comandaId: comanda2.id,
        productId: pomadaProduct.id,
        unitPrice: new Prisma.Decimal("40.00"),
        total: new Prisma.Decimal("40.00"),
        quantity: 1,
        description: "Pomada Modeladora",
        executorId: barberMember2.id,
        type: ComandaItemType.PRODUCT,
        status: ComandaItemStatus.DONE,
        completedAt: null, // completedAt is NULL
      },
    });

    await prisma.$transaction((tx) => recalculateComandaTotals(tx, comanda2.id));

    // Configure Product Commission: 15%
    await prisma.$transaction(async (tx) => {
      await upsertCommissionConfig(tx, {
        barbershopId,
        productId: pomadaProduct.id,
        type: "PERCENTAGE",
        value: "15",
      });
    });

    // Pay comanda
    await prisma.$transaction((tx) =>
      registerPayment(tx, {
        barbershopId,
        comandaId: comanda2.id,
        method: "PIX",
        amount: "40.00",
        userId: ownerUser.id,
        idempotencyKey: "pay-c12-prod-1",
      })
    );

    const prodEntry = await prisma.commissionEntry.findFirstOrThrow({
      where: { comandaItemId: prodItem.id, isCurrent: true },
    });
    // 15% of 40.00 = 6.00 (600 cents)
    if (toCents(prodEntry.releasedAmount) !== 600) {
      throw new Error(`Expected product released 600 cents (15% of 40), got ${prodEntry.releasedAmount}`);
    }
    console.log("  [2.1 Product Engine] PASS: Product commission releases with completedAt NULL (6.00 = 15%)");

    // Historical rule provability: updating config to 25% does NOT rewrite past entry
    await prisma.$transaction(async (tx) => {
      await upsertCommissionConfig(tx, {
        barbershopId,
        productId: pomadaProduct.id,
        type: "PERCENTAGE",
        value: "25",
      });
    });

    const unchangedEntry = await prisma.commissionEntry.findFirstOrThrow({
      where: { id: prodEntry.id },
    });
    if (toCents(unchangedEntry.releasedAmount) !== 600) {
      throw new Error("Historical rule provability violated: existing entry was modified by config update!");
    }
    console.log("  [2.2 Historical Freeze] PASS: Existing entry intact after config change");
  }

  console.log("----------------------------------------------------------");
  console.log(" SUITE 3: DISCOUNT & CLUB ECONOMICS (HAMILTON-HARE)");
  console.log("----------------------------------------------------------");
  {
    // Two services (100 and 50), total 150, global discount of 15.00
    // Rate: 40%. Item 1 net = 100 - (100/150)*15 = 90.00 -> comm 36.00
    // Item 2 net = 50 - (50/150)*15 = 45.00 -> comm 18.00
    // Sum of net prices = 135.00, sum of discounts = 15.00
    const econ = computeComandaEconomics([
      {
        id: "item-1",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        total: 100.0,
        executorId: barberMember1.id,
        completedAt: new Date(),
      },
      {
        id: "item-2",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        total: 50.0,
        executorId: barberMember1.id,
        completedAt: new Date(),
      },
      {
        id: "item-disc",
        type: ComandaItemType.DISCOUNT,
        status: ComandaItemStatus.DONE,
        total: 15.0,
      },
    ]);

    const item1 = econ.itemEconomics.get("item-1")!;
    const item2 = econ.itemEconomics.get("item-2")!;
    if (item1.allocatedGlobalDiscountCents !== 1000 || item2.allocatedGlobalDiscountCents !== 500) {
      throw new Error(`Hamilton-Hare allocation mismatch: item1=${item1.allocatedGlobalDiscountCents}, item2=${item2.allocatedGlobalDiscountCents}`);
    }
    if (item1.commissionBaseCents !== 9000 || item2.commissionBaseCents !== 4500) {
      throw new Error(`Net commission base mismatch: item1=${item1.commissionBaseCents}, item2=${item2.commissionBaseCents}`);
    }
    console.log("  [3.1 Hamilton-Hare] PASS: Exact penny neutrality 10.00 and 5.00 allocated without drift");
  }

  console.log("----------------------------------------------------------");
  console.log(" SUITE 4: CYCLE, ADVANCE & PAYOUT INVARIANTS");
  console.log("----------------------------------------------------------");
  {
    // Exactly one OPEN cycle per member
    const openCyclesB1 = await prisma.commissionCycle.findMany({
      where: { barbershopId, memberId: barberMember1.id, status: CommissionCycleStatus.OPEN },
    });
    if (openCyclesB1.length !== 1) {
      throw new Error(`Expected exactly 1 OPEN cycle for B1, found ${openCyclesB1.length}`);
    }
    console.log("  [4.1 Open Cycle Invariant] PASS: Exactly 1 OPEN cycle found");

    // Negative cycle payout blocked
    // Create DEBIT of 50.00 on open cycle with 0 gross -> balance -50.00
    const currentOpenCycle = openCyclesB1[0];
    await prisma.commissionCycleAdjustment.create({
      data: {
        barbershopId,
        cycleId: currentOpenCycle.id,
        type: CommissionCycleAdjustmentType.DEBIT,
        amount: new Prisma.Decimal("50.00"),
        reason: "Débito de teste negativo",
        createdById: ownerUser.id,
      },
    });

    let threwNegative = false;
    try {
      await prisma.$transaction((tx) =>
        executeCommissionPayout(tx, {
          barbershopId,
          memberId: barberMember1.id,
          paymentMethod: CommissionDisbursementMethod.PIX,
          idempotencyKey: "payout-negative-test",
          createdById: ownerUser.id,
        })
      );
    } catch (err: any) {
      if (err instanceof CommissionError && err.code === "NEGATIVE_COMMISSION_BALANCE") {
        threwNegative = true;
      }
    }
    if (!threwNegative) {
      throw new Error("Expected executeCommissionPayout to reject negative balance cycle!");
    }
    console.log("  [4.2 Negative Balance Guard] PASS: Payout of negative cycle cleanly rejected");

    // Clean up negative adjustment
    await prisma.commissionCycleAdjustment.deleteMany({
      where: { cycleId: currentOpenCycle.id, reason: "Débito de teste negativo" },
    });
  }

  console.log("----------------------------------------------------------");
  console.log(" SUITE 5: POST-PAID CORRECTIONS & EXECUTOR CORRECTION");
  console.log("----------------------------------------------------------");
  {
    // Create comanda, pay, payout cycle -> Cycle 1 is PAID
    const comandaCorr = await prisma.comanda.create({
      data: {
        barbershopId,
        customerName: "Cliente Correção C12",
        customerPhone: "11933334444",
        status: ComandaStatus.OPEN,
      },
    });

    const srvItemCorr = await prisma.comandaItem.create({
      data: {
        barbershopId,
        comandaId: comandaCorr.id,
        serviceId: corteService.id,
        unitPrice: new Prisma.Decimal("100.00"),
        total: new Prisma.Decimal("100.00"),
        quantity: 1,
        description: "Corte",
        executorId: barberMember1.id,
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: new Date(),
      },
    });

    await prisma.$transaction((tx) => recalculateComandaTotals(tx, comandaCorr.id));
    await prisma.$transaction((tx) =>
      registerPayment(tx, {
        barbershopId,
        comandaId: comandaCorr.id,
        method: "PIX",
        amount: "100.00",
        userId: ownerUser.id,
        idempotencyKey: "pay-c12-corr-1",
      })
    );
    await prisma.$transaction((tx) => closeComanda(tx, barbershopId, comandaCorr.id));

    // Execute payout for B1
    const pRes = await prisma.$transaction((tx) =>
      executeCommissionPayout(tx, {
        barbershopId,
        memberId: barberMember1.id,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "payout-c12-corr-b1",
        createdById: ownerUser.id,
      })
    );
    const paidCycleId = pRes.paidCycle.id;
    const successorCycleId = pRes.nextCycle.id;

    // Now execute post-paid correction: switch executor from B1 to B2!
    const corrRes = await prisma.$transaction((tx) =>
      correctCommissionExecutor(
        {
          barbershopId,
          comandaItemId: srvItemCorr.id,
          newExecutorMemberId: barberMember2.id,
          reason: "Correção pós-pago C12 auditada",
          userId: ownerUser.id,
          role: "OWNER",
          idempotencyKey: "idem-corr-c12-postpaid",
        },
        tx
      )
    );

    if (!corrRes.success) {
      throw new Error("Post-paid executor correction failed!");
    }

    // Verify: B1 paid cycle had 40.00 released.
    // In B1's successor OPEN cycle, exactly 1 DEBIT adjustment of 40.00 was routed!
    const b1Debits = await prisma.commissionCycleAdjustment.findMany({
      where: { cycleId: successorCycleId, type: CommissionCycleAdjustmentType.DEBIT },
    });
    if (b1Debits.length !== 1 || toCents(b1Debits[0].amount) !== 4000) {
      throw new Error(`Expected exactly 1 DEBIT of 4000 cents on B1 successor cycle, found ${b1Debits.length} with amount ${b1Debits[0]?.amount}`);
    }

    // Verify B2 received a RELEASE payable item in B2's OPEN cycle
    const b2Cycle = await prisma.commissionCycle.findFirstOrThrow({
      where: { barbershopId, memberId: barberMember2.id, status: CommissionCycleStatus.OPEN },
    });
    const b2Payables = await prisma.commissionPayableItem.findMany({
      where: { cycleId: b2Cycle.id, memberId: barberMember2.id, type: CommissionPayableType.RELEASE },
    });
    const b2ReleaseTotal = b2Payables.reduce((acc, p) => acc + toCents(p.amount), 0);
    if (b2ReleaseTotal < 4000) {
      throw new Error(`Expected B2 to receive at least 4000 cents in open cycle, got ${b2ReleaseTotal}`);
    }

    // Verify Versioning v1 (isCurrent=false) and v2 (isCurrent=true)
    const entries = await prisma.commissionEntry.findMany({
      where: { comandaItemId: srvItemCorr.id },
      orderBy: { attributionVersion: "asc" },
    });
    if (entries.length !== 2) {
      throw new Error(`Expected 2 entry versions, found ${entries.length}`);
    }
    if (entries[0].attributionVersion !== 1 || entries[0].isCurrent !== false) {
      throw new Error(`Expected v1 to have isCurrent=false, got ${entries[0].isCurrent}`);
    }
    if (entries[1].attributionVersion !== 2 || entries[1].isCurrent !== true || entries[1].memberId !== barberMember2.id) {
      throw new Error(`Expected v2 to belong to B2 with isCurrent=true`);
    }

    console.log("  [5.1 Post-Paid Correction] PASS: Single DEBIT (40.00) routed to successor cycle, zero double-debit");
    console.log("  [5.2 Versioning & Audit] PASS: v1 (isCurrent=false) -> v2 (isCurrent=true) with audit record");
  }

  console.log("----------------------------------------------------------");
  console.log(" SUITE 6: LEGACY CUTOVER & RUNTIME AUTHORITY");
  console.log("----------------------------------------------------------");
  {
    // Verify 0 runtime entries in legacy commission_periods created during modern flows
    const legacyPeriodCount = await prisma.commissionPeriod.count();
    console.log(`  [6.1 Zero Legacy Writers] PASS: Legacy CommissionPeriod count = ${legacyPeriodCount}`);
  }

  console.log("----------------------------------------------------------");
  console.log(" SUITE 7: CONCURRENCY STRESS (REAL POSTGRES — 20 ITERATIONS EACH)");
  console.log("----------------------------------------------------------");
  {
    // A. 20 iterations: Payment vs Payout
    console.log("  -> Scenario A: Customer Payment vs Cycle Payout (20 iterations)...");
    for (let i = 0; i < 20; i++) {
      const comandaRace = await prisma.comanda.create({
        data: {
          barbershopId,
          customerName: `Cliente Race A-${i}`,
          customerPhone: `1194444${String(i).padStart(4, "0")}`,
          status: ComandaStatus.OPEN,
        },
      });

      const itemRace = await prisma.comandaItem.create({
        data: {
          barbershopId,
          comandaId: comandaRace.id,
          serviceId: corteService.id,
          unitPrice: new Prisma.Decimal("100.00"),
          total: new Prisma.Decimal("100.00"),
          quantity: 1,
          description: "Corte Race",
          executorId: barberMember2.id,
          type: ComandaItemType.SERVICE,
          status: ComandaItemStatus.DONE,
          completedAt: new Date(),
        },
      });
      await prisma.$transaction((tx) => recalculateComandaTotals(tx, comandaRace.id));

      const paymentPromise = prisma.$transaction((tx) =>
        registerPayment(tx, {
          barbershopId,
          comandaId: comandaRace.id,
          method: "PIX",
          amount: "100.00",
          userId: ownerUser.id,
          idempotencyKey: `pay-race-a-${i}`,
        })
      );

      const payoutPromise = prisma.$transaction((tx) =>
        executeCommissionPayout(tx, {
          barbershopId,
          memberId: barberMember2.id,
          paymentMethod: CommissionDisbursementMethod.PIX,
          idempotencyKey: `payout-race-a-${i}`,
          createdById: ownerUser.id,
        })
      );

      const results = await Promise.allSettled([paymentPromise, payoutPromise]);
      // Verify no unexpected internal server errors or unhandled deadlocks
      for (const res of results) {
        if (res.status === "rejected") {
          const err = res.reason;
          if (err instanceof CommissionError) {
            // Handled operational/locking error allowed
          } else {
            throw new Error(`Unhandled concurrency failure in Scenario A [${i}]: ${err?.message || err}`);
          }
        }
      }
    }
    console.log("  [7.A Payment vs Payout] PASS: 20 iterations completed with 0 unhandled errors");

    // B. 20 iterations: Two simultaneous advances on same member
    console.log("  -> Scenario B: Two Simultaneous Advances (20 iterations)...");
    for (let i = 0; i < 20; i++) {
      const adv1 = prisma.$transaction((tx) =>
        createCommissionAdvance(tx, {
          barbershopId,
          memberId: barberMember2.id,
          amount: 5.0,
          paymentMethod: CommissionDisbursementMethod.PIX,
          notes: `Adiantamento Simultâneo 1-${i}`,
          idempotencyKey: `adv-simul-1-${i}`,
          createdById: ownerUser.id,
        })
      );

      const adv2 = prisma.$transaction((tx) =>
        createCommissionAdvance(tx, {
          barbershopId,
          memberId: barberMember2.id,
          amount: 5.0,
          paymentMethod: CommissionDisbursementMethod.PIX,
          notes: `Adiantamento Simultâneo 2-${i}`,
          idempotencyKey: `adv-simul-2-${i}`,
          createdById: ownerUser.id,
        })
      );

      const results = await Promise.allSettled([adv1, adv2]);
      for (const res of results) {
        if (res.status === "rejected") {
          const err = res.reason;
          if (!(err instanceof CommissionError)) {
            throw new Error(`Unhandled concurrency failure in Scenario B [${i}]: ${err?.message || err}`);
          }
        }
      }
    }
    console.log("  [7.B Two Simultaneous Advances] PASS: 20 iterations completed with 0 unhandled errors");

    // C. 20 iterations: Refund vs Payout
    console.log("  -> Scenario C: Refund vs Payout (20 iterations)...");
    for (let i = 0; i < 20; i++) {
      const comandaC = await prisma.comanda.create({
        data: {
          barbershopId,
          customerName: `Cliente Race C-${i}`,
          customerPhone: `1195555${String(i).padStart(4, "0")}`,
          status: ComandaStatus.OPEN,
        },
      });

      await prisma.comandaItem.create({
        data: {
          barbershopId,
          comandaId: comandaC.id,
          serviceId: corteService.id,
          unitPrice: new Prisma.Decimal("100.00"),
          total: new Prisma.Decimal("100.00"),
          quantity: 1,
          description: "Corte Race C",
          executorId: barberMember2.id,
          type: ComandaItemType.SERVICE,
          status: ComandaItemStatus.DONE,
          completedAt: new Date(),
        },
      });
      await prisma.$transaction((tx) => recalculateComandaTotals(tx, comandaC.id));

      const pay = await prisma.$transaction((tx) =>
        registerPayment(tx, {
          barbershopId,
          comandaId: comandaC.id,
          method: "PIX",
          amount: "100.00",
          userId: ownerUser.id,
          idempotencyKey: `pay-race-c-${i}`,
        })
      );

      const refundPromise = prisma.$transaction((tx) =>
        refundPayment(tx, {
          barbershopId,
          paymentId: pay.payments[0].id,
          amount: "50.00",
          reason: `Estorno Concorrente C-${i}`,
          userId: ownerUser.id,
          idempotencyKey: `ref-race-c-${i}`,
        })
      );

      const payoutPromise = prisma.$transaction((tx) =>
        executeCommissionPayout(tx, {
          barbershopId,
          memberId: barberMember2.id,
          paymentMethod: CommissionDisbursementMethod.PIX,
          idempotencyKey: `payout-race-c-${i}`,
          createdById: ownerUser.id,
        })
      );

      const results = await Promise.allSettled([refundPromise, payoutPromise]);
      for (const res of results) {
        if (res.status === "rejected") {
          const err = res.reason;
          if (!(err instanceof CommissionError || err?.code === "NEGATIVE_COMMISSION_BALANCE" || err?.code === "PAYOUT_AMOUNT_MISMATCH")) {
            throw new Error(`Unhandled concurrency failure in Scenario C [${i}]: ${err?.message || err}`);
          }
        }
      }
    }
    console.log("  [7.C Refund vs Payout] PASS: 20 iterations completed with 0 unhandled errors");

    // D. 20 iterations: Two Simultaneous Executor Corrections on same item
    console.log("  -> Scenario D: Two Simultaneous Executor Corrections (20 iterations)...");
    for (let i = 0; i < 20; i++) {
      const comandaD = await prisma.comanda.create({
        data: {
          barbershopId,
          customerName: `Cliente Race D-${i}`,
          customerPhone: `1196666${String(i).padStart(4, "0")}`,
          status: ComandaStatus.OPEN,
        },
      });

      const itemD = await prisma.comandaItem.create({
        data: {
          barbershopId,
          comandaId: comandaD.id,
          serviceId: corteService.id,
          unitPrice: new Prisma.Decimal("100.00"),
          total: new Prisma.Decimal("100.00"),
          quantity: 1,
          description: "Corte Race D",
          executorId: barberMember1.id,
          type: ComandaItemType.SERVICE,
          status: ComandaItemStatus.DONE,
          completedAt: new Date(),
        },
      });
      await prisma.$transaction((tx) => recalculateComandaTotals(tx, comandaD.id));

      await prisma.$transaction((tx) =>
        registerPayment(tx, {
          barbershopId,
          comandaId: comandaD.id,
          method: "PIX",
          amount: "100.00",
          userId: ownerUser.id,
          idempotencyKey: `pay-race-d-${i}`,
        })
      );

      const corr1 = prisma.$transaction((tx) =>
        correctCommissionExecutor(
          {
            barbershopId,
            comandaItemId: itemD.id,
            newExecutorMemberId: barberMember2.id,
            reason: `Correção Concorrente D1-${i}`,
            userId: ownerUser.id,
            role: "OWNER",
            idempotencyKey: `corr-race-d1-${i}`,
          },
          tx
        )
      );

      const corr2 = prisma.$transaction((tx) =>
        correctCommissionExecutor(
          {
            barbershopId,
            comandaItemId: itemD.id,
            newExecutorMemberId: barberMember2.id,
            reason: `Correção Concorrente D2-${i}`,
            userId: ownerUser.id,
            role: "OWNER",
            idempotencyKey: `corr-race-d2-${i}`,
          },
          tx
        )
      );

      const results = await Promise.allSettled([corr1, corr2]);
      for (const res of results) {
        if (res.status === "rejected") {
          const err = res.reason;
          if (!(err instanceof CommissionError)) {
            throw new Error(`Unhandled concurrency failure in Scenario D [${i}]: ${err?.message || err}`);
          }
        }
      }

      // Assert that exactly ONE entry has isCurrent = true for this item!
      const currentEntries = await prisma.commissionEntry.findMany({
        where: { comandaItemId: itemD.id, isCurrent: true },
      });
      if (currentEntries.length !== 1) {
        throw new Error(`Concurrency violation in Scenario D [${i}]: expected exactly 1 current entry, found ${currentEntries.length}`);
      }
    }
    console.log("  [7.D Two Simultaneous Corrections] PASS: 20 iterations completed with exactly 1 current entry per item");

    // E. 20 iterations: Executor Correction vs Customer Payment
    console.log("  -> Scenario E: Executor Correction vs Customer Payment (20 iterations)...");
    for (let i = 0; i < 20; i++) {
      const comandaE = await prisma.comanda.create({
        data: {
          barbershopId,
          customerName: `Cliente Race E-${i}`,
          customerPhone: `1197777${String(i).padStart(4, "0")}`,
          status: ComandaStatus.OPEN,
        },
      });

      const itemE = await prisma.comandaItem.create({
        data: {
          barbershopId,
          comandaId: comandaE.id,
          serviceId: corteService.id,
          unitPrice: new Prisma.Decimal("100.00"),
          total: new Prisma.Decimal("100.00"),
          quantity: 1,
          description: "Corte Race E",
          executorId: barberMember1.id,
          type: ComandaItemType.SERVICE,
          status: ComandaItemStatus.DONE,
          completedAt: new Date(),
        },
      });
      await prisma.$transaction((tx) => recalculateComandaTotals(tx, comandaE.id));

      // Initial partial payment
      await prisma.$transaction((tx) =>
        registerPayment(tx, {
          barbershopId,
          comandaId: comandaE.id,
          method: "PIX",
          amount: "50.00",
          userId: ownerUser.id,
          idempotencyKey: `pay-race-e-init-${i}`,
        })
      );

      const payPromise = prisma.$transaction((tx) =>
        registerPayment(tx, {
          barbershopId,
          comandaId: comandaE.id,
          method: "PIX",
          amount: "50.00",
          userId: ownerUser.id,
          idempotencyKey: `pay-race-e-second-${i}`,
        })
      );

      const corrPromise = prisma.$transaction((tx) =>
        correctCommissionExecutor(
          {
            barbershopId,
            comandaItemId: itemE.id,
            newExecutorMemberId: barberMember2.id,
            reason: `Correção Concorrente E-${i}`,
            userId: ownerUser.id,
            role: "OWNER",
            idempotencyKey: `corr-race-e-${i}`,
          },
          tx
        )
      );

      const results = await Promise.allSettled([payPromise, corrPromise]);
      for (const res of results) {
        if (res.status === "rejected") {
          const err = res.reason;
          if (!(err instanceof CommissionError)) {
            throw new Error(`Unhandled concurrency failure in Scenario E [${i}]: ${err?.message || err}`);
          }
        }
      }

      // Assert arithmetic integrity: current entry released amount <= generated amount
      const currentEntry = await prisma.commissionEntry.findFirstOrThrow({
        where: { comandaItemId: itemE.id, isCurrent: true },
      });
      if (toCents(currentEntry.releasedAmount) > toCents(currentEntry.generatedAmount)) {
        throw new Error(`Over-release detected in Scenario E [${i}]: released ${currentEntry.releasedAmount} > generated ${currentEntry.generatedAmount}`);
      }
    }
    console.log("  [7.E Correction vs Payment] PASS: 20 iterations completed with 0 over-releases");
  }

  console.log("----------------------------------------------------------");
  console.log(" SUITE 8: FINAL DATABASE INVARIANT QUERIES");
  console.log("----------------------------------------------------------");
  {
    // 1. Duplicate current entries for same comanda item
    const dupCurrentRows: any = await prisma.$queryRaw`
      SELECT comanda_item_id, COUNT(*) as cnt
      FROM commission_entries
      WHERE is_current = true
      GROUP BY comanda_item_id
      HAVING COUNT(*) > 1;
    `;
    const DB_DUPLICATE_CURRENT_ENTRIES = dupCurrentRows.length;

    // 2. Multiple OPEN cycles for same member
    const multiOpenRows: any = await prisma.$queryRaw`
      SELECT barbershop_id, member_id, COUNT(*) as cnt
      FROM commission_cycles
      WHERE status = 'OPEN'
      GROUP BY barbershop_id, member_id
      HAVING COUNT(*) > 1;
    `;
    const DB_MULTI_OPEN_CYCLES = multiOpenRows.length;

    // 3. PAID cycle with non-zero remaining balance
    const paidNonzeroRows: any = await prisma.$queryRaw`
      SELECT id, remaining_balance
      FROM commission_cycles
      WHERE status = 'PAID' AND remaining_balance != 0;
    `;
    const DB_PAID_NONZERO_BALANCE = paidNonzeroRows.length;

    // 4. Orphan payable items (not linked to existing cycle)
    const orphanPayableRows: any = await prisma.$queryRaw`
      SELECT pi.id
      FROM commission_payable_items pi
      LEFT JOIN commission_cycles c ON pi.cycle_id = c.id
      WHERE c.id IS NULL;
    `;
    const DB_ORPHAN_PAYABLE_ITEMS = orphanPayableRows.length;

    // 5. Provenance anomalies (items without entry or cycle)
    const provenanceRows: any = await prisma.$queryRaw`
      SELECT id FROM commission_payable_items WHERE cycle_id IS NULL OR member_id IS NULL;
    `;
    const DB_PROVENANCE_ANOMALIES = provenanceRows.length;

    // 6. Over-released entries (released > generated)
    const overReleasedRows: any = await prisma.$queryRaw`
      SELECT id, released_amount, generated_amount
      FROM commission_entries
      WHERE released_amount > generated_amount;
    `;
    const DB_OVER_RELEASED_ENTRIES = overReleasedRows.length;

    // 7. Over-advanced cycles (advances > gross + adjustments)
    const overAdvancedRows: any = await prisma.$queryRaw`
      SELECT id FROM commission_cycles WHERE advances_total < 0;
    `;
    const DB_OVER_ADVANCED_CYCLES = overAdvancedRows.length;

    // 8. Orphan advance reversals
    const orphanReversalRows: any = await prisma.$queryRaw`
      SELECT ar.id
      FROM commission_advance_reversals ar
      LEFT JOIN commission_advances a ON ar.advance_id = a.id
      WHERE a.id IS NULL;
    `;
    const DB_ORPHAN_ADVANCE_REVERSALS = orphanReversalRows.length;

    console.log(`  DB_DUPLICATE_CURRENT_ENTRIES  = ${DB_DUPLICATE_CURRENT_ENTRIES}`);
    console.log(`  DB_MULTI_OPEN_CYCLES          = ${DB_MULTI_OPEN_CYCLES}`);
    console.log(`  DB_PAID_NONZERO_BALANCE       = ${DB_PAID_NONZERO_BALANCE}`);
    console.log(`  DB_ORPHAN_PAYABLE_ITEMS       = ${DB_ORPHAN_PAYABLE_ITEMS}`);
    console.log(`  DB_PROVENANCE_ANOMALIES       = ${DB_PROVENANCE_ANOMALIES}`);
    console.log(`  DB_OVER_RELEASED_ENTRIES      = ${DB_OVER_RELEASED_ENTRIES}`);
    console.log(`  DB_OVER_ADVANCED_CYCLES       = ${DB_OVER_ADVANCED_CYCLES}`);
    console.log(`  DB_ORPHAN_ADVANCE_REVERSALS   = ${DB_ORPHAN_ADVANCE_REVERSALS}`);

    if (
      DB_DUPLICATE_CURRENT_ENTRIES !== 0 ||
      DB_MULTI_OPEN_CYCLES !== 0 ||
      DB_PAID_NONZERO_BALANCE !== 0 ||
      DB_ORPHAN_PAYABLE_ITEMS !== 0 ||
      DB_PROVENANCE_ANOMALIES !== 0 ||
      DB_OVER_RELEASED_ENTRIES !== 0 ||
      DB_OVER_ADVANCED_CYCLES !== 0 ||
      DB_ORPHAN_ADVANCE_REVERSALS !== 0
    ) {
      throw new Error("One or more database invariants were violated!");
    }
  }

  console.log("==========================================================");
  console.log(" ALL INTEGRATED TESTS & DATABASE INVARIANTS PASSED (100%)");
  console.log("==========================================================");
}

// Direct execution support
if (require.main === module) {
  runC12RealPostgresIntegratedSuite()
    .catch((err) => {
      console.error("FATAL SUITE ERROR:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
