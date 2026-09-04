/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as postExecutorCorrection } from "@/app/api/admin/commissions/executor-correction/route";
import { POST as legacyClosePeriod } from "@/app/api/admin/commissions/periods/[id]/close/route";
import { POST as legacyPayPeriod } from "@/app/api/admin/commissions/periods/[id]/pay/route";
import {
  correctCommissionExecutor,
  getCurrentCommissionEntry,
  resolveHistoricalCommissionConfig,
  syncOpenCommissionPeriod,
  recalculateComandaCommissions,
  closeCommissionPeriod,
  payCommissionPeriod,
} from "@/lib/operations/commissions";
import { requireOperationalSession, getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import {
  ComandaItemType,
  ComandaItemStatus,
  ComandaStatus,
  CommissionEntryStatus,
  CommissionCycleStatus,
  Prisma,
} from "@prisma/client";

vi.mock("@/lib/api-auth", () => ({
  requireOperationalSession: vi.fn(),
  getAdminSession: vi.fn(),
}));

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
      findFirstOrThrow: vi.fn(),
      update: vi.fn(),
    },
    comandaItem: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    commissionEntry: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    commissionCycle: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
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
      create: vi.fn(),
      findMany: vi.fn(),
    },
    commissionExecutorCorrectionAudit: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    commissionPeriod: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    commissionAdjustment: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    barbershopMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    serviceCommissionRule: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    commissionConfig: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    careerLevel: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    payment: {
      findMany: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    service: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  };
  return { default: p };
});

const mockedPrisma = prisma as any;
const mockedAuth = requireOperationalSession as any;
const mockedAdminAuth = getAdminSession as any;

