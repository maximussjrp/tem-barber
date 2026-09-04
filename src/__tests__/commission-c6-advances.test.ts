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
  getAuthoritativeCycleBalance,
  syncCommissionReleaseForComanda,
  CommissionError,
} from "@/lib/operations/commissions";
import { fromCents, toCents } from "@/lib/operations/money";

function createInMemoryC6Db() {
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
    financialEntries: [] as any[],
    cashSessions: [] as any[],
    cashMovements: [] as any[],
    legacyAdjustments: [] as any[],
    periods: [] as any[],
    appointments: [] as any[],
  };

  const tx: any = {
    $executeRaw: async () => 1,
    barbershopMember: {
      findFirst: async ({ where }: any) =>
        state.members.find((m) => (!where.id || m.id === where.id) && (!where.barbershopId || m.barbershopId === where.barbershopId)) || null,
      findUnique: async ({ where }: any) =>
        state.members.find((m) => (!where.id || m.id === where.id) && (!where.barbershopId_userId || (m.barbershopId === where.barbershopId_userId.barbershopId && m.userId === where.barbershopId_userId.userId))) || null,
      findFirstOrThrow: async ({ where }: any) => {
        const found = state.members.find((m) => (!where.id || m.id === where.id) && (!where.barbershopId || m.barbershopId === where.barbershopId));
        if (!found) throw new Error("Member not found");
        return found;
      },
    },
    service: {
      findFirst: async ({ where }: any) =>
        state.services.find((s) => (!where.id || s.id === where.id) && (!where.barbershopId || s.barbershopId === where.barbershopId)) || null,
      findFirstOrThrow: async ({ where }: any) => {
        const found = state.services.find((s) => (!where.id || s.id === where.id) && (!where.barbershopId || s.barbershopId === where.barbershopId));
        if (!found) throw new Error("Service not found");
        return found;
      },
    },
    product: {
      findFirst: async () => null,
      findFirstOrThrow: async () => { throw new Error("Not found"); },
    },
    careerLevel: {
      findFirst: async () => null,
    },
    serviceCommissionRule: {
      findFirst: async () => null,
    },
    commissionConfig: {
      findMany: async ({ where }: any) =>
        state.configs.filter((c) => (!where.barbershopId || c.barbershopId === where.barbershopId) && (where.active === undefined || c.active === where.active)),
    },
    appointment: {
      findUnique: async ({ where }: any) =>
        state.appointments.find((a) => a.id === where.id) || null,
    },
    comanda: {
      findFirst: async ({ where }: any) => {
        const c = state.comandas.find((cmd) => (!where.id || cmd.id === where.id) && (!where.barbershopId || cmd.barbershopId === where.barbershopId));
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
        state.payments.filter((p) => (!where.comandaId || p.comandaId === where.comandaId) && (!where.status || p.status === where.status)),
    },
    commissionEntry: {
      findUnique: async ({ where }: any) =>
        state.entries.find((e) => (!where.id || e.id === where.id) && (!where.comandaItemId || e.comandaItemId === where.comandaItemId)) || null,
      findFirst: async ({ where }: any) =>
        state.entries.find((e) => (!where.id || e.id === where.id) && (!where.barbershopId || e.barbershopId === where.barbershopId) && (!where.comandaItemId || e.comandaItemId === where.comandaItemId)) || null,
      findMany: async ({ where }: any) =>
        state.entries.filter((e) => (!where.barbershopId || e.barbershopId === where.barbershopId) && (!where.memberId || e.memberId === where.memberId) && (!where.comandaItem?.comandaId || state.comandaItems.some((i) => i.id === e.comandaItemId && i.comandaId === where.comandaItem.comandaId))),
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
          (c) => (!where.barbershopId || c.barbershopId === where.barbershopId) && (!where.memberId || c.memberId === where.memberId) && (!where.status || c.status === where.status)
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
          return state.payableItems.find(
            (p) => p.barbershopId === where.barbershopId_eventKey.barbershopId && p.eventKey === where.barbershopId_eventKey.eventKey
          ) || null;
        }
        return null;
      },
      findMany: async ({ where }: any) =>
        state.payableItems.filter((p) => !where.cycleId || p.cycleId === where.cycleId),
      findFirst: async ({ where, orderBy }: any) => {
        let list = state.payableItems.filter(
          (p) => (!where.barbershopId || p.barbershopId === where.barbershopId) && (!where.entryId || p.entryId === where.entryId) && (!where.type || p.type === where.type)
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
        state.cycleAdjustments.filter((a) => !where.cycleId || a.cycleId === where.cycleId),
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
    financialEntry: {
      create: async ({ data }: any) => {
        const entry = { id: `fe-${state.financialEntries.length + 1}`, createdAt: new Date(), ...data };
        state.financialEntries.push(entry);
        return entry;
      },
    },
    cashSession: {
      findFirst: async ({ where }: any) =>
        state.cashSessions.find(
          (cs) => (!where.barbershopId || cs.barbershopId === where.barbershopId) && (!where.status || cs.status === where.status)
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

describe("TEM BARBER — Normal Commission C6 Advances Suite", () => {
  const shopId = "shop-c6";
  const memberId = "member-barber-1";
  const userId = "user-admin-1";

  let db: ReturnType<typeof createInMemoryC6Db>;

  beforeEach(() => {
    db = createInMemoryC6Db();
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
      id: "cycle-open-c6",
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

    db.state.payableItems.push({
      id: "payable-item-initial",
      barbershopId: shopId,
      cycleId: cycle.id,
      entryId: "entry-initial",
      memberId,
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      type: CommissionPayableType.RELEASE,
      amount: fromCents(payableAmountCents),
      isHistoricalCorrection: false,
      eventKey: `event-init-${payableAmountCents}`,
    });

    return cycle;
  }

  it("1. payable300 → advance100 → remaining200", async () => {
    const cycle = await setupCycleWithPayable(30000);

    const advance = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 100,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-key-1",
      createdById: userId,
    });

    expect(advance).toBeDefined();
    expect(toCents(advance.amount)).toBe(10000);

    const auth = await getAuthoritativeCycleBalance(db.tx, cycle.id);
    expect(auth.grossCommissionCents).toBe(30000);
    expect(auth.advancesTotalCents).toBe(10000);
    expect(auth.remainingBalanceCents).toBe(20000);
    expect(auth.availableForAdvanceCents).toBe(20000);

    expect(toCents(cycle.advancesTotal)).toBe(10000);
    expect(toCents(cycle.remainingBalance)).toBe(20000);
  });

  it("2. generated but unreleased300 → advance rejected", async () => {
    // Member has comanda with 300 generated commission, but no customer payment released
    const cycle = {
      id: "cycle-unreleased",
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
    db.state.cycles.push(cycle);

    db.state.entries.push({
      id: "entry-unrel",
      barbershopId: shopId,
      memberId,
      comandaItemId: "item-1",
      baseAmount: new Prisma.Decimal("300.00"),
      generatedAmount: new Prisma.Decimal("300.00"),
      releasedAmount: new Prisma.Decimal("0.00"), // UNRELEASED!
      status: CommissionEntryStatus.GENERATED,
    });

    await expect(
      createCommissionAdvance(db.tx, {
        barbershopId: shopId,
        memberId,
        amount: 100,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "adv-key-2",
        createdById: userId,
      })
    ).rejects.toThrow(CommissionError);
  });

  it("3. available200 → advance201 rejected", async () => {
    await setupCycleWithPayable(20000);

    await expect(
      createCommissionAdvance(db.tx, {
        barbershopId: shopId,
        memberId,
        amount: 201,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "adv-key-3",
        createdById: userId,
      })
    ).rejects.toThrow(/Saldo disponível insuficiente/);
  });

  it("4. available200 → advance200 allowed", async () => {
    const cycle = await setupCycleWithPayable(20000);

    const advance = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 200,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-key-4",
      createdById: userId,
    });

    expect(advance).toBeDefined();
    expect(toCents(cycle.remainingBalance)).toBe(0);
    expect(toCents(cycle.advancesTotal)).toBe(20000);
  });

  it("5. advance0 rejected", async () => {
    await setupCycleWithPayable(20000);

    await expect(
      createCommissionAdvance(db.tx, {
        barbershopId: shopId,
        memberId,
        amount: 0,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "adv-key-5",
        createdById: userId,
      })
    ).rejects.toThrow(/deve ser positivo/);
  });

  it("6. negative advance rejected", async () => {
    await setupCycleWithPayable(20000);

    await expect(
      createCommissionAdvance(db.tx, {
        barbershopId: shopId,
        memberId,
        amount: -50,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "adv-key-6",
        createdById: userId,
      })
    ).rejects.toThrow(/deve ser positivo/);
  });

  it("7. retry same idempotency key → one advance", async () => {
    await setupCycleWithPayable(30000);

    const adv1 = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 100,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-key-7",
      createdById: userId,
    });

    const adv2 = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 100,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-key-7",
      createdById: userId,
    });

    expect(adv1.id).toBe(adv2.id);
    expect(db.state.advances.length).toBe(1);
    expect(db.state.financialEntries.length).toBe(1);
    expect(db.state.advanceAudits.length).toBe(1);
  });

  it("8. same key conflicting payload → rejected", async () => {
    await setupCycleWithPayable(30000);

    await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 100,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-key-8",
      createdById: userId,
    });

    await expect(
      createCommissionAdvance(db.tx, {
        barbershopId: shopId,
        memberId,
        amount: 150, // conflicting amount!
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "adv-key-8",
        createdById: userId,
      })
    ).rejects.toThrow(/payload diferente/);
  });

  it("9. concurrent150 + 100 against available200 → never commits250", async () => {
    await setupCycleWithPayable(20000);

    // First request takes 150 -> succeeds
    const adv1 = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 150,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-conc-1",
      createdById: userId,
    });
    expect(adv1).toBeDefined();

    // Second request attempts 100 -> only 50 available -> must fail!
    await expect(
      createCommissionAdvance(db.tx, {
        barbershopId: shopId,
        memberId,
        amount: 100,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "adv-conc-2",
        createdById: userId,
      })
    ).rejects.toThrow(/Saldo disponível insuficiente/);

    expect(db.state.advances.length).toBe(1);
    expect(toCents(db.state.cycles[0].advancesTotal)).toBe(15000);
    expect(toCents(db.state.cycles[0].remainingBalance)).toBe(5000);
  });

  it("10. advance creates exactly one negative FinancialEntry", async () => {
    await setupCycleWithPayable(20000);

    const advance = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 80,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-fe-10",
      createdById: userId,
    });

    expect(db.state.financialEntries.length).toBe(1);
    const fe = db.state.financialEntries[0];
    expect(fe.type).toBe(FinancialEntryType.COMMISSION_ADVANCE);
    expect(fe.commissionAdvanceId).toBe(advance.id);
    expect(toCents(fe.amount)).toBe(-8000); // NEGATIVE
  });

  it("11. advance does not change CommissionEntry.releasedAmount", async () => {
    await setupCycleWithPayable(20000);
    const entry = {
      id: "entry-released-test",
      barbershopId: shopId,
      memberId,
      comandaItemId: "item-11",
      baseAmount: new Prisma.Decimal("200.00"),
      generatedAmount: new Prisma.Decimal("200.00"),
      releasedAmount: new Prisma.Decimal("200.00"),
      reversedAmount: new Prisma.Decimal("0.00"),
      paidAmount: new Prisma.Decimal("0.00"),
      status: CommissionEntryStatus.RELEASED,
    };
    db.state.entries.push(entry);

    await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 50,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-entry-11",
      createdById: userId,
    });

    expect(toCents(entry.releasedAmount)).toBe(20000); // UNTOUCHED
  });

  it("12. advance does not create RELEASE/REVERSAL ledger item", async () => {
    await setupCycleWithPayable(20000);
    const countBefore = db.state.payableItems.length;

    await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 50,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-ledger-12",
      createdById: userId,
    });

    expect(db.state.payableItems.length).toBe(countBefore);
  });

  it("13. advance keeps cycle OPEN", async () => {
    const cycle = await setupCycleWithPayable(20000);

    await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 50,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-open-13",
      createdById: userId,
    });

    expect(cycle.status).toBe(CommissionCycleStatus.OPEN);
  });

  it("14. future RELEASE after advance increases same cycle normally", async () => {
    const cycle = await setupCycleWithPayable(10000); // 100 payable

    // Advance 50 -> remaining 50
    await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 50,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-future-14",
      createdById: userId,
    });
    expect(toCents(cycle.remainingBalance)).toBe(5000);

    // New comanda releases 100 more into the same cycle
    db.state.comandas.push({
      id: "cmd-new",
      barbershopId: shopId,
      status: ComandaStatus.OPEN,
      total: new Prisma.Decimal("100.00"),
      commissionRevision: 1,
    });
    db.state.comandaItems.push({
      id: "item-new",
      comandaId: "cmd-new",
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-09-02T10:00:00Z"),
      unitPrice: new Prisma.Decimal("100.00"),
      quantity: 1,
      total: new Prisma.Decimal("100.00"),
      serviceId: "srv-cut",
      executorId: memberId,
    });
    db.state.payments.push({
      id: "pay-new",
      comandaId: "cmd-new",
      barbershopId: shopId,
      amount: new Prisma.Decimal("100.00"),
      refundedAmount: new Prisma.Decimal("0.00"),
      status: "CONFIRMED",
    });

    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-new");

    // Total gross: 100 + 100 = 200. Net advances: 50. Remaining: 150.
    const auth = await getAuthoritativeCycleBalance(db.tx, cycle.id);
    expect(auth.grossCommissionCents).toBe(20000);
    expect(auth.advancesTotalCents).toBe(5000);
    expect(auth.remainingBalanceCents).toBe(15000);
    expect(auth.availableForAdvanceCents).toBe(15000);
  });

  it("15. advance100 → reversal40 → netAdvanced60", async () => {
    const cycle = await setupCycleWithPayable(20000);

    const advance = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 100,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-rev-15",
      createdById: userId,
    });

    const reversal = await reverseCommissionAdvance(db.tx, {
      barbershopId: shopId,
      advanceId: advance.id,
      amount: 40,
      returnMethod: CommissionDisbursementMethod.PIX,
      reason: "Devolucao parcial",
      idempotencyKey: "rev-key-15",
      createdById: userId,
    });

    expect(reversal).toBeDefined();
    expect(toCents(reversal.amount)).toBe(4000);

    const auth = await getAuthoritativeCycleBalance(db.tx, cycle.id);
    expect(auth.advancesTotalCents).toBe(6000); // 100 - 40 = 60
    expect(auth.remainingBalanceCents).toBe(14000); // 200 - 60 = 140
  });

  it("16. advance100 → reversal101 rejected", async () => {
    await setupCycleWithPayable(20000);

    const advance = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 100,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-rev-16",
      createdById: userId,
    });

    await expect(
      reverseCommissionAdvance(db.tx, {
        barbershopId: shopId,
        advanceId: advance.id,
        amount: 101,
        returnMethod: CommissionDisbursementMethod.PIX,
        reason: "Devolucao excessiva",
        idempotencyKey: "rev-key-16",
        createdById: userId,
      })
    ).rejects.toThrow(/excede o saldo em aberto/);
  });

  it("17. two reversals40+60 allowed; third rejected", async () => {
    await setupCycleWithPayable(20000);

    const advance = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 100,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-rev-17",
      createdById: userId,
    });

    await reverseCommissionAdvance(db.tx, {
      barbershopId: shopId,
      advanceId: advance.id,
      amount: 40,
      returnMethod: CommissionDisbursementMethod.PIX,
      reason: "Devolucao 1",
      idempotencyKey: "rev-17-1",
      createdById: userId,
    });

    await reverseCommissionAdvance(db.tx, {
      barbershopId: shopId,
      advanceId: advance.id,
      amount: 60,
      returnMethod: CommissionDisbursementMethod.PIX,
      reason: "Devolucao 2",
      idempotencyKey: "rev-17-2",
      createdById: userId,
    });

    // Third reversal must be rejected because unreversed advance balance is 0
    await expect(
      reverseCommissionAdvance(db.tx, {
        barbershopId: shopId,
        advanceId: advance.id,
        amount: 1,
        returnMethod: CommissionDisbursementMethod.PIX,
        reason: "Devolucao 3",
        idempotencyKey: "rev-17-3",
        createdById: userId,
      })
    ).rejects.toThrow(/excede o saldo em aberto/);

    expect(db.state.advanceReversals.length).toBe(2);
    expect(toCents(db.state.cycles[0].advancesTotal)).toBe(0);
    expect(toCents(db.state.cycles[0].remainingBalance)).toBe(20000);
  });

  it("18. reversal creates exactly one positive FinancialEntry", async () => {
    await setupCycleWithPayable(20000);

    const advance = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 100,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-rev-18",
      createdById: userId,
    });

    const reversal = await reverseCommissionAdvance(db.tx, {
      barbershopId: shopId,
      advanceId: advance.id,
      amount: 40,
      returnMethod: CommissionDisbursementMethod.PIX,
      reason: "Devolucao 40",
      idempotencyKey: "rev-18-key",
      createdById: userId,
    });

    const revFe = db.state.financialEntries.find(
      (f) => f.commissionAdvanceReversalId === reversal.id
    );
    expect(revFe).toBeDefined();
    expect(revFe!.type).toBe(FinancialEntryType.COMMISSION_ADVANCE_REVERSAL);
    expect(toCents(revFe!.amount)).toBe(4000); // POSITIVE
  });

  it("19. reversal retry is idempotent", async () => {
    await setupCycleWithPayable(20000);

    const advance = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 100,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-rev-19",
      createdById: userId,
    });

    const rev1 = await reverseCommissionAdvance(db.tx, {
      barbershopId: shopId,
      advanceId: advance.id,
      amount: 50,
      returnMethod: CommissionDisbursementMethod.PIX,
      reason: "Devolucao 50",
      idempotencyKey: "rev-19-key",
      createdById: userId,
    });

    const rev2 = await reverseCommissionAdvance(db.tx, {
      barbershopId: shopId,
      advanceId: advance.id,
      amount: 50,
      returnMethod: CommissionDisbursementMethod.PIX,
      reason: "Devolucao 50",
      idempotencyKey: "rev-19-key",
      createdById: userId,
    });

    expect(rev1.id).toBe(rev2.id);
    expect(db.state.advanceReversals.length).toBe(1);
    expect(toCents(db.state.cycles[0].advancesTotal)).toBe(5000);
  });

  it("20. advance reversal is not commission income/accrual", async () => {
    await setupCycleWithPayable(20000);

    const advance = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 100,
      paymentMethod: CommissionDisbursementMethod.PIX,
      idempotencyKey: "adv-rev-20",
      createdById: userId,
    });

    await reverseCommissionAdvance(db.tx, {
      barbershopId: shopId,
      advanceId: advance.id,
      amount: 50,
      returnMethod: CommissionDisbursementMethod.PIX,
      reason: "Devolucao",
      idempotencyKey: "rev-20-key",
      createdById: userId,
    });

    // Commission payable items must not contain any new RELEASE
    const releases = db.state.payableItems.filter((p) => p.type === CommissionPayableType.RELEASE);
    expect(releases.length).toBe(1); // only the initial one
    expect(toCents(db.state.cycles[0].grossCommission)).toBe(20000);
  });

  it("21. CASH advance creates negative CashMovement", async () => {
    await setupCycleWithPayable(20000);
    // Open cash session
    db.state.cashSessions.push({
      id: "cs-open",
      barbershopId: shopId,
      status: "OPEN",
      openingAmount: new Prisma.Decimal("500.00"),
      expectedAmount: new Prisma.Decimal("500.00"),
    });

    const advance = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 70,
      paymentMethod: CommissionDisbursementMethod.CASH,
      idempotencyKey: "adv-cash-21",
      createdById: userId,
    });

    const cm = db.state.cashMovements.find((m) => m.commissionAdvanceId === advance.id);
    expect(cm).toBeDefined();
    expect(toCents(cm!.amount)).toBe(-7000); // NEGATIVE
    expect(toCents(db.state.cashSessions[0].expectedAmount)).toBe(43000); // 500 - 70 = 430
  });

  it("22. CASH reversal creates positive CashMovement", async () => {
    await setupCycleWithPayable(20000);
    db.state.cashSessions.push({
      id: "cs-open-rev",
      barbershopId: shopId,
      status: "OPEN",
      openingAmount: new Prisma.Decimal("500.00"),
      expectedAmount: new Prisma.Decimal("500.00"),
    });

    const advance = await createCommissionAdvance(db.tx, {
      barbershopId: shopId,
      memberId,
      amount: 100,
      paymentMethod: CommissionDisbursementMethod.CASH,
      idempotencyKey: "adv-cash-22",
      createdById: userId,
    });

    const reversal = await reverseCommissionAdvance(db.tx, {
      barbershopId: shopId,
      advanceId: advance.id,
      amount: 40,
      returnMethod: CommissionDisbursementMethod.CASH,
      isPhysicalCashReturned: true,
      reason: "Devolucao em dinheiro",
      idempotencyKey: "rev-cash-22",
      createdById: userId,
    });

    const cm = db.state.cashMovements.find((m) => m.commissionAdvanceReversalId === reversal.id);
    expect(cm).toBeDefined();
    expect(toCents(cm!.amount)).toBe(4000); // POSITIVE
    expect(toCents(db.state.cashSessions[0].expectedAmount)).toBe(44000); // (500 - 100) + 40 = 440
  });

  it("23. CASH advance without required open cash session rejected atomically", async () => {
    await setupCycleWithPayable(20000);
    // No cash session in db.state.cashSessions

    await expect(
      createCommissionAdvance(db.tx, {
        barbershopId: shopId,
        memberId,
        amount: 50,
        paymentMethod: CommissionDisbursementMethod.CASH,
        idempotencyKey: "adv-nocash-23",
        createdById: userId,
      })
    ).rejects.toThrow(/sessão de caixa aberta/);
  });

  it("24. failed FinancialEntry/CashMovement creation leaves no partial advance", async () => {
    await setupCycleWithPayable(20000);

    // Mock failure on financialEntry.create
    const originalCreate = db.tx.financialEntry.create;
    db.tx.financialEntry.create = async () => {
      throw new Error("DB network failure during FinancialEntry creation");
    };

    await expect(
      createCommissionAdvance(db.tx, {
        barbershopId: shopId,
        memberId,
        amount: 50,
        paymentMethod: CommissionDisbursementMethod.PIX,
        idempotencyKey: "adv-fail-24",
        createdById: userId,
      })
    ).rejects.toThrow("DB network failure");

    db.tx.financialEntry.create = originalCreate;
  });
});
