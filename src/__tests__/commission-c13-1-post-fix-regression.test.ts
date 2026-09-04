/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateCommissionsForComanda,
  correctCommissionExecutor,
  CommissionError,
} from "@/lib/operations/commissions";
import {
  CommissionEntryStatus,
  CommissionCycleStatus,
  CommissionPayableType,
  CommissionPayableSourceKind,
  Prisma,
} from "@prisma/client";
import { POST as executorCorrectionPOST } from "@/app/api/admin/commissions/executor-correction/route";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  requireOperationalSession: vi.fn(),
  getAdminSession: vi.fn(),
}));

vi.mock("@/lib/operations/stock", () => ({
  runSerializableTransaction: vi.fn(async (cb: any) => cb({})),
  syncStockForComandaItem: vi.fn(),
}));

describe("Phase C13.1 — Post-Fix Behavioral Regression Suite", () => {
  const barbershopId = "shop-c13-proof";
  const comandaId = "cmd-c13-proof";
  const itemId = "item-c13-1";
  const oldMemberId = "member-barber-1";
  const newMemberId = "member-barber-2";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Cancellation with Superseded CommissionEntry Versions", () => {
    it("proves ONLY current version is reversed, and superseded version is NEVER touched", async () => {
      const entryV1 = {
        id: "entry-v1-superseded",
        barbershopId,
        memberId: oldMemberId,
        comandaItemId: itemId,
        attributionVersion: 1,
        isCurrent: false,
        supersedesEntryId: null,
        baseAmount: new Prisma.Decimal(100),
        generatedAmount: new Prisma.Decimal(0),
        releasedAmount: new Prisma.Decimal(0),
        paidAmount: new Prisma.Decimal(0),
        status: CommissionEntryStatus.REVERSED,
      };

      const entryV2 = {
        id: "entry-v2-current",
        barbershopId,
        memberId: newMemberId,
        comandaItemId: itemId,
        attributionVersion: 2,
        isCurrent: true,
        supersedesEntryId: "entry-v1-superseded",
        baseAmount: new Prisma.Decimal(100),
        generatedAmount: new Prisma.Decimal(40),
        releasedAmount: new Prisma.Decimal(40),
        paidAmount: new Prisma.Decimal(0),
        status: CommissionEntryStatus.RELEASED,
      };

      const mockCycleV2 = {
        id: "cycle-member-2",
        barbershopId,
        memberId: newMemberId,
        status: CommissionCycleStatus.OPEN,
        cycleNumber: 1,
        grossCommission: new Prisma.Decimal(40),
        adjustmentsTotal: new Prisma.Decimal(0),
        advancesTotal: new Prisma.Decimal(0),
        finalPayoutAmount: new Prisma.Decimal(0),
        remainingBalance: new Prisma.Decimal(40),
        version: 1,
      };

      const reversedEntries: string[] = [];
      const updatedEntries: Array<{ id: string; data: any }> = [];

      const tx: any = {
        $queryRaw: vi.fn(async () => [entryV2]),
        comanda: {
          findFirst: vi.fn().mockResolvedValue({
            id: comandaId,
            barbershopId,
            status: "OPEN",
            commissionRevision: 3,
            items: [],
            payments: [],
          }),
          update: vi.fn().mockResolvedValue({ id: comandaId, commissionRevision: 4 }),
        },
        comandaItem: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        commissionEntry: {
          findMany: vi.fn().mockImplementation(async ({ where }: any) => {
            expect(where.isCurrent).toBe(true);
            if (where.isCurrent === true) {
              return [entryV2];
            }
            return [entryV1, entryV2];
          }),
          findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
            if (where.id === entryV2.id) return entryV2;
            if (where.id === entryV1.id) return entryV1;
            return null;
          }),
          findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
            if (where.id === entryV2.id) return entryV2;
            if (where.id === entryV1.id) return entryV1;
            return null;
          }),
          update: vi.fn().mockImplementation(async ({ where, data }: any) => {
            updatedEntries.push({ id: where.id, data });
            return { ...entryV2, ...data };
          }),
          delete: vi.fn(),
        },
        commissionCycle: {
          findFirst: vi.fn().mockResolvedValue(mockCycleV2),
          update: vi.fn().mockResolvedValue(mockCycleV2),
        },
        commissionPayableItem: {
          findFirst: vi.fn().mockResolvedValue({
            id: "pay-v2-release",
            cycleId: mockCycleV2.id,
            cycle: mockCycleV2,
            amount: new Prisma.Decimal(40),
            type: CommissionPayableType.RELEASE,
          }),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            if (data.type === CommissionPayableType.REVERSAL) {
              reversedEntries.push(data.entryId);
            }
            return { id: "new-payable-item", ...data };
          }),
        },
        commissionCycleAdjustment: {
          create: vi.fn(),
        },
        barbershopMember: {
          findUnique: vi.fn().mockResolvedValue({ id: newMemberId, barbershopId, active: true }),
        },
      };

      await generateCommissionsForComanda(tx, barbershopId, comandaId);

      expect(reversedEntries).toContain(entryV2.id);
      expect(reversedEntries).not.toContain(entryV1.id);
      expect(reversedEntries.length).toBe(1);

      const updatedEntryV1 = updatedEntries.find((u) => u.id === entryV1.id);
      expect(updatedEntryV1).toBeUndefined();
    });

    it("proves cancellation rerun produces ZERO delta (idempotent)", async () => {
      const alreadyReversedEntryV2 = {
        id: "entry-v2-current",
        barbershopId,
        memberId: newMemberId,
        comandaItemId: itemId,
        attributionVersion: 2,
        isCurrent: true,
        supersedesEntryId: "entry-v1-superseded",
        baseAmount: new Prisma.Decimal(0),
        generatedAmount: new Prisma.Decimal(0),
        releasedAmount: new Prisma.Decimal(0),
        paidAmount: new Prisma.Decimal(0),
        status: CommissionEntryStatus.REVERSED,
      };

      const payableCreates: any[] = [];
      const adjustmentCreates: any[] = [];

      const tx: any = {
        $queryRaw: vi.fn(async () => [alreadyReversedEntryV2]),
        comanda: {
          findFirst: vi.fn().mockResolvedValue({
            id: comandaId,
            barbershopId,
            status: "OPEN",
            commissionRevision: 4,
            items: [],
            payments: [],
          }),
          update: vi.fn().mockResolvedValue({ id: comandaId, commissionRevision: 5 }),
        },
        comandaItem: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        commissionEntry: {
          findMany: vi.fn().mockResolvedValue([alreadyReversedEntryV2]),
          findFirst: vi.fn().mockResolvedValue(alreadyReversedEntryV2),
          update: vi.fn(),
          delete: vi.fn(),
        },
        commissionPayableItem: {
          findFirst: vi.fn().mockResolvedValue({ id: "pay-v2-reversal" }),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            payableCreates.push(data);
            return { id: "payable-item-id", ...data };
          }),
        },
        commissionCycleAdjustment: {
          create: vi.fn().mockImplementation(async ({ data }: any) => {
            adjustmentCreates.push(data);
            return { id: "adj-id", ...data };
          }),
        },
      };

      await generateCommissionsForComanda(tx, barbershopId, comandaId);

      expect(payableCreates.length).toBe(0);
      expect(adjustmentCreates.length).toBe(0);
    });
  });

  describe("2. Executor Correction to Cancellation Lifecycle", () => {
    it("proves correcting executor role validation (rejects BARBER and SUPER_ADMIN)", async () => {
      await expect(
        correctCommissionExecutor({
          barbershopId,
          comandaItemId: itemId,
          newExecutorMemberId: newMemberId,
          reason: "Correção de executor autorizada",
          idempotencyKey: "idemp-c13-1",
          userId: "user-barber",
          role: "BARBER",
        })
      ).rejects.toThrow(CommissionError);

      await expect(
        correctCommissionExecutor({
          barbershopId,
          comandaItemId: itemId,
          newExecutorMemberId: newMemberId,
          reason: "Correção de executor autorizada",
          idempotencyKey: "idemp-c13-2",
          userId: "user-super-admin",
          role: "SUPER_ADMIN",
        })
      ).rejects.toThrow(CommissionError);
    });
  });

  describe("3. Executor Correction API Generic Error Response Safety", () => {
    it("returns specific status code and code for known CommissionError", async () => {
      const { requireOperationalSession } = await import("@/lib/api-auth");
      vi.mocked(requireOperationalSession).mockResolvedValueOnce({
        error: null,
        data: {
          userId: "usr-owner",
          role: "OWNER",
          memberId: "mem-owner",
          barbershopId: "shop-c13",
        },
      } as any);

      const req = new NextRequest("http://localhost/api/admin/commissions/executor-correction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "idemp-key-12345",
        },
        body: JSON.stringify({
          comandaItemId: "item-1",
          newExecutorMemberId: "mem-2",
          reason: "short",
        }),
      });

      const res = await executorCorrectionPOST(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.code).toBe("INVALID_REASON");
      expect(json.error).toBe("Motivo deve ter no mínimo 10 caracteres.");
    });

    it("returns safe generic 500 error response without leaking Prisma SQL or stack trace for unexpected errors", async () => {
      const { requireOperationalSession } = await import("@/lib/api-auth");
      vi.mocked(requireOperationalSession).mockResolvedValueOnce({
        error: null,
        data: {
          userId: "usr-owner",
          role: "OWNER",
          memberId: "mem-owner",
          barbershopId: "shop-c13",
        },
      } as any);

      const { runSerializableTransaction } = await import("@/lib/operations/stock");
      vi.mocked(runSerializableTransaction).mockRejectedValueOnce(
        new Error("PrismaClientKnownRequestError: Raw SQL query SELECT * FROM \"secret_table\" failed at line 42")
      );

      const req = new NextRequest("http://localhost/api/admin/commissions/executor-correction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "idemp-key-safe-500",
        },
        body: JSON.stringify({
          comandaItemId: "item-1",
          newExecutorMemberId: "mem-2",
          reason: "Motivo valido com mais de dez caracteres",
        }),
      });

      const res = await executorCorrectionPOST(req);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe("Erro interno ao processar correção de executor.");
      expect(json.error).not.toContain("Prisma");
      expect(json.error).not.toContain("SELECT");
      expect(json.error).not.toContain("secret_table");
    });
  });
});
