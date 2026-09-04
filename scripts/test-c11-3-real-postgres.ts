/* eslint-disable @typescript-eslint/no-explicit-any */
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
} from "@prisma/client";
import {
  correctCommissionExecutor,
  getCurrentCommissionEntry,
  generateCommissionsForComanda,
  resolveHistoricalCommissionConfig,
  syncOpenCommissionPeriod,
} from "@/lib/operations/commissions";

export async function runRealPostgresProofC11_3() {
  console.log("==========================================================");
  console.log(" TEM BARBER — C11.3 REAL POSTGRESQL AUTHORITY & CORRECTION PROOF");
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

  // 2. Clean previous test data
  async function cleanAllData() {
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
    await prisma.service.deleteMany();
    await prisma.category.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.comandaItem.deleteMany();
    await prisma.comanda.deleteMany();
    await prisma.barbershopMember.deleteMany();
    await prisma.user.deleteMany();
    await prisma.barbershop.deleteMany();
  }

  await cleanAllData();
  console.log("DB cleaned.");

  // 3. Helper to create tenant with users and members
  const barbershopId = "shop-c11-proof";
  await prisma.barbershop.create({
    data: {
      id: barbershopId,
      name: "C11 Proof Shop",
      slug: `proof-shop-${Date.now()}`,
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
      id: "usr-owner",
      name: "Owner User",
      email: "owner@test.com",
      phone: "11999990001",
      role: UserRole.USER,
    },
  });

  const barberOldUser = await prisma.user.create({
    data: {
      id: "usr-old",
      name: "Old Barber",
      email: "old@test.com",
      phone: "11999990002",
      role: UserRole.USER,
    },
  });

  const barberNewUser = await prisma.user.create({
    data: {
      id: "usr-new",
      name: "New Barber",
      email: "new@test.com",
      phone: "11999990003",
      role: UserRole.USER,
    },
  });

  const oldMember = await prisma.barbershopMember.create({
    data: {
      id: "mbr-old",
      barbershopId,
      userId: barberOldUser.id,
      role: "BARBER",
      isActive: true,
    },
  });

  const newMember = await prisma.barbershopMember.create({
    data: {
      id: "mbr-new",
      barbershopId,
      userId: barberNewUser.id,
      role: "BARBER",
      isActive: true,
    },
  });

  const category = await prisma.category.create({
    data: {
      id: "cat-corte",
      barbershopId,
      name: "Cabelo",
      slug: "cabelo",
    },
  });

  const service = await prisma.service.create({
    data: {
      id: "srv-corte",
      barbershopId,
      categoryId: category.id,
      name: "Corte Tradicional",
      price: new Prisma.Decimal("100.00"),
      durationMin: 30,
    },
  });

  // Historical commission rule for new member created in July (provenance)
  const historicalDate = new Date("2026-07-01T10:00:00Z");
  await prisma.$executeRaw`
    INSERT INTO commission_configs (id, barbershop_id, scope_key, type, value, active, created_at, updated_at)
    VALUES ('cfg-new-member', ${barbershopId}, ${'member:' + newMember.id + ':default'}, 'PERCENTAGE', 40.00, true, ${historicalDate}, ${historicalDate});
  `;

  console.log("Tenant and base data created.");

  // ----------------------------------------------------
  // TEST A: Zero Live Legacy Runtime Writes
  // ----------------------------------------------------
  console.log("\n--- TEST A: Zero Live Legacy Writers ---");
  const syncResult = await syncOpenCommissionPeriod(prisma, barbershopId, oldMember.id, "2026-08");
  if (syncResult !== null) throw new Error("syncOpenCommissionPeriod must return null");

  const legacyPeriods = await prisma.commissionPeriod.count();
  const legacyAdjustments = await prisma.commissionAdjustment.count();
  if (legacyPeriods !== 0 || legacyAdjustments !== 0) {
    throw new Error(`Legacy tables must have 0 rows, got periods=${legacyPeriods}, adjs=${legacyAdjustments}`);
  }
  console.log("PASS: Legacy writers are 100% no-ops, zero rows created.");

  // ----------------------------------------------------
  // TEST B: Multi-Version Reader Safety & Direct Mutation Guard
  // ----------------------------------------------------
  console.log("\n--- TEST B: Direct Mutation Guard & Multi-Version Readers ---");
  const comanda = await prisma.comanda.create({
    data: {
      id: "cmd-proof-1",
      barbershopId,
      status: ComandaStatus.OPEN,
      total: new Prisma.Decimal("100.00"),
      commissionRevision: 1,
      customerName: "Cliente Teste",
    },
  });

  const comandaItem = await prisma.comandaItem.create({
    data: {
      id: "item-proof-1",
      barbershopId,
      comandaId: comanda.id,
      serviceId: service.id,
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-08-01T12:00:00Z"),
      total: new Prisma.Decimal("100.00"),
      unitPrice: new Prisma.Decimal("100.00"),
      quantity: 1,
      executorId: oldMember.id,
      description: "Corte Tradicional",
    },
  });

  // Create initial v1 commission entry
  const entryV1 = await prisma.commissionEntry.create({
    data: {
      id: "entry-proof-v1",
      barbershopId,
      comandaItemId: comandaItem.id,
      memberId: oldMember.id,
      type: "SERVICE",
      competence: "2026-08",
      baseAmount: new Prisma.Decimal("100.00"),
      generatedAmount: new Prisma.Decimal("50.00"),
      releasedAmount: new Prisma.Decimal("0.00"),
      paidAmount: new Prisma.Decimal("0.00"),
      reversedAmount: new Prisma.Decimal("0.00"),
      status: CommissionEntryStatus.GENERATED,
      attributionVersion: 1,
      isCurrent: true,
      configSnapshot: { type: "PERCENTAGE", value: 50 },
      createdAt: new Date("2026-08-01T12:00:00Z"),
    },
  });

  // Verify getCurrentCommissionEntry
  const currentRead = await getCurrentCommissionEntry(prisma, {
    barbershopId,
    comandaItemId: comandaItem.id,
  });
  if (!currentRead || currentRead.id !== entryV1.id) {
    throw new Error("getCurrentCommissionEntry failed to find active v1 entry");
  }
  console.log("PASS: Multi-version reader successfully resolved current entry v1.");

  // Test direct mutation detection in recalculate/generate
  await prisma.comandaItem.update({
    where: { id: comandaItem.id },
    data: { executorId: newMember.id },
  });

  let guardCaught = false;
  try {
    await generateCommissionsForComanda(prisma, barbershopId, comanda.id);
  } catch (err: any) {
    if (err.code === "EXECUTOR_CORRECTION_REQUIRED" && err.status === 409) {
      guardCaught = true;
    } else {
      throw err;
    }
  }
  if (!guardCaught) throw new Error("Expected EXECUTOR_CORRECTION_REQUIRED (409) on direct executor change");
  console.log("PASS: Direct executor change rejected with EXECUTOR_CORRECTION_REQUIRED (409).");

  // Revert comandaItem executor back to oldMember for canonical correction
  await prisma.comandaItem.update({
    where: { id: comandaItem.id },
    data: { executorId: oldMember.id },
  });

  // ----------------------------------------------------
  // TEST C: Historical Rule Provenance Gate
  // ----------------------------------------------------
  console.log("\n--- TEST C: Historical Rule Provenance Gate ---");
  // Test rule created in the future (after attributionTime)
  const futureDate = new Date("2026-08-15T00:00:00Z");
  await prisma.$executeRaw`
    INSERT INTO commission_configs (id, barbershop_id, scope_key, type, value, active, created_at, updated_at)
    VALUES ('cfg-future', ${barbershopId}, 'member:mbr-future:default', 'PERCENTAGE', 40.00, true, ${futureDate}, ${futureDate});
  `;

  let unprovableCaught = false;
  try {
    await resolveHistoricalCommissionConfig(prisma, {
      barbershopId,
      memberId: "mbr-future",
      serviceId: service.id,
      itemType: ComandaItemType.SERVICE,
      attributionTime: new Date("2026-08-01T12:00:00Z"),
    });
  } catch (err: any) {
    if (err.code === "HISTORICAL_COMMISSION_RULE_UNPROVABLE" && err.status === 422) {
      unprovableCaught = true;
    }
  }
  if (!unprovableCaught) throw new Error("Expected HISTORICAL_COMMISSION_RULE_UNPROVABLE for future rule");
  console.log("PASS: Future rule properly rejected as UNPROVABLE (422).");

  // ----------------------------------------------------
  // TEST D: Full Versioned Executor Correction Execution
  // ----------------------------------------------------
  console.log("\n--- TEST D: Versioned Executor Correction Execution ---");
  // Create open cycle for both members
  const cycleOld = await prisma.commissionCycle.create({
    data: {
      id: "cycle-old-open",
      barbershopId,
      memberId: oldMember.id,
      cycleNumber: 1,
      status: CommissionCycleStatus.OPEN,
      grossCommission: new Prisma.Decimal("50.00"),
      remainingBalance: new Prisma.Decimal("50.00"),
      openedAt: new Date("2026-08-01T00:00:00Z"),
    },
  });

  const cycleNew = await prisma.commissionCycle.create({
    data: {
      id: "cycle-new-open",
      barbershopId,
      memberId: newMember.id,
      cycleNumber: 1,
      status: CommissionCycleStatus.OPEN,
      grossCommission: new Prisma.Decimal("0.00"),
      remainingBalance: new Prisma.Decimal("0.00"),
      openedAt: new Date("2026-08-01T00:00:00Z"),
    },
  });

  // Create confirmed payment of 100.00 for comanda
  await prisma.payment.create({
    data: {
      id: "pay-proof-1",
      barbershopId,
      comandaId: comanda.id,
      method: "PIX",
      amount: new Prisma.Decimal("100.00"),
      status: "CONFIRMED",
    },
  });

  // Give old entry 50.00 released
  await prisma.commissionEntry.update({
    where: { id: entryV1.id },
    data: {
      releasedAmount: new Prisma.Decimal("50.00"),
      status: CommissionEntryStatus.RELEASED,
    },
  });

  // Create initial release payable item
  await prisma.commissionPayableItem.create({
    data: {
      id: "pi-old-rel",
      barbershopId,
      cycleId: cycleOld.id,
      memberId: oldMember.id,
      entryId: entryV1.id,
      sourceKind: CommissionPayableSourceKind.ITEM_COMPLETION,
      eventKey: "rel:old-v1:init",
      type: CommissionPayableType.RELEASE,
      amount: new Prisma.Decimal("50.00"),
    },
  });

  // Call correctCommissionExecutor
  const correctionResult = await correctCommissionExecutor({
    barbershopId,
    comandaItemId: comandaItem.id,
    newExecutorMemberId: newMember.id,
    reason: "Administrative reattribution to correct serving barber",
    idempotencyKey: "idem-real-pg-1",
    userId: ownerUser.id,
    role: "OWNER",
  });

  console.log("Correction Result:", correctionResult);

  if (!correctionResult.success) throw new Error("Correction execution failed");
  if (correctionResult.attributionVersion !== 2) throw new Error("Expected attributionVersion 2");
  if (correctionResult.oldReleasedAmount !== "50.00") throw new Error("Expected oldReleasedAmount 50.00");
  if (correctionResult.newReleasedAmount !== "40.00") throw new Error("Expected newReleasedAmount 40.00 (40%)");
  if (correctionResult.reversalAmount !== "50.00") throw new Error("Expected reversalAmount 50.00");

  // Verify PostgreSQL physical state
  const oldEntryAfter = await prisma.commissionEntry.findUniqueOrThrow({ where: { id: entryV1.id } });
  if (oldEntryAfter.isCurrent !== false) throw new Error("Old entry must have isCurrent = false");

  const newEntryAfter = await prisma.commissionEntry.findUniqueOrThrow({ where: { id: correctionResult.newEntryId } });
  if (newEntryAfter.isCurrent !== true) throw new Error("New entry must have isCurrent = true");
  if (newEntryAfter.attributionVersion !== 2) throw new Error("New entry must have attributionVersion = 2");
  if (newEntryAfter.supersedesEntryId !== entryV1.id) throw new Error("New entry supersedesEntryId must point to v1");

  // Verify partial index enforcement: Attempting to set oldEntry.isCurrent = true MUST fail in Postgres
  let partialViolationCaught = false;
  try {
    await prisma.commissionEntry.update({
      where: { id: entryV1.id },
      data: { isCurrent: true },
    });
  } catch (err: any) {
    if (err.code === "P2002") {
      partialViolationCaught = true;
    }
  }
  if (!partialViolationCaught) throw new Error("PostgreSQL partial index did NOT reject second current entry!");
  console.log("PASS: PostgreSQL partial unique index enforced: 2 current entries physically rejected.");

  // Verify comanda item executorId updated
  const updatedItem = await prisma.comandaItem.findUniqueOrThrow({ where: { id: comandaItem.id } });
  if (updatedItem.executorId !== newMember.id) throw new Error("Comanda item executorId was not updated");

  // Verify comanda commissionRevision incremented
  const updatedComanda = await prisma.comanda.findUniqueOrThrow({ where: { id: comanda.id } });
  if (updatedComanda.commissionRevision !== 2) throw new Error("Comanda commissionRevision was not incremented");

  // Verify economic ledger items created
  const reversalPayable = await prisma.commissionPayableItem.findFirst({
    where: {
      barbershopId,
      cycleId: cycleOld.id,
      memberId: oldMember.id,
      type: CommissionPayableType.REVERSAL,
    },
  });
  if (!reversalPayable || Number(reversalPayable.amount) !== 50) {
    throw new Error(`Reversal payable item missing or incorrect amount: ${reversalPayable?.amount}`);
  }

  const releaseNewPayable = await prisma.commissionPayableItem.findFirst({
    where: {
      barbershopId,
      cycleId: cycleNew.id,
      memberId: newMember.id,
      type: CommissionPayableType.RELEASE,
    },
  });
  if (!releaseNewPayable || Number(releaseNewPayable.amount) !== 40) {
    throw new Error(`New release payable item missing or incorrect amount: ${releaseNewPayable?.amount}`);
  }

  // Verify audit row
  const auditRow = await prisma.commissionExecutorCorrectionAudit.findUnique({
    where: {
      barbershopId_idempotencyKey: {
        barbershopId,
        idempotencyKey: "idem-real-pg-1",
      },
    },
  });
  if (!auditRow) throw new Error("Audit log row was not created");
  if (auditRow.oldMemberId !== oldMember.id || auditRow.newMemberId !== newMember.id) {
    throw new Error("Audit row member IDs incorrect");
  }
  console.log("PASS: Full versioned correction executed and verified on real PostgreSQL 16.");

  // ----------------------------------------------------
  // TEST E: Idempotency Replay & Conflict
  // ----------------------------------------------------
  console.log("\n--- TEST E: Idempotency Replay & Conflict ---");
  const replayResult = await correctCommissionExecutor({
    barbershopId,
    comandaItemId: comandaItem.id,
    newExecutorMemberId: newMember.id,
    reason: "Administrative reattribution to correct serving barber",
    idempotencyKey: "idem-real-pg-1",
    userId: ownerUser.id,
    role: "OWNER",
  });
  if (!replayResult.isIdempotentReplay) throw new Error("Expected isIdempotentReplay: true");
  if (replayResult.auditId !== auditRow.id) throw new Error("Replay returned different auditId");
  console.log("PASS: Idempotent replay returned cached result.");

  let conflictCaught = false;
  try {
    await correctCommissionExecutor({
      barbershopId,
      comandaItemId: comandaItem.id,
      newExecutorMemberId: newMember.id,
      reason: "DIFFERENT REASON FOR IDEMPOTENCY KEY CONFLICT",
      idempotencyKey: "idem-real-pg-1",
      userId: ownerUser.id,
      role: "OWNER",
    });
  } catch (err: any) {
    if (err.code === "IDEMPOTENCY_CONFLICT" && err.status === 409) {
      conflictCaught = true;
    }
  }
  if (!conflictCaught) throw new Error("Expected IDEMPOTENCY_CONFLICT (409) for conflicting payload");
  console.log("PASS: Conflicting payload rejected with IDEMPOTENCY_CONFLICT (409).");

  // ----------------------------------------------------
  // TEST F: Historical Cycle Immutability Proof
  // ----------------------------------------------------
  console.log("\n--- TEST F: Historical Cycle Immutability ---");
  // Verify that if old member was paid in a CLOSED cycle, that closed cycle is NEVER modified
  const closedCycle = await prisma.commissionCycle.create({
    data: {
      id: "cycle-old-closed",
      barbershopId,
      memberId: oldMember.id,
      cycleNumber: 2,
      status: CommissionCycleStatus.PAID,
      grossCommission: new Prisma.Decimal("100.00"),
      remainingBalance: new Prisma.Decimal("0.00"),
      paidAt: new Date("2026-07-16T10:00:00Z"),
      openedAt: new Date("2026-07-01T00:00:00Z"),
      closedAt: new Date("2026-07-15T23:59:59Z"),
    },
  });

  const closedCycleBefore = await prisma.commissionCycle.findUniqueOrThrow({ where: { id: closedCycle.id } });

  // Create another comanda item that had release in closedCycle
  const comanda2 = await prisma.comanda.create({
    data: {
      id: "cmd-proof-2",
      barbershopId,
      status: ComandaStatus.CLOSED,
      total: new Prisma.Decimal("100.00"),
      commissionRevision: 1,
      customerName: "Cliente Teste 2",
    },
  });

  const item2 = await prisma.comandaItem.create({
    data: {
      id: "item-proof-2",
      barbershopId,
      comandaId: comanda2.id,
      serviceId: service.id,
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-07-05T12:00:00Z"),
      total: new Prisma.Decimal("100.00"),
      unitPrice: new Prisma.Decimal("100.00"),
      quantity: 1,
      executorId: oldMember.id,
      description: "Corte Tradicional",
    },
  });

  const entry2V1 = await prisma.commissionEntry.create({
    data: {
      id: "entry-proof-2-v1",
      barbershopId,
      comandaItemId: item2.id,
      memberId: oldMember.id,
      type: "SERVICE",
      competence: "2026-07",
      baseAmount: new Prisma.Decimal("100.00"),
      generatedAmount: new Prisma.Decimal("50.00"),
      releasedAmount: new Prisma.Decimal("50.00"),
      paidAmount: new Prisma.Decimal("50.00"),
      reversedAmount: new Prisma.Decimal("0.00"),
      status: CommissionEntryStatus.PAID,
      attributionVersion: 1,
      isCurrent: true,
      configSnapshot: { type: "PERCENTAGE", value: 50 },
      createdAt: new Date("2026-07-05T12:00:00Z"),
    },
  });

  await prisma.payment.create({
    data: {
      id: "pay-proof-2",
      barbershopId,
      comandaId: comanda2.id,
      method: "PIX",
      amount: new Prisma.Decimal("100.00"),
      status: "CONFIRMED",
    },
  });

  await prisma.commissionPayableItem.create({
    data: {
      id: "pi-entry2-closed",
      barbershopId,
      cycleId: closedCycle.id,
      memberId: oldMember.id,
      entryId: entry2V1.id,
      sourceKind: CommissionPayableSourceKind.ITEM_COMPLETION,
      eventKey: "rel:entry2:init",
      type: CommissionPayableType.RELEASE,
      amount: new Prisma.Decimal("50.00"),
    },
  });

  // Now execute correction on item2
  const correction2 = await correctCommissionExecutor({
    barbershopId,
    comandaItemId: item2.id,
    newExecutorMemberId: newMember.id,
    reason: "Historical correction of already paid commission in closed cycle",
    idempotencyKey: "idem-real-pg-closed-cycle",
    userId: ownerUser.id,
    role: "OWNER",
  });

  if (!correction2.success) throw new Error("Correction 2 failed");

  // Verify closed cycle row was NOT mutated
  const closedCycleAfter = await prisma.commissionCycle.findUniqueOrThrow({ where: { id: closedCycle.id } });
  if (
    closedCycleAfter.status !== closedCycleBefore.status ||
    closedCycleAfter.grossCommission.toString() !== closedCycleBefore.grossCommission.toString() ||
    closedCycleAfter.remainingBalance.toString() !== closedCycleBefore.remainingBalance.toString()
  ) {
    throw new Error("CRITICAL: Historical CLOSED cycle was mutated!");
  }

  // Verify DEBIT adjustment was created in CURRENT OPEN cycle
  const companionDebit = await prisma.commissionCycleAdjustment.findFirst({
    where: {
      barbershopId,
      cycleId: cycleOld.id,
      type: CommissionCycleAdjustmentType.DEBIT,
      sourceEntryId: entry2V1.id,
    },
  });
  if (!companionDebit || Number(companionDebit.amount) !== 50) {
    throw new Error("Companion DEBIT adjustment in open cycle missing or incorrect");
  }

  console.log("PASS: Historical PAID cycle was 100% IMMUTABLE; clawback was routed to current open cycle via companion DEBIT adjustment.");

  console.log("\n==========================================================");
  console.log(" ALL C11.3 REAL POSTGRESQL PROOFS PASSED WITH ZERO DEFECTS");
  console.log("==========================================================");
}

// Self-run when executed directly
if (require.main === module || process.argv[1]?.includes("test-c11-3-real-postgres")) {
  runRealPostgresProofC11_3()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("PROOF FAILED:", err);
      process.exit(1);
    });
}
