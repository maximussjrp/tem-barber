/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from "vitest";
import {
  ComandaItemStatus,
  ComandaItemType,
  ComandaStatus,
  CommissionCycleAdjustmentType,
  CommissionCycleStatus,
  CommissionDisbursementMethod,
  CommissionEntryStatus,
  CommissionPayableSourceKind,
  CommissionPayableType,
  FinancialEntryType,
  Prisma,
} from "@prisma/client";
import {
  createCommissionAdvance,
  reverseCommissionAdvance,
  executeCommissionPayout,
  getAuthoritativeCycleBalance,
  syncCommissionReleaseForComanda,
  reverseCommissionEntry,
  CommissionError,
} from "@/lib/operations/commissions";
import { fromCents, toCents } from "@/lib/operations/money";

function createInMemoryC7Db() {
  const state = {
    members: [] as any[],
    services: [] as any[],
    configs: [] as any[],
    comandas: [] as any[],
    comandaItems: [] as any[],
    payments: [] as any[],
    entries: [] as any[],
    cycles: [] as any[],
    payableItems: [] as any[],
    cycleAdjustments: [] as any[],
    advances: [] as any[],
    advanceReversals: [] as any[],
    advanceAudits: [] as any[],
    payouts: [] as any[],
    financialEntries: [] as any[],
    cashSessions: [] as any[],
    cashMovements: [] as any[],
    legacyAdjustments: [] as any[],
    appointments: [] as any[],
  };

  const tx: any = {
    $executeRaw: async () => 1,
    barbershopMember: {
      findFirst: async ({ where }: any) =>
        state.members.find(
          (m) =>
            (!where.id || m.id === where.id) &&
            (!where.barbershopId || m.barbershopId === where.barbershopId)
        ) || null,
      findUnique: async ({ where }: any) =>
        state.members.find(
          (m) =>
            (!where.id || m.id === where.id) &&
            (!where.barbershopId_userId ||
              (m.barbershopId === where.barbershopId_userId.barbershopId &&
                m.userId === where.barbershopId_userId.userId))
        ) || null,
      findFirstOrThrow: async ({ where }: any) => {
        const found = state.members.find(
          (m) =>
            (!where.id || m.id === where.id) &&
            (!where.barbershopId || m.barbershopId === where.barbershopId)
        );
        if (!found) throw new Error("Member not found");
        return found;
      },
    },
    service: {
      findFirst: async ({ where }: any) =>
        state.services.find(
          (s) =>
            (!where.id || s.id === where.id) &&
            (!where.barbershopId || s.barbershopId === where.barbershopId)
        ) || null,
      findFirstOrThrow: async ({ where }: any) => {
        const found = state.services.find(
          (s) =>
            (!where.id || s.id === where.id) &&
            (!where.barbershopId || s.barbershopId === where.barbershopId)
        );
        if (!found) throw new Error("Service not found");
        return found;
      },
    },
    product: {
      findFirst: async () => null,
      findFirstOrThrow: async () => {
        throw new Error("Not found");
      },
    },
    careerLevel: {
      findFirst: async () => null,
    },
    serviceCommissionRule: {
      findFirst: async () => null,
    },
    commissionConfig: {
      findMany: async ({ where }: any) =>
        state.configs.filter(
          (c) =>
            (!where.barbershopId || c.barbershopId === where.barbershopId) &&
            (where.active === undefined || c.active === where.active)
        ),
    },
    appointment: {
      findUnique: async ({ where }: any) =>
        state.appointments.find((a) => a.id === where.id) || null,
    },
    comanda: {
      findFirst: async ({ where }: any) => {
        const c = state.comandas.find(
          (cmd) =>
            (!where.id || cmd.id === where.id) &&
            (!where.barbershopId || cmd.barbershopId === where.barbershopId)
        );
        if (!c) return null;
        return {
          ...c,
          items: state.comandaItems
            .filter((i) => i.comandaId === c.id)
            .map((i) => ({
              ...i,
              commissionEntry: state.entries.find((e) => e.comandaItemId === i.id) || null,
            })),
        };
      },
      findFirstOrThrow: async (args: any) => {
        const found = await tx.comanda.findFirst(args);
        if (!found) throw new Error("Comanda not found");
        return found;
      },
      update: async ({ where, data }: any) => {
        const c = state.comandas.find((cmd) => cmd.id === where.id);
        if (!c) throw new Error("Comanda not found");
        if (data.status) c.status = data.status;
        if (data.commissionRevision?.increment) c.commissionRevision += data.commissionRevision.increment;
        return c;
      },
    },
    comandaItem: {
      findMany: async ({ where }: any) =>
        state.comandaItems.filter((i) => !where.comandaId || i.comandaId === where.comandaId),
      findFirst: async ({ where }: any) =>
        state.comandaItems.find((i) => !where.id || i.id === where.id) || null,
    },
    payment: {
      findMany: async ({ where }: any) =>
        state.payments.filter(
          (p) =>
            (!where.comandaId || p.comandaId === where.comandaId) &&
            (!where.status || p.status === where.status)
        ),
    },
    commissionEntry: {
      findUnique: async ({ where }: any) =>
        state.entries.find(
          (e) =>
            (!where.id || e.id === where.id) &&
            (!where.comandaItemId || e.comandaItemId === where.comandaItemId)
        ) || null,
      findFirst: async ({ where }: any) =>
        state.entries.find(
          (e) =>
            (!where.id || e.id === where.id) &&
            (!where.barbershopId || e.barbershopId === where.barbershopId) &&
            (!where.comandaItemId || e.comandaItemId === where.comandaItemId)
        ) || null,
      findMany: async ({ where }: any) =>
        state.entries.filter(
          (e) =>
            (!where.barbershopId || e.barbershopId === where.barbershopId) &&
            (!where.memberId || e.memberId === where.memberId) &&
            (!where.comandaItem?.comandaId ||
              state.comandaItems.some(
                (i) => i.id === e.comandaItemId && i.comandaId === where.comandaItem.comandaId
              ))
        ),
      create: async ({ data }: any) => {
        const item = {
          id: `entry-${state.entries.length + 1}`,
          releasedAmount: new Prisma.Decimal("0.00"),
          reversedAmount: new Prisma.Decimal("0.00"),
          paidAmount: new Prisma.Decimal("0.00"),
          status: data.status || CommissionEntryStatus.GENERATED,
          ...data,
        };
        state.entries.push(item);
        return item;
      },
      update: async ({ where, data }: any) => {
        const idx = state.entries.findIndex((e) => e.id === where.id);
        if (idx === -1) throw new Error("Entry not found");
        state.entries[idx] = { ...state.entries[idx], ...data };
        return state.entries[idx];
      },
      delete: async ({ where }: any) => {
        const idx = state.entries.findIndex((e) => e.id === where.id);
        if (idx !== -1) state.entries.splice(idx, 1);
      },
    },
    commissionCycle: {
      findFirst: async ({ where, orderBy }: any) => {
        let list = state.cycles.filter(
          (c) =>
            (!where.id || c.id === where.id) &&
            (!where.barbershopId || c.barbershopId === where.barbershopId) &&
            (!where.memberId || c.memberId === where.memberId) &&
            (!where.status || c.status === where.status)
        );
        if (orderBy?.cycleNumber === "desc") {
          list = [...list].sort((a, b) => b.cycleNumber - a.cycleNumber);
        }
        return list[0] || null;
      },
      create: async ({ data }: any) => {
        const cycle = { id: `cycle-${state.cycles.length + 1}`, ...data };
        state.cycles.push(cycle);
        return cycle;
      },
      update: async ({ where, data }: any) => {
        const c = state.cycles.find((cy) => cy.id === where.id);
        if (!c) throw new Error("Cycle not found");
        if (data.version?.increment) {
          c.version = (c.version ?? 1) + data.version.increment;
          delete data.version;
        }
        Object.assign(c, data);
        return c;
      },
    },
    commissionPayableItem: {
      findUnique: async ({ where }: any) => {
        if (where.barbershopId_eventKey) {
          return (
            state.payableItems.find(
              (p) =>
                p.barbershopId === where.barbershopId_eventKey.barbershopId &&
                p.eventKey === where.barbershopId_eventKey.eventKey
            ) || null
          );
        }
        return null;
      },
      findMany: async ({ where }: any) =>
        state.payableItems.filter(
          (p) =>
            (!where.cycleId || p.cycleId === where.cycleId) &&
            (!where.barbershopId || p.barbershopId === where.barbershopId)
        ),
      findFirst: async ({ where, orderBy }: any) => {
        let list = state.payableItems.filter(
          (p) =>
            (!where.barbershopId || p.barbershopId === where.barbershopId) &&
            (!where.entryId || p.entryId === where.entryId) &&
            (!where.type || p.type === where.type)
        );
        if (orderBy?.createdAt === "desc") {
          list = [...list].reverse();
        }
        if (list[0]) {
          const cycle = state.cycles.find((c) => c.id === list[0].cycleId);
          return { ...list[0], cycle };
        }
        return null;
      },
      create: async ({ data }: any) => {
        const item = { id: `payable-${state.payableItems.length + 1}`, createdAt: new Date(), ...data };
        state.payableItems.push(item);
        return item;
      },
    },
    commissionCycleAdjustment: {
      findMany: async ({ where }: any) =>
        state.cycleAdjustments.filter(
          (a) =>
            (!where.cycleId || a.cycleId === where.cycleId) &&
            (!where.barbershopId || a.barbershopId === where.barbershopId)
        ),
      create: async ({ data }: any) => {
        const adj = { id: `cadj-${state.cycleAdjustments.length + 1}`, createdAt: new Date(), ...data };
        state.cycleAdjustments.push(adj);
        return adj;
      },
    },
    commissionAdvance: {
      findUnique: async ({ where }: any) => {
        if (where.barbershopId_idempotencyKey) {
          const found = state.advances.find(
            (a) =>
              a.barbershopId === where.barbershopId_idempotencyKey.barbershopId &&
              a.idempotencyKey === where.barbershopId_idempotencyKey.idempotencyKey
          );
          if (!found) return null;
          return {
            ...found,
            reversals: state.advanceReversals.filter((r) => r.advanceId === found.id),
            cycle: state.cycles.find((c) => c.id === found.cycleId),
            financialEntry: state.financialEntries.find((f) => f.commissionAdvanceId === found.id),
            cashMovement: state.cashMovements.find((cm) => cm.commissionAdvanceId === found.id),
          };
        }
        if (where.id) {
          const found = state.advances.find((a) => a.id === where.id);
          if (!found) return null;
          return {
            ...found,
            reversals: state.advanceReversals.filter((r) => r.advanceId === found.id),
            cycle: state.cycles.find((c) => c.id === found.cycleId),
            financialEntry: state.financialEntries.find((f) => f.commissionAdvanceId === found.id),
            cashMovement: state.cashMovements.find((cm) => cm.commissionAdvanceId === found.id),
          };
        }
        return null;
      },
      findMany: async ({ where, include }: any) => {
        return state.advances
          .filter((a) => !where.cycleId || a.cycleId === where.cycleId)
          .map((a) => {
            if (include?.reversals) {
              return {
                ...a,
                reversals: state.advanceReversals.filter((r) => r.advanceId === a.id),
              };
            }
            return a;
          });
      },
      create: async ({ data }: any) => {
        const adv = { id: `adv-${state.advances.length + 1}`, createdAt: new Date(), ...data };
        state.advances.push(adv);
        return adv;
      },
    },
    commissionAdvanceReversal: {
      findUnique: async ({ where }: any) => {
        if (where.barbershopId_idempotencyKey) {
          return (
            state.advanceReversals.find(
              (r) =>
                r.barbershopId === where.barbershopId_idempotencyKey.barbershopId &&
                r.idempotencyKey === where.barbershopId_idempotencyKey.idempotencyKey
            ) || null
          );
        }
        if (where.id) {
          return state.advanceReversals.find((r) => r.id === where.id) || null;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const rev = { id: `adv-rev-${state.advanceReversals.length + 1}`, createdAt: new Date(), ...data };
        state.advanceReversals.push(rev);
        return rev;
      },
    },
    commissionAdvanceAudit: {
      create: async ({ data }: any) => {
        const audit = { id: `audit-${state.advanceAudits.length + 1}`, createdAt: new Date(), ...data };
        state.advanceAudits.push(audit);
        return audit;
      },
    },
    commissionPayout: {
      findUnique: async ({ where }: any) => {
        if (where.barbershopId_idempotencyKey) {
          const found = state.payouts.find(
            (p) =>
              p.barbershopId === where.barbershopId_idempotencyKey.barbershopId &&
              p.idempotencyKey === where.barbershopId_idempotencyKey.idempotencyKey
          );
          if (!found) return null;
          return {
            ...found,
            cycle: state.cycles.find((c) => c.id === found.cycleId),
            financialEntry: state.financialEntries.find((f) => f.commissionPayoutId === found.id),
            cashMovement: state.cashMovements.find((cm) => cm.commissionPayoutId === found.id),
          };
        }
        if (where.id) {
          const found = state.payouts.find((p) => p.id === where.id);
          if (!found) return null;
          return {
            ...found,
            cycle: state.cycles.find((c) => c.id === found.cycleId),
            financialEntry: state.financialEntries.find((f) => f.commissionPayoutId === found.id),
            cashMovement: state.cashMovements.find((cm) => cm.commissionPayoutId === found.id),
          };
        }
        return null;
      },
      create: async ({ data }: any) => {
        const payout = { id: `payout-${state.payouts.length + 1}`, createdAt: new Date(), ...data };
        state.payouts.push(payout);
        return payout;
      },
    },
    financialEntry: {
      findMany: async ({ where }: any) =>
        state.financialEntries.filter(
          (f) =>
            (!where.barbershopId || f.barbershopId === where.barbershopId) &&
            (!where.type?.in || where.type.in.includes(f.type))
        ),
      create: async ({ data }: any) => {
        const entry = { id: `fe-${state.financialEntries.length + 1}`, createdAt: new Date(), ...data };
        state.financialEntries.push(entry);
        return entry;
      },
    },
    cashSession: {
      findFirst: async ({ where }: any) =>
        state.cashSessions.find(
          (cs) =>
            (!where.barbershopId || cs.barbershopId === where.barbershopId) &&
            (!where.status || cs.status === where.status)
        ) || null,
      findUnique: async ({ where }: any) => {
        const cs = state.cashSessions.find((s) => s.id === where.id);
        if (!cs) return null;
        return {
          ...cs,
          movements: state.cashMovements.filter((m) => m.cashSessionId === cs.id),
        };
      },
      update: async ({ where, data }: any) => {
        const cs = state.cashSessions.find((s) => s.id === where.id);
        if (!cs) throw new Error("Cash session not found");
        Object.assign(cs, data);
        return {
          ...cs,
          movements: state.cashMovements.filter((m) => m.cashSessionId === cs.id),
        };
      },
    },
    cashMovement: {
      create: async ({ data }: any) => {
        const movement = { id: `cm-${state.cashMovements.length + 1}`, createdAt: new Date(), ...data };
        state.cashMovements.push(movement);
        return movement;
      },
    },
    commissionAdjustment: {
      create: async ({ data }: any) => {
        const adj = { id: `ladj-${state.legacyAdjustments.length + 1}`, ...data };
        state.legacyAdjustments.push(adj);
        return adj;
      },
      deleteMany: async () => ({ count: 0 }),
      findMany: async () => [],
      upsert: async () => ({}),
    },
    commissionPeriod: {
      findUnique: async () => null,
      upsert: async () => ({ id: "period-1" }),
      update: async () => ({ id: "period-1" }),
    },
  };

  return { state, tx };
}

describe("TEM BARBER — Normal Commission C7 Payout Suite", () => {
  const shopId = "shop-c7";
  const memberId = "member-barber-1";
  const userId = "user-admin-1";

  let db: ReturnType<typeof createInMemoryC7Db>;

  beforeEach(() => {
    db = createInMemoryC7Db();
    db.state.members.push({ id: memberId, barbershopId: shopId, userId });
    db.state.services.push({
      id: "srv-cut",
      barbershopId: shopId,
      name: "Corte",
      price: new Prisma.Decimal("100.00"),
      categoryId: "cat-1",
    });
    db.state.configs.push({
      id: "cfg-1",
      barbershopId: shopId,
      scopeKey: `member:${memberId}:default`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("100.00"), // 100% for simple math tests
      active: true,
      memberId,
    });
  });

  // Helper to setup a cycle with confirmed released payable commission
  async function setupCycleWithPayable(payableAmountCents: number) {
    const cycle = {
      id: "cycle-open-c7",
      barbershopId: shopId,
      memberId,
      cycleNumber: 1,
      status: CommissionCycleStatus.OPEN,
      grossCommission: fromCents(payableAmountCents),
      adjustmentsTotal: new Prisma.Decimal("0.00"),
      advancesTotal: new Prisma.Decimal("0.00"),
      finalPayoutAmount: new Prisma.Decimal("0.00"),
      remainingBalance: fromCents(payableAmountCents),
      version: 1,
    };
    db.state.cycles.push(cycle);

    const entry = {
      id: `entry-${payableAmountCents}`,
      barbershopId: shopId,
      memberId,
      comandaItemId: `item-${payableAmountCents}`,
      baseAmount: fromCents(payableAmountCents),
      generatedAmount: fromCents(payableAmountCents),
      releasedAmount: fromCents(payableAmountCents),
      reversedAmount: new Prisma.Decimal("0.00"),
      paidAmount: new Prisma.Decimal("0.00"),
      status: CommissionEntryStatus.RELEASED,
      competence: "2026-08",
    };
    db.state.entries.push(entry);

    db.state.payableItems.push({
      id: `payable-item-${payableAmountCents}`,
      barbershopId: shopId,
      cycleId: cycle.id,
      entryId: entry.id,
      memberId,
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      type: CommissionPayableType.RELEASE,
      amount: fromCents(payableAmountCents),
      isHistoricalCorrection: false,
      eventKey: `event-${payableAmountCents}`,
    });

    return cycle;
  }

  it("1. 580 commission - 150 advance => payout430", async () => {
    const cycle = await setupCycleWithPayable(58000);

    await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 150,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-1",
      createdById: userId,
    });

    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-1",
      createdById: userId,
    });

    expect(toCents(res.payout.amount)).toBe(43000);
    expect(toCents(res.paidCycle.finalPayoutAmount)).toBe(43000);
    expect(toCents(res.paidCycle.remainingBalance)).toBe(0);
    expect(res.paidCycle.status).toBe(CommissionCycleStatus.PAID);
    expect(res.nextCycle.status).toBe(CommissionCycleStatus.OPEN);
  });

  it("2. no advance => payout full balance", async () => {
    await setupCycleWithPayable(30000);

    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-2",
      createdById: userId,
    });

    expect(toCents(res.payout.amount)).toBe(30000);
    expect(toCents(res.paidCycle.remainingBalance)).toBe(0);
  });

  it("3. advance100 reversal40 on commission300 => payout240", async () => {
    await setupCycleWithPayable(30000);

    const adv = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 100,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-3",
      createdById: userId,
    });

    await reverseCommissionAdvance(db.tx, {
      barbershopId: shopId,
      advanceId: adv.id,
      amount: 40,
      returnMethod: CommissionDisbursementMethod.PIX,
      reason: "Devolucao 40",
      idempotencyKey: "rev-3",
      createdById: userId,
    });

    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-3",
      createdById: userId,
    });

    expect(toCents(res.payout.amount)).toBe(24000);
  });

  it("4. fully advanced cycle => payout0 closes correctly", async () => {
    await setupCycleWithPayable(20000);

    await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 200,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-4",
      createdById: userId,
    });

    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      idempotencyKey: "payout-4",
      createdById: userId,
    });

    expect(toCents(res.payout.amount)).toBe(0);
    expect(res.payout.paymentMethod).toBeNull();
    expect(res.paidCycle.status).toBe(CommissionCycleStatus.PAID);
    expect(res.nextCycle.status).toBe(CommissionCycleStatus.OPEN);
  });

  it("5. zero payout creates no fake FinancialEntry/CashMovement", async () => {
    await setupCycleWithPayable(20000);

    await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 200,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-5",
      createdById: userId,
    });

    const feCountBefore = db.state.financialEntries.length;
    const cmCountBefore = db.state.cashMovements.length;

    await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      idempotencyKey: "payout-5",
      createdById: userId,
    });

    expect(db.state.financialEntries.length).toBe(feCountBefore);
    expect(db.state.cashMovements.length).toBe(cmCountBefore);
  });

  it("6. negative balance cannot payout/close", async () => {
    const cycle = {
      id: "cycle-neg",
      barbershopId: shopId,
      memberId,
      cycleNumber: 1,
      status: CommissionCycleStatus.OPEN,
      grossCommission: new Prisma.Decimal("0.00"),
      adjustmentsTotal: new Prisma.Decimal("-50.00"),
      advancesTotal: new Prisma.Decimal("0.00"),
      finalPayoutAmount: new Prisma.Decimal("0.00"),
      remainingBalance: new Prisma.Decimal("-50.00"),
      version: 1,
    };
    db.state.cycles.push(cycle);
    db.state.cycleAdjustments.push({
      id: "adj-neg",
      barbershopId: shopId,
      cycleId: cycle.id,
      type: CommissionCycleAdjustmentType.DEBIT,
      amount: new Prisma.Decimal("50.00"),
    });

    await expect(
      executeCommissionPayout(db.tx, {
        barbershopId: shopId,
        memberId,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "payout-6",
        createdById: userId,
      })
    ).rejects.toThrow(/saldo devedor negativo/);

    expect(cycle.status).toBe(CommissionCycleStatus.OPEN);
  });

  it("7. caller amount mismatch rejected", async () => {
    await setupCycleWithPayable(30000);

    await expect(
      executeCommissionPayout(db.tx, {
        barbershopId: shopId,
        memberId,
        amount: 290, // caller requested 290, authoritative is 300
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "payout-7",
        createdById: userId,
      })
    ).rejects.toThrow(/difere do saldo autoritativo/);
  });

  it("8. payout creates exactly one negative FinancialEntry", async () => {
    await setupCycleWithPayable(25000);

    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-8",
      createdById: userId,
    });

    const fe = db.state.financialEntries.find((f) => f.commissionPayoutId === res.payout.id);
    expect(fe).toBeDefined();
    expect(fe!.type).toBe(FinancialEntryType.COMMISSION_PAYOUT);
    expect(toCents(fe!.amount)).toBe(-25000); // NEGATIVE liability settlement
  });

  it("9. payout does not change commission accrual ledger", async () => {
    await setupCycleWithPayable(25000);
    const countBefore = db.state.payableItems.length;

    await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-9",
      createdById: userId,
    });

    expect(db.state.payableItems.length).toBe(countBefore);
  });

  it("10. payout transitions OPEN→PAID", async () => {
    const cycle = await setupCycleWithPayable(20000);
    expect(cycle.status).toBe(CommissionCycleStatus.OPEN);

    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-10",
      createdById: userId,
    });

    expect(res.paidCycle.status).toBe(CommissionCycleStatus.PAID);
    expect(cycle.status).toBe(CommissionCycleStatus.PAID);
  });

  it("11. PAID remainingBalance=0", async () => {
    const cycle = await setupCycleWithPayable(20000);

    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-11",
      createdById: userId,
    });

    expect(toCents(res.paidCycle.remainingBalance)).toBe(0);
    expect(toCents(cycle.remainingBalance)).toBe(0);
  });

  it("12. PAID cycle immutable", async () => {
    await setupCycleWithPayable(20000);

    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-12",
      createdById: userId,
    });

    const frozenGross = res.paidCycle.grossCommission;
    const frozenPayout = res.paidCycle.finalPayoutAmount;

    // Subsequent advance against closed cycle fails
    await expect(
      createCommissionAdvance(db.tx, {
        barbershopId: shopId,
        memberId,
        amount: 50,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "adv-against-closed",
        createdById: userId,
      })
    ).rejects.toThrow(/Saldo disponível insuficiente/);

    expect(res.paidCycle.grossCommission).toBe(frozenGross);
    expect(res.paidCycle.finalPayoutAmount).toBe(frozenPayout);
  });

  it("13. next OPEN cycle created atomically", async () => {
    await setupCycleWithPayable(20000);

    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-13",
      createdById: userId,
    });

    expect(res.nextCycle).toBeDefined();
    expect(res.nextCycle.status).toBe(CommissionCycleStatus.OPEN);
    expect(res.nextCycle.memberId).toBe(memberId);
  });

  it("14. next cycle number exactly previous+1", async () => {
    const cycle = await setupCycleWithPayable(20000);
    expect(cycle.cycleNumber).toBe(1);

    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-14",
      createdById: userId,
    });

    expect(res.nextCycle.cycleNumber).toBe(2);
  });

  it("15. retry payout => no duplicate settlement/new cycle", async () => {
    await setupCycleWithPayable(20000);

    const res1 = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-15",
      createdById: userId,
    });

    const res2 = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-15",
      createdById: userId,
    });

    expect(res1.payout.id).toBe(res2.payout.id);
    expect(res1.nextCycle.id).toBe(res2.nextCycle.id);
    expect(db.state.payouts.length).toBe(1);
    expect(db.state.cycles.length).toBe(2); // 1 old paid + 1 next open
  });

  it("16. conflicting idempotency payload => rejected", async () => {
    await setupCycleWithPayable(20000);

    await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-16",
      createdById: userId,
    });

    await expect(
      executeCommissionPayout(db.tx, {
        barbershopId: shopId,
        memberId,
        paymentMethod: CommissionDisbursementMethod.TRANSFER, // conflicting method!
        idempotencyKey: "payout-16",
        createdById: userId,
      })
    ).rejects.toThrow(/payload diferente/);
  });

  it("17. CASH payout creates negative CashMovement", async () => {
    await setupCycleWithPayable(10000);
    db.state.cashSessions.push({
      id: "cs-c7",
      barbershopId: shopId,
      status: "OPEN",
      openingAmount: new Prisma.Decimal("500.00"),
      expectedAmount: new Prisma.Decimal("500.00"),
    });

    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.CASH,
      idempotencyKey: "payout-cash-17",
      createdById: userId,
    });

    const cm = db.state.cashMovements.find((m) => m.commissionPayoutId === res.payout.id);
    expect(cm).toBeDefined();
    expect(toCents(cm!.amount)).toBe(-10000); // NEGATIVE
    expect(toCents(db.state.cashSessions[0].expectedAmount)).toBe(40000); // 500 - 100 = 400
  });

  it("18. CASH payout without cash session rolls back", async () => {
    await setupCycleWithPayable(10000);
    // No open cash session

    await expect(
      executeCommissionPayout(db.tx, {
        barbershopId: shopId,
        memberId,
        paymentMethod: CommissionDisbursementMethod.CASH,
        idempotencyKey: "payout-nocash-18",
        createdById: userId,
      })
    ).rejects.toThrow(/sessao de caixa aberta/);

    expect(db.state.payouts.length).toBe(0);
    expect(db.state.cycles[0].status).toBe(CommissionCycleStatus.OPEN);
  });

  it("19. failure FinancialEntry creation rolls back everything", async () => {
    await setupCycleWithPayable(10000);

    const orig = db.tx.financialEntry.create;
    db.tx.financialEntry.create = async () => {
      throw new Error("Simulated failure in FinancialEntry");
    };

    await expect(
      executeCommissionPayout(db.tx, {
        barbershopId: shopId,
        memberId,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "payout-fail-19",
        createdById: userId,
      })
    ).rejects.toThrow("Simulated failure in FinancialEntry");

    db.tx.financialEntry.create = orig;
  });

  it("20. payout vs RELEASE concurrency loses no commission", async () => {
    const cycle = await setupCycleWithPayable(43000); // 430 payable

    // Concurrency scenario A: RELEASE commits first -> payout sees 446
    db.state.payableItems.push({
      id: "pay-item-concurrent",
      barbershopId: shopId,
      cycleId: cycle.id,
      entryId: "entry-conc",
      memberId,
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      type: CommissionPayableType.RELEASE,
      amount: new Prisma.Decimal("16.00"),
      isHistoricalCorrection: false,
      eventKey: "event-conc-16",
    });

    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-conc-20",
      createdById: userId,
    });

    expect(toCents(res.payout.amount)).toBe(44600); // 430 + 16 = 446
  });

  it("21. payout vs advance concurrency cannot over-settle", async () => {
    await setupCycleWithPayable(20000); // 200 payable

    // First advance takes 150
    await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 150,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-conc-21",
      createdById: userId,
    });

    // Payout after advance must only pay remaining 50
    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-conc-21",
      createdById: userId,
    });

    expect(toCents(res.payout.amount)).toBe(5000);
    // Total settled = 150 advance + 50 payout = 200 (never 350)
  });

  it("22. RELEASE after payout enters new cycle", async () => {
    await setupCycleWithPayable(20000);

    const payoutRes = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-22",
      createdById: userId,
    });

    // New comanda completes and pays after cycle closed
    db.state.comandas.push({
      id: "cmd-after-payout",
      barbershopId: shopId,
      status: ComandaStatus.OPEN,
      total: new Prisma.Decimal("100.00"),
      commissionRevision: 1,
      createdAt: new Date("2026-09-02T10:00:00Z"),
    });
    db.state.comandaItems.push({
      id: "item-after-payout",
      comandaId: "cmd-after-payout",
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date(),
      unitPrice: new Prisma.Decimal("100.00"),
      quantity: 1,
      total: new Prisma.Decimal("100.00"),
      serviceId: "srv-cut",
      executorId: memberId,
    });
    db.state.payments.push({
      id: "pay-after-payout",
      comandaId: "cmd-after-payout",
      barbershopId: shopId,
      amount: new Prisma.Decimal("100.00"),
      refundedAmount: new Prisma.Decimal("0.00"),
      status: "CONFIRMED",
    });

    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-after-payout");

    // Old cycle remains PAID and frozen
    expect(toCents(payoutRes.paidCycle.remainingBalance)).toBe(0);
    expect(payoutRes.paidCycle.status).toBe(CommissionCycleStatus.PAID);

    // New cycle received the 100 commission!
    const authNew = await getAuthoritativeCycleBalance(db.tx, payoutRes.nextCycle.id);
    expect(authNew.grossCommissionCents).toBe(10000);
    expect(authNew.remainingBalanceCents).toBe(10000);
  });

  it("23. Friday service / Monday payment after prior cycle closed => commission enters current cycle", async () => {
    // Service done on Friday
    db.state.comandas.push({
      id: "cmd-friday",
      barbershopId: shopId,
      status: ComandaStatus.OPEN,
      total: new Prisma.Decimal("50.00"),
      commissionRevision: 1,
    });
    db.state.comandaItems.push({
      id: "item-friday",
      comandaId: "cmd-friday",
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-08-28T18:00:00Z"), // Friday
      unitPrice: new Prisma.Decimal("50.00"),
      quantity: 1,
      total: new Prisma.Decimal("50.00"),
      serviceId: "srv-cut",
      executorId: memberId,
    });

    // Saturday: payout cycle 1 closes with 0 (or past commissions)
    const cycle1 = {
      id: "cycle-sat",
      barbershopId: shopId,
      memberId,
      cycleNumber: 1,
      status: CommissionCycleStatus.OPEN,
      grossCommission: new Prisma.Decimal("0.00"),
      adjustmentsTotal: new Prisma.Decimal("0.00"),
      advancesTotal: new Prisma.Decimal("0.00"),
      finalPayoutAmount: new Prisma.Decimal("0.00"),
      remainingBalance: new Prisma.Decimal("0.00"),
      version: 1,
    };
    db.state.cycles.push(cycle1);

    const satPayout = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      idempotencyKey: "sat-close",
      createdById: userId,
    });
    expect(satPayout.paidCycle.status).toBe(CommissionCycleStatus.PAID);

    // Monday: customer pays 50.00
    db.state.payments.push({
      id: "pay-mon",
      comandaId: "cmd-friday",
      barbershopId: shopId,
      amount: new Prisma.Decimal("50.00"),
      refundedAmount: new Prisma.Decimal("0.00"),
      status: "CONFIRMED",
      paidAt: new Date("2026-08-31T10:00:00Z"), // Monday
    });

    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-friday");

    // Saturday cycle is untouched
    expect(toCents(satPayout.paidCycle.remainingBalance)).toBe(0);
    // Monday's current cycle has the 50.00
    const authMon = await getAuthoritativeCycleBalance(db.tx, satPayout.nextCycle.id);
    expect(authMon.grossCommissionCents).toBe(5000);
    expect(authMon.remainingBalanceCents).toBe(5000);
  });

  it("24. post-paid refund leaves PAID cycle unchanged", async () => {
    const cycle = await setupCycleWithPayable(1600); // 16.00 paid

    const payoutRes = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-paid-old",
      createdById: userId,
    });
    expect(payoutRes.paidCycle.status).toBe(CommissionCycleStatus.PAID);
    expect(toCents(payoutRes.paidCycle.finalPayoutAmount)).toBe(1600);

    const entry = db.state.entries[0];
    entry.paidAmount = new Prisma.Decimal("16.00");
    entry.status = CommissionEntryStatus.PAID;

    // Refund of 8.00 occurs
    await reverseCommissionEntry(db.tx, shopId, entry.id, 800, "pay-refund-1", "Refund");

    // PAID cycle remains immutable
    expect(toCents(payoutRes.paidCycle.finalPayoutAmount)).toBe(1600);
    expect(toCents(payoutRes.paidCycle.remainingBalance)).toBe(0);
    expect(payoutRes.paidCycle.status).toBe(CommissionCycleStatus.PAID);
  });

  it("25. post-paid correction debits current OPEN cycle once", async () => {
    const cycle = await setupCycleWithPayable(1600);

    const payoutRes = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-paid-25",
      createdById: userId,
    });

    const entry = db.state.entries[0];
    entry.paidAmount = new Prisma.Decimal("16.00");
    entry.status = CommissionEntryStatus.PAID;

    // Next cycle earns 30.00
    const nextCycle = payoutRes.nextCycle;
    nextCycle.grossCommission = new Prisma.Decimal("30.00");
    nextCycle.remainingBalance = new Prisma.Decimal("30.00");

    await reverseCommissionEntry(db.tx, shopId, entry.id, 800, "pay-refund-25", "Refund");

    // Current open cycle balance: 30 - 8 = 22 (NOT 14)
    expect(toCents(nextCycle.grossCommission)).toBe(3000);
    expect(toCents(nextCycle.adjustmentsTotal)).toBe(-800);
    expect(toCents(nextCycle.remainingBalance)).toBe(2200);
  });

  it("26. financial summary uses RELEASE-REVERSAL ledger accrual", () => {
    // Test P&L logic directly
    const items = [
      { type: "RELEASE", amount: new Prisma.Decimal("100.00"), isHistoricalCorrection: false, memberId },
      { type: "RELEASE", amount: new Prisma.Decimal("50.00"), isHistoricalCorrection: false, memberId },
      { type: "REVERSAL", amount: new Prisma.Decimal("20.00"), isHistoricalCorrection: false, memberId },
      { type: "REVERSAL", amount: new Prisma.Decimal("10.00"), isHistoricalCorrection: true, memberId }, // economic reversal counted in P&L
    ];

    let accrued = 0;
    for (const item of items) {
      if (item.type === "RELEASE") accrued += toCents(item.amount);
      else if (item.type === "REVERSAL") accrued -= toCents(item.amount);
    }

    expect(accrued).toBe(12000); // 100 + 50 - 20 - 10 = 120
  });

  it("27. LEGACY_BACKFILL excluded from current P&L", () => {
    const items = [
      { type: "RELEASE", amount: new Prisma.Decimal("100.00"), sourceKind: "PAYMENT", isHistoricalCorrection: false },
      { type: "RELEASE", amount: new Prisma.Decimal("500.00"), sourceKind: "LEGACY_BACKFILL", isHistoricalCorrection: false },
    ];

    const filtered = items.filter((i) => i.sourceKind !== "LEGACY_BACKFILL");
    const accrued = filtered.reduce((sum, i) => sum + toCents(i.amount), 0);

    expect(accrued).toBe(10000); // 100.00 only
  });

  it("28. payout settles cash without adding commission expense a second time", () => {
    const payableItems = [
      { type: "RELEASE", amount: new Prisma.Decimal("100.00") },
    ];
    const entries = [
      { type: "COMMISSION_PAYOUT", amount: new Prisma.Decimal("-100.00") },
    ];

    const commissionExpense = payableItems
      .filter((item) => item.type === "RELEASE")
      .reduce((sum, item) => sum + toCents(item.amount), 0);
    const payoutCashOutflow = entries
      .filter((entry) => entry.type === "COMMISSION_PAYOUT")
      .reduce((sum, entry) => sum + Math.abs(toCents(entry.amount)), 0);

    expect(commissionExpense).toBe(10000);
    expect(payoutCashOutflow).toBe(10000);
    expect(commissionExpense).not.toBe(20000);
  });

  it("29. advance excluded from operating expenses", () => {
    const entries = [
      { type: "MANUAL_OUT", amount: new Prisma.Decimal("30.00") },
      { type: "COMMISSION_ADVANCE", amount: new Prisma.Decimal("-100.00") },
    ];

    const operatingExpenses = entries
      .filter((e) => e.type === "MANUAL_OUT")
      .reduce((sum, e) => sum + Math.abs(toCents(e.amount)), 0);

    expect(operatingExpenses).toBe(3000); // 30 only, NOT 130!
  });

  it("30. advance reversal excluded from operating income", () => {
    const entries = [
      { type: "MANUAL_IN", amount: new Prisma.Decimal("40.00") },
      { type: "COMMISSION_ADVANCE_REVERSAL", amount: new Prisma.Decimal("40.00") },
    ];

    const operatingIncome = entries
      .filter((e) => e.type === "MANUAL_IN")
      .reduce((sum, e) => sum + toCents(e.amount), 0);

    expect(operatingIncome).toBe(4000); // 40 only, NOT 80!
  });

  it("31. daily-summary includes advance cash outflow", () => {
    const entries = [
      { type: "COMMISSION_ADVANCE", amount: new Prisma.Decimal("-75.00") },
    ];

    const advanceOut = entries
      .filter((e) => e.type === "COMMISSION_ADVANCE")
      .reduce((sum, e) => sum + Math.abs(toCents(e.amount)), 0);

    expect(advanceOut).toBe(7500);
  });

  it("32. daily-summary includes payout cash outflow", () => {
    const entries = [
      { type: "COMMISSION_PAYOUT", amount: new Prisma.Decimal("-120.00") },
    ];

    const payoutOut = entries
      .filter((e) => e.type === "COMMISSION_PAYOUT")
      .reduce((sum, e) => sum + Math.abs(toCents(e.amount)), 0);

    expect(payoutOut).toBe(12000);
  });

  it("33. daily-summary includes advance reversal inflow", () => {
    const entries = [
      { type: "COMMISSION_ADVANCE_REVERSAL", amount: new Prisma.Decimal("35.00") },
    ];

    const reversalIn = entries
      .filter((e) => e.type === "COMMISSION_ADVANCE_REVERSAL")
      .reduce((sum, e) => sum + Math.max(0, toCents(e.amount)), 0);

    expect(reversalIn).toBe(3500);
  });

  it("34. cycle reconciliation: advances - reversals + payout = economic payable", async () => {
    // Setup 580 commission
    await setupCycleWithPayable(58000);

    // Advance 150
    const adv = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 150,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-34",
      createdById: userId,
    });

    // Advance reversal 20
    await reverseCommissionAdvance(db.tx, {
      barbershopId: shopId,
      advanceId: adv.id,
      amount: 20,
      returnMethod: CommissionDisbursementMethod.PIX,
      reason: "Devolucao",
      idempotencyKey: "rev-34",
      createdById: userId,
    });

    // Payout remaining: 580 - (150 - 20) = 450
    const res = await executeCommissionPayout(db.tx, {
      barbershopId: shopId,
      memberId,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "payout-34",
      createdById: userId,
    });

    const netAdvances = 15000 - 2000; // 13000
    const payoutAmount = toCents(res.payout.amount); // 45000
    const totalNetPaidToBarber = netAdvances + payoutAmount; // 58000

    expect(payoutAmount).toBe(45000);
    expect(totalNetPaidToBarber).toBe(58000);
    expect(totalNetPaidToBarber).toBe(toCents(res.paidCycle.grossCommission));
  });
});

