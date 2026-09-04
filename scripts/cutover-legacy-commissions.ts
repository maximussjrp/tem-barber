import prisma from "@/lib/prisma";
import {
  Prisma,
  CommissionCycleStatus,
  CommissionPayableType,
  CommissionPayableSourceKind,
  CommissionCycleAdjustmentType,
  CommissionDisbursementMethod,
} from "@prisma/client";
import { fromCents, toCents } from "@/lib/operations/money";
import { getAuthoritativeCycleBalance } from "@/lib/operations/commissions";

export class CutoverError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(`[${code}] ${message}`);
    this.name = "CutoverError";
  }
}

export interface PreflightReport {
  status: "READY" | "BLOCKED";
  tenantCount: number;
  tenants: Array<{
    barbershopId: string;
    legacyPaidPeriodsCount: number;
    legacyOpenPeriodsCount: number;
    legacyEntriesCount: number;
    legacyAdjustmentsCount: number;
    canonicalCyclesCount: number;
    canonicalPayableItemsCount: number;
    canonicalPayoutsCount: number;
    canonicalAdjustmentsCount: number;
    hasMixedCanonicalData: boolean;
    blockers: string[];
  }>;
  totalBlockersCount: number;
}

export interface TenantCutoverSummary {
  barbershopId: string;
  historicalPaidCyclesCreated: number;
  historicalPayableItemsCreated: number;
  historicalPayoutsCreated: number;
  openCyclesCreatedOrReused: number;
  unpaidPayableItemsCreated: number;
  terminalCycleAdjustmentsCreated: number;
  reconciledMembersCount: number;
}

export interface VerificationReport {
  status: "VERIFIED" | "FAILED";
  tenantsChecked: number;
  failures: Array<{
    barbershopId: string;
    memberId?: string;
    cycleId?: string;
    reason: string;
    expected?: unknown;
    actual?: unknown;
  }>;
}

// ----------------------------------------------------
// PREFLIGHT ENGINE
// ----------------------------------------------------

