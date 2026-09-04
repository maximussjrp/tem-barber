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
  getAuthoritativeCycleBalance,
  reverseCommissionEntry,
} from "@/lib/operations/commissions";
import { toCents, fromCents } from "@/lib/operations/money";

export async function runRealPostgresProofC11_3a() {
  console.log("==========================================================");
  console.log(" TEM BARBER — C11.3a REAL POSTGRESQL PROOF (B, C, D, F, G)");
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

  // 2. Clean database cleanly
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
  console.log("Database reset complete.");

  // Base setup
  const barbershopId = "shop-c11-3a-proof";
  await prisma.barbershop.create({
    data: {
      id: barbershopId,
      name: "C11.3a Proof Shop",
      slug: `c11-3a-shop-${Date.now()}`,
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
      id: "usr-3a-owner",
      name: "Owner 3a",
      email: "owner3a@test.com",
      phone: "11999990001",
      role: UserRole.USER,
    },
  });

  const oldUser = await prisma.user.create({
    data: {
      id: "usr-3a-old",
      name: "Old Barber",
      email: "old3a@test.com",
      phone: "11999990002",
      role: UserRole.USER,
    },
  });

  const newUser = await prisma.user.create({
    data: {
      id: "usr-3a-new",
      name: "New Barber",
      email: "new3a@test.com",
      phone: "11999990003",
      role: UserRole.USER,
    },
  });

  const oldMember = await prisma.barbershopMember.create({
    data: {
      id: "mbr-3a-old",
      barbershopId,
      userId: oldUser.id,
      role: "BARBER",
      isActive: true,
    },
  });

  const newMember = await prisma.barbershopMember.create({
    data: {
      id: "mbr-3a-new",
      barbershopId,
      userId: newUser.id,
      role: "BARBER",
      isActive: true,
    },
  });

  // Category and Service
  const category = await prisma.category.create({
    data: {
      id: "cat-3a-corte",
      barbershopId,
      name: "Cabelo",
      slug: "cat-corte",
    },
  });

  const service = await prisma.service.create({
    data: {
      id: "srv-3a-corte",
      barbershopId,
      categoryId: category.id,
      name: "Corte Tradicional",
      price: new Prisma.Decimal("100.00"),
      durationMin: 30,
    },
  });

  // Assign service to both members
  await prisma.barberService.createMany({
    data: [
      { barberId: oldMember.id, serviceId: service.id },
      { barberId: newMember.id, serviceId: service.id },
    ],
  });

  // Products
  await prisma.product.createMany({
    data: [
      { id: "prod-pomada-1", barbershopId, name: "Pomada Modeladora", salePrice: new Prisma.Decimal("100.00") },
      { id: "prod-gel-1", barbershopId, name: "Gel Fixador", salePrice: new Prisma.Decimal("100.00") },
      { id: "prod-late-1", barbershopId, name: "Shampoo Late", salePrice: new Prisma.Decimal("100.00") },
    ],
  });

  const attributionTime = new Date("2026-08-01T12:00:00Z");

  // =========================================================================
  // TEST B: OPEN CYCLE EXECUTOR REVERSAL MUST NOT DOUBLE-DEBIT
  // Old OPEN 40, new entitlement 50, fully paid customer => old -40, new +50, net +10
  // =========================================================================
  console.log("\n--- RUNNING TEST B: Open-cycle executor reversal must not double-debit ---");

  // Old member rule: 40%
  await prisma.commissionConfig.create({
    data: {
      id: "cfg-b-old-40",
      barbershopId,
      scopeKey: `member:${oldMember.id}:default`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("40.00"),
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    },
  });

  // New member rule: 50%
  await prisma.commissionConfig.create({
    data: {
      id: "cfg-b-new-50",
      barbershopId,
      scopeKey: `member:${newMember.id}:default`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("50.00"),
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    },
  });

  // Comanda with fully paid customer (100.00)
  const comandaB = await prisma.comanda.create({
    data: {
      id: "cmd-test-b",
      barbershopId,
      customerName: "Cliente Teste",
      total: new Prisma.Decimal("100.00"),
      status: ComandaStatus.CLOSED,
      commissionRevision: 1,
    },
  });

  const itemB = await prisma.comandaItem.create({
    data: {
      id: "item-test-b",
      comandaId: comandaB.id,
      barbershopId,
      description: "Item description",
      type: ComandaItemType.SERVICE,
      serviceId: service.id,
      unitPrice: new Prisma.Decimal("100.00"),
      total: new Prisma.Decimal("100.00"),
      quantity: 1,
      status: ComandaItemStatus.DONE,
      executorId: oldMember.id,
    },
  });

  await prisma.payment.create({
    data: {
      id: "pay-test-b",
      barbershopId,
      comandaId: comandaB.id,
      amount: new Prisma.Decimal("100.00"),
      method: "CREDIT",
      status: "CONFIRMED",
    },
  });

  // Old member open cycle
  const oldOpenCycleB = await prisma.commissionCycle.create({
    data: {
      id: "cycle-b-old-open",
      barbershopId,
      memberId: oldMember.id,
      cycleNumber: 1,
      status: CommissionCycleStatus.OPEN,
      openedAt: new Date("2026-08-01T00:00:00Z"),
      grossCommission: new Prisma.Decimal("40.00"),
      adjustmentsTotal: new Prisma.Decimal("0.00"),
      advancesTotal: new Prisma.Decimal("0.00"),
      remainingBalance: new Prisma.Decimal("40.00"),
    },
  });

  // Old commission entry (generated: 40, released: 40)
  const oldEntryB = await prisma.commissionEntry.create({
    data: {
      id: "entry-b-old-v1",
      barbershopId,
      memberId: oldMember.id,
      comandaItemId: itemB.id,
      baseAmount: new Prisma.Decimal("100.00"),
      generatedAmount: new Prisma.Decimal("40.00"),
      releasedAmount: new Prisma.Decimal("40.00"),
      paidAmount: new Prisma.Decimal("0.00"),
      reversedAmount: new Prisma.Decimal("0.00"),
      attributionVersion: 1,
      isCurrent: true,
      competence: "2026-08",
      type: "SERVICE",
      status: CommissionEntryStatus.RELEASED,
      createdAt: attributionTime,
      configSnapshot: { type: "PERCENTAGE", value: 40 },
    },
  });

  // Old release payable item
  await prisma.commissionPayableItem.create({
    data: {
      id: "pi-b-old-rel",
      barbershopId,
      cycleId: oldOpenCycleB.id,
      entryId: oldEntryB.id,
      memberId: oldMember.id,
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      type: CommissionPayableType.RELEASE,
      amount: new Prisma.Decimal("40.00"),
      isHistoricalCorrection: false,
      eventKey: `entry:${oldEntryB.id}:rel:1:target:4000`,
    },
  });

  // Execute correction to newMember
  const resB = await correctCommissionExecutor({
    barbershopId,
    comandaItemId: itemB.id,
    newExecutorMemberId: newMember.id,
    reason: "Reassigning fully paid service to new barber",
    idempotencyKey: "idem-proof-b-1",
    userId: ownerUser.id,
    role: "OWNER",
  });

  if (!resB.success || resB.reversalAmount !== "40.00" || resB.newReleasedAmount !== "50.00") {
    throw new Error(`Test B failed: unexpected res: ${JSON.stringify(resB)}`);
  }

  // Verify: Old cycle gross decremented from 40 to 0
  const updatedOldCycleB = await prisma.commissionCycle.findUniqueOrThrow({
    where: { id: oldOpenCycleB.id },
  });
  if (toCents(updatedOldCycleB.grossCommission) !== 0 || toCents(updatedOldCycleB.remainingBalance) !== 0) {
    throw new Error(`Test B failed: old cycle balance not 0: ${JSON.stringify(updatedOldCycleB)}`);
  }

  // Verify: ZERO companion CommissionCycleAdjustment created in old member's open cycle
  const oldCycleAdjustmentsCountB = await prisma.commissionCycleAdjustment.count({
    where: { cycleId: oldOpenCycleB.id },
  });
  if (oldCycleAdjustmentsCountB !== 0) {
    throw new Error(`Test B failed: routing adjustments created in OPEN cycle: ${oldCycleAdjustmentsCountB}`);
  }

  // Verify: Authoritative balance for old cycle is 0
  const authOldCycleB = await getAuthoritativeCycleBalance(prisma, oldOpenCycleB.id);
  if (authOldCycleB.grossCommissionCents !== 0 || authOldCycleB.economicPayableCents !== 0) {
    throw new Error(`Test B failed: old cycle authoritative balance not 0: ${JSON.stringify(authOldCycleB)}`);
  }

  // Verify: New member received 50.00 in their open cycle
  const newMemberCycleB = await prisma.commissionCycle.findFirst({
    where: { barbershopId, memberId: newMember.id, status: CommissionCycleStatus.OPEN },
  });
  if (!newMemberCycleB || toCents(newMemberCycleB.grossCommission) !== 5000 || toCents(newMemberCycleB.remainingBalance) !== 5000) {
    throw new Error(`Test B failed: new member cycle balance not 50.00: ${JSON.stringify(newMemberCycleB)}`);
  }

  // Verify: Net economic effect across tenant is exactly -40 + 50 = +10
  const netDeltaB = toCents(newMemberCycleB.remainingBalance) - 4000;
  if (netDeltaB !== 1000) {
    throw new Error(`Test B failed: net delta not +10.00: ${netDeltaB}`);
  }
  console.log("✓ TEST B PASSED: Old OPEN cycle payable 40 reversed to 0, no routing DEBIT, new +50, net P&L +10.");

  // =========================================================================
  // TEST C: HISTORICAL PAID CYCLE RECONCILIATION
  // PAID historical 40, correction to 50 => historical PAID stays 40, current routing old -40 exactly once, new +50, net +10
  // =========================================================================
  console.log("\n--- RUNNING TEST C: Historical PAID cycle isolation and routing ---");

  // Old & New members for Test C isolation
  const oldUserC = await prisma.user.create({
    data: { id: "usr-3a-old-c", name: "Old Barber C", email: "old3a-c@test.com", phone: "11999990012", role: UserRole.USER },
  });
  const newUserC = await prisma.user.create({
    data: { id: "usr-3a-new-c", name: "New Barber C", email: "new3a-c@test.com", phone: "11999990013", role: UserRole.USER },
  });
  const oldMemberC = await prisma.barbershopMember.create({
    data: { id: "mbr-3a-old-c", barbershopId, userId: oldUserC.id, role: "BARBER", isActive: true },
  });
  const newMemberC = await prisma.barbershopMember.create({
    data: { id: "mbr-3a-new-c", barbershopId, userId: newUserC.id, role: "BARBER", isActive: true },
  });
  await prisma.barberService.createMany({
    data: [
      { barberId: oldMemberC.id, serviceId: service.id },
      { barberId: newMemberC.id, serviceId: service.id },
    ],
  });

  // Commission configs for Test C
  await prisma.commissionConfig.create({
    data: {
      id: "cfg-c-old-40",
      barbershopId,
      scopeKey: `member:${oldMemberC.id}:default`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("40.00"),
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    },
  });
  await prisma.commissionConfig.create({
    data: {
      id: "cfg-c-new-50",
      barbershopId,
      scopeKey: `member:${newMemberC.id}:default`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("50.00"),
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    },
  });

  // Old member historical closed/paid cycle (July 2026)
  const historicalPaidCycleC = await prisma.commissionCycle.create({
    data: {
      id: "cycle-c-old-paid-historical",
      barbershopId,
      memberId: oldMemberC.id,
      cycleNumber: 1,
      status: CommissionCycleStatus.PAID,
      openedAt: new Date("2026-07-01T00:00:00Z"),
      closedAt: new Date("2026-07-31T23:59:59Z"),
      paidAt: new Date("2026-07-31T23:59:59Z"),
      grossCommission: new Prisma.Decimal("1000.00"),
      adjustmentsTotal: new Prisma.Decimal("0.00"),
      advancesTotal: new Prisma.Decimal("0.00"),
      finalPayoutAmount: new Prisma.Decimal("1000.00"),
      remainingBalance: new Prisma.Decimal("0.00"),
    },
  });

  // Old member current OPEN cycle (September 2026)
  const currentOpenCycleC = await prisma.commissionCycle.create({
    data: {
      id: "cycle-c-old-current-open",
      barbershopId,
      memberId: oldMemberC.id,
      cycleNumber: 2,
      status: CommissionCycleStatus.OPEN,
      openedAt: new Date("2026-09-01T00:00:00Z"),
      grossCommission: new Prisma.Decimal("100.00"),
      adjustmentsTotal: new Prisma.Decimal("0.00"),
      advancesTotal: new Prisma.Decimal("0.00"),
      remainingBalance: new Prisma.Decimal("100.00"),
    },
  });

  const priorComandaC = await prisma.comanda.create({
    data: {
      id: "cmd-test-c-prior",
      barbershopId,
      customerName: "Cliente Previo",
      total: new Prisma.Decimal("200.00"),
      status: ComandaStatus.CLOSED,
      commissionRevision: 1,
    },
  });

  const priorItemC = await prisma.comandaItem.create({
    data: {
      id: "item-test-c-prior",
      comandaId: priorComandaC.id,
      barbershopId,
      description: "Servico anterior",
      type: ComandaItemType.SERVICE,
      serviceId: service.id,
      unitPrice: new Prisma.Decimal("200.00"),
      total: new Prisma.Decimal("200.00"),
      quantity: 1,
      status: ComandaItemStatus.DONE,
      executorId: oldMemberC.id,
    },
  });

  const priorEntryC = await prisma.commissionEntry.create({
    data: {
      id: "entry-c-prior-100",
      barbershopId,
      memberId: oldMemberC.id,
      comandaItemId: priorItemC.id,
      baseAmount: new Prisma.Decimal("200.00"),
      generatedAmount: new Prisma.Decimal("100.00"),
      releasedAmount: new Prisma.Decimal("100.00"),
      paidAmount: new Prisma.Decimal("0.00"),
      reversedAmount: new Prisma.Decimal("0.00"),
      attributionVersion: 1,
      isCurrent: true,
      competence: "2026-09",
      type: "SERVICE",
      status: CommissionEntryStatus.RELEASED,
      createdAt: new Date("2026-09-01T12:00:00Z"),
      configSnapshot: { type: "PERCENTAGE", value: 50 },
    },
  });

  // Authoritative release item of 100 in current open cycle
  await prisma.commissionPayableItem.create({
    data: {
      id: "pi-c-initial-rel-100",
      barbershopId,
      cycleId: currentOpenCycleC.id,
      entryId: priorEntryC.id,
      memberId: oldMemberC.id,
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      type: CommissionPayableType.RELEASE,
      amount: new Prisma.Decimal("100.00"),
      isHistoricalCorrection: false,
      eventKey: `test:c:open:100`,
    },
  });

  const comandaC = await prisma.comanda.create({
    data: {
      id: "cmd-test-c",
      barbershopId,
      customerName: "Cliente Teste",
      total: new Prisma.Decimal("100.00"),
      status: ComandaStatus.CLOSED,
      commissionRevision: 1,
    },
  });

  const itemC = await prisma.comandaItem.create({
    data: {
      id: "item-test-c",
      comandaId: comandaC.id,
      barbershopId,
      description: "Item description",
      type: ComandaItemType.SERVICE,
      serviceId: service.id,
      unitPrice: new Prisma.Decimal("100.00"),
      total: new Prisma.Decimal("100.00"),
      quantity: 1,
      status: ComandaItemStatus.DONE,
      executorId: oldMemberC.id,
    },
  });

  await prisma.payment.create({
    data: {
      id: "pay-test-c",
      barbershopId,
      comandaId: comandaC.id,
      amount: new Prisma.Decimal("100.00"),
      method: "CREDIT",
      status: "CONFIRMED",
    },
  });

  const oldEntryC = await prisma.commissionEntry.create({
    data: {
      id: "entry-c-old-v1",
      barbershopId,
      memberId: oldMemberC.id,
      comandaItemId: itemC.id,
      baseAmount: new Prisma.Decimal("100.00"),
      generatedAmount: new Prisma.Decimal("40.00"),
      releasedAmount: new Prisma.Decimal("40.00"),
      paidAmount: new Prisma.Decimal("40.00"),
      reversedAmount: new Prisma.Decimal("0.00"),
      attributionVersion: 1,
      isCurrent: true,
      competence: "2026-07",
      type: "SERVICE",
      status: CommissionEntryStatus.PAID,
      createdAt: new Date("2026-07-15T12:00:00Z"),
      configSnapshot: { type: "PERCENTAGE", value: 40 },
    },
  });

  // Source release item in HISTORICAL cycle
  await prisma.commissionPayableItem.create({
    data: {
      id: "pi-c-old-rel-closed",
      barbershopId,
      cycleId: historicalPaidCycleC.id,
      entryId: oldEntryC.id,
      memberId: oldMemberC.id,
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      type: CommissionPayableType.RELEASE,
      amount: new Prisma.Decimal("40.00"),
      isHistoricalCorrection: false,
      eventKey: `entry:${oldEntryC.id}:rel:1:target:4000`,
    },
  });

  // Execute correction
  const resC = await correctCommissionExecutor({
    barbershopId,
    comandaItemId: itemC.id,
    newExecutorMemberId: newMemberC.id,
    reason: "Correction of historical paid commission item",
    idempotencyKey: "idem-proof-c-1",
    userId: ownerUser.id,
    role: "OWNER",
  });

  if (!resC.success || resC.reversalAmount !== "40.00" || resC.newReleasedAmount !== "50.00") {
    throw new Error(`Test C failed: unexpected res: ${JSON.stringify(resC)}`);
  }

  // 1. Verify historical PAID cycle was NOT modified
  const historicalCycleAfter = await prisma.commissionCycle.findUniqueOrThrow({
    where: { id: historicalPaidCycleC.id },
  });
  if (
    historicalCycleAfter.status !== CommissionCycleStatus.PAID ||
    toCents(historicalCycleAfter.grossCommission) !== 100000 ||
    toCents(historicalCycleAfter.finalPayoutAmount) !== 100000 ||
    toCents(historicalCycleAfter.remainingBalance) !== 0
  ) {
    throw new Error(`Test C failed: historical cycle was mutated: ${JSON.stringify(historicalCycleAfter)}`);
  }

  // 2. Verify companion DEBIT adjustment created in current OPEN cycle
  const debitAdjustmentsC = await prisma.commissionCycleAdjustment.findMany({
    where: { cycleId: currentOpenCycleC.id, type: CommissionCycleAdjustmentType.DEBIT },
  });
  if (debitAdjustmentsC.length !== 1 || toCents(debitAdjustmentsC[0].amount) !== 4000) {
    throw new Error(`Test C failed: expected 1 DEBIT adjustment of 40.00, got: ${JSON.stringify(debitAdjustmentsC)}`);
  }

  // 3. Verify current open cycle balance updated: 100 - 40 = 60
  const currentOpenCycleAfter = await prisma.commissionCycle.findUniqueOrThrow({
    where: { id: currentOpenCycleC.id },
  });
  if (
    toCents(currentOpenCycleAfter.adjustmentsTotal) !== -4000 ||
    toCents(currentOpenCycleAfter.remainingBalance) !== 6000
  ) {
    throw new Error(`Test C failed: current open cycle balance mismatch: ${JSON.stringify(currentOpenCycleAfter)}`);
  }

  // 4. Verify authoritative balance calculation: gross remains 100, adjustmentsTotal is -40, economicPayable is 60
  const authCurrentOpenC = await getAuthoritativeCycleBalance(prisma, currentOpenCycleC.id);
  if (
    authCurrentOpenC.grossCommissionCents !== 10000 ||
    authCurrentOpenC.adjustmentsTotalCents !== -4000 ||
    authCurrentOpenC.economicPayableCents !== 6000
  ) {
    throw new Error(`Test C failed: authoritative balance mismatch: ${JSON.stringify(authCurrentOpenC)}`);
  }
  console.log("✓ TEST C PASSED: Historical PAID cycle remains untouched, current OPEN cycle receives -40 DEBIT exactly once, economic payable is 60.");

  // =========================================================================
  // TEST D: PRODUCT EXECUTOR CORRECTION (DONE, CUSTOMER FULLY PAID)
  // PRODUCT DONE, provable old rate 40, new executor PRODUCT rule 50, customer fully paid => old reversal 40, new release 50
  // =========================================================================
  console.log("\n--- RUNNING TEST D: Product executor correction with DONE status & full customer payment ---");

  // Old member PRODUCT rule 40%
  await prisma.commissionConfig.create({
    data: {
      id: "cfg-d-old-prod-40",
      barbershopId,
      scopeKey: `member:${oldMember.id}:product_default`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("40.00"),
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    },
  });

  // New member PRODUCT rule 50%
  await prisma.commissionConfig.create({
    data: {
      id: "cfg-d-new-prod-50",
      barbershopId,
      scopeKey: `member:${newMember.id}:product_default`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("50.00"),
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    },
  });

  const comandaD = await prisma.comanda.create({
    data: {
      id: "cmd-test-d",
      barbershopId,
      customerName: "Cliente Teste",
      total: new Prisma.Decimal("100.00"),
      status: ComandaStatus.CLOSED,
      commissionRevision: 1,
    },
  });

  const itemD = await prisma.comandaItem.create({
    data: {
      id: "item-test-d",
      comandaId: comandaD.id,
      barbershopId,
      description: "Item description",
      type: ComandaItemType.PRODUCT,
      productId: "prod-pomada-1",
      unitPrice: new Prisma.Decimal("100.00"),
      total: new Prisma.Decimal("100.00"),
      quantity: 1,
      status: ComandaItemStatus.DONE, // status must be DONE
      executorId: oldMember.id,
    },
  });

  await prisma.payment.create({
    data: {
      id: "pay-test-d",
      barbershopId,
      comandaId: comandaD.id,
      amount: new Prisma.Decimal("100.00"),
      method: "CASH",
      status: "CONFIRMED",
    },
  });

  const oldEntryD = await prisma.commissionEntry.create({
    data: {
      id: "entry-d-old-v1",
      barbershopId,
      memberId: oldMember.id,
      comandaItemId: itemD.id,
      baseAmount: new Prisma.Decimal("100.00"),
      generatedAmount: new Prisma.Decimal("40.00"),
      releasedAmount: new Prisma.Decimal("40.00"),
      paidAmount: new Prisma.Decimal("0.00"),
      reversedAmount: new Prisma.Decimal("0.00"),
      attributionVersion: 1,
      isCurrent: true,
      competence: "2026-08",
      type: "PRODUCT",
      status: CommissionEntryStatus.RELEASED,
      createdAt: attributionTime,
      configSnapshot: { type: "PERCENTAGE", value: 40 },
    },
  });

  // Source release item in old member's open cycle
  await prisma.commissionPayableItem.create({
    data: {
      id: "pi-d-old-rel",
      barbershopId,
      cycleId: oldOpenCycleB.id,
      entryId: oldEntryD.id,
      memberId: oldMember.id,
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      type: CommissionPayableType.RELEASE,
      amount: new Prisma.Decimal("40.00"),
      isHistoricalCorrection: false,
      eventKey: `entry:${oldEntryD.id}:rel:1:target:4000`,
    },
  });

  const resD = await correctCommissionExecutor({
    barbershopId,
    comandaItemId: itemD.id,
    newExecutorMemberId: newMember.id,
    reason: "Product commission reassigned to new member",
    idempotencyKey: "idem-proof-d-1",
    userId: ownerUser.id,
    role: "OWNER",
  });

  if (!resD.success || resD.reversalAmount !== "40.00" || resD.newReleasedAmount !== "50.00") {
    throw new Error(`Test D failed: unexpected res: ${JSON.stringify(resD)}`);
  }

  // Verify old entry reversed, new entry created with type PRODUCT
  const oldEntryAfterD = await prisma.commissionEntry.findUniqueOrThrow({ where: { id: oldEntryD.id } });
  if (oldEntryAfterD.isCurrent !== false || toCents(oldEntryAfterD.reversedAmount) !== 4000) {
    throw new Error(`Test D failed: old entry not reversed: ${JSON.stringify(oldEntryAfterD)}`);
  }

  const newEntryD = await prisma.commissionEntry.findFirstOrThrow({
    where: { comandaItemId: itemD.id, isCurrent: true },
  });
  if (newEntryD.memberId !== newMember.id || newEntryD.type !== "PRODUCT" || toCents(newEntryD.releasedAmount) !== 5000) {
    throw new Error(`Test D failed: new entry mismatch: ${JSON.stringify(newEntryD)}`);
  }
  console.log("✓ TEST D PASSED: PRODUCT item with status=DONE and fully paid customer corrected: old reversal 40, new release 50.");

  // =========================================================================
  // TEST F: PRODUCT COMMISSION USES PRODUCT HIERARCHY, NEVER SERVICE HIERARCHY
  // New executor SERVICE rule 80, PRODUCT rule 30 => uses 30, never 80
  // =========================================================================
  console.log("\n--- RUNNING TEST F: PRODUCT commission hierarchy isolation from SERVICE rules ---");

  // Create third member for clean isolation
  const thirdUser = await prisma.user.create({
    data: {
      id: "usr-3a-third",
      name: "Third Barber",
      email: "third3a@test.com",
      phone: "11999990004",
      role: UserRole.USER,
    },
  });

  const thirdMember = await prisma.barbershopMember.create({
    data: {
      id: "mbr-3a-third",
      barbershopId,
      userId: thirdUser.id,
      role: "BARBER",
      isActive: true,
    },
  });

  // Third member SERVICE rule = 80%
  await prisma.commissionConfig.create({
    data: {
      id: "cfg-f-third-service-80",
      barbershopId,
      scopeKey: `member:${thirdMember.id}:default`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("80.00"),
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    },
  });

  // Third member PRODUCT rule = 30%
  await prisma.commissionConfig.create({
    data: {
      id: "cfg-f-third-product-30",
      barbershopId,
      scopeKey: `member:${thirdMember.id}:product_default`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("30.00"),
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    },
  });

  const comandaF = await prisma.comanda.create({
    data: {
      id: "cmd-test-f",
      barbershopId,
      customerName: "Cliente Teste",
      total: new Prisma.Decimal("100.00"),
      status: ComandaStatus.CLOSED,
      commissionRevision: 1,
    },
  });

  const itemF = await prisma.comandaItem.create({
    data: {
      id: "item-test-f",
      comandaId: comandaF.id,
      barbershopId,
      description: "Item description",
      type: ComandaItemType.PRODUCT,
      productId: "prod-gel-1",
      unitPrice: new Prisma.Decimal("100.00"),
      total: new Prisma.Decimal("100.00"),
      quantity: 1,
      status: ComandaItemStatus.DONE,
      executorId: oldMember.id,
    },
  });

  await prisma.payment.create({
    data: {
      id: "pay-test-f",
      barbershopId,
      comandaId: comandaF.id,
      amount: new Prisma.Decimal("100.00"),
      method: "DEBIT",
      status: "CONFIRMED",
    },
  });

  const oldEntryF = await prisma.commissionEntry.create({
    data: {
      id: "entry-f-old-v1",
      barbershopId,
      memberId: oldMember.id,
      comandaItemId: itemF.id,
      baseAmount: new Prisma.Decimal("100.00"),
      generatedAmount: new Prisma.Decimal("40.00"),
      releasedAmount: new Prisma.Decimal("40.00"),
      paidAmount: new Prisma.Decimal("0.00"),
      reversedAmount: new Prisma.Decimal("0.00"),
      attributionVersion: 1,
      isCurrent: true,
      competence: "2026-08",
      type: "PRODUCT",
      status: CommissionEntryStatus.RELEASED,
      createdAt: attributionTime,
      configSnapshot: { type: "PERCENTAGE", value: 40 },
    },
  });

  await prisma.commissionPayableItem.create({
    data: {
      id: "pi-f-old-rel",
      barbershopId,
      cycleId: oldOpenCycleB.id,
      entryId: oldEntryF.id,
      memberId: oldMember.id,
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      type: CommissionPayableType.RELEASE,
      amount: new Prisma.Decimal("40.00"),
      isHistoricalCorrection: false,
      eventKey: `entry:${oldEntryF.id}:rel:1:target:4000`,
    },
  });

  // Reassign to third member
  const resF = await correctCommissionExecutor({
    barbershopId,
    comandaItemId: itemF.id,
    newExecutorMemberId: thirdMember.id,
    reason: "Verify PRODUCT rule 30% used over SERVICE rule 80%",
    idempotencyKey: "idem-proof-f-1",
    userId: ownerUser.id,
    role: "OWNER",
  });

  if (!resF.success || resF.newReleasedAmount !== "30.00") {
    throw new Error(`Test F failed: expected 30.00, got: ${JSON.stringify(resF)}`);
  }

  const newEntryF = await prisma.commissionEntry.findFirstOrThrow({
    where: { comandaItemId: itemF.id, isCurrent: true },
  });
  if (toCents(newEntryF.generatedAmount) !== 3000 || toCents(newEntryF.releasedAmount) !== 3000) {
    throw new Error(`Test F failed: new entry amount is not 30.00 (got generated=${newEntryF.generatedAmount}, released=${newEntryF.releasedAmount})`);
  }
  console.log("✓ TEST F PASSED: PRODUCT item resolved to PRODUCT rule 30.00, never SERVICE rule 80.00.");

  // =========================================================================
  // TEST G: HISTORICAL RULE PROVABILITY AT ATTRIBUTION TIME & ATOMIC ROLLBACK
  // PRODUCT historical rule created after attributionTime => HISTORICAL_COMMISSION_RULE_UNPROVABLE => atomic rollback
  // =========================================================================
  console.log("\n--- RUNNING TEST G: Historical rule provability at attributionTime & atomic rollback ---");

  // Fourth member who has NO rule at attributionTime (2026-08-01), but a rule created LATER (2026-08-05)
  const fourthUser = await prisma.user.create({
    data: {
      id: "usr-3a-fourth",
      name: "Fourth Barber",
      email: "fourth3a@test.com",
      phone: "11999990005",
      role: UserRole.USER,
    },
  });

  const fourthMember = await prisma.barbershopMember.create({
    data: {
      id: "mbr-3a-fourth",
      barbershopId,
      userId: fourthUser.id,
      role: "BARBER",
      isActive: true,
    },
  });

  // Rule created at 2026-08-05 (AFTER attributionTime 2026-08-01)
  await prisma.commissionConfig.create({
    data: {
      id: "cfg-g-fourth-prod-late",
      barbershopId,
      scopeKey: `member:${fourthMember.id}:product_default`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("45.00"),
      createdAt: new Date("2026-08-05T00:00:00Z"),
      updatedAt: new Date("2026-08-05T00:00:00Z"),
    },
  });

  const comandaG = await prisma.comanda.create({
    data: {
      id: "cmd-test-g",
      barbershopId,
      customerName: "Cliente Teste",
      total: new Prisma.Decimal("100.00"),
      status: ComandaStatus.CLOSED,
      commissionRevision: 1,
    },
  });

  const itemG = await prisma.comandaItem.create({
    data: {
      id: "item-test-g",
      comandaId: comandaG.id,
      barbershopId,
      description: "Item description",
      type: ComandaItemType.PRODUCT,
      productId: "prod-late-1",
      unitPrice: new Prisma.Decimal("100.00"),
      total: new Prisma.Decimal("100.00"),
      quantity: 1,
      status: ComandaItemStatus.DONE,
      executorId: oldMember.id,
    },
  });

  await prisma.payment.create({
    data: {
      id: "pay-test-g",
      barbershopId,
      comandaId: comandaG.id,
      amount: new Prisma.Decimal("100.00"),
      method: "CASH",
      status: "CONFIRMED",
    },
  });

  const oldEntryG = await prisma.commissionEntry.create({
    data: {
      id: "entry-g-old-v1",
      barbershopId,
      memberId: oldMember.id,
      comandaItemId: itemG.id,
      baseAmount: new Prisma.Decimal("100.00"),
      generatedAmount: new Prisma.Decimal("40.00"),
      releasedAmount: new Prisma.Decimal("40.00"),
      paidAmount: new Prisma.Decimal("0.00"),
      reversedAmount: new Prisma.Decimal("0.00"),
      attributionVersion: 1,
      isCurrent: true,
      competence: "2026-08",
      type: "PRODUCT",
      status: CommissionEntryStatus.RELEASED,
      createdAt: attributionTime, // 2026-08-01
      configSnapshot: { type: "PERCENTAGE", value: 40 },
    },
  });

  await prisma.commissionPayableItem.create({
    data: {
      id: "pi-g-old-rel",
      barbershopId,
      cycleId: oldOpenCycleB.id,
      entryId: oldEntryG.id,
      memberId: oldMember.id,
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      type: CommissionPayableType.RELEASE,
      amount: new Prisma.Decimal("40.00"),
      isHistoricalCorrection: false,
      eventKey: `entry:${oldEntryG.id}:rel:1:target:4000`,
    },
  });

  let errorCaughtG: any = null;
  try {
    await correctCommissionExecutor({
      barbershopId,
      comandaItemId: itemG.id,
      newExecutorMemberId: fourthMember.id,
      reason: "Reassigning to member whose rule is unprovable at attributionTime",
      idempotencyKey: "idem-proof-g-1",
      userId: ownerUser.id,
      role: "OWNER",
    });
  } catch (err) {
    errorCaughtG = err;
  }

  if (!errorCaughtG || errorCaughtG.code !== "HISTORICAL_COMMISSION_RULE_UNPROVABLE" || errorCaughtG.status !== 422) {
    throw new Error(`Test G failed: expected 422 HISTORICAL_COMMISSION_RULE_UNPROVABLE, got: ${JSON.stringify(errorCaughtG)}`);
  }

  // Verify atomic rollback
  const oldEntryAfterG = await prisma.commissionEntry.findUniqueOrThrow({ where: { id: oldEntryG.id } });
  if (oldEntryAfterG.isCurrent !== true || toCents(oldEntryAfterG.reversedAmount) !== 0) {
    throw new Error(`Test G failed: old entry was mutated despite rollback: ${JSON.stringify(oldEntryAfterG)}`);
  }

  const newEntriesCountG = await prisma.commissionEntry.count({
    where: { comandaItemId: itemG.id, memberId: fourthMember.id },
  });
  if (newEntriesCountG !== 0) {
    throw new Error(`Test G failed: new entry was persisted despite rollback: count=${newEntriesCountG}`);
  }

  const auditCountG = await prisma.commissionExecutorCorrectionAudit.count({
    where: { comandaItemId: itemG.id },
  });
  if (auditCountG !== 0) {
    throw new Error(`Test G failed: audit record persisted despite rollback: count=${auditCountG}`);
  }
  console.log("✓ TEST G PASSED: Unprovable historical rule rejected with 422 HISTORICAL_COMMISSION_RULE_UNPROVABLE and rolled back atomically.");

  console.log("\n==========================================================");
  console.log(" ALL C11.3a REAL POSTGRESQL PROOFS PASSED (B, C, D, F, G) ");
  console.log("==========================================================");
}

// Execute directly if run via tsx/node
if (require.main === module) {
  runRealPostgresProofC11_3a()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