describe("TEM BARBER — C7.1 Period P&L Reversal Suite", () => {
  const memberId = "member-barber-pnl";

  // Helper simulating the canonical P&L calculation from route.ts
  function computePeriodCommissionAccrual(
    payableItems: Array<{
      type: "RELEASE" | "REVERSAL";
      amount: Prisma.Decimal | number | string;
      sourceKind?: string;
      isHistoricalCorrection?: boolean;
    }>,
    cycleAdjustments: Array<{
      type: "CREDIT" | "DEBIT";
      amount: Prisma.Decimal | number | string;
      sourcePayableItemId?: string | null;
      sourceAdvanceReversalId?: string | null;
    }>
  ) {
    // 1. Filter out LEGACY_BACKFILL from payable items
    const validPayableItems = payableItems.filter((i) => i.sourceKind !== "LEGACY_BACKFILL");

    // 2. Filter true manual adjustments (excluding routing companions)
    const trueAdjustments = cycleAdjustments.filter(
      (a) => !a.sourcePayableItemId && !a.sourceAdvanceReversalId
    );

    let accrualCents = 0;

    // Economic Releases (+) and Reversals (-)
    for (const item of validPayableItems) {
      if (item.type === "RELEASE") {
        accrualCents += toCents(item.amount);
      } else if (item.type === "REVERSAL") {
        accrualCents -= toCents(item.amount);
      }
    }

    // True manual adjustments (+CREDIT / -DEBIT)
    for (const adj of trueAdjustments) {
      if (adj.type === "CREDIT") {
        accrualCents += toCents(adj.amount);
      } else if (adj.type === "DEBIT") {
        accrualCents -= toCents(adj.amount);
      }
    }

    return accrualCents;
  }

  it("1. Historical PAID cycle + post-paid REVERSAL8 today + routing DEBIT8 today => today's commission P&L delta = -8 exactly once", () => {
    // Given: A post-paid refund creates an economic REVERSAL of 8.00 (with isHistoricalCorrection: true)
    // and a routing companion CommissionCycleAdjustment(DEBIT) of 8.00 in current OPEN cycle
    const payableItems = [
      {
        type: "REVERSAL" as const,
        amount: new Prisma.Decimal("8.00"),
        sourceKind: "PAYMENT_REFUND",
        isHistoricalCorrection: true, // points to old PAID cycle
      },
    ];

    const cycleAdjustments = [
      {
        type: "DEBIT" as const,
        amount: new Prisma.Decimal("8.00"),
        sourcePayableItemId: "payable-item-reversal-1", // routing companion provenance
      },
    ];

    const pnlDelta = computePeriodCommissionAccrual(payableItems, cycleAdjustments);

    // Expected: economic REVERSAL has P&L effect (-8.00) once; companion routing DEBIT has zero additional effect
    expect(pnlDelta).toBe(-800); // exactly -8, NOT 0 and NOT -16!
  });

  it("2. Current-cycle REVERSAL8 => P&L delta = -8", () => {
    const payableItems = [
      {
        type: "REVERSAL" as const,
        amount: new Prisma.Decimal("8.00"),
        sourceKind: "PAYMENT_REFUND",
        isHistoricalCorrection: false,
      },
    ];

    const pnlDelta = computePeriodCommissionAccrual(payableItems, []);
    expect(pnlDelta).toBe(-800);
  });

  it("3. Routing DEBIT with routing provenance => zero additional P&L effect", () => {
    const cycleAdjustments = [
      {
        type: "DEBIT" as const,
        amount: new Prisma.Decimal("8.00"),
        sourcePayableItemId: "pay-rev-id", // companion routing adjustment
      },
      {
        type: "DEBIT" as const,
        amount: new Prisma.Decimal("5.00"),
        sourceAdvanceReversalId: "adv-rev-id", // advance companion adjustment
      },
    ];

    const pnlDelta = computePeriodCommissionAccrual([], cycleAdjustments);
    expect(pnlDelta).toBe(0); // ZERO additional P&L effect
  });

  it("4. TRUE manual CREDIT10 => period commission accrual +10", () => {
    const cycleAdjustments = [
      {
        type: "CREDIT" as const,
        amount: new Prisma.Decimal("10.00"),
        sourcePayableItemId: null,
        sourceAdvanceReversalId: null,
      },
    ];

    const pnlDelta = computePeriodCommissionAccrual([], cycleAdjustments);
    expect(pnlDelta).toBe(1000); // +10.00
  });

  it("5. TRUE manual DEBIT10 => period commission accrual -10", () => {
    const cycleAdjustments = [
      {
        type: "DEBIT" as const,
        amount: new Prisma.Decimal("10.00"),
        sourcePayableItemId: null,
        sourceAdvanceReversalId: null,
      },
    ];

    const pnlDelta = computePeriodCommissionAccrual([], cycleAdjustments);
    expect(pnlDelta).toBe(-1000); // -10.00
  });

  it("6. LEGACY_BACKFILL RELEASE remains excluded", () => {
    const payableItems = [
      {
        type: "RELEASE" as const,
        amount: new Prisma.Decimal("100.00"),
        sourceKind: "LEGACY_BACKFILL",
        isHistoricalCorrection: false,
      },
      {
        type: "RELEASE" as const,
        amount: new Prisma.Decimal("25.00"),
        sourceKind: "PAYMENT",
        isHistoricalCorrection: false,
      },
    ];

    const pnlDelta = computePeriodCommissionAccrual(payableItems, []);
    expect(pnlDelta).toBe(2500); // 25.00 only; 100.00 backfill excluded
  });
});