describe("C11.3 — Final Authority Cutover + Versioned Executor Correction", () => {
  const barbershopId = "shop-c11";
  const ownerId = "user-owner";
  const managerId = "user-manager";
  const barberId = "user-barber";
  const oldMemberId = "member-old";
  const newMemberId = "member-new";
  const newExecutorMemberId = newMemberId;
  const comandaItemId = "item-100";
  const comandaId = "cmd-100";

  const getFingerprint = (payload: { comandaItemId: string; newExecutorMemberId: string; reason: string }) =>
    crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  beforeEach(() => {
    vi.clearAllMocks();
    mockedPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockedPrisma));
    mockedPrisma.$queryRaw.mockResolvedValue([]);
  });

  describe("1. Legacy Writers — Zero Live Runtime", () => {
    it("Item 1: syncOpenCommissionPeriod is a no-op returning null without writing rows", async () => {
      const res = await syncOpenCommissionPeriod(mockedPrisma, barbershopId, oldMemberId, "2026-08");
      expect(res).toBeNull();
      expect(mockedPrisma.commissionPeriod.upsert).not.toHaveBeenCalled();
      expect(mockedPrisma.commissionAdjustment.upsert).not.toHaveBeenCalled();
    });

    it("Item 2: recalculateComandaCommissions does NOT call legacy tx.commissionAdjustment", async () => {
      mockedPrisma.comanda.findFirst.mockResolvedValue({
        id: comandaId,
        barbershopId,
        status: ComandaStatus.OPEN,
        commissionRevision: 1,
        openedAt: new Date("2026-08-01T10:00:00Z"),
        items: [
          {
            id: comandaItemId,
            barbershopId,
            comandaId,
            type: ComandaItemType.SERVICE,
            status: ComandaItemStatus.DONE,
            total: "100.00",
            executorId: oldMemberId,
            commissionEntries: [],
          },
        ],
      });
      mockedPrisma.comandaItem.findMany.mockResolvedValue([]);
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue(null);
      mockedPrisma.commissionConfig.findMany.mockResolvedValue([
        {
          id: "cfg-default",
          barbershopId,
          scopeKey: "member:" + oldMemberId + ":default",
          type: "PERCENTAGE",
          value: new Prisma.Decimal("50.00"),
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-01T00:00:00Z"),
        },
      ]);
      mockedPrisma.barbershopMember.findUnique.mockResolvedValue({
        id: oldMemberId,
        careerLevelId: null,
      });
      mockedPrisma.commissionEntry.create.mockResolvedValue({
        id: "entry-new",
        memberId: oldMemberId,
      });
      mockedPrisma.commissionEntry.findMany.mockResolvedValue([]);

      await recalculateComandaCommissions(mockedPrisma, barbershopId, comandaId);

      expect(mockedPrisma.commissionAdjustment.create).not.toHaveBeenCalled();
      expect(mockedPrisma.commissionAdjustment.deleteMany).not.toHaveBeenCalled();
      expect(mockedPrisma.commissionPeriod.upsert).not.toHaveBeenCalled();
    });

    it("Item 3: recalculateComandaCommissions throws EXECUTOR_CORRECTION_REQUIRED if executor changed", async () => {
      mockedPrisma.comanda.findFirst.mockResolvedValue({
        id: comandaId,
        barbershopId,
        status: ComandaStatus.OPEN,
        commissionRevision: 1,
        openedAt: new Date("2026-08-01T10:00:00Z"),
        items: [
          {
            id: comandaItemId,
            barbershopId,
            comandaId,
            type: ComandaItemType.SERVICE,
            status: ComandaItemStatus.DONE,
            completedAt: new Date("2026-08-01T10:00:00Z"),
            serviceId: "srv-corte",
            total: "100.00",
            executorId: newMemberId,
            commissionEntries: [],
          },
        ],
      });
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-old",
        memberId: oldMemberId,
        isCurrent: true,
        paidAmount: "0.00",
      });
      mockedPrisma.barbershopMember.findUnique.mockResolvedValue({
        id: newMemberId,
        careerLevelId: null,
      });
      mockedPrisma.commissionConfig.findMany.mockResolvedValue([
        {
          id: "cfg-default",
          scopeKey: "member:" + newMemberId + ":default",
          type: "PERCENTAGE",
          value: new Prisma.Decimal("50.00"),
        },
      ]);

      await expect(
        recalculateComandaCommissions(mockedPrisma, barbershopId, comandaId)
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "EXECUTOR_CORRECTION_REQUIRED",
          status: 409,
        })
      );
    });

    it("Item 4: legacy closeCommissionPeriod throws 410 LEGACY_ENDPOINT_DEPRECATED", async () => {
      await expect(
        closeCommissionPeriod(mockedPrisma, {
          barbershopId,
          memberId: oldMemberId,
          competence: "2026-08",
          userId: ownerId,
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "LEGACY_ENDPOINT_DEPRECATED",
          status: 410,
        })
      );
    });

    it("Item 5: legacy payCommissionPeriod throws 410 LEGACY_ENDPOINT_DEPRECATED", async () => {
      await expect(
        payCommissionPeriod(mockedPrisma, {
          barbershopId,
          periodId: "per-1",
          paidByMemberId: ownerId,
          userId: ownerId,
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "LEGACY_ENDPOINT_DEPRECATED",
          status: 410,
        })
      );
    });
  });

  describe("2. Multi-Version Read Safety", () => {
    it("Item 6: getCurrentCommissionEntry explicitly filters isCurrent: true", async () => {
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-v2",
        comandaItemId,
        isCurrent: true,
        attributionVersion: 2,
      });

      const entry = await getCurrentCommissionEntry(mockedPrisma, {
        comandaItemId,
        barbershopId,
      });

      expect(mockedPrisma.commissionEntry.findFirst).toHaveBeenCalledWith({
        where: {
          comandaItemId,
          barbershopId,
          isCurrent: true,
        },
      });
      expect(entry?.attributionVersion).toBe(2);
    });

    it("Item 7: Multiple versions exist for same item; reader retrieves only the active one", async () => {
      mockedPrisma.commissionEntry.findFirst.mockImplementation(async ({ where }: any) => {
        if (where.isCurrent === true) {
          return { id: "entry-v2", comandaItemId, isCurrent: true, attributionVersion: 2 };
        }
        return null;
      });

      const entry = await getCurrentCommissionEntry(mockedPrisma, { comandaItemId });
      expect(entry?.id).toBe("entry-v2");
      expect(entry?.isCurrent).toBe(true);
    });
  });

  describe("3. Financial RBAC", () => {
    it("Item 8: BARBER is forbidden (403) from calling correctCommissionExecutor", async () => {
      await expect(
        correctCommissionExecutor({
          barbershopId,
          comandaItemId,
          newExecutorMemberId: newMemberId,
          reason: "Correction of barber for this comanda service",
          idempotencyKey: "idem-1",
          userId: barberId,
          role: "BARBER",
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "FORBIDDEN",
          status: 403,
        })
      );
    });

    it("Item 9: OWNER is authorized to execute correction", async () => {
      const reason = "Valid correction reason with >= 10 chars";
      mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue({
        id: "audit-1",
        barbershopId,
        idempotencyKey: "idem-owner",
        payloadFingerprint: getFingerprint({ comandaItemId, newExecutorMemberId: newMemberId, reason }),
        oldReleasedAmount: "0.00",
        newReleasedAmount: "0.00",
        newEntry: { attributionVersion: 2, generatedAmount: "50.00" },
      });
      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId: newMemberId,
        reason,
        idempotencyKey: "idem-owner",
        userId: ownerId,
        role: "OWNER",
      });
      expect(res.success).toBe(true);
    });

    it("Item 10: MANAGER is authorized to execute correction", async () => {
      const reason = "Valid correction reason with >= 10 chars";
      mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue({
        id: "audit-2",
        barbershopId,
        idempotencyKey: "idem-mgr",
        payloadFingerprint: getFingerprint({ comandaItemId, newExecutorMemberId: newMemberId, reason }),
        oldReleasedAmount: "0.00",
        newReleasedAmount: "0.00",
        newEntry: { attributionVersion: 2, generatedAmount: "50.00" },
      });
      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId: newMemberId,
        reason,
        idempotencyKey: "idem-mgr",
        userId: managerId,
        role: "MANAGER",
      });
      expect(res.success).toBe(true);
    });
  });

  describe("4. Input Validation & Idempotency", () => {
    it("Item 11: Reason < 10 characters rejected with INVALID_REASON", async () => {
      await expect(
        correctCommissionExecutor({
          barbershopId,
          comandaItemId,
          newExecutorMemberId: newMemberId,
          reason: "short",
          idempotencyKey: "idem-val-1",
          userId: ownerId,
          role: "OWNER",
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "INVALID_REASON",
          status: 400,
        })
      );
    });

    it("Item 12: Missing idempotency key rejected with IDEMPOTENCY_KEY_REQUIRED", async () => {
      await expect(
        correctCommissionExecutor({
          barbershopId,
          comandaItemId,
          newExecutorMemberId: newMemberId,
          reason: "Valid reason with sufficient characters",
          idempotencyKey: "",
          userId: ownerId,
          role: "OWNER",
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "IDEMPOTENCY_KEY_REQUIRED",
          status: 400,
        })
      );
    });

    it("Item 13: Duplicate call with identical key & payload returns cached result", async () => {
      const crypto = await import("crypto");
      const payloadFingerprint = crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            comandaItemId,
            newExecutorMemberId: newMemberId,
            reason: "Correction reason for idempotency replay",
          })
        )
        .digest("hex");

      mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue({
        id: "audit-replay",
        barbershopId,
        idempotencyKey: "idem-same",
        payloadFingerprint,
        oldEntryId: "entry-old",
        newEntryId: "entry-new",
        oldMemberId,
        newMemberId,
        comandaItemId,
        oldReleasedAmount: new Prisma.Decimal("30.00"),
        newReleasedAmount: new Prisma.Decimal("25.00"),
        newEntry: { attributionVersion: 2, generatedAmount: new Prisma.Decimal("50.00") },
      });

      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId: newMemberId,
        reason: "Correction reason for idempotency replay",
        idempotencyKey: "idem-same",
        userId: ownerId,
        role: "OWNER",
      });

      expect(res.isIdempotentReplay).toBe(true);
      expect(res.auditId).toBe("audit-replay");
      expect(mockedPrisma.comandaItem.update).not.toHaveBeenCalled();
    });

    it("Item 14: Duplicate call with same key but conflicting payload throws 409 IDEMPOTENCY_CONFLICT", async () => {
      mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue({
        id: "audit-conflict",
        barbershopId,
        idempotencyKey: "idem-conflict",
        payloadFingerprint: "different-hash",
        oldEntry: {},
        newEntry: {},
      });

      await expect(
        correctCommissionExecutor({
          barbershopId,
          comandaItemId,
          newExecutorMemberId: newMemberId,
          reason: "First payload attempt with sufficient text",
          idempotencyKey: "idem-conflict",
          userId: ownerId,
          role: "OWNER",
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "IDEMPOTENCY_CONFLICT",
          status: 409,
        })
      );
    });

    it("Item 15: Comanda item not found throws 404 ITEM_NOT_FOUND", async () => {
      mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue(null);
      mockedPrisma.comandaItem.findFirst.mockResolvedValue(null);

      await expect(
        correctCommissionExecutor({
          barbershopId,
          comandaItemId: "non-existent",
          newExecutorMemberId: newMemberId,
          reason: "Valid reason with sufficient characters",
          idempotencyKey: "idem-not-found",
          userId: ownerId,
          role: "OWNER",
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "ITEM_NOT_FOUND",
          status: 404,
        })
      );
    });

    it("Item 16: Comanda is CANCELLED throws 422 COMANDA_CANCELLED", async () => {
      mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue(null);
      mockedPrisma.comandaItem.findFirst.mockResolvedValue({
        id: comandaItemId,
        comandaId,
        comanda: { status: ComandaStatus.CANCELLED },
      });

      await expect(
        correctCommissionExecutor({
          barbershopId,
          comandaItemId,
          newExecutorMemberId: newMemberId,
          reason: "Valid reason with sufficient characters",
          idempotencyKey: "idem-cancelled",
          userId: ownerId,
          role: "OWNER",
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "COMANDA_CANCELLED",
          status: 422,
        })
      );
    });

    it("Item 17: No active commission entry throws 404 NO_CURRENT_ENTRY", async () => {
      mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue(null);
      mockedPrisma.comandaItem.findFirst.mockResolvedValue({
        id: comandaItemId,
        comandaId,
        comanda: { status: ComandaStatus.OPEN },
      });
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue(null);

      await expect(
        correctCommissionExecutor({
          barbershopId,
          comandaItemId,
          newExecutorMemberId: newMemberId,
          reason: "Valid reason with sufficient characters",
          idempotencyKey: "idem-no-entry",
          userId: ownerId,
          role: "OWNER",
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "NO_CURRENT_ENTRY",
          status: 404,
        })
      );
    });

    it("Item 18: Same executor (no change) throws 400 NO_CHANGE", async () => {
      mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue(null);
      mockedPrisma.comandaItem.findFirst.mockResolvedValue({
        id: comandaItemId,
        comandaId,
        comanda: { status: ComandaStatus.OPEN },
      });
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-old",
        memberId: oldMemberId,
        isCurrent: true,
      });

      await expect(
        correctCommissionExecutor({
          barbershopId,
          comandaItemId,
          newExecutorMemberId: oldMemberId,
          reason: "Valid reason with sufficient characters",
          idempotencyKey: "idem-no-change",
          userId: ownerId,
          role: "OWNER",
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "NO_CHANGE",
          status: 400,
        })
      );
    });

    it("Item 19: New executor inactive throws 422 INVALID_EXECUTOR", async () => {
      mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue(null);
      mockedPrisma.comandaItem.findFirst.mockResolvedValue({
        id: comandaItemId,
        comandaId,
        comanda: { status: ComandaStatus.OPEN },
      });
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-old",
        memberId: oldMemberId,
        isCurrent: true,
      });
      mockedPrisma.barbershopMember.findFirst.mockResolvedValue(null);

      await expect(
        correctCommissionExecutor({
          barbershopId,
          comandaItemId,
          newExecutorMemberId: "inactive-barber",
          reason: "Valid reason with sufficient characters",
          idempotencyKey: "idem-inact",
          userId: ownerId,
          role: "OWNER",
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "INVALID_EXECUTOR",
          status: 422,
        })
      );
    });

    it("Item 20: Service capability mismatch throws 422 EXECUTOR_SERVICE_MISMATCH", async () => {
      mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue(null);
      mockedPrisma.comandaItem.findFirst.mockResolvedValue({
        id: comandaItemId,
        comandaId,
        type: ComandaItemType.SERVICE,
        serviceId: "srv-coloration",
        comanda: { status: ComandaStatus.OPEN },
      });
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-old",
        memberId: oldMemberId,
        isCurrent: true,
      });
      mockedPrisma.barbershopMember.findFirst.mockResolvedValue({
        id: newMemberId,
        barbershopId,
        isActive: true,
        services: [{ serviceId: "srv-corte" }],
      });

      await expect(
        correctCommissionExecutor({
          barbershopId,
          comandaItemId,
          newExecutorMemberId,
          reason: "Valid reason with sufficient characters",
          idempotencyKey: "idem-mismatch",
          userId: ownerId,
          role: "OWNER",
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "EXECUTOR_SERVICE_MISMATCH",
          status: 422,
        })
      );
    });
  });

  describe("5. Historical Rule Reconstruction", () => {
    const attributionTime = new Date("2026-08-01T12:00:00Z");

    beforeEach(() => {
      mockedPrisma.service.findFirst.mockResolvedValue({ id: "srv-corte", categoryId: "cat-corte" });
      mockedPrisma.barbershopMember.findFirst.mockResolvedValue({ id: newMemberId, careerLevelId: null });
    });

    it("Item 21: Rule created BEFORE attributionTime and NOT updated succeeds with historical rate", async () => {
      mockedPrisma.commissionConfig.findMany.mockResolvedValue([
        {
          id: "cfg-proven",
          barbershopId,
          scopeKey: "member:" + newMemberId + ":default",
          type: "PERCENTAGE",
          value: new Prisma.Decimal("40.00"),
          createdAt: new Date("2026-07-15T00:00:00Z"),
          updatedAt: new Date("2026-07-15T00:00:00Z"),
        },
      ]);
      mockedPrisma.commissionConfig.findUnique.mockResolvedValue({
        id: "cfg-proven",
        createdAt: new Date("2026-07-15T00:00:00Z"),
        updatedAt: new Date("2026-07-15T00:00:00Z"),
      });
      mockedPrisma.barbershopMember.findUnique.mockResolvedValue({
        id: newMemberId,
        careerLevelId: null,
      });

      const resolved = await resolveHistoricalCommissionConfig(mockedPrisma, {
        barbershopId,
        memberId: newMemberId,
        serviceId: "srv-corte",
        itemType: ComandaItemType.SERVICE,
        attributionTime,
      });

      expect(resolved.type).toBe("PERCENTAGE");
      expect(resolved.value.toString()).toBe("40");
    });

    it("Item 22: Rule created AFTER attributionTime throws 422 HISTORICAL_COMMISSION_RULE_UNPROVABLE", async () => {
      mockedPrisma.commissionConfig.findMany.mockResolvedValue([
        {
          id: "cfg-future",
          barbershopId,
          scopeKey: "member:" + newMemberId + ":default",
          type: "PERCENTAGE",
          value: new Prisma.Decimal("40.00"),
          createdAt: new Date("2026-08-10T00:00:00Z"),
          updatedAt: new Date("2026-08-10T00:00:00Z"),
        },
      ]);
      mockedPrisma.commissionConfig.findUnique.mockResolvedValue({
        id: "cfg-future",
        createdAt: new Date("2026-08-10T00:00:00Z"),
        updatedAt: new Date("2026-08-10T00:00:00Z"),
      });
      mockedPrisma.barbershopMember.findUnique.mockResolvedValue({
        id: newMemberId,
        careerLevelId: null,
      });

      await expect(
        resolveHistoricalCommissionConfig(mockedPrisma, {
          barbershopId,
          memberId: newMemberId,
          serviceId: "srv-corte",
          itemType: ComandaItemType.SERVICE,
          attributionTime,
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "HISTORICAL_COMMISSION_RULE_UNPROVABLE",
          status: 422,
        })
      );
    });

    it("Item 23: Rule updated AFTER attributionTime throws 422 HISTORICAL_COMMISSION_RULE_UNPROVABLE", async () => {
      mockedPrisma.commissionConfig.findMany.mockResolvedValue([
        {
          id: "cfg-edited",
          barbershopId,
          scopeKey: "member:" + newMemberId + ":default",
          type: "PERCENTAGE",
          value: new Prisma.Decimal("40.00"),
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-08-05T00:00:00Z"),
        },
      ]);
      mockedPrisma.commissionConfig.findUnique.mockResolvedValue({
        id: "cfg-edited",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-08-05T00:00:00Z"),
      });
      mockedPrisma.barbershopMember.findUnique.mockResolvedValue({
        id: newMemberId,
        careerLevelId: null,
      });

      await expect(
        resolveHistoricalCommissionConfig(mockedPrisma, {
          barbershopId,
          memberId: newMemberId,
          serviceId: "srv-corte",
          itemType: ComandaItemType.SERVICE,
          attributionTime,
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "HISTORICAL_COMMISSION_RULE_UNPROVABLE",
          status: 422,
        })
      );
    });

    it("Item 24: No rule existed at all throws 422 HISTORICAL_COMMISSION_RULE_UNPROVABLE", async () => {
      mockedPrisma.commissionConfig.findMany.mockResolvedValue([]);
      mockedPrisma.barbershopMember.findUnique.mockResolvedValue({
        id: newMemberId,
        careerLevelId: null,
      });

      await expect(
        resolveHistoricalCommissionConfig(mockedPrisma, {
          barbershopId,
          memberId: newMemberId,
          serviceId: "srv-corte",
          itemType: ComandaItemType.SERVICE,
          attributionTime,
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: "HISTORICAL_COMMISSION_RULE_UNPROVABLE",
          status: 422,
        })
      );
    });

    it("Item 25: Caller cannot pass client snapshot override (CALLER_SNAPSHOT_OVERRIDE_ALLOWED = NO)", async () => {
      const input: any = {
        barbershopId,
        comandaItemId,
        newExecutorMemberId: newMemberId,
        reason: "Attempting caller snapshot bypass",
        idempotencyKey: "idem-bypass",
        userId: ownerId,
        role: "OWNER",
        callerSnapshotOverride: { type: "PERCENTAGE", value: 99 },
      };
      mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue(null);
      mockedPrisma.comandaItem.findFirst.mockResolvedValue({
        id: comandaItemId,
        comandaId,
        type: ComandaItemType.SERVICE,
        comanda: { status: ComandaStatus.OPEN, total: "100.00" },
      });
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-old",
        memberId: oldMemberId,
        isCurrent: true,
        createdAt: attributionTime,
        baseAmount: "100.00",
        releasedAmount: "0.00",
        attributionVersion: 1,
      });
      mockedPrisma.barbershopMember.findFirst.mockResolvedValue({
        id: newMemberId,
        barbershopId,
        isActive: true,
        services: [],
      });
      mockedPrisma.commissionConfig.findMany.mockResolvedValue([]);
      mockedPrisma.barbershopMember.findUnique.mockResolvedValue({ id: newMemberId, careerLevelId: null });

      await expect(correctCommissionExecutor(input)).rejects.toThrowError(
        expect.objectContaining({
          code: "HISTORICAL_COMMISSION_RULE_UNPROVABLE",
        })
      );
    });
  });

  describe("6. Multi-Version Mutation & Ledger Effects", () => {
    const attributionTime = new Date("2026-08-01T12:00:00Z");

    beforeEach(() => {
      mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue(null);
      mockedPrisma.service.findFirst.mockResolvedValue({ id: "srv-100", categoryId: "cat-1" });
      mockedPrisma.comandaItem.findFirst.mockResolvedValue({
        id: comandaItemId,
        comandaId,
        serviceId: "srv-100",
        type: ComandaItemType.SERVICE,
        comanda: {
          id: comandaId,
          status: ComandaStatus.OPEN,
          total: "100.00",
          commissionRevision: 1,
        },
      });
      mockedPrisma.barbershopMember.findFirst.mockResolvedValue({
        id: newMemberId,
        barbershopId,
        isActive: true,
        services: [],
      });
      mockedPrisma.commissionConfig.findMany.mockResolvedValue([
        {
          id: "cfg-hist",
          barbershopId,
          scopeKey: "member:" + newMemberId + ":default",
          type: "PERCENTAGE",
          value: new Prisma.Decimal("40.00"),
          createdAt: new Date("2026-07-01T00:00:00Z"),
          updatedAt: new Date("2026-07-01T00:00:00Z"),
        },
      ]);
      mockedPrisma.commissionConfig.findUnique.mockResolvedValue({
        id: "cfg-hist",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z"),
      });
      mockedPrisma.barbershopMember.findUnique.mockResolvedValue({ id: newMemberId, careerLevelId: null });
      mockedPrisma.payment.findMany.mockResolvedValue([]);
      mockedPrisma.commissionPayableItem.create.mockImplementation(async ({ data }: any) => ({
        id: "pi-" + Math.random().toString(36).slice(2),
        ...data,
      }));
      mockedPrisma.commissionCycleAdjustment.create.mockImplementation(async ({ data }: any) => ({
        id: "adj-" + Math.random().toString(36).slice(2),
        ...data,
      }));
      mockedPrisma.commissionCycle.findFirst.mockResolvedValue({
        id: "cycle-open-1",
        barbershopId,
        status: CommissionCycleStatus.OPEN,
        grossCommission: "0.00",
        netCommission: "0.00",
        remainingBalance: "0.00",
      });
    });

    it("Item 26-30: Full multi-version execution in OPEN comanda with zero payments", async () => {
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-v1",
        memberId: oldMemberId,
        comandaItemId,
        baseAmount: new Prisma.Decimal("100.00"),
        generatedAmount: new Prisma.Decimal("50.00"),
        releasedAmount: new Prisma.Decimal("0.00"),
        paidAmount: new Prisma.Decimal("0.00"),
        reversedAmount: new Prisma.Decimal("0.00"),
        attributionVersion: 1,
        isCurrent: true,
        competence: "2026-08",
        type: "SERVICE",
        createdAt: attributionTime,
        configSnapshot: { type: "PERCENTAGE", value: 50 },
      });
      mockedPrisma.commissionEntry.create.mockResolvedValue({
        id: "entry-v2",
        attributionVersion: 2,
        generatedAmount: new Prisma.Decimal("40.00"),
      });
      mockedPrisma.commissionExecutorCorrectionAudit.create.mockResolvedValue({
        id: "audit-100",
      });

      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId,
        reason: "Reassigning customer barber from item 100",
        idempotencyKey: "idem-mv-1",
        userId: ownerId,
        role: "OWNER",
      });

      expect(res.success).toBe(true);
      expect(res.attributionVersion).toBe(2);

      // Item 26: old entry set isCurrent = false
      expect(mockedPrisma.commissionEntry.update).toHaveBeenCalledWith({
        where: { id: "entry-v1" },
        data: { isCurrent: false },
      });

      // Item 27 & 28: new entry created with isCurrent = true, attributionVersion = 2, supersedesEntryId = entry-v1, paidAmount = 0
      expect(mockedPrisma.commissionEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isCurrent: true,
            attributionVersion: 2,
            supersedesEntryId: "entry-v1",
            paidAmount: 0,
            reversedAmount: 0,
            memberId: newMemberId,
            generatedAmount: new Prisma.Decimal("40.00"),
            releasedAmount: new Prisma.Decimal("0.00"),
          }),
        })
      );

      // Item 29: comandaItem.executorId updated
      expect(mockedPrisma.comandaItem.update).toHaveBeenCalledWith({
        where: { id: comandaItemId },
        data: { executorId: newMemberId },
      });

      // Item 30: audit row created
      expect(mockedPrisma.commissionExecutorCorrectionAudit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            oldEntryId: "entry-v1",
            oldMemberId,
            newMemberId,
            reason: "Reassigning customer barber from item 100",
            idempotencyKey: "idem-mv-1",
            correctedById: ownerId,
          }),
        })
      );

      // Item 36: comanda commissionRevision incremented
      expect(mockedPrisma.comanda.update).toHaveBeenCalledWith({
        where: { id: comandaId },
        data: { commissionRevision: { increment: 1 } },
      });
    });

    it("Item 31-32: Economic reversal and release in OPEN cycle when comanda was partially paid", async () => {
      mockedPrisma.payment.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal("50.00"), refundedAmount: "0.00", status: "CONFIRMED" },
      ]);
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-v1",
        memberId: oldMemberId,
        comandaItemId,
        baseAmount: new Prisma.Decimal("100.00"),
        generatedAmount: new Prisma.Decimal("50.00"),
        releasedAmount: new Prisma.Decimal("25.00"),
        paidAmount: new Prisma.Decimal("0.00"),
        reversedAmount: new Prisma.Decimal("0.00"),
        attributionVersion: 1,
        isCurrent: true,
        competence: "2026-08",
        type: "SERVICE",
        createdAt: attributionTime,
      });

      const oldCycle = {
        id: "cycle-old-open",
        status: CommissionCycleStatus.OPEN,
        grossCommission: new Prisma.Decimal("100.00"),
        remainingBalance: new Prisma.Decimal("100.00"),
      };
      mockedPrisma.commissionPayableItem.findFirst.mockResolvedValue({
        id: "payable-rel-old",
        cycleId: oldCycle.id,
        cycle: oldCycle,
        amount: new Prisma.Decimal("25.00"),
      });
      mockedPrisma.commissionPayableItem.findUnique.mockResolvedValue(null);

      const newCycle = {
        id: "cycle-new-open",
        status: CommissionCycleStatus.OPEN,
        grossCommission: new Prisma.Decimal("0.00"),
        remainingBalance: new Prisma.Decimal("0.00"),
      };
      mockedPrisma.commissionCycle.findFirst.mockResolvedValue(newCycle);

      mockedPrisma.commissionEntry.create.mockResolvedValue({
        id: "entry-v2",
        attributionVersion: 2,
        generatedAmount: new Prisma.Decimal("40.00"),
      });
      mockedPrisma.commissionExecutorCorrectionAudit.create.mockResolvedValue({
        id: "audit-econ",
      });

      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId,
        reason: "Reassigning partially paid comanda item",
        idempotencyKey: "idem-econ-1",
        userId: ownerId,
        role: "OWNER",
      });

      expect(res.success).toBe(true);
      expect(res.newReleasedAmount).toBe("20.00");
      expect(res.reversalAmount).toBe("25.00");

      // Item 31: Old executor open cycle deducted
      expect(mockedPrisma.commissionCycle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: oldCycle.id },
          data: expect.objectContaining({
            grossCommission: new Prisma.Decimal("75.00"),
            remainingBalance: new Prisma.Decimal("75.00"),
          }),
        })
      );

      // Item 32: New executor open cycle credited
      expect(mockedPrisma.commissionCycle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: newCycle.id },
          data: expect.objectContaining({
            grossCommission: new Prisma.Decimal("20.00"),
            remainingBalance: new Prisma.Decimal("20.00"),
          }),
        })
      );
    });

    it("Item 33: Historical cycle immutability when old executor was already PAID in closed cycle", async () => {
      mockedPrisma.payment.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal("100.00"), refundedAmount: "0.00", status: "CONFIRMED" },
      ]);
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-v1",
        memberId: oldMemberId,
        comandaItemId,
        baseAmount: new Prisma.Decimal("100.00"),
        generatedAmount: new Prisma.Decimal("50.00"),
        releasedAmount: new Prisma.Decimal("50.00"),
        paidAmount: new Prisma.Decimal("50.00"),
        status: CommissionEntryStatus.PAID,
        reversedAmount: new Prisma.Decimal("0.00"),
        attributionVersion: 1,
        isCurrent: true,
        competence: "2026-07",
        type: "SERVICE",
        createdAt: attributionTime,
      });

      const historicalPaidCycle = {
        id: "cycle-hist-paid",
        status: CommissionCycleStatus.PAID,
      };
      mockedPrisma.commissionPayableItem.findFirst.mockResolvedValue({
        id: "payable-hist-rel",
        cycleId: historicalPaidCycle.id,
        cycle: historicalPaidCycle,
        amount: new Prisma.Decimal("50.00"),
      });
      mockedPrisma.commissionPayableItem.findUnique.mockResolvedValue(null);

      const oldCurrentOpenCycle = {
        id: "cycle-old-open-now",
        status: CommissionCycleStatus.OPEN,
        grossCommission: new Prisma.Decimal("100.00"),
        adjustmentsTotal: new Prisma.Decimal("0.00"),
        remainingBalance: new Prisma.Decimal("100.00"),
      };
      const newCurrentOpenCycle = {
        id: "cycle-new-open-now",
        status: CommissionCycleStatus.OPEN,
        grossCommission: new Prisma.Decimal("0.00"),
        remainingBalance: new Prisma.Decimal("0.00"),
      };

      mockedPrisma.commissionCycle.findFirst
        .mockResolvedValueOnce(oldCurrentOpenCycle)
        .mockResolvedValueOnce(newCurrentOpenCycle);

      mockedPrisma.commissionEntry.create.mockResolvedValue({
        id: "entry-v2",
        attributionVersion: 2,
        generatedAmount: new Prisma.Decimal("40.00"),
      });
      mockedPrisma.commissionExecutorCorrectionAudit.create.mockResolvedValue({
        id: "audit-paid-hist",
      });

      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId,
        reason: "Clawback of already paid commission to current cycle",
        idempotencyKey: "idem-hist-paid",
        userId: ownerId,
        role: "OWNER",
      });

      expect(res.success).toBe(true);

      // Historical PAID cycle is NEVER touched!
      const calls = mockedPrisma.commissionCycle.update.mock.calls;
      const touchedCycleIds = calls.map((c: any) => c[0].where.id);
      expect(touchedCycleIds).not.toContain(historicalPaidCycle.id);

      // Clawback is routed to old member current open cycle via companion DEBIT adjustment
      expect(mockedPrisma.commissionCycleAdjustment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cycleId: oldCurrentOpenCycle.id,
            type: "DEBIT",
            amount: new Prisma.Decimal("50.00"),
          }),
        })
      );
    });

    it("Item 34: Zero payments comanda: old has 0 reversal, new has 0 release", async () => {
      mockedPrisma.payment.findMany.mockResolvedValue([]);
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-v1",
        memberId: oldMemberId,
        comandaItemId,
        baseAmount: new Prisma.Decimal("100.00"),
        generatedAmount: new Prisma.Decimal("50.00"),
        releasedAmount: new Prisma.Decimal("0.00"),
        paidAmount: new Prisma.Decimal("0.00"),
        reversedAmount: new Prisma.Decimal("0.00"),
        attributionVersion: 1,
        isCurrent: true,
        competence: "2026-08",
        type: "SERVICE",
        createdAt: attributionTime,
      });

      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId,
        reason: "Zero payment comanda reattribution",
        idempotencyKey: "idem-zero-pay",
        userId: ownerId,
        role: "OWNER",
      });

      expect(res.reversalAmount).toBe("0.00");
      expect(res.newReleasedAmount).toBe("0.00");
      expect(mockedPrisma.commissionPayableItem.create).not.toHaveBeenCalled();
    });

    it("Item 35: Partial payments comanda: release proportion is exactly preserved", async () => {
      // 40% paid (R$ 40 of R$ 100)
      mockedPrisma.payment.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal("40.00"), refundedAmount: "0.00", status: "CONFIRMED" },
      ]);
      mockedPrisma.commissionEntry.findFirst.mockResolvedValue({
        id: "entry-v1",
        memberId: oldMemberId,
        comandaItemId,
        baseAmount: new Prisma.Decimal("100.00"),
        generatedAmount: new Prisma.Decimal("50.00"),
        releasedAmount: new Prisma.Decimal("20.00"),
        paidAmount: new Prisma.Decimal("0.00"),
        reversedAmount: new Prisma.Decimal("0.00"),
        attributionVersion: 1,
        isCurrent: true,
        competence: "2026-08",
        type: "SERVICE",
        createdAt: attributionTime,
      });

      const oldCycle = {
        id: "cycle-old-open",
        status: CommissionCycleStatus.OPEN,
        grossCommission: new Prisma.Decimal("100.00"),
        remainingBalance: new Prisma.Decimal("100.00"),
      };
      mockedPrisma.commissionPayableItem.findFirst.mockResolvedValue({
        id: "payable-rel-old",
        cycleId: oldCycle.id,
        cycle: oldCycle,
        amount: new Prisma.Decimal("20.00"),
      });
      mockedPrisma.commissionPayableItem.findUnique.mockResolvedValue(null);

      const newCycle = {
        id: "cycle-new-open",
        status: CommissionCycleStatus.OPEN,
        grossCommission: new Prisma.Decimal("0.00"),
        remainingBalance: new Prisma.Decimal("0.00"),
      };
      mockedPrisma.commissionCycle.findFirst.mockResolvedValue(newCycle);

      const res = await correctCommissionExecutor({
        barbershopId,
        comandaItemId,
        newExecutorMemberId,
        reason: "Partial payment 40% reattribution",
        idempotencyKey: "idem-40-pct",
        userId: ownerId,
        role: "OWNER",
      });

      // New generated is 40.00. 40% of 40.00 is 16.00
      expect(res.newReleasedAmount).toBe("16.00");
      expect(res.reversalAmount).toBe("20.00");
    });
  });

  describe("7. API Endpoints & Deprecation", () => {
    it("Item 37: POST /api/admin/commissions/periods/[id]/close returns 410 LEGACY_ENDPOINT_DEPRECATED", async () => {
      mockedAdminAuth.mockResolvedValue({
        error: null,
        data: { barbershopId, role: "OWNER", userId: ownerId },
      });
      const res = await legacyClosePeriod(
        new NextRequest("http://localhost/api/admin/commissions/periods/p1/close", { method: "POST" })
      );
      expect(res.status).toBe(410);
      const json = await res.json();
      expect(json.code).toBe("LEGACY_ENDPOINT_DEPRECATED");
    });

    it("Item 38: POST /api/admin/commissions/periods/[id]/pay returns 410 LEGACY_ENDPOINT_DEPRECATED", async () => {
      mockedAdminAuth.mockResolvedValue({
        error: null,
        data: { barbershopId, role: "OWNER", userId: ownerId },
      });
      const res = await legacyPayPeriod(
        new NextRequest("http://localhost/api/admin/commissions/periods/p1/pay", { method: "POST" })
      );
      expect(res.status).toBe(410);
      const json = await res.json();
      expect(json.code).toBe("LEGACY_ENDPOINT_DEPRECATED");
    });

    it("Item 39: POST /api/admin/commissions/executor-correction enforces RBAC and delegates cleanly", async () => {
      mockedAuth.mockResolvedValue({
        error: null,
        data: { barbershopId, role: "OWNER", userId: ownerId },
      });
      const reason = "Correction performed through administrative API";
      mockedPrisma.commissionExecutorCorrectionAudit.findUnique.mockResolvedValue({
        id: "audit-api",
        barbershopId,
        idempotencyKey: "api-key-1",
        payloadFingerprint: getFingerprint({
          comandaItemId,
          newExecutorMemberId,
          reason,
        }),
        oldReleasedAmount: "0.00",
        newReleasedAmount: "0.00",
        newEntry: { attributionVersion: 2, generatedAmount: "40.00" },
      });

      const req = new NextRequest("http://localhost/api/admin/commissions/executor-correction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "api-key-1",
        },
        body: JSON.stringify({
          comandaItemId,
          newExecutorMemberId,
          reason: "Correction performed through administrative API",
        }),
      });

      const res = await postExecutorCorrection(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it("Item 40: POST /api/admin/commissions/executor-correction returns 403 for BARBER", async () => {
      mockedAuth.mockResolvedValue({
        error: null,
        data: { barbershopId, role: "BARBER", userId: barberId },
      });

      const req = new NextRequest("http://localhost/api/admin/commissions/executor-correction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "api-key-2",
        },
        body: JSON.stringify({
          comandaItemId,
          newExecutorMemberId,
          reason: "Barber attempting unauthorized correction",
        }),
      });

      const res = await postExecutorCorrection(req);
      expect(res.status).toBe(403);
    });
  });
});