export async function runPreflight(
  tx: Prisma.TransactionClient,
  targetBarbershopId?: string
): Promise<PreflightReport> {
  const barbershops = await tx.barbershop.findMany({
    where: targetBarbershopId ? { id: targetBarbershopId } : {},
    select: { id: true },
  });

  const tenantReports: PreflightReport["tenants"] = [];
  let totalBlockersCount = 0;

  for (const shop of barbershops) {
    const barbershopId = shop.id;
    const blockers: string[] = [];

    // 1. Audit Mixed Canonical Business Activity
    const nonBackfillPayableItemsCount = await tx.commissionPayableItem.count({
      where: {
        barbershopId,
        sourceKind: { not: CommissionPayableSourceKind.LEGACY_BACKFILL },
      },
    });

    const nonBackfillPayoutsCount = await tx.commissionPayout.count({
      where: {
        barbershopId,
        NOT: { idempotencyKey: { startsWith: "legacy-payout:period:" } },
      },
    });

    const nonBackfillAdvancesCount = await tx.commissionAdvance.count({
      where: {
        barbershopId,
        NOT: { idempotencyKey: { startsWith: "legacy-advance:" } },
      },
    });

    const nonBackfillAdjustmentsCount = await tx.commissionCycleAdjustment.count({
      where: {
        barbershopId,
        NOT: { idempotencyKey: { startsWith: "legacy-adjustment:" } },
      },
    });

    const hasMixedCanonicalData =
      nonBackfillPayableItemsCount > 0 ||
      nonBackfillPayoutsCount > 0 ||
      nonBackfillAdvancesCount > 0 ||
      nonBackfillAdjustmentsCount > 0;

    if (hasMixedCanonicalData) {
      blockers.push("MIXED_CANONICAL_DATA_BLOCKER");
    }

    // 2. Audit Commission Periods
    const periods = await tx.commissionPeriod.findMany({
      where: { barbershopId },
      include: { member: { select: { barbershopId: true, userId: true } } },
    });

    for (const p of periods) {
      if (!p.member || p.member.barbershopId !== barbershopId) {
        blockers.push(`CROSS_TENANT_LEGACY_PROVENANCE: period ${p.id}`);
      }

      if (p.status === "PAID") {
        if (!p.paidAt) {
          blockers.push(`PAID_PERIOD_MISSING_PAID_AT: period ${p.id}`);
        }

        const paidCents = toCents(p.paidAmount);
        const releasedCents = toCents(p.releasedAmount);
        if (paidCents !== releasedCents) {
          blockers.push(
            `PAID_HISTORY_RECONCILIATION_MISMATCH: period ${p.id} paid=${paidCents} released=${releasedCents}`
          );
        }

        const actorId = p.paidById || p.closedById;
        if (!actorId) {
          blockers.push(`ACTOR_PROVENANCE_BLOCKER: period ${p.id} has no paidById or closedById`);
        } else {
          const userExists = await tx.user.findUnique({ where: { id: actorId }, select: { id: true } });
          if (!userExists) {
            blockers.push(`ACTOR_PROVENANCE_BLOCKER: period ${p.id} actor ${actorId} does not exist`);
          }
        }
      }
    }

    // 3. Audit Commission Entries
    const entries = await tx.commissionEntry.findMany({
      where: { barbershopId },
      select: {
        id: true,
        comandaItemId: true,
        baseAmount: true,
        generatedAmount: true,
        releasedAmount: true,
        paidAmount: true,
        reversedAmount: true,
        attributionVersion: true,
        isCurrent: true,
      },
    });

    const currentEntriesByItem = new Map<string, number>();
    for (const e of entries) {
      const b = toCents(e.baseAmount);
      const g = toCents(e.generatedAmount);
      const r = toCents(e.releasedAmount);
      const p = toCents(e.paidAmount);
      const rev = toCents(e.reversedAmount);

      if (isNaN(b) || isNaN(g) || isNaN(r) || isNaN(p) || isNaN(rev) || b < 0 || g < 0 || r < 0 || p < 0 || rev < 0) {
        blockers.push(`INVALID_ENTRY_AMOUNT: entry ${e.id}`);
      }

      if (e.isCurrent) {
        currentEntriesByItem.set(e.comandaItemId, (currentEntriesByItem.get(e.comandaItemId) || 0) + 1);
      }
    }

    for (const [itemId, count] of currentEntriesByItem.entries()) {
      if (count > 1) {
        blockers.push(`MULTIPLE_CURRENT_ENTRIES_FOR_ITEM: item ${itemId} has ${count} current entries`);
      }
    }

    // 4. Counts
    const paidPeriodsCount = periods.filter((p) => p.status === "PAID").length;
    const openPeriodsCount = periods.filter((p) => p.status === "OPEN").length;
    const legacyAdjustmentsCount = await tx.commissionAdjustment.count({ where: { barbershopId } });

    const canonicalCyclesCount = await tx.commissionCycle.count({ where: { barbershopId } });
    const canonicalPayableItemsCount = await tx.commissionPayableItem.count({ where: { barbershopId } });
    const canonicalPayoutsCount = await tx.commissionPayout.count({ where: { barbershopId } });
    const canonicalAdjustmentsCount = await tx.commissionCycleAdjustment.count({ where: { barbershopId } });

    if (blockers.length > 0) {
      totalBlockersCount += blockers.length;
    }

    tenantReports.push({
      barbershopId,
      legacyPaidPeriodsCount: paidPeriodsCount,
      legacyOpenPeriodsCount: openPeriodsCount,
      legacyEntriesCount: entries.length,
      legacyAdjustmentsCount,
      canonicalCyclesCount,
      canonicalPayableItemsCount,
      canonicalPayoutsCount,
      canonicalAdjustmentsCount,
      hasMixedCanonicalData,
      blockers,
    });
  }

  return {
    status: totalBlockersCount === 0 ? "READY" : "BLOCKED",
    tenantCount: barbershops.length,
    tenants: tenantReports,
    totalBlockersCount,
  };
}

// ----------------------------------------------------
// TENANT BACKFILL LOGIC (TRANSACTIONAL)
// ----------------------------------------------------

