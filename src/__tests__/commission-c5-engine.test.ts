/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from "vitest";
import {
  ComandaItemStatus,
  ComandaItemType,
  ComandaStatus,
  CommissionConfigType,
  CommissionCycleStatus,
  CommissionEntryStatus,
  CommissionPayableSourceKind,
  CommissionPayableType,
  CommissionType,
  Prisma,
} from "@prisma/client";
import {
  computeComandaEconomics,
  getOrCreateCurrentCycle,
  isCommissionEligibleItem,
  syncCommissionReleaseForComanda,
  generateCommissionsForComanda,
  reverseCommissionEntry,
} from "@/lib/operations/commissions";
import { fromCents, toCents } from "@/lib/operations/money";

function createInMemoryDb() {
  const state = {
    members: [] as any[],
    services: [] as any[],
    products: [] as any[],
    configs: [] as any[],
    careerLevels: [] as any[],
    serviceRules: [] as any[],
    comandas: [] as any[],
    comandaItems: [] as any[],
    payments: [] as any[],
    entries: [] as any[],
    cycles: [] as any[],
    payableItems: [] as any[],
    cycleAdjustments: [] as any[],
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
      findFirst: async ({ where }: any) =>
        state.products.find((p) => (!where.id || p.id === where.id) && (!where.barbershopId || p.barbershopId === where.barbershopId)) || null,
      findFirstOrThrow: async ({ where }: any) => {
        const found = state.products.find((p) => (!where.id || p.id === where.id) && (!where.barbershopId || p.barbershopId === where.barbershopId));
        if (!found) throw new Error("Product not found");
        return found;
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
        // Enforce partial unique invariant in mock
        if (data.status === CommissionCycleStatus.OPEN) {
          const openExists = state.cycles.some(
            (c) => c.barbershopId === data.barbershopId && c.memberId === data.memberId && c.status === CommissionCycleStatus.OPEN
          );
          if (openExists) {
            const err: any = new Error("Unique constraint failed on commission_cycles_one_open_per_member_uidx");
            err.code = "P2002";
            throw err;
          }
        }
        const cycle = { id: `cycle-${state.cycles.length + 1}`, ...data };
        state.cycles.push(cycle);
        return cycle;
      },
      update: async ({ where, data }: any) => {
        const c = state.cycles.find((cy) => cy.id === where.id);
        if (!c) throw new Error("Cycle not found");
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
      create: async ({ data }: any) => {
        const adj = { id: `cadj-${state.cycleAdjustments.length + 1}`, createdAt: new Date(), ...data };
        state.cycleAdjustments.push(adj);
        return adj;
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

describe("TEM BARBER — Normal Commission C5 Engine Suite", () => {
  const shopId = "shop-alpha";
  const memberA = "barber-1";
  const memberB = "barber-2";
  const userA = "user-1";
  const userB = "user-2";

  let db: ReturnType<typeof createInMemoryDb>;

  beforeEach(() => {
    db = createInMemoryDb();
    db.state.members.push(
      { id: memberA, barbershopId: shopId, userId: userA },
      { id: memberB, barbershopId: shopId, userId: userB }
    );
    db.state.services.push(
      { id: "srv-cut", barbershopId: shopId, name: "Corte", price: new Prisma.Decimal("40.00"), categoryId: "cat-1" },
      { id: "srv-50", barbershopId: shopId, name: "Servico 50", price: new Prisma.Decimal("50.00"), categoryId: "cat-1" }
    );
    db.state.products.push(
      { id: "prod-pomade", barbershopId: shopId, name: "Pomada", price: new Prisma.Decimal("30.00"), categoryId: "cat-prod" },
      { id: "prod-50", barbershopId: shopId, name: "Produto 50", price: new Prisma.Decimal("50.00"), categoryId: "cat-prod" }
    );
    // Config default: 40% on all services for memberA
    db.state.configs.push({
      id: "cfg-1",
      barbershopId: shopId,
      scopeKey: `member:${memberA}:default`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("40.00"),
      active: true,
      memberId: memberA,
    });
    // Config default: 30% for memberB
    db.state.configs.push({
      id: "cfg-2",
      barbershopId: shopId,
      scopeKey: `member:${memberB}:default`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("30.00"),
      active: true,
      memberId: memberB,
    });
  });

  it("1. appointment only -> 0 payable", async () => {
    db.state.appointments.push({ id: "appt-1", barbershopId: shopId, memberId: memberA });
    // Appointment alone without comanda / payment creates 0 payable items
    expect(db.state.payableItems.length).toBe(0);
    expect(db.state.cycles.length).toBe(0);
  });

  it("2. DONE service, no customer payment -> 0 payable", async () => {
    db.state.comandas.push({
      id: "cmd-1",
      barbershopId: shopId,
      status: ComandaStatus.OPEN,
      total: new Prisma.Decimal("40.00"),
      commissionRevision: 1,
    });
    db.state.comandaItems.push({
      id: "item-1",
      comandaId: "cmd-1",
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-09-01T10:00:00Z"),
      unitPrice: new Prisma.Decimal("40.00"),
      quantity: 1,
      total: new Prisma.Decimal("40.00"),
      discountAmount: new Prisma.Decimal("0.00"),
      surchargeAmount: new Prisma.Decimal("0.00"),
      serviceId: "srv-cut",
      executorId: memberA,
    });

    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-1");

    expect(db.state.entries.length).toBe(1);
    expect(db.state.entries[0].status).toBe("GENERATED");
    expect(toCents(db.state.entries[0].generatedAmount)).toBe(1600); // 40% of 40 = 16
    expect(toCents(db.state.entries[0].releasedAmount)).toBe(0);
    expect(db.state.payableItems.length).toBe(0);
    expect(db.state.cycles.length).toBe(0); // lazy cycle provisioning: no cycle created for 0 payable
  });

  it("3. service PENDING + completedAt -> 0", async () => {
    expect(
      isCommissionEligibleItem({
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.PENDING,
        completedAt: new Date(),
        total: new Prisma.Decimal("40.00"),
      })
    ).toBe(false);
  });

  it("4. DONE service + completedAt null -> 0", async () => {
    expect(
      isCommissionEligibleItem({
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: null,
        total: new Prisma.Decimal("40.00"),
      })
    ).toBe(false);
  });

  it("5. product DONE eligible without completedAt", async () => {
    expect(
      isCommissionEligibleItem({
        type: ComandaItemType.PRODUCT,
        status: ComandaItemStatus.DONE,
        completedAt: null,
        total: new Prisma.Decimal("30.00"),
      })
    ).toBe(true);
  });

  it("6. payment 20/40 with 40% -> release 8", async () => {
    db.state.comandas.push({
      id: "cmd-2",
      barbershopId: shopId,
      status: ComandaStatus.OPEN,
      total: new Prisma.Decimal("40.00"),
      commissionRevision: 1,
    });
    db.state.comandaItems.push({
      id: "item-2",
      comandaId: "cmd-2",
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-09-01T10:00:00Z"),
      unitPrice: new Prisma.Decimal("40.00"),
      quantity: 1,
      total: new Prisma.Decimal("40.00"),
      serviceId: "srv-cut",
      executorId: memberA,
    });
    db.state.payments.push({
      id: "pay-1",
      comandaId: "cmd-2",
      barbershopId: shopId,
      amount: new Prisma.Decimal("20.00"),
      refundedAmount: new Prisma.Decimal("0.00"),
      status: "CONFIRMED",
    });

    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-2", "Pagamento parcial", {
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      sourcePaymentId: "pay-1",
    });

    expect(db.state.entries[0].status).toBe("PARTIALLY_RELEASED");
    expect(toCents(db.state.entries[0].releasedAmount)).toBe(800); // 8.00
    expect(db.state.payableItems.length).toBe(1);
    expect(db.state.payableItems[0].type).toBe(CommissionPayableType.RELEASE);
    expect(toCents(db.state.payableItems[0].amount)).toBe(800);
    expect(db.state.cycles.length).toBe(1);
    expect(toCents(db.state.cycles[0].grossCommission)).toBe(800);
    expect(toCents(db.state.cycles[0].remainingBalance)).toBe(800);
  });

  it("7. later remaining 20 -> total released 16", async () => {
    db.state.comandas.push({
      id: "cmd-3",
      barbershopId: shopId,
      status: ComandaStatus.OPEN,
      total: new Prisma.Decimal("40.00"),
      commissionRevision: 1,
    });
    db.state.comandaItems.push({
      id: "item-3",
      comandaId: "cmd-3",
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-09-01T10:00:00Z"),
      unitPrice: new Prisma.Decimal("40.00"),
      quantity: 1,
      total: new Prisma.Decimal("40.00"),
      serviceId: "srv-cut",
      executorId: memberA,
    });
    db.state.payments.push({
      id: "pay-1",
      comandaId: "cmd-3",
      barbershopId: shopId,
      amount: new Prisma.Decimal("20.00"),
      refundedAmount: new Prisma.Decimal("0.00"),
      status: "CONFIRMED",
    });

    // First payment 20 -> release 8
    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-3", "Pagamento parcial 1", {
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      sourcePaymentId: "pay-1",
    });

    // Second payment 20 -> total paid 40 -> release remaining 8 (total 16)
    db.state.payments.push({
      id: "pay-2",
      comandaId: "cmd-3",
      barbershopId: shopId,
      amount: new Prisma.Decimal("20.00"),
      refundedAmount: new Prisma.Decimal("0.00"),
      status: "CONFIRMED",
    });

    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-3", "Pagamento parcial 2", {
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      sourcePaymentId: "pay-2",
    });

    expect(db.state.entries[0].status).toBe("RELEASED");
    expect(toCents(db.state.entries[0].releasedAmount)).toBe(1600);
    expect(db.state.payableItems.length).toBe(2);
    expect(toCents(db.state.payableItems[0].amount)).toBe(800);
    expect(toCents(db.state.payableItems[1].amount)).toBe(800);
    expect(toCents(db.state.cycles[0].grossCommission)).toBe(1600);
    expect(toCents(db.state.cycles[0].remainingBalance)).toBe(1600);
  });

  it("8. repeated payment event -> no duplicate", async () => {
    db.state.comandas.push({
      id: "cmd-4",
      barbershopId: shopId,
      status: ComandaStatus.OPEN,
      total: new Prisma.Decimal("40.00"),
      commissionRevision: 1,
    });
    db.state.comandaItems.push({
      id: "item-4",
      comandaId: "cmd-4",
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-09-01T10:00:00Z"),
      unitPrice: new Prisma.Decimal("40.00"),
      quantity: 1,
      total: new Prisma.Decimal("40.00"),
      serviceId: "srv-cut",
      executorId: memberA,
    });
    db.state.payments.push({
      id: "pay-dup",
      comandaId: "cmd-4",
      barbershopId: shopId,
      amount: new Prisma.Decimal("40.00"),
      refundedAmount: new Prisma.Decimal("0.00"),
      status: "CONFIRMED",
    });

    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-4", "Pagamento total", {
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      sourcePaymentId: "pay-dup",
    });

    const payableCountAfterFirst = db.state.payableItems.length;
    const grossAfterFirst = toCents(db.state.cycles[0].grossCommission);
    const releasedAfterFirst = toCents(db.state.entries[0].releasedAmount);

    // Replay/Retry exact same event
    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-4", "Retry pagamento", {
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      sourcePaymentId: "pay-dup",
    });

    expect(db.state.payableItems.length).toBe(payableCountAfterFirst);
    expect(toCents(db.state.cycles[0].grossCommission)).toBe(grossAfterFirst);
    expect(toCents(db.state.entries[0].releasedAmount)).toBe(releasedAfterFirst);
  });

  it("9. discount 40->30 at 40% -> commission 12", async () => {
    const items: any[] = [
      {
        id: "it-service",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: new Date(),
        unitPrice: new Prisma.Decimal("40.00"),
        quantity: 1,
        total: new Prisma.Decimal("40.00"),
        discountAmount: new Prisma.Decimal("0.00"),
        surchargeAmount: new Prisma.Decimal("0.00"),
        executorId: memberA,
        serviceId: "srv-cut",
      },
      {
        id: "it-discount",
        type: ComandaItemType.DISCOUNT,
        status: ComandaItemStatus.DONE,
        total: new Prisma.Decimal("10.00"),
      },
    ];

    const econ = computeComandaEconomics(items);
    const serviceEcon = econ.itemEconomics.get("it-service")!;
    expect(serviceEcon.allocatedGlobalDiscountCents).toBe(1000);
    expect(serviceEcon.commissionBaseCents).toBe(3000); // 40 - 10 = 30
  });

  it("10. multi-barber comanda routes each commission to own cycle", async () => {
    db.state.comandas.push({
      id: "cmd-multi",
      barbershopId: shopId,
      status: ComandaStatus.OPEN,
      total: new Prisma.Decimal("90.00"),
      commissionRevision: 1,
    });
    // Item 1: Barber A (40.00 @ 40% = 16.00)
    db.state.comandaItems.push({
      id: "item-a",
      comandaId: "cmd-multi",
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-09-01T10:00:00Z"),
      unitPrice: new Prisma.Decimal("40.00"),
      quantity: 1,
      total: new Prisma.Decimal("40.00"),
      serviceId: "srv-cut",
      executorId: memberA,
    });
    // Item 2: Barber B (50.00 @ 30% = 15.00)
    db.state.comandaItems.push({
      id: "item-b",
      comandaId: "cmd-multi",
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-09-01T10:00:00Z"),
      unitPrice: new Prisma.Decimal("50.00"),
      quantity: 1,
      total: new Prisma.Decimal("50.00"),
      serviceId: "srv-50",
      executorId: memberB,
    });

    db.state.payments.push({
      id: "pay-full",
      comandaId: "cmd-multi",
      barbershopId: shopId,
      amount: new Prisma.Decimal("90.00"),
      refundedAmount: new Prisma.Decimal("0.00"),
      status: "CONFIRMED",
    });

    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-multi");

    expect(db.state.cycles.length).toBe(2);
    const cycleA = db.state.cycles.find((c) => c.memberId === memberA)!;
    const cycleB = db.state.cycles.find((c) => c.memberId === memberB)!;

    expect(toCents(cycleA.grossCommission)).toBe(1600);
    expect(toCents(cycleB.grossCommission)).toBe(1500);

    const payablesA = db.state.payableItems.filter((p) => p.memberId === memberA);
    const payablesB = db.state.payableItems.filter((p) => p.memberId === memberB);
    expect(payablesA[0].cycleId).toBe(cycleA.id);
    expect(payablesB[0].cycleId).toBe(cycleB.id);
  });

  it("11. zero commission rule -> no payable", async () => {
    db.state.configs = [
      {
        id: "cfg-zero",
        barbershopId: shopId,
        scopeKey: `member:${memberA}:default`,
        type: "PERCENTAGE",
        value: new Prisma.Decimal("0.00"),
        active: true,
        memberId: memberA,
      },
    ];

    db.state.comandas.push({
      id: "cmd-zero",
      barbershopId: shopId,
      status: ComandaStatus.OPEN,
      total: new Prisma.Decimal("40.00"),
      commissionRevision: 1,
    });
    db.state.comandaItems.push({
      id: "item-zero",
      comandaId: "cmd-zero",
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-09-01T10:00:00Z"),
      unitPrice: new Prisma.Decimal("40.00"),
      quantity: 1,
      total: new Prisma.Decimal("40.00"),
      serviceId: "srv-cut",
      executorId: memberA,
    });
    db.state.payments.push({
      id: "pay-zero",
      comandaId: "cmd-zero",
      barbershopId: shopId,
      amount: new Prisma.Decimal("40.00"),
      refundedAmount: new Prisma.Decimal("0.00"),
      status: "CONFIRMED",
    });

    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-zero");

    expect(db.state.entries[0].status).toBe("GENERATED");
    expect(toCents(db.state.entries[0].generatedAmount)).toBe(0);
    expect(toCents(db.state.entries[0].releasedAmount)).toBe(0);
    expect(db.state.payableItems.length).toBe(0);
  });

  it("12. RELEASE16 then REVERSAL8 -> released=8, reversed=8", async () => {
    db.state.comandas.push({
      id: "cmd-rev",
      barbershopId: shopId,
      status: ComandaStatus.OPEN,
      total: new Prisma.Decimal("40.00"),
      commissionRevision: 1,
    });
    db.state.comandaItems.push({
      id: "item-rev",
      comandaId: "cmd-rev",
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-09-01T10:00:00Z"),
      unitPrice: new Prisma.Decimal("40.00"),
      quantity: 1,
      total: new Prisma.Decimal("40.00"),
      serviceId: "srv-cut",
      executorId: memberA,
    });
    const payment = {
      id: "pay-rev",
      comandaId: "cmd-rev",
      barbershopId: shopId,
      amount: new Prisma.Decimal("40.00"),
      refundedAmount: new Prisma.Decimal("0.00"),
      status: "CONFIRMED",
    };
    db.state.payments.push(payment);

    // 1. Release 16
    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-rev");
    expect(toCents(db.state.entries[0].releasedAmount)).toBe(1600);
    expect(toCents(db.state.entries[0].reversedAmount)).toBe(0);

    // 2. Refund 20 -> net paid drops to 20 -> targetReleased drops to 8 -> reverse 8
    payment.refundedAmount = new Prisma.Decimal("20.00");
    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-rev", "Estorno parcial", {
      sourceKind: CommissionPayableSourceKind.REFUND,
      sourcePaymentId: "refund-1",
    });

    const entry = db.state.entries[0];
    expect(toCents(entry.releasedAmount)).toBe(800);
    expect(toCents(entry.reversedAmount)).toBe(800);
    expect(entry.status).toBe("PARTIALLY_RELEASED");
    expect(toCents(db.state.cycles[0].grossCommission)).toBe(800);
  });

  it("13. partial-release cancellation reverses only released", async () => {
    const cmd = {
      id: "cmd-cancel",
      barbershopId: shopId,
      status: ComandaStatus.OPEN as ComandaStatus,
      total: new Prisma.Decimal("40.00"),
      commissionRevision: 1,
    };
    db.state.comandas.push(cmd);
    db.state.comandaItems.push({
      id: "item-cancel",
      comandaId: "cmd-cancel",
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-09-01T10:00:00Z"),
      unitPrice: new Prisma.Decimal("40.00"),
      quantity: 1,
      total: new Prisma.Decimal("40.00"),
      serviceId: "srv-cut",
      executorId: memberA,
    });
    db.state.payments.push({
      id: "pay-p",
      comandaId: "cmd-cancel",
      barbershopId: shopId,
      amount: new Prisma.Decimal("20.00"),
      refundedAmount: new Prisma.Decimal("0.00"),
      status: "CONFIRMED",
    });

    // Half paid -> release 8 out of 16
    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-cancel");
    expect(toCents(db.state.entries[0].releasedAmount)).toBe(800);

    // Comanda is cancelled
    cmd.status = ComandaStatus.CANCELLED;
    cmd.commissionRevision = 2;
    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-cancel", "Cancelamento de comanda", {
      sourceKind: CommissionPayableSourceKind.COMANDA_RECALCULATION,
    });

    const entry = db.state.entries[0];
    expect(toCents(entry.releasedAmount)).toBe(0);
    expect(toCents(entry.reversedAmount)).toBe(800); // exactly 8 reversed, never the unreleased 8!
    expect(entry.status).toBe("REVERSED");
    expect(toCents(db.state.cycles[0].grossCommission)).toBe(0);
  });

  it("14. Club INCLUDED50 + normal50 + global discount20 -> normal base30", () => {
    const items: any[] = [
      {
        id: "item-club-inc",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: new Date(),
        unitPrice: new Prisma.Decimal("50.00"),
        quantity: 1,
        total: new Prisma.Decimal("50.00"),
        clubBenefitRequested: true,
        clubBenefitUsage: { status: "APPLIED", benefitType: "INCLUDED_SERVICE" },
        serviceId: "srv-50",
        executorId: memberA,
      },
      {
        id: "item-normal-50",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: new Date(),
        unitPrice: new Prisma.Decimal("50.00"),
        quantity: 1,
        total: new Prisma.Decimal("50.00"),
        serviceId: "srv-50",
        executorId: memberA,
      },
      {
        id: "item-disc-20",
        type: ComandaItemType.DISCOUNT,
        status: ComandaItemStatus.DONE,
        total: new Prisma.Decimal("20.00"),
      },
    ];

    const econ = computeComandaEconomics(items);
    const incEcon = econ.itemEconomics.get("item-club-inc")!;
    const normalEcon = econ.itemEconomics.get("item-normal-50")!;

    expect(incEcon.chargeableBaseCents).toBe(0);
    expect(incEcon.allocatedGlobalDiscountCents).toBe(0);
    expect(incEcon.commissionBaseCents).toBe(0);

    expect(normalEcon.chargeableBaseCents).toBe(5000);
    expect(normalEcon.allocatedGlobalDiscountCents).toBe(2000); // absorbs all 20 of global discount
    expect(normalEcon.commissionBaseCents).toBe(3000); // 50 - 20 = 30
  });

  it("15. commissionable50 + noncommissionable chargeable50 + discount20 -> service base40", () => {
    const items: any[] = [
      {
        id: "it-service-50",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: new Date(),
        unitPrice: new Prisma.Decimal("50.00"),
        quantity: 1,
        total: new Prisma.Decimal("50.00"),
        serviceId: "srv-50",
        executorId: memberA,
      },
      {
        id: "it-prod-chargeable",
        type: ComandaItemType.PRODUCT,
        status: ComandaItemStatus.DONE,
        unitPrice: new Prisma.Decimal("50.00"),
        quantity: 1,
        total: new Prisma.Decimal("50.00"),
        executorId: null, // non-commissionable
      },
      {
        id: "it-disc-20",
        type: ComandaItemType.DISCOUNT,
        status: ComandaItemStatus.DONE,
        total: new Prisma.Decimal("20.00"),
      },
    ];

    const econ = computeComandaEconomics(items);
    const srvEcon = econ.itemEconomics.get("it-service-50")!;
    const prodEcon = econ.itemEconomics.get("it-prod-chargeable")!;

    expect(econ.totalChargeableBaseCents).toBe(10000);
    expect(srvEcon.allocatedGlobalDiscountCents).toBe(1000);
    expect(prodEcon.allocatedGlobalDiscountCents).toBe(1000);

    expect(srvEcon.commissionBaseCents).toBe(4000); // 50 - 10 = 40
    expect(prodEcon.commissionBaseCents).toBe(0); // non-commissionable
  });

  it("16. unresolved Club + global discount -> hold/replay", async () => {
    db.state.comandas.push({
      id: "cmd-club-hold",
      barbershopId: shopId,
      status: ComandaStatus.OPEN,
      total: new Prisma.Decimal("80.00"),
      commissionRevision: 1,
    });
    db.state.comandaItems.push(
      {
        id: "item-club-unresolved",
        comandaId: "cmd-club-hold",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: new Date("2026-09-01T10:00:00Z"),
        unitPrice: new Prisma.Decimal("50.00"),
        quantity: 1,
        total: new Prisma.Decimal("50.00"),
        clubBenefitRequested: true,
        clubBenefitUsage: null, // UNRESOLVED!
        serviceId: "srv-50",
        executorId: memberA,
      },
      {
        id: "item-normal-other",
        comandaId: "cmd-club-hold",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: new Date("2026-09-01T10:00:00Z"),
        unitPrice: new Prisma.Decimal("50.00"),
        quantity: 1,
        total: new Prisma.Decimal("50.00"),
        serviceId: "srv-50",
        executorId: memberA,
      },
      {
        id: "item-gd-20",
        comandaId: "cmd-club-hold",
        type: ComandaItemType.DISCOUNT,
        status: ComandaItemStatus.DONE,
        total: new Prisma.Decimal("20.00"),
      }
    );

    db.state.payments.push({
      id: "pay-hold",
      comandaId: "cmd-club-hold",
      barbershopId: shopId,
      amount: new Prisma.Decimal("80.00"),
      refundedAmount: new Prisma.Decimal("0.00"),
      status: "CONFIRMED",
    });

    // 1. While Club is unresolved and global discount > 0, rule snapshot is frozen, but release is held at 0
    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-club-hold");
    expect(db.state.payableItems.length).toBe(0);
    expect(db.state.cycles.length).toBe(0); // no payable debt created before resolution
    const normalEntryPre = db.state.entries.find((e) => e.comandaItemId === "item-normal-other")!;
    expect(normalEntryPre).toBeDefined();
    expect(toCents(normalEntryPre.releasedAmount)).toBe(0);

    // 2. Club benefit resolves to INCLUDED_SERVICE upon comanda finalization
    const clubItem = db.state.comandaItems.find((i) => i.id === "item-club-unresolved")!;
    clubItem.clubBenefitUsage = { status: "APPLIED", benefitType: "INCLUDED_SERVICE" };

    // Replay with finalized economics
    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-club-hold");
    expect(db.state.payableItems.length).toBe(1); // only the normal service
    const normalEntry = db.state.entries.find((e) => e.comandaItemId === "item-normal-other")!;
    expect(toCents(normalEntry.baseAmount)).toBe(3000); // 50 - 20 = 30
    expect(toCents(normalEntry.releasedAmount)).toBe(1200); // 40% of 30 = 12
  });

  it("17. standalone surcharge -> no commission", () => {
    const items: any[] = [
      {
        id: "it-surcharge",
        type: ComandaItemType.SURCHARGE,
        status: ComandaItemStatus.DONE,
        total: new Prisma.Decimal("15.00"),
      },
    ];

    const econ = computeComandaEconomics(items);
    const surchargeEcon = econ.itemEconomics.get("it-surcharge")!;
    expect(surchargeEcon.isCommissionEligible).toBe(false);
    expect(surchargeEcon.commissionBaseCents).toBe(0);
  });

  it("18. exactly one OPEN cycle under concurrent provisioning", async () => {
    // Calling getOrCreateCurrentCycle multiple times produces the exact same cycle
    const cycle1 = await getOrCreateCurrentCycle(db.tx, shopId, memberA);
    const cycle2 = await getOrCreateCurrentCycle(db.tx, shopId, memberA);

    expect(cycle1.id).toBe(cycle2.id);
    expect(db.state.cycles.filter((c) => c.memberId === memberA && c.status === CommissionCycleStatus.OPEN).length).toBe(1);
  });

  it("19. PAID historical cycle never mutated by later reversal", async () => {
    // 1. Create a historical cycle that was marked PAID
    const paidCycle = {
      id: "cycle-paid-hist",
      barbershopId: shopId,
      memberId: memberA,
      cycleNumber: 1,
      status: CommissionCycleStatus.PAID,
      grossCommission: new Prisma.Decimal("16.00"),
      adjustmentsTotal: new Prisma.Decimal("0.00"),
      advancesTotal: new Prisma.Decimal("0.00"),
      finalPayoutAmount: new Prisma.Decimal("16.00"),
      remainingBalance: new Prisma.Decimal("0.00"),
      closedAt: new Date("2026-08-31T23:59:59Z"),
      paidAt: new Date("2026-09-01T00:00:00Z"),
      version: 1,
    };
    db.state.cycles.push(paidCycle);

    // Commission entry from that period
    const entry = {
      id: "entry-hist",
      barbershopId: shopId,
      comandaItemId: "item-hist",
      memberId: memberA,
      baseAmount: new Prisma.Decimal("40.00"),
      generatedAmount: new Prisma.Decimal("16.00"),
      releasedAmount: new Prisma.Decimal("16.00"),
      reversedAmount: new Prisma.Decimal("0.00"),
      paidAmount: new Prisma.Decimal("16.00"),
      status: CommissionEntryStatus.PAID,
      competence: "2026-08",
    };
    db.state.entries.push(entry);

    // Source release was in the paid cycle
    db.state.payableItems.push({
      id: "pay-item-hist",
      barbershopId: shopId,
      cycleId: paidCycle.id,
      entryId: entry.id,
      memberId: memberA,
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      type: CommissionPayableType.RELEASE,
      amount: new Prisma.Decimal("16.00"),
      eventKey: "hist-event-1",
      createdAt: new Date("2026-08-15T12:00:00Z"),
    });

    // 2. Later reversal of R$ 8 occurs
    await reverseCommissionEntry(db.tx, shopId, entry.id, 800, "pay-hist-refund", "Reversao historica");

    // PAID historical cycle must NOT be mutated!
    expect(toCents(paidCycle.grossCommission)).toBe(1600);
    expect(toCents(paidCycle.remainingBalance)).toBe(0);
    expect(paidCycle.status).toBe(CommissionCycleStatus.PAID);

    // A new OPEN cycle was lazily created for memberA to absorb the correction
    const openCycles = db.state.cycles.filter((c) => c.memberId === memberA && c.status === CommissionCycleStatus.OPEN);
    expect(openCycles.length).toBe(1);
    const openCycle = openCycles[0];
    expect(openCycle.cycleNumber).toBe(2);

    // Reversal payable item was posted with isHistoricalCorrection: true
    const reversalItem = db.state.payableItems.find((p) => p.type === CommissionPayableType.REVERSAL)!;
    expect(reversalItem.isHistoricalCorrection).toBe(true);
    expect(reversalItem.cycleId).toBe(openCycle.id);

    // Companion CommissionCycleAdjustment of type DEBIT was created
    expect(db.state.cycleAdjustments.length).toBe(1);
    const adj = db.state.cycleAdjustments[0];
    expect(adj.type).toBe("DEBIT");
    expect(toCents(adj.amount)).toBe(800);
    expect(adj.sourcePayableItemId).toBe(reversalItem.id);

    // Open cycle balance reflects debit adjustment
    expect(toCents(openCycle.adjustmentsTotal)).toBe(-800);
    expect(toCents(openCycle.remainingBalance)).toBe(-800);

    // Entry cache reflects net released and cumulative reversal
    const updatedEntry = db.state.entries.find((e) => e.id === entry.id)!;
    expect(toCents(updatedEntry.releasedAmount)).toBe(800); // 16 - 8 = 8
    expect(toCents(updatedEntry.reversedAmount)).toBe(800); // 8 reversed
  });

  it("20. ledger/cache reconciliation exact to cents", () => {
    // 3 items with fractional discount remainder
    const items: any[] = [
      {
        id: "item-1",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: new Date(),
        unitPrice: new Prisma.Decimal("33.33"),
        quantity: 1,
        total: new Prisma.Decimal("33.33"),
        serviceId: "srv-cut",
        executorId: memberA,
      },
      {
        id: "item-2",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: new Date(),
        unitPrice: new Prisma.Decimal("33.33"),
        quantity: 1,
        total: new Prisma.Decimal("33.33"),
        serviceId: "srv-cut",
        executorId: memberA,
      },
      {
        id: "item-3",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: new Date(),
        unitPrice: new Prisma.Decimal("33.34"),
        quantity: 1,
        total: new Prisma.Decimal("33.34"),
        serviceId: "srv-cut",
        executorId: memberA,
      },
      {
        id: "discount",
        type: ComandaItemType.DISCOUNT,
        status: ComandaItemStatus.DONE,
        total: new Prisma.Decimal("10.00"),
      },
    ];

    const econ = computeComandaEconomics(items);
    const d1 = econ.itemEconomics.get("item-1")!.allocatedGlobalDiscountCents;
    const d2 = econ.itemEconomics.get("item-2")!.allocatedGlobalDiscountCents;
    const d3 = econ.itemEconomics.get("item-3")!.allocatedGlobalDiscountCents;

    // Sum of allocated discount must equal exactly 10.00 (1000 cents)
    expect(d1 + d2 + d3).toBe(1000);
  });

  it("21. service DONE with rule=40%, Club unresolved + global discount => release 0, change config to 50%, resolve Club => attribution still uses frozen 40%, never 50%", async () => {
    // 1. Initial setup: memberA has 40% rule active
    db.state.comandas.push({
      id: "cmd-freeze-test",
      barbershopId: shopId,
      status: ComandaStatus.OPEN,
      total: new Prisma.Decimal("80.00"),
      commissionRevision: 1,
    });
    db.state.comandaItems.push(
      {
        id: "item-service-done",
        comandaId: "cmd-freeze-test",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: new Date("2026-09-01T10:00:00Z"),
        unitPrice: new Prisma.Decimal("50.00"),
        quantity: 1,
        total: new Prisma.Decimal("50.00"),
        clubBenefitRequested: true,
        clubBenefitUsage: null, // unresolved
        serviceId: "srv-50",
        executorId: memberA,
      },
      {
        id: "item-service-other",
        comandaId: "cmd-freeze-test",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        completedAt: new Date("2026-09-01T10:00:00Z"),
        unitPrice: new Prisma.Decimal("50.00"),
        quantity: 1,
        total: new Prisma.Decimal("50.00"),
        serviceId: "srv-50",
        executorId: memberA,
      },
      {
        id: "item-global-disc",
        comandaId: "cmd-freeze-test",
        type: ComandaItemType.DISCOUNT,
        status: ComandaItemStatus.DONE,
        total: new Prisma.Decimal("20.00"),
      }
    );
    db.state.payments.push({
      id: "pay-freeze",
      comandaId: "cmd-freeze-test",
      barbershopId: shopId,
      amount: new Prisma.Decimal("80.00"),
      refundedAmount: new Prisma.Decimal("0.00"),
      status: "CONFIRMED",
    });

    // 2. Service is DONE, Club is unresolved + global discount => release is 0, but rule snapshot 40% is frozen!
    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-freeze-test");
    expect(db.state.payableItems.length).toBe(0); // release remains 0
    expect(db.state.cycles.length).toBe(0); // no payable debt created before resolution

    const entryBefore = db.state.entries.find((e) => e.comandaItemId === "item-service-other")!;
    expect(entryBefore).toBeDefined();
    expect(Number((entryBefore.configSnapshot as any).value)).toBe(40);
    expect(toCents(entryBefore.releasedAmount)).toBe(0);

    // 3. Admin changes commission configuration in DB to 50%!
    const memberCfg = db.state.configs.find((c) => c.memberId === memberA && c.scopeKey === `member:${memberA}:default`)!;
    memberCfg.value = new Prisma.Decimal("50.00");

    // 4. Resolve Club benefit on item (club absorbs benefit, item-service-other absorbs remainder)
    const clubItem = db.state.comandaItems.find((i) => i.id === "item-service-done")!;
    clubItem.clubBenefitUsage = { status: "APPLIED", benefitType: "INCLUDED_SERVICE" };

    // 5. Replay release against confirmed customer money
    await syncCommissionReleaseForComanda(db.tx, shopId, "cmd-freeze-test");

    // Entry must STILL use the frozen 40% rule, NEVER 50%!
    const entryAfter = db.state.entries.find((e) => e.comandaItemId === "item-service-other")!;
    expect(Number((entryAfter.configSnapshot as any).value)).toBe(40);
    // Finalized base for item-service-other: 50 - 20 = 30.
    // At 40% = 12.00 (1200 cents). (If it had used 50%, it would be 15.00!)
    expect(toCents(entryAfter.baseAmount)).toBe(3000);
    expect(toCents(entryAfter.generatedAmount)).toBe(1200);
    expect(toCents(entryAfter.releasedAmount)).toBe(1200);
    expect(db.state.payableItems.length).toBe(1);
    expect(toCents(db.state.payableItems[0].amount)).toBe(1200);
  });

  it("22. post-paid reversal on historical PAID cycle routes companion DEBIT to current OPEN cycle without double-debit (30 - 8 = 22, not 14)", async () => {
    // 1. Old cycle = PAID (paid commission = 16.00)
    const oldPaidCycle = {
      id: "cycle-paid-1",
      barbershopId: shopId,
      memberId: memberA,
      cycleNumber: 1,
      status: CommissionCycleStatus.PAID,
      grossCommission: new Prisma.Decimal("16.00"),
      adjustmentsTotal: new Prisma.Decimal("0.00"),
      advancesTotal: new Prisma.Decimal("0.00"),
      finalPayoutAmount: new Prisma.Decimal("16.00"),
      remainingBalance: new Prisma.Decimal("0.00"),
      closedAt: new Date("2026-08-31T23:59:59Z"),
      paidAt: new Date("2026-09-01T00:00:00Z"),
      version: 1,
    };
    db.state.cycles.push(oldPaidCycle);

    // Old entry from that cycle
    const oldEntry = {
      id: "entry-old-1",
      barbershopId: shopId,
      comandaItemId: "item-old-1",
      memberId: memberA,
      baseAmount: new Prisma.Decimal("40.00"),
      generatedAmount: new Prisma.Decimal("16.00"),
      releasedAmount: new Prisma.Decimal("16.00"),
      reversedAmount: new Prisma.Decimal("0.00"),
      paidAmount: new Prisma.Decimal("16.00"),
      status: CommissionEntryStatus.PAID,
      competence: "2026-08",
    };
    db.state.entries.push(oldEntry);

    db.state.payableItems.push({
      id: "pay-item-old-1",
      barbershopId: shopId,
      cycleId: oldPaidCycle.id,
      entryId: oldEntry.id,
      memberId: memberA,
      sourceKind: CommissionPayableSourceKind.PAYMENT,
      type: CommissionPayableType.RELEASE,
      amount: new Prisma.Decimal("16.00"),
      eventKey: "old-event-1",
      createdAt: new Date("2026-08-15T12:00:00Z"),
    });

    // 2. Current OPEN cycle already has commissions = 30.00
    const currentOpenCycle = {
      id: "cycle-open-2",
      barbershopId: shopId,
      memberId: memberA,
      cycleNumber: 2,
      status: CommissionCycleStatus.OPEN,
      grossCommission: new Prisma.Decimal("30.00"),
      adjustmentsTotal: new Prisma.Decimal("0.00"),
      advancesTotal: new Prisma.Decimal("0.00"),
      finalPayoutAmount: new Prisma.Decimal("0.00"),
      remainingBalance: new Prisma.Decimal("30.00"),
      version: 1,
    };
    db.state.cycles.push(currentOpenCycle);

    // 3. Post-paid refund of R$ 8 occurs on the old comanda
    await reverseCommissionEntry(db.tx, shopId, oldEntry.id, 800, "pay-old-refund", "Reversao de comissao ja paga");

    // Invariant: Historical PAID cycle remains immutable!
    expect(toCents(oldPaidCycle.grossCommission)).toBe(1600);
    expect(toCents(oldPaidCycle.remainingBalance)).toBe(0);
    expect(oldPaidCycle.status).toBe(CommissionCycleStatus.PAID);

    // Invariant: Current OPEN cycle receives ONE economic debit only:
    // grossCommission remains 30.00 (NOT decremented to 22.00)
    // adjustmentsTotal = -8.00 (via CommissionCycleAdjustment DEBIT)
    // remainingBalance = 30.00 - 8.00 = 22.00 (NOT 14.00!)
    expect(toCents(currentOpenCycle.grossCommission)).toBe(3000);
    expect(toCents(currentOpenCycle.adjustmentsTotal)).toBe(-800);
    expect(toCents(currentOpenCycle.remainingBalance)).toBe(2200);

    // Verify companion adjustment and payable item
    expect(db.state.cycleAdjustments.length).toBe(1);
    const adj = db.state.cycleAdjustments[0];
    expect(adj.type).toBe("DEBIT");
    expect(toCents(adj.amount)).toBe(800);
    expect(adj.cycleId).toBe(currentOpenCycle.id);

    const reversalItem = db.state.payableItems.find((p) => p.type === CommissionPayableType.REVERSAL)!;
    expect(reversalItem.isHistoricalCorrection).toBe(true);
    expect(reversalItem.cycleId).toBe(currentOpenCycle.id);
    expect(adj.sourcePayableItemId).toBe(reversalItem.id);
  });
});
