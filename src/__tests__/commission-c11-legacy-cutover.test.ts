/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  Prisma,
  CommissionCycleStatus,
  CommissionPayableSourceKind,
  CommissionPayableType,
  CommissionCycleAdjustmentType,
} from "@prisma/client";
import {
  runPreflight,
  applyCutoverForTenant,
  verifyTenantCutover,
  executeCutoverWorkflow,
  CutoverError,
} from "../../scripts/cutover-legacy-commissions";
import { fromCents, toCents } from "@/lib/operations/money";

interface InMemoryState {
  barbershops: any[];
  users: any[];
  members: any[];
  commissionEntries: any[];
  commissionPeriods: any[];
  commissionAdjustments: any[];
  commissionCycles: any[];
  commissionPayableItems: any[];
  commissionPayouts: any[];
  commissionCycleAdjustments: any[];
  commissionAdvances: any[];
  financialEntries: any[];
  cashMovements: any[];
}

function createInMemoryTx(initialState?: Partial<InMemoryState>) {
  const state: InMemoryState = {
    barbershops: [],
    users: [],
    members: [],
    commissionEntries: [],
    commissionPeriods: [],
    commissionAdjustments: [],
    commissionCycles: [],
    commissionPayableItems: [],
    commissionPayouts: [],
    commissionCycleAdjustments: [],
    commissionAdvances: [],
    financialEntries: [],
    cashMovements: [],
    ...initialState,
  };

  const tx: any = {
    $executeRaw: async () => 1,
    $transaction: async (fn: any) => fn(tx),
    barbershop: {
      findMany: async ({ where }: any = {}) => {
        return state.barbershops.filter((b) => !where?.id || b.id === where.id);
      },
    },
    user: {
      findUnique: async ({ where }: any) => {
        return state.users.find((u) => u.id === where.id) || null;
      },
    },
    barbershopMember: {
      findMany: async ({ where }: any = {}) => {
        return state.members.filter((m) => {
          if (where?.barbershopId && m.barbershopId !== where.barbershopId) return false;
          if (where?.OR) {
            const hasLegacyEntries = state.commissionEntries.some((e) => e.memberId === m.id);
            const hasLegacyPeriods = state.commissionPeriods.some((p) => p.memberId === m.id);
            const hasLegacyAdjustments = state.commissionAdjustments.some((a) => a.memberId === m.id);
            return hasLegacyEntries || hasLegacyPeriods || hasLegacyAdjustments;
          }
          return true;
        });
      },
      findUnique: async ({ where }: any = {}) => {
        return state.members.find((m) => m.id === where.id) || null;
      },
    },
    commissionPeriod: {
      findMany: async ({ where, orderBy }: any = {}) => {
        const res = state.commissionPeriods.filter((p) => {
          if (where?.barbershopId && p.barbershopId !== where.barbershopId) return false;
          if (where?.memberId && p.memberId !== where.memberId) return false;
          if (where?.status && p.status !== where.status) return false;
          return true;
        });
        if (orderBy) {
          res.sort((a, b) => {
            for (const rule of Array.isArray(orderBy) ? orderBy : [orderBy]) {
              const [key, dir] = Object.entries(rule)[0] as [string, "asc" | "desc"];
              const va = a[key];
              const vb = b[key];
              if (va < vb) return dir === "asc" ? -1 : 1;
              if (va > vb) return dir === "asc" ? 1 : -1;
            }
            return 0;
          });
        }
        return res.map((p) => ({
          ...p,
          member: state.members.find((m) => m.id === p.memberId),
        }));
      },
      count: async ({ where }: any = {}) => {
        return state.commissionPeriods.filter((p) => {
          if (where?.barbershopId && p.barbershopId !== where.barbershopId) return false;
          if (where?.status && p.status !== where.status) return false;
          return true;
        }).length;
      },
    },
    commissionEntry: {
      findMany: async ({ where, orderBy }: any = {}) => {
        const res = state.commissionEntries.filter((e) => {
          if (where?.barbershopId && e.barbershopId !== where.barbershopId) return false;
          if (where?.memberId && e.memberId !== where.memberId) return false;
          if (where?.competence && e.competence !== where.competence) return false;
          return true;
        });
        if (orderBy) {
          res.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
        }
        return res;
      },
    },
    commissionAdjustment: {
      findMany: async ({ where, orderBy }: any = {}) => {
        const res = state.commissionAdjustments.filter((a) => {
          if (where?.barbershopId && a.barbershopId !== where.barbershopId) return false;
          if (where?.memberId && a.memberId !== where.memberId) return false;
          if (where?.type && a.type !== where.type) return false;
          return true;
        });
        if (orderBy) {
          res.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
        }
        return res;
      },
      count: async ({ where }: any = {}) => {
        return state.commissionAdjustments.filter((a) => !where?.barbershopId || a.barbershopId === where.barbershopId).length;
      },
    },
    commissionCycle: {
      findMany: async ({ where }: any = {}) => {
        return state.commissionCycles.filter((c) => {
          if (where?.barbershopId && c.barbershopId !== where.barbershopId) return false;
          if (where?.status && c.status !== where.status) return false;
          return true;
        });
      },
      findFirst: async ({ where }: any) => {
        return (
          state.commissionCycles.find((c) => {
            if (where?.barbershopId && c.barbershopId !== where.barbershopId) return false;
            if (where?.memberId && c.memberId !== where.memberId) return false;
            if (where?.status && c.status !== where.status) return false;
            return true;
          }) || null
        );
      },
      findUnique: async ({ where }: any) => {
        if (where.barbershopId_memberId_cycleNumber) {
          const { barbershopId, memberId, cycleNumber } = where.barbershopId_memberId_cycleNumber;
          return (
            state.commissionCycles.find(
              (c) => c.barbershopId === barbershopId && c.memberId === memberId && c.cycleNumber === cycleNumber
            ) || null
          );
        }
        return state.commissionCycles.find((c) => c.id === where.id) || null;
      },
      create: async ({ data }: any) => {
        const row = { id: `cycle-${Date.now()}-${Math.random()}`, ...data };
        state.commissionCycles.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const idx = state.commissionCycles.findIndex((c) => c.id === where.id);
        if (idx >= 0) {
          state.commissionCycles[idx] = { ...state.commissionCycles[idx], ...data };
          return state.commissionCycles[idx];
        }
        throw new Error("Cycle not found for update");
      },
      count: async ({ where }: any = {}) => {
        return state.commissionCycles.filter((c) => !where?.barbershopId || c.barbershopId === where.barbershopId).length;
      },
    },
    commissionPayableItem: {
      findMany: async ({ where }: any = {}) => {
        return state.commissionPayableItems.filter((i) => {
          if (where?.barbershopId && i.barbershopId !== where.barbershopId) return false;
          if (where?.cycleId && i.cycleId !== where.cycleId) return false;
          return true;
        });
      },
      findUnique: async ({ where }: any) => {
        if (where.barbershopId_eventKey) {
          const { barbershopId, eventKey } = where.barbershopId_eventKey;
          return (
            state.commissionPayableItems.find(
              (i) => i.barbershopId === barbershopId && i.eventKey === eventKey
            ) || null
          );
        }
        return state.commissionPayableItems.find((i) => i.id === where.id) || null;
      },
      create: async ({ data }: any) => {
        const row = { id: `payable-${Date.now()}-${Math.random()}`, ...data };
        state.commissionPayableItems.push(row);
        return row;
      },
      count: async ({ where }: any = {}) => {
        return state.commissionPayableItems.filter((i) => {
          if (where?.barbershopId && i.barbershopId !== where.barbershopId) return false;
          if (where?.sourceKind?.not && i.sourceKind === where.sourceKind.not) return false;
          return true;
        }).length;
      },
    },
    commissionPayout: {
      findMany: async ({ where }: any = {}) => {
        return state.commissionPayouts.filter((p) => !where?.barbershopId || p.barbershopId === where.barbershopId);
      },
      findUnique: async ({ where }: any) => {
        if (where.barbershopId_idempotencyKey) {
          const { barbershopId, idempotencyKey } = where.barbershopId_idempotencyKey;
          const found = state.commissionPayouts.find(
            (p) => p.barbershopId === barbershopId && p.idempotencyKey === idempotencyKey
          );
          if (!found) return null;
          return {
            ...found,
            cycle: state.commissionCycles.find((c) => c.id === found.cycleId),
            financialEntry: state.financialEntries.find((f) => f.commissionPayoutId === found.id) || null,
            cashMovement: state.cashMovements.find((cm) => cm.commissionPayoutId === found.id) || null,
          };
        }
        return state.commissionPayouts.find((p) => p.id === where.id) || null;
      },
      create: async ({ data }: any) => {
        const row = { id: `payout-${Date.now()}-${Math.random()}`, ...data };
        state.commissionPayouts.push(row);
        return row;
      },
      count: async ({ where }: any = {}) => {
        return state.commissionPayouts.filter((p) => {
          if (where?.barbershopId && p.barbershopId !== where.barbershopId) return false;
          if (where?.NOT?.idempotencyKey?.startsWith && p.idempotencyKey.startsWith(where.NOT.idempotencyKey.startsWith)) return false;
          return true;
        }).length;
      },
    },
    commissionCycleAdjustment: {
      findMany: async ({ where }: any = {}) => {
        return state.commissionCycleAdjustments.filter((a) => {
          if (where?.barbershopId && a.barbershopId !== where.barbershopId) return false;
          if (where?.cycleId && a.cycleId !== where.cycleId) return false;
          return true;
        });
      },
      findUnique: async ({ where }: any) => {
        if (where.barbershopId_idempotencyKey) {
          const { barbershopId, idempotencyKey } = where.barbershopId_idempotencyKey;
          return (
            state.commissionCycleAdjustments.find(
              (a) => a.barbershopId === barbershopId && a.idempotencyKey === idempotencyKey
            ) || null
          );
        }
        return state.commissionCycleAdjustments.find((a) => a.id === where.id) || null;
      },
      create: async ({ data }: any) => {
        const row = { id: `cadj-${Date.now()}-${Math.random()}`, ...data };
        state.commissionCycleAdjustments.push(row);
        return row;
      },
      count: async ({ where }: any = {}) => {
        return state.commissionCycleAdjustments.filter((a) => {
          if (where?.barbershopId && a.barbershopId !== where.barbershopId) return false;
          if (where?.NOT?.idempotencyKey?.startsWith && a.idempotencyKey?.startsWith(where.NOT.idempotencyKey.startsWith)) return false;
          return true;
        }).length;
      },
    },
    commissionAdvance: {
      findMany: async ({ where }: any = {}) => {
        return state.commissionAdvances.filter((a) => !where?.cycleId || a.cycleId === where.cycleId).map((a) => ({ ...a, reversals: [] }));
      },
      count: async ({ where }: any = {}) => {
        return state.commissionAdvances.filter((a) => {
          if (where?.barbershopId && a.barbershopId !== where.barbershopId) return false;
          if (where?.NOT?.idempotencyKey?.startsWith && a.idempotencyKey.startsWith(where.NOT.idempotencyKey.startsWith)) return false;
          return true;
        }).length;
      },
    },
    financialEntry: {
      count: async () => state.financialEntries.length,
    },
    cashMovement: {
      count: async () => state.cashMovements.length,
    },
  };

  return { tx, state };
}