export async function applyCutoverForTenant(
  tx: Prisma.TransactionClient,
  barbershopId: string
): Promise<TenantCutoverSummary> {
  // 1. Run strict preflight assertion on this tenant
  const preflight = await runPreflight(tx, barbershopId);
  const tenantReport = preflight.tenants.find((t) => t.barbershopId === barbershopId);

  if (!tenantReport || tenantReport.blockers.length > 0) {
    const firstBlocker = tenantReport?.blockers[0] || "PREFLIGHT_FAILED";
    if (tenantReport?.hasMixedCanonicalData) {
      throw new CutoverError("MIXED_CANONICAL_DATA_BLOCKER", "Tenant contains non-backfill canonical data.", {
        barbershopId,
        blockers: tenantReport.blockers,
      });
    }
    if (firstBlocker.startsWith("PAID_HISTORY_RECONCILIATION_MISMATCH")) {
      throw new CutoverError("PAID_HISTORY_RECONCILIATION_MISMATCH", firstBlocker, { barbershopId });
    }
    if (firstBlocker.startsWith("ACTOR_PROVENANCE_BLOCKER")) {
      throw new CutoverError("ACTOR_PROVENANCE_BLOCKER", firstBlocker, { barbershopId });
    }
    if (firstBlocker.startsWith("CROSS_TENANT_LEGACY_PROVENANCE")) {
      throw new CutoverError("CROSS_TENANT_LEGACY_PROVENANCE", firstBlocker, { barbershopId });
    }
    throw new CutoverError("PREFLIGHT_VALIDATION_FAILED", `Preflight blocked: ${firstBlocker}`, {
      barbershopId,
      blockers: tenantReport?.blockers,
    });
  }

  // 2. Fetch only members that have legacy entries, periods, or adjustments
  const members = await tx.barbershopMember.findMany({
    where: {
      barbershopId,
      OR: [
        { commissionEntries: { some: {} } },
        { commissionPeriods: { some: {} } },
        { commissionAdjustments: { some: {} } },
      ],
    },
    select: { id: true, userId: true },
  });

  let historicalPaidCyclesCreated = 0;
  let historicalPayableItemsCreated = 0;
  let historicalPayoutsCreated = 0;
  let openCyclesCreatedOrReused = 0;
  let unpaidPayableItemsCreated = 0;
  let terminalCycleAdjustmentsCreated = 0;
  let reconciledMembersCount = 0;

  for (const member of members) {
    const memberId = member.id;

    // A. Historical PAID Periods
    const legacyPaidPeriods = await tx.commissionPeriod.findMany({
      where: { barbershopId, memberId, status: "PAID" },
      orderBy: [{ competence: "asc" }, { paidAt: "asc" }, { id: "asc" }],
    });

    let currentSequence = 0;

    for (const period of legacyPaidPeriods) {
      currentSequence += 1;
      const cycleNumber = currentSequence;

      const frozenReleased = period.releasedAmount;
      const frozenPaid = period.paidAmount;
      const frozenPaidCents = toCents(frozenPaid);
      const frozenReleasedCents = toCents(frozenReleased);

      if (frozenPaidCents !== frozenReleasedCents) {
        throw new CutoverError(
          "PAID_HISTORY_RECONCILIATION_MISMATCH",
          `Period ${period.id} has paidAmount (${frozenPaidCents}) != releasedAmount (${frozenReleasedCents})`,
          { periodId: period.id }
        );
      }

      // Check actor provenance
      const actorId = period.paidById || period.closedById;
      if (!actorId) {
        throw new CutoverError("ACTOR_PROVENANCE_BLOCKER", `Period ${period.id} missing actor ID`, { periodId: period.id });
      }

      // Find or create historical PAID cycle
      let cycle = await tx.commissionCycle.findUnique({
        where: { barbershopId_memberId_cycleNumber: { barbershopId, memberId, cycleNumber } },
      });

      if (!cycle) {
        cycle = await tx.commissionCycle.create({
          data: {
            barbershopId,
            memberId,
            cycleNumber,
            status: CommissionCycleStatus.PAID,
            grossCommission: frozenReleased,
            adjustmentsTotal: 0,
            advancesTotal: 0,
            finalPayoutAmount: frozenPaid,
            remainingBalance: 0,
            openedAt: period.createdAt,
            closedAt: period.closedAt || period.paidAt || new Date(),
            paidAt: period.paidAt || new Date(),
          },
        });
        historicalPaidCyclesCreated++;
      }

      // Historical Paid Ledger: CommissionPayableItem per entry in this paid competence
      const competenceEntries = await tx.commissionEntry.findMany({
        where: { barbershopId, memberId, competence: period.competence },
        orderBy: { createdAt: "asc" },
      });

      let sumEntryPaidCents = 0;

      for (const entry of competenceEntries) {
        const entryPaidCents = toCents(entry.paidAmount);
        if (entryPaidCents < 0) {
          throw new CutoverError("INVALID_ENTRY_AMOUNT", `Entry ${entry.id} has negative paidAmount`, { entryId: entry.id });
        }

        sumEntryPaidCents += entryPaidCents;

        if (entryPaidCents > 0) {
          const eventKey = `legacy-paid-backfill:entry:${entry.id}`;
          const existingItem = await tx.commissionPayableItem.findUnique({
            where: { barbershopId_eventKey: { barbershopId, eventKey } },
          });

          if (!existingItem) {
            await tx.commissionPayableItem.create({
              data: {
                barbershopId,
                cycleId: cycle.id,
                entryId: entry.id,
                legacyEntryId: entry.id,
                memberId,
                sourceKind: CommissionPayableSourceKind.LEGACY_BACKFILL,
                type: CommissionPayableType.RELEASE,
                amount: entry.paidAmount,
                eventKey,
                createdAt: period.paidAt || entry.createdAt,
              },
            });
            historicalPayableItemsCreated++;
          }
        }
      }

      if (sumEntryPaidCents !== frozenPaidCents) {
        throw new CutoverError(
          "PAID_HISTORY_ENTRY_RECONCILIATION_MISMATCH",
          `Period ${period.id} paidAmount (${frozenPaidCents}) does not equal sum of entries (${sumEntryPaidCents})`,
          { periodId: period.id, frozenPaidCents, sumEntryPaidCents }
        );
      }

      // Historical Payout
      const payoutIdempotencyKey = `legacy-payout:period:${period.id}`;
      const existingPayout = await tx.commissionPayout.findUnique({
        where: { barbershopId_idempotencyKey: { barbershopId, idempotencyKey: payoutIdempotencyKey } },
      });

      if (!existingPayout) {
        await tx.commissionPayout.create({
          data: {
            barbershopId,
            cycleId: cycle.id,
            memberId,
            amount: frozenPaid,
            paymentMethod: toCents(frozenPaid) > 0 ? CommissionDisbursementMethod.OTHER : null,
            paidAt: period.paidAt || new Date(),
            idempotencyKey: payoutIdempotencyKey,
            createdById: actorId,
          },
        });
        historicalPayoutsCreated++;
      }
    }

    // B. Current OPEN Cycle (cycleNumber = N + 1)
    const openCycleNumber = currentSequence + 1;
    let openCycle = await tx.commissionCycle.findFirst({
      where: { barbershopId, memberId, status: CommissionCycleStatus.OPEN },
    });

    if (!openCycle) {
      openCycle = await tx.commissionCycle.create({
        data: {
          barbershopId,
          memberId,
          cycleNumber: openCycleNumber,
          status: CommissionCycleStatus.OPEN,
          grossCommission: 0,
          adjustmentsTotal: 0,
          advancesTotal: 0,
          finalPayoutAmount: 0,
          remainingBalance: 0,
          openedAt: new Date(),
        },
      });
      openCyclesCreatedOrReused++;
    } else {
      openCyclesCreatedOrReused++;
    }

    // C. Unpaid Entry-Level Liability (only entries with remaining > 0)
    const allMemberEntries = await tx.commissionEntry.findMany({
      where: { barbershopId, memberId },
      orderBy: { createdAt: "asc" },
    });

    let expectedOpeningLiabilityCents = 0;

    for (const entry of allMemberEntries) {
      const releasedCents = toCents(entry.releasedAmount);
      const paidCents = toCents(entry.paidAmount);
      const remainingEntryCents = Math.max(0, releasedCents - paidCents);

      if (remainingEntryCents > 0) {
        expectedOpeningLiabilityCents += remainingEntryCents;
        const eventKey = `legacy-backfill:entry:${entry.id}`;

        const existingItem = await tx.commissionPayableItem.findUnique({
          where: { barbershopId_eventKey: { barbershopId, eventKey } },
        });

        if (!existingItem) {
          await tx.commissionPayableItem.create({
            data: {
              barbershopId,
              cycleId: openCycle.id,
              entryId: entry.id,
              legacyEntryId: entry.id,
              memberId,
              sourceKind: CommissionPayableSourceKind.LEGACY_BACKFILL,
              type: CommissionPayableType.RELEASE,
              amount: fromCents(remainingEntryCents),
              eventKey,
              createdAt: entry.createdAt,
            },
          });
          unpaidPayableItemsCreated++;
        }
      }
    }

    // D. Chronological Rollover Resolution
    // Legacy PAID_ADJUSTMENTs are chained across competences.
    // Intermediate rollovers that were absorbed by subsequent PAID periods contribute zero.
    // Only terminal unliquidated adjustments reach the current OPEN cycle.
    const paidAdjustments = await tx.commissionAdjustment.findMany({
      where: { barbershopId, memberId, type: "PAID_ADJUSTMENT" },
      orderBy: { createdAt: "asc" },
    });

    const paidCompetences = new Set(legacyPaidPeriods.map((p) => p.competence));

    // A PAID_ADJUSTMENT whose target competence was already settled/PAID is absorbed
    const unabsorbedAdjustments = paidAdjustments.filter((adj) => !paidCompetences.has(adj.competence));

    // Collapse chained adjustments: if adj1 rolled into comp2 and comp2 rolled into comp3,
    // only the terminal node of the chain represents the outstanding balance
    const chainSources = new Set(
      unabsorbedAdjustments.map((a) => a.rolloverFromCompetence).filter((c): c is string => Boolean(c))
    );

    const terminalAdjustments = unabsorbedAdjustments.filter((a) => !chainSources.has(a.competence));

    let expectedOpeningAdjustmentsCents = 0;

    for (const adj of terminalAdjustments) {
      const adjCents = toCents(adj.amount);
      if (adjCents === 0) continue;

      expectedOpeningAdjustmentsCents += adjCents;
      const idempotencyKey = `legacy-adjustment:${adj.id}`;

      const existingAdj = await tx.commissionCycleAdjustment.findUnique({
        where: { barbershopId_idempotencyKey: { barbershopId, idempotencyKey } },
      });

      if (!existingAdj) {
        await tx.commissionCycleAdjustment.create({
          data: {
            barbershopId,
            cycleId: openCycle.id,
            sourceAdjustmentId: adj.id,
            type: adjCents < 0 ? CommissionCycleAdjustmentType.DEBIT : CommissionCycleAdjustmentType.CREDIT,
            amount: fromCents(Math.abs(adjCents)),
            reason: `[LEGACY_MIGRATED] ${adj.description}`,
            idempotencyKey,
            createdById: member.userId,
            createdAt: adj.createdAt,
          },
        });
        terminalCycleAdjustmentsCreated++;
      }
    }

    // E. Synchronize and Reconcile OPEN Cycle Balance
    const authBalance = await getAuthoritativeCycleBalance(tx, openCycle.id);

    const expectedRemainingCents = expectedOpeningLiabilityCents + expectedOpeningAdjustmentsCents;
    if (authBalance.remainingBalanceCents !== expectedRemainingCents) {
      throw new CutoverError(
        "OPEN_BALANCE_RECONCILIATION_MISMATCH",
        `Member ${memberId} authoritative balance (${authBalance.remainingBalanceCents}) != expected (${expectedRemainingCents})`,
        {
          memberId,
          authBalance: authBalance.remainingBalanceCents,
          expectedRemainingCents,
        }
      );
    }

    await tx.commissionCycle.update({
      where: { id: openCycle.id },
      data: {
        grossCommission: fromCents(authBalance.grossCommissionCents),
        adjustmentsTotal: fromCents(authBalance.adjustmentsTotalCents),
        advancesTotal: fromCents(authBalance.advancesTotalCents),
        remainingBalance: fromCents(authBalance.remainingBalanceCents),
      },
    });

    reconciledMembersCount++;
  }

  return {
    barbershopId,
    historicalPaidCyclesCreated,
    historicalPayableItemsCreated,
    historicalPayoutsCreated,
    openCyclesCreatedOrReused,
    unpaidPayableItemsCreated,
    terminalCycleAdjustmentsCreated,
    reconciledMembersCount,
  };
}

