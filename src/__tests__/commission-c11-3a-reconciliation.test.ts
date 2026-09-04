/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  correctCommissionExecutor,
  getAuthoritativeCycleBalance,
  resolveHistoricalCommissionConfig,
  reverseCommissionEntry,
} from "@/lib/operations/commissions";
import { toCents, fromCents } from "@/lib/operations/money";
import prisma from "@/lib/prisma";
import {
  ComandaItemType,
  ComandaItemStatus,
  ComandaStatus,
  CommissionEntryStatus,
  CommissionCycleStatus,
  CommissionPayableType,
  CommissionPayableSourceKind,
  CommissionCycleAdjustmentType,
  Prisma,
} from "@prisma/client";

vi.mock("@/lib/operations/stock", () => ({
  runSerializableTransaction: vi.fn(async (cb: any) => cb(prisma)),
  syncStockForComandaItem: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const p: any = {
    $transaction: vi.fn(async (cb: any) => cb(p)),
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 1),
    comanda: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    comandaItem: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    commissionEntry: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    commissionCycle: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    commissionPayableItem: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    commissionCycleAdjustment: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    commissionAdvance: {
      findMany: vi.fn(),
    },
    commissionExecutorCorrectionAudit: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    barbershopMember: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    commissionConfig: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    serviceCommissionRule: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    careerLevel: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    service: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    payment: {
      findMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  };
  return { default: p };
});

const mockedPrisma = prisma as any;

describe("C11.3a Final Executor Correction Reconciliation", () => {
  const barbershopId = "shop-c11-3a";
  const ownerId = "usr-owner";
  const oldMemberId = "mbr-old";
  const newMemberId = "mbr-new";
  const comandaItemId = "item-3a-1";
  const comandaId = "cmd-3a-1";
  const attributionTime = new Date("2026-08-01T12:00:00Z");

  const getFingerprint = (payload: { comandaItemId: string; newExecutorMemberId: string; reason: string }) =>
    crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  beforeEach(() => {
    vi.clearAllMocks();
    mockedPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockedPrisma));
    mockedPrisma.$queryRaw.mockResolvedValue([]);
    mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue(null);
    mockedPrisma.commissionExecutorCorrectionAudit.create.mockResolvedValue({
      id: "audit-3a-default",
      createdAt: new Date(),
    });
    mockedPrisma.commissionEntry.create.mockImplementation(async ({ data }: any) => ({
      id: "entry-new-created",
      attributionVersion: 2,
      ...data,
    }));
  });

  describe("1. Open-Cycle Executor Reversal Must Not Double-Debit", () => {
    it("A. OPEN cycle payable 100, correction reversal 40 => old OPEN payable 60 exactly", async () => {
      const openCycleId = "cycle-old-open";
      // Source release of 100.00 in OPEN cycle
      const sourceRelease = {
        id: "pi-rel-100",
        barbershopId,
        cycleId: openCycleId,
        memberId: oldMemberId,
        entryId: "entry-old",
        type: CommissionPayableType.RELEASE,
        amount: new Prisma.Decimal("100.00"),
        isHistoricalCorrection: false,
        cycle: {
          id: openCycleId,
          status: CommissionCycleStatus.OPEN,
          grossCommission: new Prisma.Decimal("100.00"),
          remainingBalance: new Prisma.Decimal("100.00"),
        },
      };

      mockedPrisma.commissionPayableItem.findFirst.mockResolvedValue(sourceRelease);
      mockedPrisma.commissionCycle.update.mockResolvedValue({});
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-old",
        barbershopId,
        memberId: oldMemberId,
        releasedAmount: new Prisma.Decimal("100.00"),
        reversedAmount: new Prisma.Decimal("0.00"),
      });

      // Execute reversal of 40
      await reverseCommissionEntry(
        mockedPrisma,
        barbershopId,
        "entry-old",
        4000,
        null,
        "Reversal of 40 in OPEN cycle"
      );

      // Verify: In Case A (OPEN cycle), NO CommissionCycleAdjustment was created
      expect(mockedPrisma.commissionCycleAdjustment.create).not.toHaveBeenCalled();

      // Verify: A single REVERSAL payable item was created in the open cycle
      expect(mockedPrisma.commissionPayableItem.create).toHaveBeenCalledTimes(1);
      const payableItemCall = mockedPrisma.commissionPayableItem.create.mock.calls[0][0];
      expect(payableItemCall.data.cycleId).toBe(openCycleId);
      expect(payableItemCall.data.type).toBe(CommissionPayableType.REVERSAL);
      expect(toCents(payableItemCall.data.amount)).toBe(4000);

      // Verify: CommissionCycle cache decremented by 40: 100 - 40 = 60
      expect(mockedPrisma.commissionCycle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: openCycleId },
          data: {
            grossCommission: fromCents(6000),
            remainingBalance: fromCents(6000),
          },
        })
      );

      // Verify Authoritative Balance calculation: 100 release - 40 reversal = 60 economic payable
      mockedPrisma.commissionPayableItem.findMany.mockResolvedValue([
        { type: CommissionPayableType.RELEASE, amount: new Prisma.Decimal("100.00") },
        { type: CommissionPayableType.REVERSAL, amount: new Prisma.Decimal("40.00"), isHistoricalCorrection: false },
      ]);
      mockedPrisma.commissionCycleAdjustment.findMany.mockResolvedValue([]);
      mockedPrisma.commissionAdvance.findMany.mockResolvedValue([]);

      const authBalance = await getAuthoritativeCycleBalance(mockedPrisma, openCycleId);
      expect(authBalance.grossCommissionCents).toBe(6000);
      expect(authBalance.adjustmentsTotalCents).toBe(0);
      expect(authBalance.economicPayableCents).toBe(6000);
      expect(authBalance.remainingBalanceCents).toBe(6000);
    });

    it("B. old OPEN 40, new corrected executor entitlement 50, fully paid customer => old -40, new +50, net P&L +10, no second -40", async () => {
      const oldCycleId = "cycle-old-open";
      const newCycleId = "cycle-new-open";

      mockedPrisma.comandaItem.findFirst.mockResolvedValue({
        id: comandaItemId,
        comandaId,
        serviceId: "srv-corte",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        comanda: {
          id: comandaId,
          status: ComandaStatus.OPEN,
          total: "100.00",
          commissionRevision: 1,
        },
      });

      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-old-v1",
        memberId: oldMemberId,
        comandaItemId,
        baseAmount: new Prisma.Decimal("100.00"),
        generatedAmount: new Prisma.Decimal("40.00"),
        releasedAmount: new Prisma.Decimal("40.00"),
        paidAmount: new Prisma.Decimal("0.00"),
        reversedAmount: new Prisma.Decimal("0.00"),
        attributionVersion: 1,
        isCurrent: true,
        competence: "2026-08",
        type: "SERVICE",
        createdAt: attributionTime,
        configSnapshot: { type: "PERCENTAGE", value: 40 },
      });

      // Old release in old member's OPEN cycle
      mockedPrisma.commissionPayableItem.findFirst.mockResolvedValue({
        id: "pi-old-rel-40",
        barbershopId,
        cycleId: oldCycleId,
        memberId: oldMemberId,
        entryId: "entry-old-v1",
        type: CommissionPayableType.RELEASE,
        amount: new Prisma.Decimal("40.00"),
        isHistoricalCorrection: false,
        cycle: {
          id: oldCycleId,
          status: CommissionCycleStatus.OPEN,
          grossCommission: new Prisma.Decimal("40.00"),
          remainingBalance: new Prisma.Decimal("40.00"),
        },
      });

      mockedPrisma.barbershopMember.findFirst.mockResolvedValue({
        id: newMemberId,
        barbershopId,
        isActive: true,
        services: [{ serviceId: "srv-corte" }],
      });

      mockedPrisma.service.findFirst.mockResolvedValue({
        id: "srv-corte",
        categoryId: "cat-corte",
      });

      // New member rule is 50%
      mockedPrisma.commissionConfig.findMany.mockResolvedValue([
        {
          id: "cfg-new-50",
          barbershopId,
          scopeKey: "member:" + newMemberId + ":default",
          type: "PERCENTAGE",
          value: new Prisma.Decimal("50.00"),
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-01T00:00:00Z"),
        },
      ]);
      mockedPrisma.commissionConfig.findUnique.mockResolvedValue({
        id: "cfg-new-50",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z"),
      });
      mockedPrisma.barbershopMember.findUnique.mockResolvedValue({ id: newMemberId, careerLevelId: null });

      // Customer fully paid (100.00 payment)
      mockedPrisma.payment.findMany.mockResolvedValue([
        {
          id: "pay-1",
          comandaId,
          status: "CONFIRMED",
          amount: new Prisma.Decimal("100.00"),
          refunds: [],
        },
      ]);

      mockedPrisma.commissionCycle.findFirst.mockResolvedValue({
        id: newCycleId,
        barbershopId,
        status: CommissionCycleStatus.OPEN,
        grossCommission: new Prisma.Decimal("0.00"),
        remainingBalance: new Prisma.Decimal("0.00"),
      });

      mockedPrisma.commissionEntry.create.mockImplementation(async ({ data }: any) => ({
        id: "entry-new-v2",
        attributionVersion: 2,
        ...data,
      }));

      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId: newMemberId,
        reason: "Reassigning fully paid customer service",
        idempotencyKey: "idem-3a-test-b",
        userId: ownerId,
        role: "OWNER",
      });

      expect(res.success).toBe(true);
      expect(res.reversalAmount).toBe("40.00");
      expect(res.newReleasedAmount).toBe("50.00");

      // Verify NO routing adjustment created for old OPEN cycle
      expect(mockedPrisma.commissionCycleAdjustment.create).not.toHaveBeenCalled();

      // Net economic effect:
      // Old member open cycle gross decremented by 40 (old economic effect: -40)
      // New member open cycle gross incremented by 50 (new economic effect: +50)
      // Net P&L correction = +10. Zero second balance reduction.
    });

    it("C. PAID historical 40, correction to 50 => historical PAID stays 40, current routing old -40 exactly once, new +50, net +10", async () => {
      const closedPaidCycleId = "cycle-old-closed-paid";
      const currentOpenCycleId = "cycle-old-current-open";
      const newCycleId = "cycle-new-open";

      mockedPrisma.comandaItem.findFirst.mockResolvedValue({
        id: comandaItemId,
        comandaId,
        serviceId: "srv-corte",
        type: ComandaItemType.SERVICE,
        status: ComandaItemStatus.DONE,
        comanda: {
          id: comandaId,
          status: ComandaStatus.CLOSED,
          total: "100.00",
          commissionRevision: 1,
        },
      });

      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-old-v1",
        memberId: oldMemberId,
        comandaItemId,
        baseAmount: new Prisma.Decimal("100.00"),
        generatedAmount: new Prisma.Decimal("40.00"),
        releasedAmount: new Prisma.Decimal("40.00"),
        paidAmount: new Prisma.Decimal("40.00"),
        reversedAmount: new Prisma.Decimal("0.00"),
        attributionVersion: 1,
        isCurrent: true,
        competence: "2026-07",
        type: "SERVICE",
        createdAt: attributionTime,
        configSnapshot: { type: "PERCENTAGE", value: 40 },
      });

      // Source release belongs to a CLOSED/PAID cycle!
      mockedPrisma.commissionPayableItem.findFirst.mockResolvedValue({
        id: "pi-old-rel-closed",
        barbershopId,
        cycleId: closedPaidCycleId,
        memberId: oldMemberId,
        entryId: "entry-old-v1",
        type: CommissionPayableType.RELEASE,
        amount: new Prisma.Decimal("40.00"),
        isHistoricalCorrection: false,
        cycle: {
          id: closedPaidCycleId,
          status: CommissionCycleStatus.PAID, // CLOSED / PAID
          grossCommission: new Prisma.Decimal("1000.00"),
          remainingBalance: new Prisma.Decimal("0.00"),
        },
      });

      // Member's current OPEN cycle for routing
      mockedPrisma.commissionCycle.findFirst
        .mockResolvedValueOnce({
          id: currentOpenCycleId,
          barbershopId,
          memberId: oldMemberId,
          status: CommissionCycleStatus.OPEN,
          grossCommission: new Prisma.Decimal("100.00"),
          adjustmentsTotal: new Prisma.Decimal("0.00"),
          remainingBalance: new Prisma.Decimal("100.00"),
        })
        .mockResolvedValueOnce({
          id: newCycleId,
          barbershopId,
          memberId: newMemberId,
          status: CommissionCycleStatus.OPEN,
          grossCommission: new Prisma.Decimal("0.00"),
          remainingBalance: new Prisma.Decimal("0.00"),
        });

      mockedPrisma.barbershopMember.findFirst.mockResolvedValue({
        id: newMemberId,
        barbershopId,
        isActive: true,
        services: [{ serviceId: "srv-corte" }],
      });
      mockedPrisma.service.findFirst.mockResolvedValue({ id: "srv-corte", categoryId: "cat-corte" });
      mockedPrisma.commissionConfig.findMany.mockResolvedValue([
        {
          id: "cfg-new-50",
          barbershopId,
          scopeKey: "member:" + newMemberId + ":default",
          type: "PERCENTAGE",
          value: new Prisma.Decimal("50.00"),
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-01T00:00:00Z"),
        },
      ]);
      mockedPrisma.commissionConfig.findUnique.mockResolvedValue({
        id: "cfg-new-50",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z"),
      });
      mockedPrisma.barbershopMember.findUnique.mockResolvedValue({ id: newMemberId, careerLevelId: null });
      mockedPrisma.payment.findMany.mockResolvedValue([
        {
          id: "pay-1",
          comandaId,
          status: "CONFIRMED",
          amount: new Prisma.Decimal("100.00"),
          refunds: [],
        },
      ]);

      mockedPrisma.commissionPayableItem.create.mockImplementation(async ({ data }: any) => ({
        id: "pi-rev-hist",
        ...data,
      }));
      mockedPrisma.commissionCycleAdjustment.create.mockResolvedValue({ id: "adj-1" });
      mockedPrisma.commissionEntry.create.mockImplementation(async ({ data }: any) => ({
        id: "entry-new-v2",
        attributionVersion: 2,
        ...data,
      }));

      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId: newMemberId,
        reason: "Clawback of already paid commission to current cycle",
        idempotencyKey: "idem-3a-test-c",
        userId: ownerId,
        role: "OWNER",
      });

      expect(res.success).toBe(true);
      expect(res.reversalAmount).toBe("40.00");
      expect(res.newReleasedAmount).toBe("50.00");

      // Verify closed PAID cycle was NOT updated
      expect(mockedPrisma.commissionCycle.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: closedPaidCycleId },
        })
      );

      // Verify companion DEBIT adjustment created in current OPEN cycle
      expect(mockedPrisma.commissionCycleAdjustment.create).toHaveBeenCalledTimes(1);
      const adjCall = mockedPrisma.commissionCycleAdjustment.create.mock.calls[0][0];
      expect(adjCall.data.cycleId).toBe(currentOpenCycleId);
      expect(adjCall.data.type).toBe(CommissionCycleAdjustmentType.DEBIT);
      expect(toCents(adjCall.data.amount)).toBe(4000);

      // Verify current open cycle updated with adjustment
      expect(mockedPrisma.commissionCycle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: currentOpenCycleId },
          data: {
            adjustmentsTotal: fromCents(-4000),
            remainingBalance: fromCents(6000),
          },
        })
      );

      // Verify authoritative balance ignores historical REVERSAL item from gross,
      // and counts companion DEBIT adjustment exactly once:
      mockedPrisma.commissionPayableItem.findMany.mockResolvedValue([
        { type: CommissionPayableType.RELEASE, amount: new Prisma.Decimal("100.00") },
        { type: CommissionPayableType.REVERSAL, amount: new Prisma.Decimal("40.00"), isHistoricalCorrection: true },
      ]);
      mockedPrisma.commissionCycleAdjustment.findMany.mockResolvedValue([
        { type: CommissionCycleAdjustmentType.DEBIT, amount: new Prisma.Decimal("40.00") },
      ]);
      mockedPrisma.commissionAdvance.findMany.mockResolvedValue([]);

      const authBalance = await getAuthoritativeCycleBalance(mockedPrisma, currentOpenCycleId);
      expect(authBalance.grossCommissionCents).toBe(10000); // 100.00 gross (reversal is historical so not deducted from gross)
      expect(authBalance.adjustmentsTotalCents).toBe(-4000); // -40.00 from DEBIT adjustment
      expect(authBalance.economicPayableCents).toBe(6000); // 100 - 40 = 60.00 exactly once!
    });
  });

  describe("2. Product Executor Correction", () => {
    const productId = "prod-shampoo";

    it("D. PRODUCT DONE, provable old rate 40, new executor PRODUCT rule 50, customer fully paid => old reversal 40, new release 50", async () => {
      mockedPrisma.comandaItem.findFirst.mockResolvedValue({
        id: comandaItemId,
        comandaId,
        productId,
        type: ComandaItemType.PRODUCT,
        status: ComandaItemStatus.DONE,
        comanda: {
          id: comandaId,
          status: ComandaStatus.OPEN,
          total: "100.00",
          commissionRevision: 1,
        },
      });

      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-prod-v1",
        memberId: oldMemberId,
        comandaItemId,
        baseAmount: new Prisma.Decimal("100.00"),
        generatedAmount: new Prisma.Decimal("40.00"),
        releasedAmount: new Prisma.Decimal("40.00"),
        paidAmount: new Prisma.Decimal("0.00"),
        reversedAmount: new Prisma.Decimal("0.00"),
        attributionVersion: 1,
        isCurrent: true,
        competence: "2026-08",
        type: "PRODUCT",
        createdAt: attributionTime,
        configSnapshot: { type: "PERCENTAGE", value: 40 },
      });

      mockedPrisma.commissionPayableItem.findFirst.mockResolvedValue({
        id: "pi-prod-old-rel",
        barbershopId,
        cycleId: "cycle-old",
        memberId: oldMemberId,
        entryId: "entry-prod-v1",
        type: CommissionPayableType.RELEASE,
        amount: new Prisma.Decimal("40.00"),
        isHistoricalCorrection: false,
        cycle: {
          id: "cycle-old",
          status: CommissionCycleStatus.OPEN,
          grossCommission: new Prisma.Decimal("40.00"),
          remainingBalance: new Prisma.Decimal("40.00"),
        },
      });

      mockedPrisma.barbershopMember.findFirst.mockResolvedValue({
        id: newMemberId,
        barbershopId,
        isActive: true,
        services: [], // Note: Empty services list, proving service eligibility is NOT required for PRODUCT!
      });

      // Product rule for new member is 50%
      mockedPrisma.commissionConfig.findMany.mockResolvedValue([
        {
          id: "cfg-prod-50",
          barbershopId,
          scopeKey: "member:" + newMemberId + ":product_default",
          type: "PERCENTAGE",
          value: new Prisma.Decimal("50.00"),
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-01T00:00:00Z"),
        },
      ]);
      mockedPrisma.commissionConfig.findUnique.mockResolvedValue({
        id: "cfg-prod-50",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z"),
      });

      // Fully paid customer
      mockedPrisma.payment.findMany.mockResolvedValue([
        {
          id: "pay-prod-1",
          comandaId,
          status: "CONFIRMED",
          amount: new Prisma.Decimal("100.00"),
          refunds: [],
        },
      ]);

      mockedPrisma.commissionCycle.findFirst.mockResolvedValue({
        id: "cycle-new",
        barbershopId,
        status: CommissionCycleStatus.OPEN,
        grossCommission: new Prisma.Decimal("0.00"),
        remainingBalance: new Prisma.Decimal("0.00"),
      });

      mockedPrisma.commissionEntry.create.mockImplementation(async ({ data }: any) => ({
        id: "entry-prod-v2",
        attributionVersion: 2,
        ...data,
      }));

      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId: newMemberId,
        reason: "Reassigning retail product sale to serving barber",
        idempotencyKey: "idem-3a-test-d",
        userId: ownerId,
        role: "OWNER",
      });

      expect(res.success).toBe(true);
      expect(res.reversalAmount).toBe("40.00");
      expect(res.newReleasedAmount).toBe("50.00");
      expect(res.newGrossAmount).toBe("50.00");
    });

    it("E. PRODUCT partial customer payment 50%, old generated 40 / released 20, new entitlement 50 => old reversal 20, new release 25", async () => {
      mockedPrisma.comandaItem.findFirst.mockResolvedValue({
        id: comandaItemId,
        comandaId,
        productId,
        type: ComandaItemType.PRODUCT,
        status: ComandaItemStatus.DONE,
        comanda: {
          id: comandaId,
          status: ComandaStatus.OPEN,
          total: "100.00",
          commissionRevision: 1,
        },
      });

      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-prod-v1",
        memberId: oldMemberId,
        comandaItemId,
        baseAmount: new Prisma.Decimal("100.00"),
        generatedAmount: new Prisma.Decimal("40.00"),
        releasedAmount: new Prisma.Decimal("20.00"), // 50% of 40 was released
        paidAmount: new Prisma.Decimal("0.00"),
        reversedAmount: new Prisma.Decimal("0.00"),
        attributionVersion: 1,
        isCurrent: true,
        competence: "2026-08",
        type: "PRODUCT",
        createdAt: attributionTime,
        configSnapshot: { type: "PERCENTAGE", value: 40 },
      });

      mockedPrisma.commissionPayableItem.findFirst.mockResolvedValue({
        id: "pi-prod-old-rel-20",
        barbershopId,
        cycleId: "cycle-old",
        memberId: oldMemberId,
        entryId: "entry-prod-v1",
        type: CommissionPayableType.RELEASE,
        amount: new Prisma.Decimal("20.00"),
        isHistoricalCorrection: false,
        cycle: {
          id: "cycle-old",
          status: CommissionCycleStatus.OPEN,
          grossCommission: new Prisma.Decimal("20.00"),
          remainingBalance: new Prisma.Decimal("20.00"),
        },
      });

      mockedPrisma.barbershopMember.findFirst.mockResolvedValue({
        id: newMemberId,
        barbershopId,
        isActive: true,
        services: [],
      });

      // Product rule for new member is 50%
      mockedPrisma.commissionConfig.findMany.mockResolvedValue([
        {
          id: "cfg-prod-50",
          barbershopId,
          scopeKey: "member:" + newMemberId + ":product_default",
          type: "PERCENTAGE",
          value: new Prisma.Decimal("50.00"),
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-01T00:00:00Z"),
        },
      ]);
      mockedPrisma.commissionConfig.findUnique.mockResolvedValue({
        id: "cfg-prod-50",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z"),
      });

      // 50% payment: 50.00 paid on 100.00 comanda
      mockedPrisma.payment.findMany.mockResolvedValue([
        {
          id: "pay-prod-50pct",
          comandaId,
          status: "CONFIRMED",
          amount: new Prisma.Decimal("50.00"),
          refunds: [],
        },
      ]);

      mockedPrisma.commissionCycle.findFirst.mockResolvedValue({
        id: "cycle-new",
        barbershopId,
        status: CommissionCycleStatus.OPEN,
        grossCommission: new Prisma.Decimal("0.00"),
        remainingBalance: new Prisma.Decimal("0.00"),
      });

      mockedPrisma.commissionEntry.create.mockImplementation(async ({ data }: any) => ({
        id: "entry-prod-v2",
        attributionVersion: 2,
        ...data,
      }));

      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId: newMemberId,
        reason: "Reassigning partially paid product sale",
        idempotencyKey: "idem-3a-test-e",
        userId: ownerId,
        role: "OWNER",
      });

      expect(res.success).toBe(true);
      expect(res.reversalAmount).toBe("20.00");
      // 50% of 50.00 is 25.00
      expect(res.newReleasedAmount).toBe("25.00");
      expect(res.newGrossAmount).toBe("50.00");
    });

    it("F. new executor SERVICE rule 80, PRODUCT rule 30, PRODUCT correction => uses 30, never 80", async () => {
      // Setup: DB has both SERVICE rule (80%) and PRODUCT rule (30%) for new executor
      mockedPrisma.commissionConfig.findMany.mockImplementation(async ({ where }: any) => {
        const inKeys = where.scopeKey?.in || [];
        const result: any[] = [];
        if (inKeys.includes("member:" + newMemberId + ":product_default")) {
          result.push({
            id: "cfg-prod-30",
            barbershopId,
            scopeKey: "member:" + newMemberId + ":product_default",
            type: "PERCENTAGE",
            value: new Prisma.Decimal("30.00"),
            createdAt: new Date("2026-07-01T00:00:00Z"),
            updatedAt: new Date("2026-07-01T00:00:00Z"),
          });
        }
        if (inKeys.includes("member:" + newMemberId + ":default")) {
          result.push({
            id: "cfg-srv-80",
            barbershopId,
            scopeKey: "member:" + newMemberId + ":default",
            type: "PERCENTAGE",
            value: new Prisma.Decimal("80.00"),
            createdAt: new Date("2026-07-01T00:00:00Z"),
            updatedAt: new Date("2026-07-01T00:00:00Z"),
          });
        }
        return result;
      });

      mockedPrisma.commissionConfig.findUnique.mockResolvedValue({
        id: "cfg-prod-30",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z"),
      });

      const resolved = await resolveHistoricalCommissionConfig(mockedPrisma, {
        barbershopId,
        memberId: newMemberId,
        productId,
        itemType: ComandaItemType.PRODUCT,
        attributionTime,
      });

      // Must strictly resolve to PRODUCT rule (30%), never SERVICE rule (80%)
      expect(resolved.value.toString()).toBe("30");
      expect(resolved.origin).toBe("MEMBER_PRODUCT_DEFAULT");
    });

    it("G. PRODUCT historical rule created after attributionTime => HISTORICAL_COMMISSION_RULE_UNPROVABLE => atomic rollback", async () => {
      mockedPrisma.commissionConfig.findMany.mockResolvedValue([
        {
          id: "cfg-prod-future",
          barbershopId,
          scopeKey: "member:" + newMemberId + ":product_default",
          type: "PERCENTAGE",
          value: new Prisma.Decimal("30.00"),
          createdAt: new Date("2026-08-15T00:00:00Z"), // Created AFTER attributionTime (2026-08-01)
          updatedAt: new Date("2026-08-15T00:00:00Z"),
        },
      ]);
      mockedPrisma.commissionConfig.findUnique.mockResolvedValue({
        id: "cfg-prod-future",
        createdAt: new Date("2026-08-15T00:00:00Z"),
        updatedAt: new Date("2026-08-15T00:00:00Z"),
      });

      await expect(
        resolveHistoricalCommissionConfig(mockedPrisma, {
          barbershopId,
          memberId: newMemberId,
          productId,
          itemType: ComandaItemType.PRODUCT,
          attributionTime,
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "HISTORICAL_COMMISSION_RULE_UNPROVABLE",
          status: 422,
        })
      );
    });

    it("H. PRODUCT correction does not require completedAt", async () => {
      mockedPrisma.comandaItem.findFirst.mockResolvedValue({
        id: comandaItemId,
        comandaId,
        productId,
        type: ComandaItemType.PRODUCT,
        status: ComandaItemStatus.DONE,
        completedAt: null, // Proving completedAt is NOT required for PRODUCT!
        comanda: {
          id: comandaId,
          status: ComandaStatus.OPEN,
          total: "100.00",
          commissionRevision: 1,
        },
      });

      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-prod-v1",
        memberId: oldMemberId,
        comandaItemId,
        baseAmount: new Prisma.Decimal("100.00"),
        generatedAmount: new Prisma.Decimal("30.00"),
        releasedAmount: new Prisma.Decimal("0.00"),
        paidAmount: new Prisma.Decimal("0.00"),
        reversedAmount: new Prisma.Decimal("0.00"),
        attributionVersion: 1,
        isCurrent: true,
        competence: "2026-08",
        type: "PRODUCT",
        createdAt: attributionTime,
        configSnapshot: { type: "PERCENTAGE", value: 30 },
      });

      mockedPrisma.barbershopMember.findFirst.mockResolvedValue({
        id: newMemberId,
        barbershopId,
        isActive: true,
        services: [],
      });

      mockedPrisma.commissionConfig.findMany.mockResolvedValue([
        {
          id: "cfg-prod-30",
          barbershopId,
          scopeKey: "member:" + newMemberId + ":product_default",
          type: "PERCENTAGE",
          value: new Prisma.Decimal("30.00"),
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-01T00:00:00Z"),
        },
      ]);
      mockedPrisma.commissionConfig.findUnique.mockResolvedValue({
        id: "cfg-prod-30",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z"),
      });

      mockedPrisma.payment.findMany.mockResolvedValue([]);
      mockedPrisma.commissionEntry.create.mockImplementation(async ({ data }: any) => ({
        id: "entry-prod-v2",
        attributionVersion: 2,
        ...data,
      }));

      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId: newMemberId,
        reason: "Product item has null completedAt and succeeds",
        idempotencyKey: "idem-3a-test-h",
        userId: ownerId,
        role: "OWNER",
      });

      expect(res.success).toBe(true);
      expect(res.attributionVersion).toBe(2);
    });

    it("I. PRODUCT correction does not accidentally require service eligibility", async () => {
      mockedPrisma.comandaItem.findFirst.mockResolvedValue({
        id: comandaItemId,
        comandaId,
        productId,
        type: ComandaItemType.PRODUCT,
        status: ComandaItemStatus.DONE,
        comanda: {
          id: comandaId,
          status: ComandaStatus.OPEN,
          total: "100.00",
          commissionRevision: 1,
        },
      });

      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-prod-v1",
        memberId: oldMemberId,
        comandaItemId,
        baseAmount: new Prisma.Decimal("100.00"),
        generatedAmount: new Prisma.Decimal("30.00"),
        releasedAmount: new Prisma.Decimal("0.00"),
        paidAmount: new Prisma.Decimal("0.00"),
        reversedAmount: new Prisma.Decimal("0.00"),
        attributionVersion: 1,
        isCurrent: true,
        competence: "2026-08",
        type: "PRODUCT",
        createdAt: attributionTime,
        configSnapshot: { type: "PERCENTAGE", value: 30 },
      });

      // New member has specific services (e.g. srv-barba), but this item is a PRODUCT
      mockedPrisma.barbershopMember.findFirst.mockResolvedValue({
        id: newMemberId,
        barbershopId,
        isActive: true,
        services: [{ serviceId: "srv-barba" }], // Does NOT have srv-corte, but item is PRODUCT!
      });

      mockedPrisma.commissionConfig.findMany.mockResolvedValue([
        {
          id: "cfg-prod-30",
          barbershopId,
          scopeKey: "member:" + newMemberId + ":product_default",
          type: "PERCENTAGE",
          value: new Prisma.Decimal("30.00"),
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-01T00:00:00Z"),
        },
      ]);
      mockedPrisma.commissionConfig.findUnique.mockResolvedValue({
        id: "cfg-prod-30",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z"),
      });

      mockedPrisma.payment.findMany.mockResolvedValue([]);
      mockedPrisma.commissionEntry.create.mockImplementation(async ({ data }: any) => ({
        id: "entry-prod-v2",
        attributionVersion: 2,
        ...data,
      }));

      // Must succeed without EXECUTOR_SERVICE_MISMATCH
      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId: newMemberId,
        reason: "New executor is assigned product sale without service check",
        idempotencyKey: "idem-3a-test-i",
        userId: ownerId,
        role: "OWNER",
      });

      expect(res.success).toBe(true);
      expect(res.attributionVersion).toBe(2);
    });
  });
});