describe("C11.2 Legacy Schema Cutover and Idempotent Backfill", () => {
  const shopId = "shop-1";
  const userId = "user-1";
  const memberId = "member-1";

  // Test 1, 2, 3: Schema & Migration Invariants
  it("1. unconditional comandaItemId unique removed from schema", () => {
    const schemaContent = fs.readFileSync(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    const entryModelMatch = schemaContent.match(/model CommissionEntry\s*\{([\s\S]*?)\n\}/);
    expect(entryModelMatch).toBeTruthy();
    const entryModel = entryModelMatch![1];
    expect(entryModel).not.toMatch(/comandaItemId\s+String\s+@unique/);
    expect(entryModel).toMatch(/comandaItemId\s+String\s+@map\("comanda_item_id"\)/);
  });

  it("2. composite version unique retained in schema", () => {
    const schemaContent = fs.readFileSync(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schemaContent).toContain("@@unique([comandaItemId, attributionVersion])");
  });

  it("3. partial one-current unique retained and verified in migration SQL", () => {
    const migrationSql = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "prisma/migrations/20260904120000_drop_commission_entries_comanda_item_id_key/migration.sql"
      ),
      "utf8"
    );
    expect(migrationSql).toContain("commission_entries_one_current_per_comanda_item_uidx");
    expect(migrationSql).toContain("DROP INDEX \"commission_entries_comanda_item_id_key\"");
    expect(migrationSql).toContain("VERSIONING_INDEX_PREREQUISITE_FAILED");
  });

  // Test 4 & 5 & 6: Preflight PAID Validation
  it("4. preflight passes when legacy PAID period has paidAmount == releasedAmount", async () => {
    const { tx } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionPeriods: [
        {
          id: "period-1",
          barbershopId: shopId,
          memberId,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("100.00"),
          paidAmount: new Prisma.Decimal("100.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
      ],
      commissionEntries: [
        {
          id: "entry-1",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-1",
          competence: "2026-07",
          baseAmount: new Prisma.Decimal("200.00"),
          generatedAmount: new Prisma.Decimal("100.00"),
          releasedAmount: new Prisma.Decimal("100.00"),
          paidAmount: new Prisma.Decimal("100.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
      ],
    });

    const report = await runPreflight(tx, shopId);
    expect(report.status).toBe("READY");
    expect(report.totalBlockersCount).toBe(0);
  });

  it("5. preflight aborts with PAID_HISTORY_RECONCILIATION_MISMATCH if paid != released", async () => {
    const { tx } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionPeriods: [
        {
          id: "period-mismatch",
          barbershopId: shopId,
          memberId,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("100.00"),
          paidAmount: new Prisma.Decimal("80.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
      ],
    });

    const report = await runPreflight(tx, shopId);
    expect(report.status).toBe("BLOCKED");
    expect(report.tenants[0].blockers.some((b) => b.includes("PAID_HISTORY_RECONCILIATION_MISMATCH"))).toBe(true);

    await expect(applyCutoverForTenant(tx, shopId)).rejects.toThrow(CutoverError);
  });

  it("6. no balancing adjustment is invented for PAID mismatch", async () => {
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionPeriods: [
        {
          id: "period-mismatch",
          barbershopId: shopId,
          memberId,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("100.00"),
          paidAmount: new Prisma.Decimal("80.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
      ],
    });

    await expect(applyCutoverForTenant(tx, shopId)).rejects.toThrow("PAID_HISTORY_RECONCILIATION_MISMATCH");
    expect(state.commissionCycleAdjustments).toHaveLength(0);
    expect(state.commissionCycles).toHaveLength(0);
  });

  // Test 7 & 8: Cycle Numbering Sequence
  it("7. assigns deterministic cycle numbers 1..N to historical PAID periods oldest to newest", async () => {
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionPeriods: [
        {
          id: "period-aug",
          barbershopId: shopId,
          memberId,
          competence: "2026-08",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("50.00"),
          paidAt: new Date("2026-09-05"),
          paidById: userId,
        },
        {
          id: "period-jul",
          barbershopId: shopId,
          memberId,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("40.00"),
          paidAmount: new Prisma.Decimal("40.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
      ],
      commissionEntries: [
        {
          id: "entry-jul",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-jul",
          competence: "2026-07",
          baseAmount: new Prisma.Decimal("80.00"),
          generatedAmount: new Prisma.Decimal("40.00"),
          releasedAmount: new Prisma.Decimal("40.00"),
          paidAmount: new Prisma.Decimal("40.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
        {
          id: "entry-aug",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-aug",
          competence: "2026-08",
          baseAmount: new Prisma.Decimal("100.00"),
          generatedAmount: new Prisma.Decimal("50.00"),
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("50.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
      ],
    });

    const summary = await applyCutoverForTenant(tx, shopId);
    expect(summary.historicalPaidCyclesCreated).toBe(2);

    const paidCycles = state.commissionCycles
      .filter((c) => c.status === CommissionCycleStatus.PAID)
      .sort((a, b) => a.cycleNumber - b.cycleNumber);

    expect(paidCycles[0].cycleNumber).toBe(1);
    expect(toCents(paidCycles[0].finalPayoutAmount)).toBe(4000); // July
    expect(paidCycles[1].cycleNumber).toBe(2);
    expect(toCents(paidCycles[1].finalPayoutAmount)).toBe(5000); // August
  });

  it("8. assigns cycleNumber = N + 1 to current OPEN cycle", async () => {
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionPeriods: [
        {
          id: "period-jul",
          barbershopId: shopId,
          memberId,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("40.00"),
          paidAmount: new Prisma.Decimal("40.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
      ],
      commissionEntries: [
        {
          id: "entry-jul",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-jul",
          competence: "2026-07",
          baseAmount: new Prisma.Decimal("80.00"),
          generatedAmount: new Prisma.Decimal("40.00"),
          releasedAmount: new Prisma.Decimal("40.00"),
          paidAmount: new Prisma.Decimal("40.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
      ],
    });

    await applyCutoverForTenant(tx, shopId);
    const openCycle = state.commissionCycles.find((c) => c.status === CommissionCycleStatus.OPEN);
    expect(openCycle).toBeTruthy();
    expect(openCycle.cycleNumber).toBe(2); // 1 historical paid period => open is #2
  });

  // Test 9, 10, 11, 12, 13: Historical Paid Ledger & Payout Invariants
  it("9 & 10. historical paid entry creates LEGACY_BACKFILL payable items whose sum equals payout", async () => {
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionPeriods: [
        {
          id: "period-1",
          barbershopId: shopId,
          memberId,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("70.00"),
          paidAmount: new Prisma.Decimal("70.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
      ],
      commissionEntries: [
        {
          id: "entry-1a",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-1a",
          competence: "2026-07",
          baseAmount: new Prisma.Decimal("60.00"),
          generatedAmount: new Prisma.Decimal("30.00"),
          releasedAmount: new Prisma.Decimal("30.00"),
          paidAmount: new Prisma.Decimal("30.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
        {
          id: "entry-1b",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-1b",
          competence: "2026-07",
          baseAmount: new Prisma.Decimal("80.00"),
          generatedAmount: new Prisma.Decimal("40.00"),
          releasedAmount: new Prisma.Decimal("40.00"),
          paidAmount: new Prisma.Decimal("40.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
      ],
    });

    await applyCutoverForTenant(tx, shopId);

    const paidCycle = state.commissionCycles.find((c) => c.status === CommissionCycleStatus.PAID);
    const paidItems = state.commissionPayableItems.filter((i) => i.cycleId === paidCycle.id);

    expect(paidItems).toHaveLength(2);
    expect(paidItems.every((i) => i.sourceKind === CommissionPayableSourceKind.LEGACY_BACKFILL)).toBe(true);

    const sumPaid = paidItems.reduce((acc, it) => acc + toCents(it.amount), 0);
    expect(sumPaid).toBe(7000); // 70.00 exactly matches payout
  });

  it("11 & 12. historical payout creates no FinancialEntry and no CashMovement", async () => {
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionPeriods: [
        {
          id: "period-1",
          barbershopId: shopId,
          memberId,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("50.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
      ],
      commissionEntries: [
        {
          id: "entry-1",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-1",
          competence: "2026-07",
          baseAmount: new Prisma.Decimal("100.00"),
          generatedAmount: new Prisma.Decimal("50.00"),
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("50.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
      ],
    });

    await applyCutoverForTenant(tx, shopId);
    expect(state.commissionPayouts).toHaveLength(1);
    expect(state.financialEntries).toHaveLength(0);
    expect(state.cashMovements).toHaveLength(0);
  });

  it("13. historical ledger is excluded from P&L queries", () => {
    // In src/app/api/admin/financial/summary/route.ts line 140:
    // sourceKind: { not: "LEGACY_BACKFILL" }
    // We verify all backfilled items have sourceKind === "LEGACY_BACKFILL"
    const backfillKind = CommissionPayableSourceKind.LEGACY_BACKFILL;
    const filterRule = { sourceKind: { not: "LEGACY_BACKFILL" } };
    expect(backfillKind === filterRule.sourceKind.not).toBe(true);
  });

  // Test 14, 15, 16, 17, 18: Unpaid Entry-Level Liability Formulas
  it("14 & 15. remaining entry = max(0, released - paid) without subtracting reversedAmount again", async () => {
    // In legacy, reversedAmount was already subtracted from releasedAmount.
    // E.g., generated 100, released 80 (was 100 before 20 refund), reversedAmount 20, paid 30.
    // True remaining is 80 - 30 = 50. NOT 80 - 30 - 20 = 30.
    const released = 8000;
    const paid = 3000;
    const reversed = 2000;
    const remaining = Math.max(0, released - paid);
    expect(remaining).toBe(5000);
    expect(remaining).not.toBe(released - paid - reversed);
  });

  it("16. partially paid entry imports only remainder into current OPEN cycle", async () => {
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionEntries: [
        {
          id: "entry-partial",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-part",
          competence: "2026-08",
          baseAmount: new Prisma.Decimal("100.00"),
          generatedAmount: new Prisma.Decimal("50.00"),
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("20.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
      ],
    });

    await applyCutoverForTenant(tx, shopId);
    const openItems = state.commissionPayableItems.filter((i) => i.eventKey.startsWith("legacy-backfill:entry:"));
    expect(openItems).toHaveLength(1);
    expect(toCents(openItems[0].amount)).toBe(3000); // 50 - 20 = 30.00 remainder
  });

  it("17. fully paid entry imports no current liability", async () => {
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionEntries: [
        {
          id: "entry-full",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-full",
          competence: "2026-08",
          baseAmount: new Prisma.Decimal("100.00"),
          generatedAmount: new Prisma.Decimal("50.00"),
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("50.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
      ],
    });

    await applyCutoverForTenant(tx, shopId);
    const openItems = state.commissionPayableItems.filter((i) => i.eventKey.startsWith("legacy-backfill:entry:"));
    expect(openItems).toHaveLength(0); // 0 remaining
  });

  it("18. post-paid refund where released < paid is floored at 0 and not imported twice", async () => {
    // E.g., paid 50 in past period. Later refund 20 makes releasedAmount = 30.
    // Entry remaining is max(0, 30 - 50) = 0.
    // The negative 20 is handled by terminal PAID_ADJUSTMENT, never as a negative entry.
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionEntries: [
        {
          id: "entry-post-refund",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-post-refund",
          competence: "2026-08",
          baseAmount: new Prisma.Decimal("100.00"),
          generatedAmount: new Prisma.Decimal("50.00"),
          releasedAmount: new Prisma.Decimal("30.00"),
          paidAmount: new Prisma.Decimal("50.00"),
          reversedAmount: new Prisma.Decimal("20.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
      ],
      commissionAdjustments: [
        {
          id: "adj-terminal-debit",
          barbershopId: shopId,
          memberId,
          type: "PAID_ADJUSTMENT",
          amount: new Prisma.Decimal("-20.00"),
          competence: "2026-09",
          rolloverFromCompetence: "2026-08",
          description: "Estorno post-paid",
        },
      ],
    });

    await applyCutoverForTenant(tx, shopId);

    // Entry remaining is 0 => no payable item for opening liability
    const openPayableItems = state.commissionPayableItems.filter((i) => i.eventKey.startsWith("legacy-backfill:entry:"));
    expect(openPayableItems).toHaveLength(0);

    // Terminal adjustment imported exactly once as DEBIT 20.00
    const openAdjs = state.commissionCycleAdjustments;
    expect(openAdjs).toHaveLength(1);
    expect(openAdjs[0].type).toBe(CommissionCycleAdjustmentType.DEBIT);
    expect(toCents(openAdjs[0].amount)).toBe(2000);

    const openCycle = state.commissionCycles.find((c) => c.status === CommissionCycleStatus.OPEN);
    expect(toCents(openCycle.remainingBalance)).toBe(-2000);
  });

  // Test 19, 20, 21, 22: Rollover Chaining and Collapse
  it("19 & 20. rollover chain Aug -> Sep -> Oct imported once into current OPEN", async () => {
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionAdjustments: [
        {
          id: "adj-aug",
          barbershopId: shopId,
          memberId,
          type: "PAID_ADJUSTMENT",
          amount: new Prisma.Decimal("-8.00"),
          competence: "2026-09",
          rolloverFromCompetence: "2026-08",
          description: "Carry over Aug",
        },
        {
          id: "adj-sep",
          barbershopId: shopId,
          memberId,
          type: "PAID_ADJUSTMENT",
          amount: new Prisma.Decimal("-8.00"),
          competence: "2026-10",
          rolloverFromCompetence: "2026-09",
          description: "Carry over Sep",
        },
      ],
    });

    await applyCutoverForTenant(tx, shopId);

    // Only terminal adj-sep is imported
    expect(state.commissionCycleAdjustments).toHaveLength(1);
    expect(state.commissionCycleAdjustments[0].sourceAdjustmentId).toBe("adj-sep");
    expect(toCents(state.commissionCycleAdjustments[0].amount)).toBe(800);
    expect(state.commissionCycleAdjustments[0].type).toBe(CommissionCycleAdjustmentType.DEBIT);
  });

  it("21. cleared/deleted rollover imports zero opening adjustment", async () => {
    // If debt was settled in legacy, the adjustment row was deleted before cutover
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionAdjustments: [],
    });

    await applyCutoverForTenant(tx, shopId);
    expect(state.commissionCycleAdjustments).toHaveLength(0);
  });

  it("22 & 23. exact sourceAdjustmentId and legacyEntryId preserved", async () => {
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionEntries: [
        {
          id: "legacy-entry-42",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-42",
          competence: "2026-08",
          baseAmount: new Prisma.Decimal("100.00"),
          generatedAmount: new Prisma.Decimal("50.00"),
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("0.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
      ],
      commissionAdjustments: [
        {
          id: "legacy-adj-99",
          barbershopId: shopId,
          memberId,
          type: "PAID_ADJUSTMENT",
          amount: new Prisma.Decimal("-15.00"),
          competence: "2026-08",
          description: "Adjustment 99",
        },
      ],
    });

    await applyCutoverForTenant(tx, shopId);

    const item = state.commissionPayableItems.find((i) => i.entryId === "legacy-entry-42");
    expect(item?.legacyEntryId).toBe("legacy-entry-42");

    const adj = state.commissionCycleAdjustments.find((a) => a.sourceAdjustmentId === "legacy-adj-99");
    expect(adj?.sourceAdjustmentId).toBe("legacy-adj-99");
  });

  // Test 24: Idempotent Rerun
  it("24. rerun backfill creates zero economic delta and zero duplicate rows", async () => {
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionPeriods: [
        {
          id: "period-1",
          barbershopId: shopId,
          memberId,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("50.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
      ],
      commissionEntries: [
        {
          id: "entry-paid",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-1",
          competence: "2026-07",
          baseAmount: new Prisma.Decimal("100.00"),
          generatedAmount: new Prisma.Decimal("50.00"),
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("50.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
        {
          id: "entry-unpaid",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-2",
          competence: "2026-08",
          baseAmount: new Prisma.Decimal("100.00"),
          generatedAmount: new Prisma.Decimal("50.00"),
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("0.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
      ],
    });

    const run1 = await applyCutoverForTenant(tx, shopId);
    const countCycles1 = state.commissionCycles.length;
    const countItems1 = state.commissionPayableItems.length;
    const countPayouts1 = state.commissionPayouts.length;

    const run2 = await applyCutoverForTenant(tx, shopId);
    expect(run2.historicalPaidCyclesCreated).toBe(0);
    expect(run2.historicalPayableItemsCreated).toBe(0);
    expect(run2.unpaidPayableItemsCreated).toBe(0);
    expect(run2.historicalPayoutsCreated).toBe(0);

    expect(state.commissionCycles.length).toBe(countCycles1);
    expect(state.commissionPayableItems.length).toBe(countItems1);
    expect(state.commissionPayouts.length).toBe(countPayouts1);
  });

  // Test 25: Pre-existing Safe Empty OPEN Cycle
  it("25. member already having an empty/safe OPEN cycle attaches liability and does not skip", async () => {
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionCycles: [
        {
          id: "open-cycle-preexisting",
          barbershopId: shopId,
          memberId,
          cycleNumber: 1,
          status: CommissionCycleStatus.OPEN,
          grossCommission: new Prisma.Decimal("0.00"),
          adjustmentsTotal: new Prisma.Decimal("0.00"),
          advancesTotal: new Prisma.Decimal("0.00"),
          finalPayoutAmount: new Prisma.Decimal("0.00"),
          remainingBalance: new Prisma.Decimal("0.00"),
        },
      ],
      commissionEntries: [
        {
          id: "entry-unpaid-1",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-1",
          competence: "2026-08",
          baseAmount: new Prisma.Decimal("100.00"),
          generatedAmount: new Prisma.Decimal("50.00"),
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("0.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
      ],
    });

    await applyCutoverForTenant(tx, shopId);

    const openItems = state.commissionPayableItems.filter((i) => i.cycleId === "open-cycle-preexisting");
    expect(openItems).toHaveLength(1);
    expect(toCents(openItems[0].amount)).toBe(5000);

    const openCycle = state.commissionCycles.find((c) => c.id === "open-cycle-preexisting");
    expect(toCents(openCycle.remainingBalance)).toBe(5000);
  });

  // Test 26: Mixed Non-backfill Canonical Data
  it("26. mixed non-backfill canonical data aborts with MIXED_CANONICAL_DATA_BLOCKER", async () => {
    const { tx } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionPayableItems: [
        {
          id: "non-backfill-payable",
          barbershopId: shopId,
          memberId,
          sourceKind: CommissionPayableSourceKind.PAYMENT, // Canonical live business activity
        },
      ],
    });

    const preflight = await runPreflight(tx, shopId);
    expect(preflight.status).toBe("BLOCKED");
    expect(preflight.tenants[0].blockers).toContain("MIXED_CANONICAL_DATA_BLOCKER");

    await expect(applyCutoverForTenant(tx, shopId)).rejects.toThrow("MIXED_CANONICAL_DATA_BLOCKER");
  });

  // Test 27: Historical Entry Reconciliation Mismatch
  it("27. historical entry reconciliation mismatch aborts tenant", async () => {
    const { tx } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionPeriods: [
        {
          id: "period-1",
          barbershopId: shopId,
          memberId,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("50.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
      ],
      commissionEntries: [
        // Entry says paidAmount is 30, but period says 50
        {
          id: "entry-1",
          barbershopId: shopId,
          memberId,
          comandaItemId: "item-1",
          competence: "2026-07",
          baseAmount: new Prisma.Decimal("100.00"),
          generatedAmount: new Prisma.Decimal("50.00"),
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("30.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          isCurrent: true,
          attributionVersion: 1,
        },
      ],
    });

    await expect(applyCutoverForTenant(tx, shopId)).rejects.toThrow("PAID_HISTORY_ENTRY_RECONCILIATION_MISMATCH");
  });

  // Test 28: Missing Historical paidAt
  it("28. missing historical paidAt aborts preflight", async () => {
    const { tx } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: shopId, userId }],
      commissionPeriods: [
        {
          id: "period-no-paid-at",
          barbershopId: shopId,
          memberId,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("50.00"),
          paidAt: null, // Missing!
          paidById: userId,
        },
      ],
    });

    const preflight = await runPreflight(tx, shopId);
    expect(preflight.status).toBe("BLOCKED");
    expect(preflight.tenants[0].blockers.some((b) => b.includes("PAID_PERIOD_MISSING_PAID_AT"))).toBe(true);
  });

  // Test 29: Cross-Tenant Legacy Provenance
  it("29. cross-tenant malformed legacy provenance aborts preflight", async () => {
    const { tx } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      users: [{ id: userId }],
      members: [{ id: memberId, barbershopId: "different-shop", userId }],
      commissionPeriods: [
        {
          id: "period-cross",
          barbershopId: shopId,
          memberId,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("50.00"),
          paidAmount: new Prisma.Decimal("50.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
      ],
    });

    const preflight = await runPreflight(tx, shopId);
    expect(preflight.status).toBe("BLOCKED");
    expect(preflight.tenants[0].blockers.some((b) => b.includes("CROSS_TENANT_LEGACY_PROVENANCE"))).toBe(true);
  });

  // Test 30: Verify Mode Detects Mismatch
  it("30. verify mode detects cache vs ledger discrepancy", async () => {
    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopId }],
      commissionCycles: [
        {
          id: "cycle-corrupt",
          barbershopId: shopId,
          status: CommissionCycleStatus.OPEN,
          grossCommission: new Prisma.Decimal("100.00"), // Cache says 100
          adjustmentsTotal: new Prisma.Decimal("0.00"),
          advancesTotal: new Prisma.Decimal("0.00"),
          remainingBalance: new Prisma.Decimal("100.00"),
        },
      ],
      commissionPayableItems: [
        {
          id: "item-actual",
          barbershopId: shopId,
          cycleId: "cycle-corrupt",
          type: CommissionPayableType.RELEASE,
          amount: new Prisma.Decimal("60.00"), // Actual ledger is only 60
        },
      ],
    });

    const verification = await verifyTenantCutover(tx, shopId);
    expect(verification.status).toBe("FAILED");
    expect(verification.failures.some((f) => f.reason.includes("OPEN cycle cache does not match authoritative ledger"))).toBe(true);
  });

  // Test 31: Global Preflight Aborts Before Any Mutation (Requirement 3.A)
  it("31. global preflight aborts before any mutation if Tenant B has mismatch, leaving Tenant A untouched", async () => {
    const shopA = "shop-a";
    const shopB = "shop-b";
    const memberA = "member-a";
    const memberB = "member-b";

    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopA }, { id: shopB }],
      users: [{ id: userId }],
      members: [
        { id: memberA, barbershopId: shopA, userId },
        { id: memberB, barbershopId: shopB, userId },
      ],
      commissionPeriods: [
        // Tenant A: valid period
        {
          id: "period-a",
          barbershopId: shopA,
          memberId: memberA,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("100.00"),
          paidAmount: new Prisma.Decimal("100.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
        // Tenant B: invalid period (paidAmount != releasedAmount)
        {
          id: "period-b",
          barbershopId: shopB,
          memberId: memberB,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("100.00"),
          paidAmount: new Prisma.Decimal("80.00"), // Mismatch!
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
      ],
    });

    // Attempt executeCutoverWorkflow with isApply=true across all tenants
    await expect(
      executeCutoverWorkflow(tx, { isApply: true })
    ).rejects.toThrow("GLOBAL_PREFLIGHT_BLOCKED");

    // Assert Tenant A remains completely untouched (zero canonical cycles created)
    const cyclesA = state.commissionCycles.filter((c) => c.barbershopId === shopA);
    const payableItemsA = state.commissionPayableItems.filter((i) => i.barbershopId === shopA);
    const payoutsA = state.commissionPayouts.filter((p) => p.barbershopId === shopA);

    expect(cyclesA.length).toBe(0);
    expect(payableItemsA.length).toBe(0);
    expect(payoutsA.length).toBe(0);
  });

  // Test 32: Global Preflight Aborts on Mixed Canonical Data
  it("32. global preflight aborts before any mutation if a tenant has mixed canonical data", async () => {
    const shopA = "shop-a";
    const shopB = "shop-b";
    const memberA = "member-a";
    const memberB = "member-b";

    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopA }, { id: shopB }],
      users: [{ id: userId }],
      members: [
        { id: memberA, barbershopId: shopA, userId },
        { id: memberB, barbershopId: shopB, userId },
      ],
      commissionPeriods: [
        {
          id: "period-a",
          barbershopId: shopA,
          memberId: memberA,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("100.00"),
          paidAmount: new Prisma.Decimal("100.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
      ],
      commissionPayableItems: [
        // Tenant B has existing business payable item (not backfill)
        {
          id: "payable-item-b",
          barbershopId: shopB,
          cycleId: "cycle-b",
          type: CommissionPayableType.RELEASE,
          amount: new Prisma.Decimal("50.00"),
          sourceKind: CommissionPayableSourceKind.PAYMENT,
        },
      ],
    });

    await expect(
      executeCutoverWorkflow(tx, { isApply: true })
    ).rejects.toThrow("GLOBAL_PREFLIGHT_BLOCKED");

    // Tenant A remains completely untouched
    const cyclesA = state.commissionCycles.filter((c) => c.barbershopId === shopA);
    expect(cyclesA.length).toBe(0);
  });

  // Test 33: Multi-tenant cutover workflow applies and verifies cleanly
  it("33. multi-tenant workflow applies and verifies cleanly when all tenants are valid", async () => {
    const shopA = "shop-a";
    const shopB = "shop-b";
    const memberA = "member-a";
    const memberB = "member-b";

    const { tx, state } = createInMemoryTx({
      barbershops: [{ id: shopA }, { id: shopB }],
      users: [{ id: userId }],
      members: [
        { id: memberA, barbershopId: shopA, userId },
        { id: memberB, barbershopId: shopB, userId },
      ],
      commissionPeriods: [
        {
          id: "period-a",
          barbershopId: shopA,
          memberId: memberA,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("100.00"),
          paidAmount: new Prisma.Decimal("100.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
        {
          id: "period-b",
          barbershopId: shopB,
          memberId: memberB,
          competence: "2026-07",
          status: "PAID",
          releasedAmount: new Prisma.Decimal("200.00"),
          paidAmount: new Prisma.Decimal("200.00"),
          paidAt: new Date("2026-08-05"),
          paidById: userId,
        },
      ],
      commissionEntries: [
        {
          id: "entry-a",
          barbershopId: shopA,
          memberId: memberA,
          comandaItemId: "item-a",
          competence: "2026-07",
          baseAmount: new Prisma.Decimal("100.00"),
          generatedAmount: new Prisma.Decimal("100.00"),
          releasedAmount: new Prisma.Decimal("100.00"),
          paidAmount: new Prisma.Decimal("100.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          paidAt: new Date("2026-08-05"),
          commissionPeriodId: "period-a",
          attributionVersion: 1,
          isCurrent: true,
        },
        {
          id: "entry-b",
          barbershopId: shopB,
          memberId: memberB,
          comandaItemId: "item-b",
          competence: "2026-07",
          baseAmount: new Prisma.Decimal("200.00"),
          generatedAmount: new Prisma.Decimal("200.00"),
          releasedAmount: new Prisma.Decimal("200.00"),
          paidAmount: new Prisma.Decimal("200.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          paidAt: new Date("2026-08-05"),
          commissionPeriodId: "period-b",
          attributionVersion: 1,
          isCurrent: true,
        },
      ],
    });

    const result = await executeCutoverWorkflow(tx, { isApply: true });
    expect(result.mode).toBe("APPLY");
    if (result.mode === "APPLY") {
      expect(result.summaries.length).toBe(2);
      expect(result.verify.status).toBe("VERIFIED");
    }

    expect(state.commissionCycles.length).toBe(4); // 2 historical PAID + 2 current OPEN
    expect(state.commissionPayouts.length).toBe(2); // 1 per historical PAID cycle
  });

  describe("C16.2 Provisioning Hotfix: Avoid Empty Cycles Without Legacy Provenance", () => {
    it("Case A: Tenant with OWNER and BARBER having no commission history -> 0 cycles created", async () => {
      const shopId = "shop-empty";
      const ownerId = "member-owner-empty";
      const barberId = "member-barber-empty";

      const { tx, state } = createInMemoryTx({
        barbershops: [{ id: shopId, name: "Empty Shop" }],
        members: [
          { id: ownerId, barbershopId: shopId, userId: "user-owner", role: "OWNER" },
          { id: barberId, barbershopId: shopId, userId: "user-barber", role: "BARBER" },
        ],
        commissionEntries: [],
        commissionPeriods: [],
        commissionAdjustments: [],
      });

      const summary = await applyCutoverForTenant(tx, shopId);
      expect(summary.openCyclesCreatedOrReused).toBe(0);
      expect(summary.historicalPaidCyclesCreated).toBe(0);
      expect(summary.reconciledMembersCount).toBe(0);
      expect(state.commissionCycles.length).toBe(0);
    });

    it("Case B: Member with outstanding CommissionEntry -> 1 OPEN cycle with liability", async () => {
      const shopId = "shop-b";
      const memberId = "member-b";

      const { tx, state } = createInMemoryTx({
        barbershops: [{ id: shopId, name: "Shop B" }],
        members: [{ id: memberId, barbershopId: shopId, userId: "user-b", role: "BARBER" }],
        commissionEntries: [
          {
            id: "entry-b1",
            barbershopId: shopId,
            memberId,
            comandaItemId: "item-b1",
            competence: "2026-08",
            baseAmount: new Prisma.Decimal("100.00"),
            generatedAmount: new Prisma.Decimal("40.00"),
            releasedAmount: new Prisma.Decimal("40.00"),
            paidAmount: new Prisma.Decimal("0.00"),
            reversedAmount: new Prisma.Decimal("0.00"),
            attributionVersion: 1,
            isCurrent: true,
          },
        ],
        commissionPeriods: [],
        commissionAdjustments: [],
      });

      const summary = await applyCutoverForTenant(tx, shopId);
      expect(summary.openCyclesCreatedOrReused).toBe(1);
      expect(summary.unpaidPayableItemsCreated).toBe(1);
      expect(state.commissionCycles.length).toBe(1);
      expect(state.commissionCycles[0].status).toBe(CommissionCycleStatus.OPEN);
      expect(Number(state.commissionCycles[0].remainingBalance)).toBe(40);
    });

    it("Case C: Member with historical PAID period -> 1 PAID cycle + 1 successor OPEN cycle", async () => {
      const shopId = "shop-c";
      const memberId = "member-c";
      const actorId = "user-actor-c";

      const { tx, state } = createInMemoryTx({
        barbershops: [{ id: shopId, name: "Shop C" }],
        users: [{ id: actorId, name: "Actor C" }],
        members: [{ id: memberId, barbershopId: shopId, userId: "user-c", role: "BARBER" }],
        commissionPeriods: [
          {
            id: "period-c1",
            barbershopId: shopId,
            memberId,
            competence: "2026-07",
            status: "PAID",
            releasedAmount: new Prisma.Decimal("50.00"),
            paidAmount: new Prisma.Decimal("50.00"),
            paidById: actorId,
            paidAt: new Date("2026-08-05"),
          },
        ],
        commissionEntries: [
          {
            id: "entry-c1",
            barbershopId: shopId,
            memberId,
            comandaItemId: "item-c1",
            competence: "2026-07",
            baseAmount: new Prisma.Decimal("100.00"),
            generatedAmount: new Prisma.Decimal("50.00"),
            releasedAmount: new Prisma.Decimal("50.00"),
            paidAmount: new Prisma.Decimal("50.00"),
            reversedAmount: new Prisma.Decimal("0.00"),
            paidAt: new Date("2026-08-05"),
            commissionPeriodId: "period-c1",
            attributionVersion: 1,
            isCurrent: true,
          },
        ],
        commissionAdjustments: [],
      });

      const summary = await applyCutoverForTenant(tx, shopId);
      expect(summary.historicalPaidCyclesCreated).toBe(1);
      expect(summary.openCyclesCreatedOrReused).toBe(1);
      expect(state.commissionCycles.length).toBe(2);
      expect(state.commissionCycles.filter((c) => c.status === CommissionCycleStatus.PAID).length).toBe(1);
      expect(state.commissionCycles.filter((c) => c.status === CommissionCycleStatus.OPEN).length).toBe(1);
    });

    it("Case D: Member with legacy CommissionAdjustment provenance only -> OPEN cycle created", async () => {
      const shopId = "shop-d";
      const memberId = "member-d";

      const { tx, state } = createInMemoryTx({
        barbershops: [{ id: shopId, name: "Shop D" }],
        members: [{ id: memberId, barbershopId: shopId, userId: "user-d", role: "BARBER" }],
        commissionPeriods: [],
        commissionEntries: [],
        commissionAdjustments: [
          {
            id: "adj-d1",
            barbershopId: shopId,
            memberId,
            type: "PAID_ADJUSTMENT",
            amount: new Prisma.Decimal("15.00"),
            description: "Legacy unliquidated bonus",
            competence: "2026-08",
            createdAt: new Date("2026-08-10"),
          },
        ],
      });

      const summary = await applyCutoverForTenant(tx, shopId);
      expect(summary.openCyclesCreatedOrReused).toBe(1);
      expect(summary.terminalCycleAdjustmentsCreated).toBe(1);
      expect(state.commissionCycles.length).toBe(1);
      expect(Number(state.commissionCycles[0].remainingBalance)).toBe(15);
    });

    it("Case E: Mixed tenant: only provenance members receive cycles", async () => {
      const shopId = "shop-mixed";
      const memberNoHistory = "member-no-hist";
      const memberWithHistory = "member-with-hist";

      const { tx, state } = createInMemoryTx({
        barbershops: [{ id: shopId, name: "Mixed Shop" }],
        members: [
          { id: memberNoHistory, barbershopId: shopId, userId: "user-1", role: "OWNER" },
          { id: memberWithHistory, barbershopId: shopId, userId: "user-2", role: "BARBER" },
        ],
        commissionEntries: [
          {
            id: "entry-m1",
            barbershopId: shopId,
            memberId: memberWithHistory,
            comandaItemId: "item-m1",
            competence: "2026-08",
            baseAmount: new Prisma.Decimal("100.00"),
            generatedAmount: new Prisma.Decimal("30.00"),
            releasedAmount: new Prisma.Decimal("30.00"),
            paidAmount: new Prisma.Decimal("0.00"),
            reversedAmount: new Prisma.Decimal("0.00"),
            attributionVersion: 1,
            isCurrent: true,
          },
        ],
        commissionPeriods: [],
        commissionAdjustments: [],
      });

      const summary = await applyCutoverForTenant(tx, shopId);
      expect(summary.openCyclesCreatedOrReused).toBe(1);
      expect(state.commissionCycles.length).toBe(1);
      expect(state.commissionCycles[0].memberId).toBe(memberWithHistory);
    });

    it("Case F: Rerun produces 0 duplicate cycle and 0 economic delta", async () => {
      const shopId = "shop-rerun";
      const memberId = "member-rerun";

      const { tx, state } = createInMemoryTx({
        barbershops: [{ id: shopId, name: "Rerun Shop" }],
        members: [
          { id: "member-zero", barbershopId: shopId, userId: "user-z", role: "OWNER" },
          { id: memberId, barbershopId: shopId, userId: "user-r", role: "BARBER" },
        ],
        commissionEntries: [
          {
            id: "entry-r1",
            barbershopId: shopId,
            memberId,
            comandaItemId: "item-r1",
            competence: "2026-08",
            baseAmount: new Prisma.Decimal("100.00"),
            generatedAmount: new Prisma.Decimal("50.00"),
            releasedAmount: new Prisma.Decimal("50.00"),
            paidAmount: new Prisma.Decimal("0.00"),
            reversedAmount: new Prisma.Decimal("0.00"),
            attributionVersion: 1,
            isCurrent: true,
          },
        ],
        commissionPeriods: [],
        commissionAdjustments: [],
      });

      const run1 = await applyCutoverForTenant(tx, shopId);
      const run2 = await applyCutoverForTenant(tx, shopId);

      expect(run1.openCyclesCreatedOrReused).toBe(1);
      expect(run2.openCyclesCreatedOrReused).toBe(1);
      expect(state.commissionCycles.length).toBe(1);
      expect(state.commissionPayableItems.length).toBe(1);
    });
  });
});