// ----------------------------------------------------
// VERIFICATION ENGINE
// ----------------------------------------------------

export async function verifyTenantCutover(
  tx: Prisma.TransactionClient,
  targetBarbershopId?: string
): Promise<VerificationReport> {
  const barbershops = await tx.barbershop.findMany({
    where: targetBarbershopId ? { id: targetBarbershopId } : {},
    select: { id: true },
  });

  const failures: VerificationReport["failures"] = [];

  for (const shop of barbershops) {
    const barbershopId = shop.id;

    // Verify historical PAID periods have canonical counterparts
    const paidPeriods = await tx.commissionPeriod.findMany({
      where: { barbershopId, status: "PAID" },
    });

    for (const p of paidPeriods) {
      const payoutKey = `legacy-payout:period:${p.id}`;
      const payout = await tx.commissionPayout.findUnique({
        where: { barbershopId_idempotencyKey: { barbershopId, idempotencyKey: payoutKey } },
        include: { cycle: true, financialEntry: true, cashMovement: true },
      });

      if (!payout) {
        failures.push({
          barbershopId,
          reason: `Missing historical payout for period ${p.id}`,
        });
        continue;
      }

      if (payout.financialEntry || payout.cashMovement) {
        failures.push({
          barbershopId,
          reason: `Historical payout for period ${p.id} has financialEntry or cashMovement`,
        });
      }

      if (toCents(payout.amount) !== toCents(p.paidAmount)) {
        failures.push({
          barbershopId,
          reason: `Historical payout amount mismatch for period ${p.id}`,
          expected: toCents(p.paidAmount),
          actual: toCents(payout.amount),
        });
      }

      // Verify historical payable items sum
      const payableItems = await tx.commissionPayableItem.findMany({
        where: { cycleId: payout.cycleId },
      });

      const ledgerSum = payableItems.reduce((sum, it) => sum + toCents(it.amount), 0);
      if (ledgerSum !== toCents(p.paidAmount)) {
        failures.push({
          barbershopId,
          cycleId: payout.cycleId,
          reason: `Historical ledger sum (${ledgerSum}) != payout amount (${toCents(p.paidAmount)}) for period ${p.id}`,
        });
      }

      // Check all historical items have sourceKind=LEGACY_BACKFILL
      const nonBackfillHistorical = payableItems.filter(
        (it) => it.sourceKind !== CommissionPayableSourceKind.LEGACY_BACKFILL
      );
      if (nonBackfillHistorical.length > 0) {
        failures.push({
          barbershopId,
          cycleId: payout.cycleId,
          reason: `Historical cycle has non-LEGACY_BACKFILL items`,
        });
      }
    }

    // Verify OPEN cycles match authoritative ledger
    const openCycles = await tx.commissionCycle.findMany({
      where: { barbershopId, status: CommissionCycleStatus.OPEN },
    });

    for (const oc of openCycles) {
      const auth = await getAuthoritativeCycleBalance(tx, oc.id);
      if (
        toCents(oc.grossCommission) !== auth.grossCommissionCents ||
        toCents(oc.adjustmentsTotal) !== auth.adjustmentsTotalCents ||
        toCents(oc.remainingBalance) !== auth.remainingBalanceCents
      ) {
        failures.push({
          barbershopId,
          cycleId: oc.id,
          reason: `OPEN cycle cache does not match authoritative ledger`,
          expected: auth,
          actual: {
            gross: toCents(oc.grossCommission),
            adj: toCents(oc.adjustmentsTotal),
            remaining: toCents(oc.remainingBalance),
          },
        });
      }
    }
  }

  return {
    status: failures.length === 0 ? "VERIFIED" : "FAILED",
    tenantsChecked: barbershops.length,
    failures,
  };
}

