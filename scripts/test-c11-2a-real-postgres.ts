/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from "@/lib/prisma";
import {
  Prisma,
  CommissionCycleStatus,
  CommissionPayableType,
  CommissionPayableSourceKind,
  CommissionCycleAdjustmentType,
  ComandaStatus,
  ComandaItemType,
  AppointmentStatus,
  UserRole,
} from "@prisma/client";
import { fromCents, toCents } from "@/lib/operations/money";
import {
  runPreflight,
  applyCutoverForTenant,
  verifyTenantCutover,
  executeCutoverWorkflow,
  CutoverError,
} from "./cutover-legacy-commissions";

export async function runRealPostgresProof() {
  console.log("==================================================");
  console.log(" TEM BARBER — C11.2a REAL POSTGRESQL PROOF RUNNER");
  console.log("==================================================");

  // 1. Check PostgreSQL connection & version
  const [versionRow]: any = await prisma.$queryRaw`SELECT version();`;
  console.log("Real DB Connected:", versionRow.version);

  // 2. Catalog Inspection
  console.log("\n--- STEP 2: CATALOG INSPECTION ---");
  const indexes: any[] = await prisma.$queryRaw`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'commission_entries'
    ORDER BY indexname;
  `;

  const indexNames = indexes.map((i) => i.indexname);
  console.log("Found indexes on commission_entries:", indexNames);

  const oldUnique = indexNames.includes("commission_entries_comanda_item_id_key");
  const compositeUnique = indexNames.includes("commission_entries_comanda_item_id_attribution_version_key");
  const partialCurrent = indexNames.includes("commission_entries_one_current_per_comanda_item_uidx");

  const partialCurrentDef = indexes.find(
    (i) => i.indexname === "commission_entries_one_current_per_comanda_item_uidx"
  )?.indexdef;

  if (oldUnique) throw new Error("OLD_UNIQUE_DB_STATE must be ABSENT");
  if (!compositeUnique) throw new Error("COMPOSITE_UNIQUE_DB_STATE must be PRESENT");
  if (!partialCurrent) throw new Error("PARTIAL_CURRENT_UNIQUE_DB_STATE must be PRESENT");
  if (!partialCurrentDef?.includes("WHERE (is_current = true)")) {
    throw new Error("PARTIAL_INDEX_PREDICATE must be WHERE (is_current = true)");
  }

  console.log("CATALOG PROOF: PASS");
  console.log("- commission_entries_comanda_item_id_key: ABSENT");
  console.log("- commission_entries_comanda_item_id_attribution_version_key: PRESENT");
  console.log("- commission_entries_one_current_per_comanda_item_uidx: PRESENT");
  console.log("- predicate:", partialCurrentDef);

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

  // Clean previous test data if any via Prisma
  async function cleanAllData() {
    await prisma.commissionPayout.deleteMany();
    await prisma.commissionCycleAdjustment.deleteMany();
    await prisma.commissionAdvance.deleteMany();
    await prisma.commissionPayableItem.deleteMany();
    await prisma.commissionCycle.deleteMany();
    await prisma.commissionEntry.deleteMany();
    await prisma.commissionAdjustment.deleteMany();
    await prisma.commissionPeriod.deleteMany();
    await prisma.comandaItem.deleteMany();
    await prisma.comanda.deleteMany();
    await prisma.barbershopMember.deleteMany();
    await prisma.user.deleteMany();
    await prisma.barbershop.deleteMany();
  }

  await cleanAllData();

  // Helper to create basic tenant graph
  async function createTenant(prefix: string) {
    const randomPhone = `11${Math.floor(10000000 + Math.random() * 90000000)}`;
    const shop = await prisma.barbershop.create({
      data: {
        id: `shop-${prefix}`,
        name: `Shop ${prefix}`,
        slug: `shop-${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        phone: randomPhone,
        zipCode: "12345-678",
        street: "Rua Teste",
        number: "100",
        neighborhood: "Bairro",
        city: "Cidade",
        state: "SP",
      },
    });

    const user = await prisma.user.create({
      data: {
        id: `user-${prefix}`,
        name: `User ${prefix}`,
        email: `user-${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}@test.com`,
        phone: randomPhone,
        role: UserRole.USER,
      },
    });

    const member = await prisma.barbershopMember.create({
      data: {
        id: `member-${prefix}`,
        barbershopId: shop.id,
        userId: user.id,
        role: "BARBER",
      },
    });

    const comanda = await prisma.comanda.create({
      data: {
        id: `comanda-${prefix}`,
        barbershopId: shop.id,
        customerName: `Customer ${prefix}`,
        status: ComandaStatus.OPEN,
        total: fromCents(10000),
      },
    });

    const comandaItem = await prisma.comandaItem.create({
      data: {
        id: `item-${prefix}`,
        comandaId: comanda.id,
        barbershopId: shop.id,
        executorId: member.id,
        type: ComandaItemType.SERVICE,
        description: `Service ${prefix}`,
        unitPrice: fromCents(10000),
        total: fromCents(10000),
        quantity: 1,
      },
    });

    return { shop, user, member, comanda, comandaItem };
  }

  // 3. Physical Multi-Version DB Proof
  console.log("\n--- STEP 3: PHYSICAL MULTI-VERSION DB PROOF ---");
  const mvTenant = await createTenant("mv");

  // A. Insert v1 current => success
  const v1 = await prisma.commissionEntry.create({
    data: {
      barbershopId: mvTenant.shop.id,
      memberId: mvTenant.member.id,
      comandaItemId: mvTenant.comandaItem.id,
      competence: "2026-07",
      configSnapshot: { percentage: 50 },
      baseAmount: fromCents(10000),
      generatedAmount: fromCents(5000),
      releasedAmount: fromCents(5000),
      paidAmount: 0,
      reversedAmount: 0,
      attributionVersion: 1,
      isCurrent: true,
    },
  });
  console.log("v1 current inserted successfully:", v1.id);

  // B. Insert second simultaneous current => DB rejection
  let secondCurrentRejected = false;
  try {
    await prisma.commissionEntry.create({
      data: {
        barbershopId: mvTenant.shop.id,
        memberId: mvTenant.member.id,
        comandaItemId: mvTenant.comandaItem.id,
        competence: "2026-07",
        configSnapshot: { percentage: 50 },
        baseAmount: fromCents(10000),
        generatedAmount: fromCents(6000),
        releasedAmount: fromCents(6000),
        paidAmount: 0,
        reversedAmount: 0,
        attributionVersion: 2,
        isCurrent: true, // Collision with partial unique index!
      },
    });
  } catch (err: any) {
    if (err.message.includes("commission_entries_one_current_per_comanda_item_uidx") || err.code === "P2002") {
      secondCurrentRejected = true;
      console.log("Second current rejected by PostgreSQL as expected (P2002 partial unique conflict)");
    } else {
      throw err;
    }
  }
  if (!secondCurrentRejected) throw new Error("Second simultaneous current was NOT rejected by database!");

  // C. Update v1 is_current=false + insert v2 is_current=true in transaction => success
  const v2 = await prisma.$transaction(async (tx) => {
    await tx.commissionEntry.update({
      where: { id: v1.id },
      data: { isCurrent: false },
    });
    return tx.commissionEntry.create({
      data: {
        barbershopId: mvTenant.shop.id,
        memberId: mvTenant.member.id,
        comandaItemId: mvTenant.comandaItem.id,
        competence: "2026-07",
        configSnapshot: { percentage: 50 },
        baseAmount: fromCents(10000),
        generatedAmount: fromCents(6000),
        releasedAmount: fromCents(6000),
        paidAmount: 0,
        reversedAmount: 0,
        attributionVersion: 2,
        supersedesEntryId: v1.id,
        isCurrent: true,
      },
    });
  });
  console.log("v1 superseded & v2 current inserted successfully:", v2.id);

  // D. Duplicate attributionVersion => DB rejection
  let duplicateVersionRejected = false;
  try {
    await prisma.commissionEntry.create({
      data: {
        barbershopId: mvTenant.shop.id,
        memberId: mvTenant.member.id,
        comandaItemId: mvTenant.comandaItem.id,
        competence: "2026-07",
        configSnapshot: { percentage: 50 },
        baseAmount: fromCents(10000),
        generatedAmount: fromCents(6000),
        releasedAmount: fromCents(6000),
        paidAmount: 0,
        reversedAmount: 0,
        attributionVersion: 2, // Collision with composite unique key!
        isCurrent: false,
      },
    });
  } catch (err: any) {
    if (err.message.includes("commission_entries_comanda_item_id_attribution_version_key") || err.code === "P2002") {
      duplicateVersionRejected = true;
      console.log("Duplicate attribution version rejected by PostgreSQL as expected (P2002 composite unique conflict)");
    } else {
      throw err;
    }
  }
  if (!duplicateVersionRejected) throw new Error("Duplicate attribution version was NOT rejected by database!");

  console.log("PHYSICAL MULTI-VERSION PROOF: ALL 4 INVARIANTS PASS");

  // 4. Global Preflight Proof
  console.log("\n--- STEP 4: GLOBAL PREFLIGHT SAFETY PROOF ---");
  const tenantA = await createTenant("pre-a");
  const tenantB = await createTenant("pre-b");

  // Seed Tenant A with clean legacy data
  const periodA = await prisma.commissionPeriod.create({
    data: {
      id: "period-pre-a",
      barbershopId: tenantA.shop.id,
      memberId: tenantA.member.id,
      competence: "2026-06",
      status: "PAID",
      releasedAmount: fromCents(10000),
      paidAmount: fromCents(10000),
      paidAt: new Date("2026-07-05"),
      paidById: tenantA.user.id,
    },
  });

  await prisma.commissionEntry.create({
    data: {
      barbershopId: tenantA.shop.id,
      memberId: tenantA.member.id,
      comandaItemId: tenantA.comandaItem.id,
      competence: "2026-06",
      configSnapshot: { percentage: 50 },
      baseAmount: fromCents(10000),
      generatedAmount: fromCents(10000),
      releasedAmount: fromCents(10000),
      paidAmount: fromCents(10000),
      reversedAmount: 0,
      attributionVersion: 1,
      isCurrent: true,
    },
  });

  // Seed Tenant B with mismatch: paidAmount (80) != releasedAmount (100)
  await prisma.commissionPeriod.create({
    data: {
      id: "period-pre-b",
      barbershopId: tenantB.shop.id,
      memberId: tenantB.member.id,
      competence: "2026-06",
      status: "PAID",
      releasedAmount: fromCents(10000),
      paidAmount: fromCents(8000), // MISMATCH!
      paidAt: new Date("2026-07-05"),
      paidById: tenantB.user.id,
    },
  });

  let globalPreflightBlocked = false;
  try {
    await executeCutoverWorkflow(prisma, { isApply: true });
  } catch (err: any) {
    if (err.code === "GLOBAL_PREFLIGHT_BLOCKED") {
      globalPreflightBlocked = true;
      console.log("Global preflight blocked before mutation:", err.message);
    } else {
      throw err;
    }
  }
  if (!globalPreflightBlocked) throw new Error("Global preflight failed to abort on Tenant B mismatch!");

  // Prove Tenant A remains completely untouched in the real database
  const cyclesA = await prisma.commissionCycle.count({ where: { barbershopId: tenantA.shop.id } });
  const itemsA = await prisma.commissionPayableItem.count({ where: { barbershopId: tenantA.shop.id } });
  const payoutsA = await prisma.commissionPayout.count({ where: { barbershopId: tenantA.shop.id } });
  const adjustmentsA = await prisma.commissionCycleAdjustment.count({ where: { barbershopId: tenantA.shop.id } });

  console.log(`Tenant A canonical row counts after global abort: cycles=${cyclesA}, items=${itemsA}, payouts=${payoutsA}, adjustments=${adjustmentsA}`);
  if (cyclesA !== 0 || itemsA !== 0 || payoutsA !== 0 || adjustmentsA !== 0) {
    throw new Error("CRITICAL SAFETY VIOLATION: Tenant A was mutated despite Tenant B preflight failure!");
  }
  console.log("GLOBAL PREFLIGHT SAFETY: PASS (Tenant A completely untouched)");

  // Clean preflight test data
  await prisma.commissionEntry.deleteMany({ where: { barbershopId: { in: [tenantA.shop.id, tenantB.shop.id] } } });
  await prisma.commissionPeriod.deleteMany({ where: { barbershopId: { in: [tenantA.shop.id, tenantB.shop.id] } } });

  // 5. Tenant Transaction Atomicity Proof
  console.log("\n--- STEP 5: TENANT TRANSACTION ATOMICITY PROOF ---");
  const atomTenant = await createTenant("atom");

  // Create valid period 1
  const atomPeriod1 = await prisma.commissionPeriod.create({
    data: {
      barbershopId: atomTenant.shop.id,
      memberId: atomTenant.member.id,
      competence: "2026-05",
      status: "PAID",
      releasedAmount: fromCents(5000),
      paidAmount: fromCents(5000),
      paidAt: new Date("2026-06-05"),
      paidById: atomTenant.user.id,
    },
  });

  await prisma.commissionEntry.create({
    data: {
      barbershopId: atomTenant.shop.id,
      memberId: atomTenant.member.id,
      comandaItemId: atomTenant.comandaItem.id,
      competence: "2026-05",
      configSnapshot: { percentage: 50 },
      baseAmount: fromCents(5000),
      generatedAmount: fromCents(5000),
      releasedAmount: fromCents(5000),
      paidAmount: fromCents(5000),
      attributionVersion: 1,
      isCurrent: true,
    },
  });

  // Create period 2 that will fail mid-flight because entry sum doesn't match
  await prisma.commissionPeriod.create({
    data: {
      barbershopId: atomTenant.shop.id,
      memberId: atomTenant.member.id,
      competence: "2026-06",
      status: "PAID",
      releasedAmount: fromCents(8000),
      paidAmount: fromCents(8000),
      paidAt: new Date("2026-07-05"),
      paidById: atomTenant.user.id,
    },
  });
  // No entries for period 2 => will throw PAID_HISTORY_ENTRY_RECONCILIATION_MISMATCH mid-flight!

  let atomicityRolledBack = false;
  try {
    await prisma.$transaction(async (tx) => {
      await applyCutoverForTenant(tx, atomTenant.shop.id);
    });
  } catch (err: any) {
    if (err.code === "PAID_HISTORY_ENTRY_RECONCILIATION_MISMATCH") {
      atomicityRolledBack = true;
      console.log("Tenant cutover failed mid-flight as expected:", err.message);
    } else {
      throw err;
    }
  }
  if (!atomicityRolledBack) throw new Error("Expected mid-flight failure did not occur!");

  // Verify that period 1 mutations were completely rolled back in the real database
  const atomCycles = await prisma.commissionCycle.count({ where: { barbershopId: atomTenant.shop.id } });
  const atomItems = await prisma.commissionPayableItem.count({ where: { barbershopId: atomTenant.shop.id } });
  const atomPayouts = await prisma.commissionPayout.count({ where: { barbershopId: atomTenant.shop.id } });

  console.log(`Atomicity check: cycles=${atomCycles}, items=${atomItems}, payouts=${atomPayouts}`);
  if (atomCycles !== 0 || atomItems !== 0 || atomPayouts !== 0) {
    throw new Error("TRANSACTION ATOMICITY FAILED: Mid-flight failure left uncommitted artifacts!");
  }
  console.log("TENANT TRANSACTION ATOMICITY: PASS");

  // Clean atomicity test data
  await prisma.commissionEntry.deleteMany({ where: { barbershopId: atomTenant.shop.id } });
  await prisma.commissionPeriod.deleteMany({ where: { barbershopId: atomTenant.shop.id } });

  // 6. Historical Actor Provenance Proof
  console.log("\n--- STEP 6: HISTORICAL ACTOR PROVENANCE PROOF ---");
  const actorTenant = await createTenant("actor");

  // Missing paidById & closedById
  const actorPeriod = await prisma.commissionPeriod.create({
    data: {
      barbershopId: actorTenant.shop.id,
      memberId: actorTenant.member.id,
      competence: "2026-06",
      status: "PAID",
      releasedAmount: fromCents(5000),
      paidAmount: fromCents(5000),
      paidAt: new Date("2026-07-05"),
      paidById: null,
      closedById: null,
    },
  });

  const actorPreflight = await prisma.$transaction((tx) => runPreflight(tx, actorTenant.shop.id));
  const actorBlocker = actorPreflight.tenants[0].blockers.find((b) => b.includes("ACTOR_PROVENANCE_BLOCKER"));
  if (!actorBlocker) {
    throw new Error("Preflight failed to block period with missing actor provenance!");
  }
  console.log("HISTORICAL ACTOR PROVENANCE: PASS (Missing actor blocked with ACTOR_PROVENANCE_BLOCKER)");

  // Clean actor test data
  await prisma.commissionPeriod.deleteMany({ where: { barbershopId: actorTenant.shop.id } });

  // 7. Exact Scenarios Proof (Real DB)
  console.log("\n--- STEP 7: EXACT SCENARIOS PROOF (REAL DB) ---");
  const scenTenant = await createTenant("scen");
  const sShopId = scenTenant.shop.id;
  const sMemberId = scenTenant.member.id;
  const sUserId = scenTenant.user.id;

  // Scenario 1: Normal PAID 100
  const paidPeriod = await prisma.commissionPeriod.create({
    data: {
      id: "scen-period-paid",
      barbershopId: sShopId,
      memberId: sMemberId,
      competence: "2026-05",
      status: "PAID",
      releasedAmount: fromCents(10000),
      paidAmount: fromCents(10000),
      paidAt: new Date("2026-06-05"),
      paidById: sUserId,
    },
  });

  await prisma.commissionEntry.create({
    data: {
      id: "scen-entry-paid",
      barbershopId: sShopId,
      memberId: sMemberId,
      comandaItemId: scenTenant.comandaItem.id,
      competence: "2026-05",
      configSnapshot: { percentage: 50 },
      baseAmount: fromCents(20000),
      generatedAmount: fromCents(10000),
      releasedAmount: fromCents(10000),
      paidAmount: fromCents(10000),
      attributionVersion: 1,
      isCurrent: true,
    },
  });

  // Scenario 2: Partial Outstanding (released 100, paid 40 => remaining 60)
  const item2 = await prisma.comandaItem.create({
    data: {
      id: "item-scen-partial",
      comandaId: scenTenant.comanda.id,
      barbershopId: sShopId,
      executorId: sMemberId,
      type: ComandaItemType.SERVICE,
      description: "Partial Service",
      unitPrice: fromCents(10000),
      total: fromCents(10000),
      quantity: 1,
    },
  });

  await prisma.commissionEntry.create({
    data: {
      id: "scen-entry-partial",
      barbershopId: sShopId,
      memberId: sMemberId,
      comandaItemId: item2.id,
      competence: "2026-06",
      configSnapshot: { percentage: 50 },
      baseAmount: fromCents(20000),
      generatedAmount: fromCents(10000),
      releasedAmount: fromCents(10000),
      paidAmount: fromCents(4000),
      attributionVersion: 1,
      isCurrent: true,
    },
  });

  // Scenario 3: Post-Paid Refund (released 8, paid 16 => remaining 0, adjustment -8)
  const item3 = await prisma.comandaItem.create({
    data: {
      id: "item-scen-postpaid",
      comandaId: scenTenant.comanda.id,
      barbershopId: sShopId,
      executorId: sMemberId,
      type: ComandaItemType.SERVICE,
      description: "Refunded Service",
      unitPrice: fromCents(1600),
      total: fromCents(1600),
      quantity: 1,
    },
  });

  await prisma.commissionEntry.create({
    data: {
      id: "scen-entry-postpaid",
      barbershopId: sShopId,
      memberId: sMemberId,
      comandaItemId: item3.id,
      competence: "2026-06",
      configSnapshot: { percentage: 50 },
      baseAmount: fromCents(1600),
      generatedAmount: fromCents(800),
      releasedAmount: fromCents(800),
      paidAmount: fromCents(1600),
      attributionVersion: 1,
      isCurrent: true,
    },
  });

  // Scenario 4: Rollover Chain (Aug -8 -> Sep -8 -> Oct -8)
  // Aug adjustment
  await prisma.commissionAdjustment.create({
    data: {
      id: "adj-aug",
      barbershopId: sShopId,
      memberId: sMemberId,
      competence: "2026-08",
      type: "PAID_ADJUSTMENT",
      amount: fromCents(-800),
      description: "Rollover Aug",
      createdAt: new Date("2026-08-15"),
    },
  });

  // Sep adjustment chained from Aug
  await prisma.commissionAdjustment.create({
    data: {
      id: "adj-sep",
      barbershopId: sShopId,
      memberId: sMemberId,
      competence: "2026-09",
      type: "PAID_ADJUSTMENT",
      amount: fromCents(-800),
      description: "Rollover Sep",
      rolloverFromCompetence: "2026-08",
      createdAt: new Date("2026-09-15"),
    },
  });

  // Oct adjustment (terminal in chain) chained from Sep
  await prisma.commissionAdjustment.create({
    data: {
      id: "adj-oct",
      barbershopId: sShopId,
      memberId: sMemberId,
      competence: "2026-10",
      type: "PAID_ADJUSTMENT",
      amount: fromCents(-800),
      description: "Rollover Oct",
      rolloverFromCompetence: "2026-09",
      createdAt: new Date("2026-10-15"),
    },
  });

  // Scenario 5: Cleared Rollover (settled/cleared adjustment should not import opening balance)
  // (In legacy, a cleared rollover was either deleted or absorbed by a cycle. Here terminal unabsorbed is only Oct -8).

  // Execute first cutover apply
  console.log("\nExecuting First Apply on Scenarios...");
  const firstApply = await executeCutoverWorkflow(prisma, { isApply: true, targetBarbershopId: sShopId });
  if (firstApply.mode !== "APPLY" || firstApply.verify.status !== "VERIFIED") {
    throw new Error("First apply failed verification!");
  }
  console.log("First apply succeeded. Summary:", firstApply.summaries[0]);

  // Assert Real DB Economics
  const historicalCycle = await prisma.commissionCycle.findFirst({
    where: { barbershopId: sShopId, status: CommissionCycleStatus.PAID },
  });
  if (!historicalCycle) throw new Error("Historical PAID cycle was not created!");
  console.log("Historical PAID cycle:", {
    cycleNumber: historicalCycle.cycleNumber,
    gross: toCents(historicalCycle.grossCommission),
    payout: toCents(historicalCycle.finalPayoutAmount),
    remaining: toCents(historicalCycle.remainingBalance),
  });
  if (toCents(historicalCycle.grossCommission) !== 10000) throw new Error("Historical cycle gross must be 100.00");
  if (toCents(historicalCycle.finalPayoutAmount) !== 10000) throw new Error("Historical payout must be 100.00");
  if (toCents(historicalCycle.remainingBalance) !== 0) throw new Error("Historical remaining balance must be 0");

  const historicalPayableItems = await prisma.commissionPayableItem.findMany({
    where: { barbershopId: sShopId, cycleId: historicalCycle.id },
  });
  const historicalLedgerSum = historicalPayableItems.reduce((acc, i) => acc + toCents(i.amount), 0);
  console.log("Historical payable items sum:", historicalLedgerSum);
  if (historicalLedgerSum !== 10000) throw new Error("Historical ledger sum must equal 100.00");

  const historicalPayout = await prisma.commissionPayout.findFirst({
    where: { barbershopId: sShopId, cycleId: historicalCycle.id },
  });
  if (!historicalPayout || toCents(historicalPayout.amount) !== 10000) {
    throw new Error("Historical payout must exist and equal 100.00");
  }

  const finEntriesCount = await prisma.financialEntry.count({ where: { barbershopId: sShopId } });
  const cashMovementsCount = await prisma.cashMovement.count({ where: { barbershopId: sShopId } });
  console.log(`P&L contamination check: FinancialEntry=${finEntriesCount}, CashMovement=${cashMovementsCount}`);
  if (finEntriesCount !== 0 || cashMovementsCount !== 0) {
    throw new Error("CRITICAL ACCOUNTING VIOLATION: Historical cutover mutated FinancialEntry or CashMovement!");
  }

  // Current OPEN cycle economic assertions
  const openCycle = await prisma.commissionCycle.findFirst({
    where: { barbershopId: sShopId, status: CommissionCycleStatus.OPEN },
  });
  if (!openCycle) throw new Error("Current OPEN cycle was not created!");

  const openPayableItems = await prisma.commissionPayableItem.findMany({
    where: { barbershopId: sShopId, cycleId: openCycle.id },
  });
  console.log(`OPEN cycle payable items count: ${openPayableItems.length}`);
  // Item 2 partial: 60.00
  // Item 3 post-paid refund: remaining = max(0, 8-16) = 0, so not added as positive item
  const partialItem = openPayableItems.find((i) => i.entryId === "scen-entry-partial");
  if (!partialItem || toCents(partialItem.amount) !== 6000) {
    throw new Error(`Partial outstanding payable item expected 60.00, got ${partialItem ? toCents(partialItem.amount) : "none"}`);
  }

  // Rollover adjustments on OPEN cycle
  const openAdjustments = await prisma.commissionCycleAdjustment.findMany({
    where: { barbershopId: sShopId, cycleId: openCycle.id },
  });
  console.log(`OPEN cycle adjustments count: ${openAdjustments.length}`);
  // Expecting exactly 1 terminal adjustment from rollover chain (Oct -8.00)
  if (openAdjustments.length !== 1) {
    throw new Error(`Expected exactly 1 terminal rollover adjustment, got ${openAdjustments.length}`);
  }
  const terminalAdj = openAdjustments[0];
  if (toCents(terminalAdj.amount) !== 800 || terminalAdj.type !== CommissionCycleAdjustmentType.DEBIT) {
    throw new Error(`Expected terminal adjustment DEBIT 8.00, got ${terminalAdj.type} ${toCents(terminalAdj.amount)}`);
  }

  // Open cycle remaining balance: 60 (gross) - 8 (debit) = 52.00
  const expectedRemainingCents = 6000 - 800; // 5200 cents
  console.log("OPEN cycle balance:", {
    gross: toCents(openCycle.grossCommission),
    adj: toCents(openCycle.adjustmentsTotal),
    remaining: toCents(openCycle.remainingBalance),
    expectedRemainingCents,
  });
  if (toCents(openCycle.remainingBalance) !== expectedRemainingCents) {
    throw new Error(`OPEN cycle remaining balance expected ${expectedRemainingCents}, got ${toCents(openCycle.remainingBalance)}`);
  }

  // 8. Idempotency Proof (Second Apply)
  console.log("\n--- STEP 8: IDEMPOTENCY PROOF (SECOND APPLY) ---");
  const countCyclesBefore = await prisma.commissionCycle.count({ where: { barbershopId: sShopId } });
  const countItemsBefore = await prisma.commissionPayableItem.count({ where: { barbershopId: sShopId } });
  const countPayoutsBefore = await prisma.commissionPayout.count({ where: { barbershopId: sShopId } });
  const countAdjBefore = await prisma.commissionCycleAdjustment.count({ where: { barbershopId: sShopId } });

  const secondApply = await executeCutoverWorkflow(prisma, { isApply: true, targetBarbershopId: sShopId });
  if (secondApply.mode !== "APPLY") throw new Error("Second apply mode failed!");

  const countCyclesAfter = await prisma.commissionCycle.count({ where: { barbershopId: sShopId } });
  const countItemsAfter = await prisma.commissionPayableItem.count({ where: { barbershopId: sShopId } });
  const countPayoutsAfter = await prisma.commissionPayout.count({ where: { barbershopId: sShopId } });
  const countAdjAfter = await prisma.commissionCycleAdjustment.count({ where: { barbershopId: sShopId } });

  const deltaCycles = countCyclesAfter - countCyclesBefore;
  const deltaItems = countItemsAfter - countItemsBefore;
  const deltaPayouts = countPayoutsAfter - countPayoutsBefore;
  const deltaAdj = countAdjAfter - countAdjBefore;

  console.log(`Second Apply Delta: cycles=${deltaCycles}, items=${deltaItems}, payouts=${deltaPayouts}, adjustments=${deltaAdj}`);
  if (deltaCycles !== 0 || deltaItems !== 0 || deltaPayouts !== 0 || deltaAdj !== 0) {
    throw new Error("IDEMPOTENCY VIOLATION: Second apply created new database rows!");
  }

  const openCycleSecond = await prisma.commissionCycle.findUnique({ where: { id: openCycle.id } });
  if (toCents(openCycleSecond!.remainingBalance) !== expectedRemainingCents) {
    throw new Error("IDEMPOTENCY VIOLATION: Second apply caused economic delta in cycle balance!");
  }
  console.log("IDEMPOTENCY PROOF: PASS (0 new rows, 0 economic delta)");

  // 9. Verify Mode & Synthetic Corruption Detection
  console.log("\n--- STEP 9: VERIFY MODE & CORRUPTION DETECTION ---");
  const verifyClean = await prisma.$transaction((tx) => verifyTenantCutover(tx, sShopId));
  if (verifyClean.status !== "VERIFIED") throw new Error("Clean verification failed!");
  console.log("Verify clean check: VERIFIED");

  // Introduce synthetic corruption: mutate cycle cache
  console.log("Introducing synthetic corruption in cycle cache...");
  await prisma.commissionCycle.update({
    where: { id: openCycle.id },
    data: { remainingBalance: fromCents(999900) }, // corrupt balance
  });

  const verifyCorrupt = await prisma.$transaction((tx) => verifyTenantCutover(tx, sShopId));
  console.log("Corrupted verification status:", verifyCorrupt.status);
  if (verifyCorrupt.status !== "FAILED") {
    throw new Error("Verify tool failed to detect corrupted cycle cache!");
  }
  console.log("Corruption detected successfully:", verifyCorrupt.failures);

  // Restore corruption
  await prisma.commissionCycle.update({
    where: { id: openCycle.id },
    data: { remainingBalance: fromCents(expectedRemainingCents) },
  });

  const verifyRestored = await prisma.$transaction((tx) => verifyTenantCutover(tx, sShopId));
  if (verifyRestored.status !== "VERIFIED") throw new Error("Restored verification failed!");
  console.log("Verify restored check: VERIFIED");

  // 10. Mixed Canonical Data Blocker Proof
  console.log("\n--- STEP 10: MIXED CANONICAL DATA BLOCKER PROOF ---");
  const mixedTenant = await createTenant("mixed");

  const mixedCycle = await prisma.commissionCycle.create({
    data: {
      barbershopId: mixedTenant.shop.id,
      memberId: mixedTenant.member.id,
      cycleNumber: 1,
      status: CommissionCycleStatus.OPEN,
      grossCommission: 0,
      adjustmentsTotal: 0,
      advancesTotal: 0,
      remainingBalance: 0,
    },
  });

  const mixedEntry = await prisma.commissionEntry.create({
    data: {
      barbershopId: mixedTenant.shop.id,
      memberId: mixedTenant.member.id,
      comandaItemId: mixedTenant.comandaItem.id,
      competence: "2026-06",
      configSnapshot: { percentage: 50 },
      baseAmount: fromCents(10000),
      generatedAmount: fromCents(5000),
      releasedAmount: fromCents(5000),
      paidAmount: 0,
      reversedAmount: 0,
      attributionVersion: 1,
      isCurrent: true,
    },
  });

  // Insert non-backfill payable item (e.g. EVENT_EMISSION)
  await prisma.commissionPayableItem.create({
    data: {
      barbershopId: mixedTenant.shop.id,
      cycleId: mixedCycle.id,
      entryId: mixedEntry.id,
      memberId: mixedTenant.member.id,
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      type: CommissionPayableType.RELEASE,
      amount: fromCents(5000),
      eventKey: "event-mixed-test",
    },
  });

  const mixedPreflight = await prisma.$transaction((tx) => runPreflight(tx, mixedTenant.shop.id));
  const hasMixedBlocker = mixedPreflight.tenants[0].blockers.includes("MIXED_CANONICAL_DATA_BLOCKER");
  if (!hasMixedBlocker) {
    throw new Error("Preflight failed to raise MIXED_CANONICAL_DATA_BLOCKER on non-backfill canonical data!");
  }
  console.log("MIXED CANONICAL DATA BLOCKER: PASS");

  console.log("\n==================================================");
  console.log(" ALL REAL POSTGRESQL C11.2a PROOFS PASSED CLEANLY ");
  console.log("==================================================");
}

if (require.main === module) {
  runRealPostgresProof()
    .catch((err) => {
      console.error("Proof runner failed with error:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
