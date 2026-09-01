import { describe, it, expect, vi, beforeEach } from "vitest";
import { AsaasPaymentStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { reconcileTenantSubscriptionBillingState } from "@/lib/asaas/entitlement";
import { syncTenantSubscriptionAccessOnPayment } from "@/lib/asaas/webhooks";

describe("Phase 2.3D2A — Unified Tenant Billing Reconciler Suite", () => {
  const barbershopId = "shop_reconcile_test";
  const subId = "sub_reconcile_123";
  const planCode = "PLAN_PRO";
  const planId = "plan_uuid_123";

  const defaultContract = {
    id: "sub_rec_record_1",
    barbershopId,
    asaasSubscriptionId: subId,
    planCode,
    planName: "Plano Pro",
    value: 99.9,
    billingType: "CREDIT_CARD",
    status: "ACTIVE",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const defaultPlan = {
    id: planId,
    code: planCode,
    name: "Plano Pro",
    price: 99.9,
    period: "MONTHLY",
    isActive: true,
  };

  let mockTx: any;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      tenantSubscription: {
        findUnique: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: "ts_created_1" }),
        update: vi.fn().mockResolvedValue({ id: "ts_updated_1" }),
      },
      asaasBillingSubscription: {
        findFirst: vi.fn().mockResolvedValue(defaultContract),
        findUnique: vi.fn().mockResolvedValue(defaultContract),
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
      },
      asaasBillingPayment: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
      },
      asaasWebhookEvent: {
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
      },
      plan: {
        findUnique: vi.fn().mockResolvedValue(defaultPlan),
      },
    };

    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));
  });

  describe("1. Recovery Rules", () => {
    it("PAST_DUE + debt RECEIVED + valid period -> update status ACTIVE and grace NULL", async () => {
      const now = new Date("2026-08-20T10:00:00.000Z");
      mockTx.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts_1",
        barbershopId,
        planId,
        status: "PAST_DUE",
        monthlyPrice: 99.9,
        planName: "Plano Pro",
        currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        gracePeriodEndsAt: new Date("2026-08-25T00:00:00.000Z"),
      });

      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p1",
          asaasPaymentId: "pay_1",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-05T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-05T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.recomputed).toBe(true);
      expect(res.tenantSubscriptionStatus).toBe("ACTIVE");
      expect(mockTx.tenantSubscription.update).toHaveBeenCalledWith({
        where: { id: "ts_1" },
        data: expect.objectContaining({
          status: "ACTIVE",
          gracePeriodEndsAt: null,
        }),
      });
    });

    it("SUSPENDED + debt CANCELED + valid entitlement -> ACTIVE", async () => {
      const now = new Date("2026-08-20T10:00:00.000Z");
      mockTx.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts_1",
        barbershopId,
        planId,
        status: "SUSPENDED",
        monthlyPrice: 99.9,
        planName: "Plano Pro",
        currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        gracePeriodEndsAt: new Date("2026-08-10T00:00:00.000Z"),
      });

      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p_winner",
          asaasPaymentId: "pay_winner",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
        {
          id: "p_canceled",
          asaasPaymentId: "pay_canceled",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.CANCELED,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: null,
          firstPositiveAt: null,
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.recomputed).toBe(true);
      expect(res.tenantSubscriptionStatus).toBe("ACTIVE");
    });

    it("PAST_DUE + debt removed + no valid entitlement -> EXPIRED", async () => {
      const now = new Date("2026-10-01T10:00:00.000Z");
      mockTx.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts_1",
        barbershopId,
        planId,
        status: "PAST_DUE",
        monthlyPrice: 99.9,
        planName: "Plano Pro",
        currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        gracePeriodEndsAt: new Date("2026-08-25T00:00:00.000Z"),
      });

      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p_old",
          asaasPaymentId: "pay_old",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.recomputed).toBe(true);
      expect(res.tenantSubscriptionStatus).toBe("EXPIRED");
    });

    it("SUSPENDED + debt removed + no valid entitlement -> EXPIRED", async () => {
      const now = new Date("2026-10-01T10:00:00.000Z");
      mockTx.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts_1",
        barbershopId,
        planId,
        status: "SUSPENDED",
        monthlyPrice: 99.9,
        planName: "Plano Pro",
        currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        gracePeriodEndsAt: new Date("2026-08-10T00:00:00.000Z"),
      });

      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p_old",
          asaasPaymentId: "pay_old",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.recomputed).toBe(true);
      expect(res.tenantSubscriptionStatus).toBe("EXPIRED");
    });
  });

  describe("2. Historical Entitlement & Expiry Rules", () => {
    it("historical winner + period expired + existingSub PAST_DUE + debt cleared -> EXPIRED (not ACTIVE)", async () => {
      const now = new Date("2026-10-01T10:00:00.000Z");
      mockTx.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts_1",
        barbershopId,
        planId,
        status: "PAST_DUE",
        monthlyPrice: 99.9,
        planName: "Plano Pro",
        currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      });

      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p_winner",
          asaasPaymentId: "pay_winner",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.tenantSubscriptionStatus).toBe("EXPIRED");
    });

    it("historical winner + period expired + existingSub null -> ZERO CREATE (reason: NO_VALID_ENTITLEMENT)", async () => {
      const now = new Date("2026-10-01T10:00:00.000Z");
      mockTx.tenantSubscription.findUnique.mockResolvedValue(null);

      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p_winner",
          asaasPaymentId: "pay_winner",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.recomputed).toBe(false);
      expect(res.reason).toBe("NO_VALID_ENTITLEMENT");
      expect(mockTx.tenantSubscription.create).not.toHaveBeenCalled();
    });
  });

  describe("3. Null TenantSubscription Rules", () => {
    it("existingSub null + no winner -> tenantSubscription.create = 0 (reason: NO_WINNER)", async () => {
      mockTx.tenantSubscription.findUnique.mockResolvedValue(null);
      mockTx.asaasBillingPayment.findMany.mockResolvedValue([]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId);

      expect(res.recomputed).toBe(false);
      expect(res.reason).toBe("NO_WINNER");
      expect(mockTx.tenantSubscription.create).not.toHaveBeenCalled();
    });

    it("existingSub null + active debt only (no valid entitlement) -> tenantSubscription.create = 0", async () => {
      const now = new Date("2026-08-20T10:00:00.000Z");
      mockTx.tenantSubscription.findUnique.mockResolvedValue(null);
      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p_overdue",
          asaasPaymentId: "pay_overdue",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.OVERDUE,
          dueDate: new Date("2026-08-10T00:00:00.000Z"),
          paymentDate: null,
          firstPositiveAt: null,
          createdAt: new Date("2026-08-10T00:00:00.000Z"),
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.recomputed).toBe(false);
      expect(res.reason).toBe("NO_WINNER");
      expect(mockTx.tenantSubscription.create).not.toHaveBeenCalled();
    });

    it("existingSub null + valid paid entitlement -> create exactly 1 (status ACTIVE when no debt, planId = plan.id)", async () => {
      const now = new Date("2026-08-10T10:00:00.000Z");
      mockTx.tenantSubscription.findUnique.mockResolvedValue(null);
      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p1",
          asaasPaymentId: "pay_1",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.recomputed).toBe(true);
      expect(res.tenantSubscriptionStatus).toBe("ACTIVE");
      expect(mockTx.tenantSubscription.create).toHaveBeenCalledTimes(1);
      expect(mockTx.tenantSubscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          barbershopId,
          planId,
          status: "ACTIVE",
        }),
      });
    });

    it("existingSub null + valid entitlement + active debt inside grace -> create exactly 1 with PAST_DUE", async () => {
      const now = new Date("2026-08-27T10:00:00-03:00");
      mockTx.tenantSubscription.findUnique.mockResolvedValue(null);
      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p1",
          asaasPaymentId: "pay_paid",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: new Date("2026-08-20T00:00:00.000Z"),
          paymentDate: new Date("2026-08-20T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-20T00:00:00.000Z"),
          createdAt: new Date("2026-08-20T00:00:00.000Z"),
        },
        {
          id: "p2",
          asaasPaymentId: "pay_due",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.OVERDUE,
          dueDate: new Date("2026-08-26T00:00:00.000Z"),
          paymentDate: null,
          firstPositiveAt: null,
          createdAt: new Date("2026-08-26T00:00:00.000Z"),
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.recomputed).toBe(true);
      expect(res.tenantSubscriptionStatus).toBe("PAST_DUE");
      expect(mockTx.tenantSubscription.create).toHaveBeenCalledTimes(1);
      expect(mockTx.tenantSubscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          barbershopId,
          status: "PAST_DUE",
        }),
      });
    });

    it("existingSub null never creates subscription with status TRIAL", async () => {
      const now = new Date("2026-08-10T10:00:00.000Z");
      mockTx.tenantSubscription.findUnique.mockResolvedValue(null);
      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p1",
          asaasPaymentId: "pay_1",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.tenantSubscriptionStatus).not.toBe("TRIAL");
    });
  });

  describe("4. Plan Protection & Invariants", () => {
    it("existing planId mismatch throws TENANT_PLAN_CODE_MISMATCH and update = 0", async () => {
      mockTx.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts_1",
        barbershopId,
        planId: "DIFFERENT_PLAN_UUID",
        status: "ACTIVE",
      });

      await expect(
        reconcileTenantSubscriptionBillingState(barbershopId, null, subId)
      ).rejects.toThrow("TENANT_PLAN_CODE_MISMATCH");

      expect(mockTx.tenantSubscription.update).not.toHaveBeenCalled();
    });

    it("existing matching planId -> planId is NOT included in update payload data", async () => {
      const now = new Date("2026-08-10T10:00:00.000Z");
      mockTx.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts_1",
        barbershopId,
        planId,
        status: "PAST_DUE",
        planName: "Plano Pro",
        monthlyPrice: 99.9,
      });

      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p1",
          asaasPaymentId: "pay_1",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(mockTx.tenantSubscription.update).toHaveBeenCalledWith({
        where: { id: "ts_1" },
        data: expect.not.objectContaining({ planId: expect.anything() }),
      });
    });
  });

  describe("5. Zero-Write Equality & Churn Prevention", () => {
    it("exact 9 fields equality yields zero update calls (reason: IDEMPOTENT_NO_CHANGE)", async () => {
      const now = new Date("2026-08-10T10:00:00.000Z");
      const winnerDate = new Date("2026-08-01T00:00:00.000Z");
      const periodEndDate = new Date("2026-09-01T00:00:00.000Z");

      mockTx.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts_1",
        barbershopId,
        planId,
        status: "ACTIVE",
        planName: defaultContract.planName,
        monthlyPrice: defaultContract.value,
        currentPeriodStart: winnerDate,
        currentPeriodEnd: periodEndDate,
        gracePeriodEndsAt: null,
        paymentMethod: "CREDIT_CARD",
        lastPaymentAt: winnerDate,
        lastAccessPaymentId: "pay_1",
      });

      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p1",
          asaasPaymentId: "pay_1",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          billingType: "CREDIT_CARD",
          value: 99.9,
          dueDate: winnerDate,
          paymentDate: winnerDate,
          firstPositiveAt: winnerDate,
          createdAt: winnerDate,
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.recomputed).toBe(true);
      expect(res.reason).toBe("IDEMPOTENT_NO_CHANGE");
      expect(mockTx.tenantSubscription.update).not.toHaveBeenCalled();
    });
  });

  describe("6. Non-Reducing PeriodEnd Rule", () => {
    it("preserves later existing currentPeriodEnd over earlier derived periodEnd", async () => {
      const now = new Date("2026-08-10T10:00:00.000Z");
      const existingLaterEnd = new Date("2026-10-01T00:00:00.000Z");

      mockTx.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts_1",
        barbershopId,
        planId,
        status: "ACTIVE",
        planName: defaultContract.planName,
        monthlyPrice: defaultContract.value,
        currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEnd: existingLaterEnd,
        gracePeriodEndsAt: null,
      });

      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p1",
          asaasPaymentId: "pay_earlier",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: new Date("2026-08-01T00:00:00.000Z"), // derives 2026-09-01
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(mockTx.tenantSubscription.update).toHaveBeenCalledWith({
        where: { id: "ts_1" },
        data: expect.objectContaining({
          currentPeriodEnd: existingLaterEnd,
        }),
      });
    });
  });

  describe("7. Locks & Ownership", () => {
    it("acquires advisory lock in namespace 0 (hashtextextended(barbershopId, 0)) and NOT 1 or 2", async () => {
      mockTx.tenantSubscription.findUnique.mockResolvedValue(null);

      await reconcileTenantSubscriptionBillingState(barbershopId, null, subId);

      expect(mockTx.$executeRaw).toHaveBeenCalled();
      const rawCalls = mockTx.$executeRaw.mock.calls;
      const sqlStrings = rawCalls.map((c: any) => String(c[0]?.strings || c[0]));

      // Verify lock in namespace 0
      expect(sqlStrings.some((s: string) => s.includes("hashtextextended") && s.includes("0"))).toBe(true);
      expect(sqlStrings.some((s: string) => s.includes(", 1)"))).toBe(false);
      expect(sqlStrings.some((s: string) => s.includes(", 2)"))).toBe(false);
    });

    it("makes 0 writes to AsaasBillingPayment, AsaasBillingSubscription, or AsaasWebhookEvent", async () => {
      const now = new Date("2026-08-10T10:00:00.000Z");
      mockTx.tenantSubscription.findUnique.mockResolvedValue(null);
      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p1",
          asaasPaymentId: "pay_1",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(mockTx.asaasBillingPayment.update).not.toHaveBeenCalled();
      expect(mockTx.asaasBillingPayment.create).not.toHaveBeenCalled();
      expect(mockTx.asaasBillingPayment.upsert).not.toHaveBeenCalled();

      expect(mockTx.asaasBillingSubscription.update).not.toHaveBeenCalled();
      expect(mockTx.asaasBillingSubscription.create).not.toHaveBeenCalled();
      expect(mockTx.asaasBillingSubscription.upsert).not.toHaveBeenCalled();

      expect(mockTx.asaasWebhookEvent.update).not.toHaveBeenCalled();
      expect(mockTx.asaasWebhookEvent.create).not.toHaveBeenCalled();
      expect(mockTx.asaasWebhookEvent.upsert).not.toHaveBeenCalled();
    });
  });

  describe("8. Fallback Candidate & Scope Filtering", () => {
    it("fallback candidate from different contract is ignored", async () => {
      mockTx.tenantSubscription.findUnique.mockResolvedValue(null);
      mockTx.asaasBillingPayment.findMany.mockResolvedValue([]);

      const fallbackDifferentContract = {
        id: "p_diff",
        asaasPaymentId: "pay_diff",
        barbershopId,
        asaasSubscriptionId: "sub_DIFFERENT",
        status: AsaasPaymentStatus.RECEIVED,
        billingType: "BOLETO",
        value: 99.9,
        dueDate: new Date("2026-08-01T00:00:00.000Z"),
        paymentDate: new Date("2026-08-01T00:00:00.000Z"),
        firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      };

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, fallbackDifferentContract as any, subId);

      expect(res.recomputed).toBe(false);
      expect(res.reason).toBe("NO_WINNER");
    });

    it("fallback candidate from different barbershop is ignored", async () => {
      mockTx.tenantSubscription.findUnique.mockResolvedValue(null);
      mockTx.asaasBillingPayment.findMany.mockResolvedValue([]);

      const fallbackDifferentShop = {
        id: "p_diff_shop",
        asaasPaymentId: "pay_diff_shop",
        barbershopId: "shop_OTHER",
        asaasSubscriptionId: subId,
        status: AsaasPaymentStatus.RECEIVED,
        billingType: "BOLETO",
        value: 99.9,
        dueDate: new Date("2026-08-01T00:00:00.000Z"),
        paymentDate: new Date("2026-08-01T00:00:00.000Z"),
        firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      };

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, fallbackDifferentShop as any, subId);

      expect(res.recomputed).toBe(false);
      expect(res.reason).toBe("NO_WINNER");
    });
  });

  describe("9. Trial Preservation Rule", () => {
    it("existing explicit active TRIAL remains TRIAL even when valid winner and debt exist", async () => {
      const now = new Date("2026-08-10T10:00:00.000Z");
      const futureTrialEnd = new Date("2026-08-20T10:00:00.000Z");

      mockTx.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts_trial",
        barbershopId,
        planId,
        status: "TRIAL",
        trialEndsAt: futureTrialEnd,
        planName: defaultContract.planName,
        monthlyPrice: defaultContract.value,
      });

      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p1",
          asaasPaymentId: "pay_1",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.tenantSubscriptionStatus).toBe("TRIAL");
    });
  });

  describe("10. Webhook Call Order Test", () => {
    it("syncTenantSubscriptionAccessOnPayment completes payment access claim before invoking reconciler", async () => {
      mockTx.asaasBillingPayment.updateMany.mockResolvedValue({ count: 1 });
      mockTx.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasSubscriptionId: subId,
        barbershopId,
      });

      await syncTenantSubscriptionAccessOnPayment(barbershopId, {
        id: "pay_order_test",
        subscription: subId,
        value: 99.9,
        dueDate: "2026-08-01",
        paymentDate: "2026-08-01",
      });

      expect(mockTx.asaasBillingPayment.updateMany).toHaveBeenCalledWith({
        where: {
          asaasPaymentId: "pay_order_test",
          barbershopId,
          accessAppliedAt: null,
        },
        data: expect.objectContaining({
          accessAppliedAt: expect.any(Date),
        }),
      });
    });
  });

  describe("11. C2 Restored Semantics — Non-Anchor Dates & Fallback Without Dates", () => {
    it("firstPositiveAt and createdAt alone DO NOT anchor period (derivedStart=null, derivedEnd=null, 0 creates)", async () => {
      const now = new Date("2026-08-20T10:00:00.000Z");
      mockTx.tenantSubscription.findUnique.mockResolvedValue(null);

      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p_no_dates",
          asaasPaymentId: "pay_no_dates",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: null,
          paymentDate: null,
          firstPositiveAt: now,
          createdAt: now,
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.recomputed).toBe(false);
      expect(res.reason).toBe("NO_VALID_ENTITLEMENT");
      expect(mockTx.tenantSubscription.create).not.toHaveBeenCalled();
    });

    it("Critical Test — Fallback without dates passes null dates and does NOT fabricate 1-month access", async () => {
      const now = new Date("2026-08-20T10:00:00.000Z");
      mockTx.tenantSubscription.findUnique.mockResolvedValue(null);
      mockTx.asaasBillingPayment.updateMany.mockResolvedValue({ count: 1 });
      mockTx.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasSubscriptionId: subId,
        barbershopId,
      });

      await syncTenantSubscriptionAccessOnPayment(barbershopId, {
        id: "pay_no_dates_fallback",
        subscription: subId,
        value: 99.9,
        dueDate: null,
        paymentDate: null,
      });

      expect(mockTx.tenantSubscription.create).not.toHaveBeenCalled();
    });

    it("Preserves existing future currentPeriodEnd without extending when winner has no due/payment date", async () => {
      const now = new Date("2026-08-20T10:00:00.000Z");
      const futureEnd = new Date("2026-09-15T00:00:00.000Z");

      mockTx.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts_existing_future",
        barbershopId,
        planId,
        status: "ACTIVE",
        monthlyPrice: 99.9,
        planName: "Plano Pro",
        currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEnd: futureEnd,
        gracePeriodEndsAt: null,
        paymentMethod: "CREDIT_CARD",
        lastPaymentAt: null,
        lastAccessPaymentId: "pay_hist_pos",
      });

      mockTx.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p_historical_positive",
          asaasPaymentId: "pay_hist_pos",
          barbershopId,
          asaasSubscriptionId: subId,
          status: AsaasPaymentStatus.RECEIVED,
          dueDate: null,
          paymentDate: null,
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      const res = await reconcileTenantSubscriptionBillingState(barbershopId, null, subId, now);

      expect(res.recomputed).toBe(true);
      expect(res.reason).toBe("IDEMPOTENT_NO_CHANGE");
      expect(mockTx.tenantSubscription.update).not.toHaveBeenCalled();
    });
  });
});