// ----------------------------------------------------
// CUTOVER WORKFLOW CONTROLLER
// ----------------------------------------------------

export interface ExecuteCutoverOptions {
  isApply?: boolean;
  isVerifyOnly?: boolean;
  targetBarbershopId?: string;
}

export type CutoverWorkflowResult =
  | { mode: "VERIFY"; report: VerificationReport }
  | { mode: "PREFLIGHT"; preflight: PreflightReport }
  | { mode: "APPLY"; summaries: TenantCutoverSummary[]; verify: VerificationReport };

export async function executeCutoverWorkflow(
  prismaClient: typeof prisma = prisma,
  options: ExecuteCutoverOptions = {}
): Promise<CutoverWorkflowResult> {
  const { isApply = false, isVerifyOnly = false, targetBarbershopId } = options;

  if (isVerifyOnly) {
    const report = await prismaClient.$transaction((tx) => verifyTenantCutover(tx, targetBarbershopId));
    return { mode: "VERIFY", report };
  }

  if (!isApply) {
    // Default safe mode: Preflight
    const preflight = await prismaClient.$transaction((tx) => runPreflight(tx, targetBarbershopId));
    return { mode: "PREFLIGHT", preflight };
  }

  // Apply Mode
  // 1. GLOBAL PREFLIGHT MUST ABORT BEFORE ANY MUTATION
  const globalPreflight = await prismaClient.$transaction((tx) => runPreflight(tx, targetBarbershopId));
  if (globalPreflight.status !== "READY") {
    const firstFailingTenant = globalPreflight.tenants.find((t) => t.blockers.length > 0);
    const firstBlocker = firstFailingTenant?.blockers[0] || "GLOBAL_PREFLIGHT_BLOCKED";
    throw new CutoverError("GLOBAL_PREFLIGHT_BLOCKED", `Global preflight blocked: ${firstBlocker}`, {
      totalBlockersCount: globalPreflight.totalBlockersCount,
      tenants: globalPreflight.tenants.filter((t) => t.blockers.length > 0),
    });
  }

  // 2. Loop tenants and mutate transactionally
  const barbershops = await prismaClient.barbershop.findMany({
    where: targetBarbershopId ? { id: targetBarbershopId } : {},
    select: { id: true },
  });

  const summaries: TenantCutoverSummary[] = [];

  for (const shop of barbershops) {
    const summary = await prismaClient.$transaction(
      async (tx) => {
        return applyCutoverForTenant(tx, shop.id);
      },
      { timeout: 30000 }
    );
    summaries.push(summary);
  }

  // 3. Post-apply verification
  const verify = await prismaClient.$transaction((tx) => verifyTenantCutover(tx, targetBarbershopId));
  if (verify.status !== "VERIFIED") {
    throw new CutoverError("POST_CUTOVER_VERIFICATION_FAILED", "Post-cutover verification failed", {
      failures: verify.failures,
    });
  }

  return { mode: "APPLY", summaries, verify };
}

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes("--apply");
  const isVerifyOnly = args.includes("--verify");
  const targetBarbershopArg = args.find((a) => a.startsWith("--barbershopId="));
  const targetBarbershopId = targetBarbershopArg ? targetBarbershopArg.split("=")[1] : undefined;

  console.log("==================================================");
  console.log(" TEM BARBER — COMMISSION LEGACY CUTOVER TOOL");
  console.log(" Mode:", isApply ? "APPLY (Transactional Mutation)" : isVerifyOnly ? "VERIFY (Read-Only)" : "PREFLIGHT (Read-Only)");
  console.log(" Target Tenant:", targetBarbershopId || "ALL");
  console.log("==================================================");

  const result = await executeCutoverWorkflow(prisma, {
    isApply,
    isVerifyOnly,
    targetBarbershopId,
  });

  if (result.mode === "VERIFY") {
    console.log(JSON.stringify(result.report, null, 2));
    if (result.report.status !== "VERIFIED") process.exit(1);
    return;
  }

  if (result.mode === "PREFLIGHT") {
    console.log(JSON.stringify(result.preflight, null, 2));
    if (result.preflight.status !== "READY") {
      console.error(`Preflight BLOCKED with ${result.preflight.totalBlockersCount} issue(s).`);
      process.exit(1);
    }
    console.log("Preflight passed. Ready for --apply.");
    return;
  }

  console.log("Cutover apply completed successfully:");
  console.log(JSON.stringify(result.summaries, null, 2));
  console.log("Post-cutover verification PASSED.");
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error("Cutover script execution failed:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
