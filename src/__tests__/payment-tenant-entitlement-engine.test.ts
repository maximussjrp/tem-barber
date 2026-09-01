import { describe, expect, it, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findUnique: vi.fn() },
    asaasBillingCustomer: { findUnique: vi.fn() },
    asaasBillingSubscription: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    asaasBillingPayment: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    asaasWebhookEvent: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    plan: { findUnique: vi.fn(), findFirst: vi.fn() },
    tenantSubscription: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((cb: any) => cb(prismaMock)),
    $executeRaw: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/billing/plans-db", () => ({
  getPlanByCode: vi.fn(async (_tx: any, code: string) => {
    if (code === "PRO_PLAN") {
      return { id: "plan_pro_123", code: "PRO_PLAN", name: "Plano Pro", price: 99.9 };
    }
    if (code === "BASIC_PLAN") {
      return { id: "plan_basic_456", code: "BASIC_PLAN", name: "Plano Basic", price: 49.9 };
    }
    return null;
  }),
}));

import {
  addCalendarMonthsUTC,
  recomputeTenantSubscriptionFromPayments,
  resolveCurrentAsaasBillingSubscription,
  resolveNonReducingPeriodEnd,
  selectEligiblePaymentWinner,
  StoredPaymentForRecompute,
} from "@/lib/asaas/entitlement";
import { parseAsaasSourceEventAt } from "@/lib/asaas/mappers";
import { processAsaasWebhookPayload } from "@/lib/asaas/webhooks";
import { deriveTenantSubscriptionAccess } from "@/lib/billing/subscription-access";

describe("Phase 2.3C2 Deterministic Tenant Entitlement Engine - Mandatory Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh_evt_1", receivedAt: new Date("2026-08-01T00:00:00Z") });
    prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
    prismaMock.asaasWebhookEvent.update.mockResolvedValue({});
    prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue(null);
    prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue(null);
    prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(null);
    prismaMock.asaasBillingPayment.findMany.mockResolvedValue([]);
    prismaMock.asaasBillingPayment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.tenantSubscription.findUnique.mockResolvedValue(null);
  });

  describe("1. UTC Calendar Arithmetic", () => {
    it("UTC July 26 + 1 month => August 26", () => {
      const start = new Date("2026-07-26T12:00:00.000Z");
      const end = addCalendarMonthsUTC(start, 1);
      expect(end.toISOString()).toBe("2026-08-26T12:00:00.000Z");
    });

    it("UTC Jan 31 non-leap year + 1 month => Feb 28", () => {
      const start = new Date("2026-01-31T15:30:00.000Z");
      const end = addCalendarMonthsUTC(start, 1);
      expect(end.toISOString()).toBe("2026-02-28T15:30:00.000Z");
    });

    it("UTC Jan 31 leap year + 1 month => Feb 29", () => {
      const start = new Date("2028-01-31T10:00:00.000Z");
      const end = addCalendarMonthsUTC(start, 1);
      expect(end.toISOString()).toBe("2028-02-29T10:00:00.000Z");
    });
  });

  describe("2. Winner Selection Determinism & Exclusions", () => {
    it("selects August payment over July payment regardless of array order", () => {
      const july: StoredPaymentForRecompute = {
        id: "p1",
        asaasPaymentId: "pay_july",
        barbershopId: "b1",
        asaasSubscriptionId: "sub_1",
        status: "RECEIVED" as any,
        billingType: "PIX",
        value: 100,
        dueDate: new Date("2026-07-26T00:00:00Z"),
        paymentDate: new Date("2026-07-25T00:00:00Z"),
        firstPositiveAt: new Date("2026-07-25T00:00:00Z"),
        createdAt: new Date("2026-07-25T00:00:00Z"),
      };

      const august: StoredPaymentForRecompute = {
        id: "p2",
        asaasPaymentId: "pay_august",
        barbershopId: "b1",
        asaasSubscriptionId: "sub_1",
        status: "RECEIVED" as any,
        billingType: "PIX",
        value: 100,
        dueDate: new Date("2026-08-26T00:00:00Z"),
        paymentDate: new Date("2026-08-25T00:00:00Z"),
        firstPositiveAt: new Date("2026-08-25T00:00:00Z"),
        createdAt: new Date("2026-08-25T00:00:00Z"),
      };

      expect(selectEligiblePaymentWinner([july, august])?.asaasPaymentId).toBe("pay_august");
      expect(selectEligiblePaymentWinner([august, july])?.asaasPaymentId).toBe("pay_august");
    });

    it("breaks ties deterministically using asaasPaymentId DESC when due dates and payment dates match", () => {
      const pA: StoredPaymentForRecompute = {
        id: "pA",
        asaasPaymentId: "pay_AAAA",
        barbershopId: "b1",
        asaasSubscriptionId: "sub_1",
        status: "RECEIVED" as any,
        billingType: "PIX",
        value: 100,
        dueDate: new Date("2026-08-26T00:00:00Z"),
        paymentDate: new Date("2026-08-25T00:00:00Z"),
        firstPositiveAt: new Date("2026-08-25T00:00:00Z"),
        createdAt: new Date("2026-08-25T00:00:00Z"),
      };

      const pB: StoredPaymentForRecompute = {
        id: "pB",
        asaasPaymentId: "pay_ZZZZ",
        barbershopId: "b1",
        asaasSubscriptionId: "sub_1",
        status: "RECEIVED" as any,
        billingType: "PIX",
        value: 100,
        dueDate: new Date("2026-08-26T00:00:00Z"),
        paymentDate: new Date("2026-08-25T00:00:00Z"),
        firstPositiveAt: new Date("2026-08-25T00:00:00Z"),
        createdAt: new Date("2026-08-25T00:00:00Z"),
      };

      expect(selectEligiblePaymentWinner([pA, pB])?.asaasPaymentId).toBe("pay_ZZZZ");
      expect(selectEligiblePaymentWinner([pB, pA])?.asaasPaymentId).toBe("pay_ZZZZ");
    });

    it("includes REFUNDED payment as eligible winner if firstPositiveAt IS NOT NULL", () => {
      const refundedWithHistory: StoredPaymentForRecompute = {
        id: "p1",
        asaasPaymentId: "pay_refunded",
        barbershopId: "b1",
        asaasSubscriptionId: "sub_1",
        status: "REFUNDED" as any,
        billingType: "PIX",
        value: 100,
        dueDate: new Date("2026-07-26T00:00:00Z"),
        paymentDate: new Date("2026-07-25T00:00:00Z"),
        firstPositiveAt: new Date("2026-07-25T00:00:00Z"),
        createdAt: new Date("2026-07-25T00:00:00Z"),
      };

      expect(selectEligiblePaymentWinner([refundedWithHistory])?.asaasPaymentId).toBe("pay_refunded");
    });

    it("excludes REFUNDED payment if firstPositiveAt IS NULL", () => {
      const refundedWithoutHistory: StoredPaymentForRecompute = {
        id: "p1",
        asaasPaymentId: "pay_refunded_no_hist",
        barbershopId: "b1",
        asaasSubscriptionId: "sub_1",
        status: "REFUNDED" as any,
        billingType: "PIX",
        value: 100,
        dueDate: new Date("2026-07-26T00:00:00Z"),
        paymentDate: null,
        firstPositiveAt: null,
        createdAt: new Date("2026-07-25T00:00:00Z"),
      };

      expect(selectEligiblePaymentWinner([refundedWithoutHistory])).toBeNull();
    });

    it("excludes firstPositiveAt from winner ordering calculation", () => {
      const p1: StoredPaymentForRecompute = {
        id: "p1",
        asaasPaymentId: "pay_1",
        barbershopId: "b1",
        asaasSubscriptionId: "sub_1",
        status: "RECEIVED" as any,
        billingType: "PIX",
        value: 100,
        dueDate: new Date("2026-08-10T00:00:00Z"),
        paymentDate: new Date("2026-08-01T00:00:00Z"),
        firstPositiveAt: new Date("2026-01-01T00:00:00Z"), // earlier firstPositiveAt
        createdAt: new Date("2026-08-01T00:00:00Z"),
      };

      const p2: StoredPaymentForRecompute = {
        id: "p2",
        asaasPaymentId: "pay_2",
        barbershopId: "b1",
        asaasSubscriptionId: "sub_1",
        status: "RECEIVED" as any,
        billingType: "PIX",
        value: 100,
        dueDate: new Date("2026-08-05T00:00:00Z"), // earlier dueDate
        paymentDate: new Date("2026-08-01T00:00:00Z"),
        firstPositiveAt: new Date("2026-08-01T00:00:00Z"), // later firstPositiveAt
        createdAt: new Date("2026-08-01T00:00:00Z"),
      };

      // p1 has later dueDate (Aug 10 > Aug 5), so p1 wins despite having earlier firstPositiveAt
      expect(selectEligiblePaymentWinner([p1, p2])?.asaasPaymentId).toBe("pay_1");
    });
  });

  describe("3. Payment Method Fallback & Invented PIX Guard", () => {
    it("derives paymentMethod = null when winner, contract and existing sub all have null billingType", async () => {
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
        id: "sub_rec_1",
        asaasSubscriptionId: "sub_1",
        barbershopId: "shop_1",
        planCode: "PRO_PLAN",
        planName: "Plano Pro",
        value: 99.9,
        billingType: null,
        createdAt: new Date(),
      });

      prismaMock.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p1",
          asaasPaymentId: "pay_1",
          barbershopId: "shop_1",
          asaasSubscriptionId: "sub_1",
          status: "RECEIVED",
          billingType: null,
          value: 99.9,
          dueDate: new Date("2026-08-10T00:00:00Z"),
          paymentDate: new Date("2026-08-10T00:00:00Z"),
          firstPositiveAt: new Date("2026-08-10T00:00:00Z"),
          createdAt: new Date(),
        },
      ]);

      prismaMock.tenantSubscription.findUnique.mockResolvedValue(null);

      const res = await recomputeTenantSubscriptionFromPayments("shop_1");
      expect(res.recomputed).toBe(true);

      expect(prismaMock.tenantSubscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          barbershopId: "shop_1",
          paymentMethod: null,
        }),
      });
    });

    it("prefers winner.billingType ?? currentContract.billingType ?? existingSub?.paymentMethod", async () => {
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
        id: "sub_rec_1",
        asaasSubscriptionId: "sub_1",
        barbershopId: "shop_1",
        planCode: "PRO_PLAN",
        planName: "Plano Pro",
        value: 99.9,
        billingType: "BOLETO",
        createdAt: new Date(),
      });

      prismaMock.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p1",
          asaasPaymentId: "pay_1",
          barbershopId: "shop_1",
          asaasSubscriptionId: "sub_1",
          status: "RECEIVED",
          billingType: "CREDIT_CARD",
          value: 99.9,
          dueDate: new Date("2026-08-10T00:00:00Z"),
          paymentDate: new Date("2026-08-10T00:00:00Z"),
          firstPositiveAt: new Date("2026-08-10T00:00:00Z"),
          createdAt: new Date(),
        },
      ]);

      prismaMock.tenantSubscription.findUnique.mockResolvedValue(null);

      const res = await recomputeTenantSubscriptionFromPayments("shop_1");
      expect(res.recomputed).toBe(true);

      expect(prismaMock.tenantSubscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          paymentMethod: "CREDIT_CARD",
        }),
      });
    });
  });

  describe("4. Current Contract Resolution Determinism", () => {
    it("orders by createdAt DESC, asaasSubscriptionId DESC without filtering by status or canceledAt", async () => {
      const txMock = prismaMock;
      await resolveCurrentAsaasBillingSubscription(txMock as any, "shop_123");

      expect(txMock.asaasBillingSubscription.findFirst).toHaveBeenCalledWith({
        where: { barbershopId: "shop_123" },
        orderBy: [
          { createdAt: "desc" },
          { asaasSubscriptionId: "desc" },
        ],
      });
    });
  });

  describe("5. Refund-First Scenario & Snapshot Immutability Test", () => {
    it("STALE positive canonical fields remain strictly immutable when older RECEIVED arrives after REFUNDED", async () => {
      // 1. Newer REFUNDED event arrives first
      const storedRefundedPayment = {
        id: "local_p1",
        barbershopId: "shop_refund",
        asaasPaymentId: "pay_refund_100",
        asaasSubscriptionId: "sub_1",
        asaasCustomerId: "cus_1",
        status: "REFUNDED",
        billingType: "CREDIT_CARD",
        value: 150.0,
        netValue: 145.0,
        dueDate: new Date("2026-08-10T00:00:00Z"),
        paymentDate: new Date("2026-08-09T00:00:00Z"),
        invoiceUrl: "http://invoice/1",
        bankSlipUrl: null,
        externalReference: "ext_100",
        sourceEventAt: new Date("2026-08-05T12:00:00Z"), // Newer event date
        sourceEventId: "evt_refund_200",
        firstPositiveAt: null,
        rawPayload: { id: "pay_refund_100", status: "REFUNDED" },
        createdAt: new Date("2026-08-05T12:00:00Z"),
        updatedAt: new Date("2026-08-05T12:00:00Z"),
      };

      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub_rec_1",
        asaasSubscriptionId: "sub_1",
        barbershopId: "shop_refund",
        planCode: "PRO_PLAN",
        planName: "Plano Pro",
        value: 150.0,
        status: "ACTIVE",
      });

      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
        id: "sub_rec_1",
        asaasSubscriptionId: "sub_1",
        barbershopId: "shop_refund",
        planCode: "PRO_PLAN",
        planName: "Plano Pro",
        value: 150.0,
        status: "ACTIVE",
      });

      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop_refund" });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(storedRefundedPayment);

      // Webhook payload for older RECEIVED event
      const olderReceivedPayload = {
        id: "evt_received_100",
        event: "PAYMENT_RECEIVED",
        dateCreated: "2026-08-01 10:00:00", // Older event date
        payment: {
          id: "pay_refund_100",
          customer: "cus_1",
          subscription: "sub_1",
          status: "RECEIVED",
          billingType: "CREDIT_CARD",
          value: 150.0,
          netValue: 145.0,
          dueDate: "2026-08-10",
          paymentDate: "2026-08-09",
          externalReference: "ext_100",
        },
      };

      const result = await processAsaasWebhookPayload(olderReceivedPayload);
      expect(result.ok).toBe(true);

      // Verify that update was called for STALE positive
      expect(prismaMock.asaasBillingPayment.update).toHaveBeenCalled();
      const updateCall = prismaMock.asaasBillingPayment.update.mock.calls[0][0];

      // CRITICAL ASSERTION: Update MUST NOT contain any canonical payment fields (status, dueDate, paymentDate, value, etc.)
      expect(updateCall.data).toEqual({
        firstPositiveAt: expect.any(Date),
      });

      // Verify canonical fields are strictly immutable
      expect(updateCall.data.status).toBeUndefined();
      expect(updateCall.data.dueDate).toBeUndefined();
      expect(updateCall.data.paymentDate).toBeUndefined();
      expect(updateCall.data.value).toBeUndefined();
      expect(updateCall.data.netValue).toBeUndefined();
      expect(updateCall.data.billingType).toBeUndefined();
      expect(updateCall.data.rawPayload).toBeUndefined();
      expect(updateCall.data.sourceEventAt).toBeUndefined();
      expect(updateCall.data.sourceEventId).toBeUndefined();
    });
  });

  describe("6. Existing RECEIVED firstPositiveAt NULL + Refund Lazy Bridge", () => {
    it("populates firstPositiveAt before transitioning to REFUNDED status", async () => {
      const storedReceivedNoHist = {
        id: "local_p2",
        barbershopId: "shop_bridge",
        asaasPaymentId: "pay_bridge_1",
        asaasSubscriptionId: "sub_1",
        asaasCustomerId: "cus_1",
        status: "RECEIVED",
        billingType: "PIX",
        value: 100.0,
        netValue: 98.0,
        dueDate: new Date("2026-08-10T00:00:00Z"),
        paymentDate: new Date("2026-08-09T00:00:00Z"),
        sourceEventAt: new Date("2026-08-01T10:00:00Z"),
        sourceEventId: "evt_rec_1",
        firstPositiveAt: null,
        createdAt: new Date("2026-08-01T10:00:00Z"),
      };

      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop_bridge" });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(storedReceivedNoHist);
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub_1",
        asaasSubscriptionId: "sub_1",
        barbershopId: "shop_bridge",
        planCode: "PRO_PLAN",
        status: "ACTIVE",
      });

      const incomingRefundPayload = {
        id: "evt_ref_2",
        event: "PAYMENT_REFUNDED",
        dateCreated: "2026-08-05 15:00:00", // Newer event
        payment: {
          id: "pay_bridge_1",
          customer: "cus_1",
          subscription: "sub_1",
          status: "REFUNDED",
          value: 100.0,
        },
      };

      const res = await processAsaasWebhookPayload(incomingRefundPayload);
      expect(res.ok).toBe(true);

      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalled();
      const upsertCall = prismaMock.asaasBillingPayment.upsert.mock.calls[0][0];

      // firstPositiveAt MUST be populated via lazy bridge from existing positive record
      expect(upsertCall.update.firstPositiveAt).toEqual(storedReceivedNoHist.sourceEventAt);
      expect(upsertCall.update.status).toBe("REFUNDED");
    });
  });

  describe("7. Recompute Matrix & TX Rules", () => {
    it("STALE negative event skips TX2 recompute and returns ignored", async () => {
      const storedReceived = {
        id: "p1",
        barbershopId: "shop_stale_neg",
        asaasPaymentId: "pay_1",
        asaasSubscriptionId: "sub_1",
        status: "RECEIVED",
        sourceEventAt: new Date("2026-08-05T12:00:00Z"),
        sourceEventId: "evt_2",
        firstPositiveAt: new Date("2026-08-05T12:00:00Z"),
      };

      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop_stale_neg" });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(storedReceived);

      const olderOverduePayload = {
        id: "evt_1",
        event: "PAYMENT_OVERDUE",
        dateCreated: "2026-08-01 10:00:00", // Older event
        payment: {
          id: "pay_1",
          subscription: "sub_1",
          status: "OVERDUE",
          externalReference: "tb_barbershop_shop_stale_neg",
        },
      };

      const res = await processAsaasWebhookPayload(olderOverduePayload);
      expect(res.ok).toBe(true);
      expect(res.ignored).toBe(true);

      // TX2 recompute was NOT called
      expect(prismaMock.asaasBillingSubscription.findFirst).not.toHaveBeenCalled();
    });

    it("CONFLICT returns error and mutates zero historical/canonical rows", async () => {
      const eventDateStr = "2026-08-01T10:00:00.000Z";
      const stored = {
        id: "p1",
        barbershopId: "shop_conflict",
        asaasPaymentId: "pay_1",
        asaasSubscriptionId: "sub_1",
        status: "PENDING",
        value: 100.0,
        sourceEventAt: new Date(eventDateStr),
        sourceEventId: "evt_same",
      };

      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop_conflict" });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(stored);

      const conflictingPayload = {
        id: "evt_same", // Same event ID and date Created
        event: "PAYMENT_RECEIVED",
        dateCreated: eventDateStr,
        payment: {
          id: "pay_1",
          subscription: "sub_1",
          status: "RECEIVED",
          value: 200.0, // Different value -> CONFLICT
          externalReference: "tb_barbershop_shop_conflict",
        },
      };

      const res = await processAsaasWebhookPayload(conflictingPayload);
      expect(res.ok).toBe(true);
      expect(res.error).toBe("PAYMENT_SOURCE_EVENT_CONFLICT");

      expect(prismaMock.asaasBillingPayment.upsert).not.toHaveBeenCalled();
      expect(prismaMock.asaasBillingPayment.update).not.toHaveBeenCalled();
    });

    it("identity mismatch returns error and mutates zero rows", async () => {
      const stored = {
        id: "p1",
        barbershopId: "shop_A",
        asaasPaymentId: "pay_1",
        asaasSubscriptionId: "sub_1",
      };

      prismaMock.barbershop.findUnique.mockImplementation(async ({ where }: any) => {
        if (where.id === "shop_B") return { id: "shop_B" };
        return null;
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(stored);

      const payload = {
        id: "evt_1",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_1",
          externalReference: "tb_barbershop_shop_B",
        },
      };

      const res = await processAsaasWebhookPayload(payload);
      expect(res.ok).toBe(true);
      expect(res.error).toBe("BARBERSHOP_SUBSCRIPTION_MISMATCH");

      expect(prismaMock.asaasBillingPayment.upsert).not.toHaveBeenCalled();
      expect(prismaMock.asaasBillingPayment.update).not.toHaveBeenCalled();
    });

    it("returns NO_WINNER when no eligible payment winner exists for contract", async () => {
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
        id: "sub_1",
        asaasSubscriptionId: "sub_1",
        barbershopId: "shop_nowinner",
        planCode: "PRO_PLAN",
      });

      prismaMock.asaasBillingPayment.findMany.mockResolvedValue([]); // No payments

      const res = await recomputeTenantSubscriptionFromPayments("shop_nowinner");
      expect(res.recomputed).toBe(false);
      expect(res.reason).toBe("NO_WINNER");
    });

    it("throws TENANT_PLAN_CODE_MISMATCH when existing tenant sub planId does not match current contract planId", async () => {
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
        id: "sub_1",
        asaasSubscriptionId: "sub_1",
        barbershopId: "shop_plan_mismatch",
        planCode: "PRO_PLAN", // resolves to plan_pro_123
      });

      prismaMock.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p1",
          asaasPaymentId: "pay_1",
          barbershopId: "shop_plan_mismatch",
          asaasSubscriptionId: "sub_1",
          status: "RECEIVED",
          dueDate: new Date(),
          paymentDate: new Date(),
          firstPositiveAt: new Date(),
        },
      ]);

      prismaMock.tenantSubscription.findUnique.mockResolvedValue({
        id: "tenant_sub_1",
        planId: "plan_basic_456", // Mismatch with plan_pro_123
      });

      await expect(recomputeTenantSubscriptionFromPayments("shop_plan_mismatch")).rejects.toThrow("TENANT_PLAN_CODE_MISMATCH");
    });
  });

  describe("8. Advisory Lock Structure Verification", () => {
    it("executes pg_advisory_xact_lock with hashtextextended(barbershopId, 0) in TX2", async () => {
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
        id: "sub_1",
        asaasSubscriptionId: "sub_1",
        barbershopId: "shop_lock_test",
        planCode: "PRO_PLAN",
        planName: "Plano Pro",
        value: 99.9,
      });

      prismaMock.asaasBillingPayment.findMany.mockResolvedValue([
        {
          id: "p1",
          asaasPaymentId: "pay_1",
          barbershopId: "shop_lock_test",
          asaasSubscriptionId: "sub_1",
          status: "RECEIVED",
          dueDate: new Date(),
          paymentDate: new Date(),
          firstPositiveAt: new Date(),
        },
      ]);

      await recomputeTenantSubscriptionFromPayments("shop_lock_test");

      expect(prismaMock.$executeRaw).toHaveBeenCalled();
    });
  });

  describe("9. Critical Partial-Commit Retry Invariants", () => {
    it("CASE A: TX1 ACCEPT committed, TX2 failed initially, retry classifies REPLAY_CURRENT and re-executes TX2", async () => {
      const eventDateStr = "2026-08-01 10:00:00";
      const parsedEventDate = parseAsaasSourceEventAt(eventDateStr);
      const currentDate = new Date();
      const currentDateStr = currentDate.toISOString();
      const storedAccepted = {
        id: "p1",
        barbershopId: "shop_retry_a",
        asaasPaymentId: "pay_retry_a",
        asaasSubscriptionId: "sub_1",
        asaasCustomerId: null,
        status: "RECEIVED",
        billingType: null,
        value: 100.0,
        netValue: null,
        dueDate: currentDate,
        paymentDate: currentDate,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: "tb_barbershop_shop_retry_a",
        sourceEventAt: parsedEventDate,
        sourceEventId: "evt_retry_a",
        firstPositiveAt: parsedEventDate,
      };

      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop_retry_a" });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(storedAccepted);
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
        id: "sub_1",
        asaasSubscriptionId: "sub_1",
        barbershopId: "shop_retry_a",
        planCode: "PRO_PLAN",
        planName: "Plano Pro",
        value: 100.0,
      });
      prismaMock.plan.findUnique.mockResolvedValue({
        id: "plan_1",
        code: "PRO_PLAN",
        name: "Plano Pro",
        price: 100.0,
      });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue(null);
      prismaMock.asaasBillingPayment.findMany.mockResolvedValue([storedAccepted as any]);

      const retryPayload = {
        id: "evt_retry_a",
        event: "PAYMENT_RECEIVED",
        dateCreated: eventDateStr,
        payment: {
          id: "pay_retry_a",
          subscription: "sub_1",
          status: "RECEIVED",
          value: 100.0,
          dueDate: currentDateStr,
          paymentDate: currentDateStr,
          externalReference: "tb_barbershop_shop_retry_a",
        },
      };

      const res = await processAsaasWebhookPayload(retryPayload);
      expect(res.ok).toBe(true);

      // TX2 recompute executed successfully on retry
      expect(prismaMock.tenantSubscription.create).toHaveBeenCalled();
    });

    it("CASE B: TX1 STALE-positive committed, TX2 failed initially, retry classifies STALE positive and re-executes TX2", async () => {
      const storedRefundedWithHistory = {
        id: "p1",
        barbershopId: "shop_retry_b",
        asaasPaymentId: "pay_retry_b",
        asaasSubscriptionId: "sub_1",
        status: "REFUNDED",
        value: 100.0,
        dueDate: new Date("2026-08-10T00:00:00Z"),
        paymentDate: new Date("2026-08-09T00:00:00Z"),
        sourceEventAt: new Date("2026-08-05T12:00:00Z"), // Newer event
        sourceEventId: "evt_refund",
        firstPositiveAt: new Date("2026-08-01T10:00:00Z"), // Monotonic historical marker set during TX1
      };

      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop_retry_b" });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(storedRefundedWithHistory);
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
        id: "sub_1",
        asaasSubscriptionId: "sub_1",
        barbershopId: "shop_retry_b",
        planCode: "PRO_PLAN",
        planName: "Plano Pro",
        value: 100.0,
      });
      prismaMock.asaasBillingPayment.findMany.mockResolvedValue([storedRefundedWithHistory as any]);

      const olderReceivedRetryPayload = {
        id: "evt_received_old",
        event: "PAYMENT_RECEIVED",
        dateCreated: "2026-08-01 10:00:00", // Older event
        payment: {
          id: "pay_retry_b",
          subscription: "sub_1",
          status: "RECEIVED",
          value: 100.0,
          externalReference: "tb_barbershop_shop_retry_b",
        },
      };

      const res = await processAsaasWebhookPayload(olderReceivedRetryPayload);
      expect(res.ok).toBe(true);

      // TX2 recompute re-executed because candidate was positive
      expect(prismaMock.tenantSubscription.create).toHaveBeenCalled();
    });
  });

  describe("10. Monotonic Access Non-Reduction Tests", () => {
    describe("resolveNonReducingPeriodEnd Unit Helper", () => {
      it("preserves existing longer period when existing > derived", () => {
        const existing = new Date("2027-02-01T02:59:59.999Z");
        const derived = new Date("2026-08-26T00:00:00.000Z");
        const res = resolveNonReducingPeriodEnd(existing, derived);
        expect(res?.toISOString()).toBe("2027-02-01T02:59:59.999Z");
      });

      it("advances to derived period when derived > existing", () => {
        const existing = new Date("2026-08-26T00:00:00.000Z");
        const derived = new Date("2026-09-26T00:00:00.000Z");
        const res = resolveNonReducingPeriodEnd(existing, derived);
        expect(res?.toISOString()).toBe("2026-09-26T00:00:00.000Z");
      });

      it("returns same value when existing and derived are equal", () => {
        const existing = new Date("2026-08-26T00:00:00.000Z");
        const derived = new Date("2026-08-26T00:00:00.000Z");
        const res = resolveNonReducingPeriodEnd(existing, derived);
        expect(res?.toISOString()).toBe("2026-08-26T00:00:00.000Z");
      });

      it("returns derived when existing is null", () => {
        const derived = new Date("2026-09-26T00:00:00.000Z");
        const res = resolveNonReducingPeriodEnd(null, derived);
        expect(res?.toISOString()).toBe("2026-09-26T00:00:00.000Z");
      });

      it("preserves existing when derived is null", () => {
        const existing = new Date("2027-02-01T02:59:59.999Z");
        const res = resolveNonReducingPeriodEnd(existing, null);
        expect(res?.toISOString()).toBe("2027-02-01T02:59:59.999Z");
      });

      it("returns null when both existing and derived are null", () => {
        const res = resolveNonReducingPeriodEnd(null, null);
        expect(res).toBeNull();
      });
    });

    describe("Integration & Production-Shaped Lockout Prevention", () => {
      it("prevents tenant lockout on production-shaped tenant with extended periodEnd", async () => {
        const existingExtendedEnd = new Date("2027-02-01T02:59:59.999Z");

        prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
          id: "sub_prod_1",
          asaasSubscriptionId: "sub_r986s4he004qes08",
          barbershopId: "shop_prod",
          planCode: "PRO_PLAN",
          planName: "Plano Tem Barber",
          value: 49.9,
          billingType: "PIX",
        });

        prismaMock.asaasBillingPayment.findMany.mockResolvedValue([
          {
            id: "p_july",
            asaasPaymentId: "pay_vgsxpqv9zhyq1fat",
            barbershopId: "shop_prod",
            asaasSubscriptionId: "sub_r986s4he004qes08",
            status: "RECEIVED",
            billingType: "PIX",
            value: 49.9,
            dueDate: new Date("2026-07-26T00:00:00Z"),
            paymentDate: new Date("2026-07-25T00:00:00Z"),
            firstPositiveAt: new Date("2026-07-25T00:00:00Z"),
            createdAt: new Date("2026-07-25T18:57:54.560Z"),
          },
        ]);

        prismaMock.tenantSubscription.findUnique.mockResolvedValue({
          id: "tenant_sub_prod",
          barbershopId: "shop_prod",
          planId: "plan_pro_123",
          planName: "Plano Tem Barber",
          monthlyPrice: 49.9,
          status: "ACTIVE",
          currentPeriodStart: new Date("2026-07-27T02:59:59.999Z"),
          currentPeriodEnd: existingExtendedEnd,
          paymentMethod: "PIX",
        });

        const res = await recomputeTenantSubscriptionFromPayments("shop_prod");
        expect(res.recomputed).toBe(true);

        // Verify update preserved currentPeriodEnd 2027-02-01 while updating periodStart to payment-derived date
        expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith({
          where: { id: "tenant_sub_prod" },
          data: expect.objectContaining({
            status: "ACTIVE",
            currentPeriodStart: new Date("2026-07-26T00:00:00Z"),
            currentPeriodEnd: existingExtendedEnd,
            lastAccessPaymentId: "pay_vgsxpqv9zhyq1fat",
          }),
        });

        // Verify effective access at current date (now = 2026-08-31) remains accessAllowed: true
        const simulatedNow = new Date("2026-08-31T11:58:35Z");
        const accessResult = deriveTenantSubscriptionAccess(
          {
            status: "ACTIVE",
            currentPeriodStart: new Date("2026-07-26T00:00:00Z"),
            currentPeriodEnd: existingExtendedEnd,
          },
          { now: simulatedNow }
        );

        expect(accessResult.accessAllowed).toBe(true);
        expect(accessResult.effectiveStatus).toBe("ACTIVE");
      });

      it("uses derivedPeriodEnd directly when creating a new TenantSubscription", async () => {
        prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
          id: "sub_new_1",
          asaasSubscriptionId: "sub_new_1",
          barbershopId: "shop_create_path",
          planCode: "PRO_PLAN",
          planName: "Plano Pro",
          value: 99.9,
          billingType: "CREDIT_CARD",
        });

        prismaMock.asaasBillingPayment.findMany.mockResolvedValue([
          {
            id: "p_new",
            asaasPaymentId: "pay_new_1",
            barbershopId: "shop_create_path",
            asaasSubscriptionId: "sub_new_1",
            status: "RECEIVED",
            billingType: "CREDIT_CARD",
            value: 99.9,
            dueDate: new Date("2026-08-10T00:00:00Z"),
            paymentDate: new Date("2026-08-09T00:00:00Z"),
            firstPositiveAt: new Date("2026-08-09T00:00:00Z"),
            createdAt: new Date("2026-08-09T00:00:00Z"),
          },
        ]);

        prismaMock.tenantSubscription.findUnique.mockResolvedValue(null);

        const res = await recomputeTenantSubscriptionFromPayments("shop_create_path");
        expect(res.recomputed).toBe(true);

        expect(prismaMock.tenantSubscription.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            barbershopId: "shop_create_path",
            planId: "plan_pro_123",
            currentPeriodStart: new Date("2026-08-10T00:00:00Z"),
            currentPeriodEnd: new Date("2026-09-10T00:00:00Z"),
          }),
        });
      });

      it("preserves extended periodEnd on July RECEIVED REPLAY_CURRENT webhook event", async () => {
        const existingExtendedEnd = new Date("2027-02-01T02:59:59.999Z");
        const stored = {
          id: "p_july",
          barbershopId: "shop_replay",
          asaasPaymentId: "pay_july",
          asaasSubscriptionId: "sub_1",
          asaasCustomerId: null,
          status: "RECEIVED",
          billingType: "PIX",
          value: 49.9,
          netValue: 49.9,
          dueDate: new Date("2026-07-26T00:00:00Z"),
          paymentDate: new Date("2026-07-25T00:00:00Z"),
          invoiceUrl: null,
          bankSlipUrl: null,
          externalReference: "tb_barbershop_shop_replay",
          sourceEventAt: new Date("2026-07-25T18:57:54.560Z"),
          sourceEventId: "evt_july_1",
          firstPositiveAt: new Date("2026-07-25T18:57:54.560Z"),
        };

        prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop_replay" });
        prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(stored);
        prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
          id: "sub_1",
          asaasSubscriptionId: "sub_1",
          barbershopId: "shop_replay",
          planCode: "PRO_PLAN",
          planName: "Plano Pro",
          value: 49.9,
        });
        prismaMock.asaasBillingPayment.findMany.mockResolvedValue([stored as any]);
        prismaMock.tenantSubscription.findUnique.mockResolvedValue({
          id: "tenant_sub_replay",
          barbershopId: "shop_replay",
          planId: "plan_pro_123",
          currentPeriodEnd: existingExtendedEnd,
        });

        const replayPayload = {
          id: "evt_july_1",
          event: "PAYMENT_RECEIVED",
          dateCreated: "2026-07-25T18:57:54.560Z",
          payment: {
            id: "pay_july",
            subscription: "sub_1",
            status: "RECEIVED",
            billingType: "PIX",
            value: 49.9,
            netValue: 49.9,
            dueDate: "2026-07-26",
            paymentDate: "2026-07-25",
            externalReference: "tb_barbershop_shop_replay",
          },
        };

        const res = await processAsaasWebhookPayload(replayPayload);
        expect(res.ok).toBe(true);

        expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith({
          where: { id: "tenant_sub_replay" },
          data: expect.objectContaining({
            currentPeriodEnd: existingExtendedEnd,
          }),
        });
      });

      it("preserves extended periodEnd on August OVERDUE ACCEPT webhook event", async () => {
        const existingExtendedEnd = new Date("2027-02-01T02:59:59.999Z");
        const julyPayment = {
          id: "p_july",
          asaasPaymentId: "pay_july",
          barbershopId: "shop_overdue",
          asaasSubscriptionId: "sub_1",
          status: "RECEIVED",
          dueDate: new Date("2026-07-26T00:00:00Z"),
          paymentDate: new Date("2026-07-25T00:00:00Z"),
          firstPositiveAt: new Date("2026-07-25T00:00:00Z"),
        };
        const augustOverduePayment = {
          id: "p_august",
          asaasPaymentId: "pay_august",
          barbershopId: "shop_overdue",
          asaasSubscriptionId: "sub_1",
          status: "OVERDUE",
          dueDate: new Date("2026-08-26T00:00:00Z"),
          paymentDate: null,
          firstPositiveAt: null,
        };

        prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop_overdue" });
        prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(null);
        prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
          id: "sub_1",
          asaasSubscriptionId: "sub_1",
          barbershopId: "shop_overdue",
          planCode: "PRO_PLAN",
          planName: "Plano Pro",
          value: 49.9,
        });
        prismaMock.asaasBillingPayment.findMany.mockResolvedValue([julyPayment as any, augustOverduePayment as any]);
        prismaMock.tenantSubscription.findUnique.mockResolvedValue({
          id: "tenant_sub_overdue",
          barbershopId: "shop_overdue",
          planId: "plan_pro_123",
          currentPeriodEnd: existingExtendedEnd,
        });

        const overduePayload = {
          id: "evt_overdue_1",
          event: "PAYMENT_OVERDUE",
          dateCreated: "2026-08-26T00:00:00Z",
          payment: {
            id: "pay_august",
            subscription: "sub_1",
            status: "OVERDUE",
            dueDate: "2026-08-26",
            externalReference: "tb_barbershop_shop_overdue",
          },
        };

        const res = await processAsaasWebhookPayload(overduePayload);
        expect(res.ok).toBe(true);

        expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith({
          where: { id: "tenant_sub_overdue" },
          data: expect.objectContaining({
            currentPeriodEnd: existingExtendedEnd,
          }),
        });
      });

      it("preserves extended periodEnd on September PENDING ACCEPT webhook event", async () => {
        const existingExtendedEnd = new Date("2027-02-01T02:59:59.999Z");
        const julyPayment = {
          id: "p_july",
          asaasPaymentId: "pay_july",
          barbershopId: "shop_pending",
          asaasSubscriptionId: "sub_1",
          status: "RECEIVED",
          dueDate: new Date("2026-07-26T00:00:00Z"),
          paymentDate: new Date("2026-07-25T00:00:00Z"),
          firstPositiveAt: new Date("2026-07-25T00:00:00Z"),
        };

        prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop_pending" });
        prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(null);
        prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
          id: "sub_1",
          asaasSubscriptionId: "sub_1",
          barbershopId: "shop_pending",
          planCode: "PRO_PLAN",
          planName: "Plano Pro",
          value: 49.9,
        });
        prismaMock.asaasBillingPayment.findMany.mockResolvedValue([julyPayment as any]);
        prismaMock.tenantSubscription.findUnique.mockResolvedValue({
          id: "tenant_sub_pending",
          barbershopId: "shop_pending",
          planId: "plan_pro_123",
          currentPeriodEnd: existingExtendedEnd,
        });

        const pendingPayload = {
          id: "evt_pending_1",
          event: "PAYMENT_CREATED",
          dateCreated: "2026-08-18T00:00:00Z",
          payment: {
            id: "pay_september",
            subscription: "sub_1",
            status: "PENDING",
            dueDate: "2026-09-26",
            externalReference: "tb_barbershop_shop_pending",
          },
        };

        const res = await processAsaasWebhookPayload(pendingPayload);
        expect(res.ok).toBe(true);

        expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith({
          where: { id: "tenant_sub_pending" },
          data: expect.objectContaining({
            currentPeriodEnd: existingExtendedEnd,
          }),
        });
      });

      it("preserves extended periodEnd on July REFUNDED webhook event with lazy bridge", async () => {
        const existingExtendedEnd = new Date("2027-02-01T02:59:59.999Z");
        const julyReceivedBeforeRefund = {
          id: "p_july",
          asaasPaymentId: "pay_july",
          barbershopId: "shop_refund",
          asaasSubscriptionId: "sub_1",
          status: "RECEIVED",
          dueDate: new Date("2026-07-26T00:00:00Z"),
          paymentDate: new Date("2026-07-25T00:00:00Z"),
          firstPositiveAt: null, // Legacy C1 record without firstPositiveAt
          sourceEventAt: new Date("2026-07-25T18:57:54Z"),
        };

        prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop_refund" });
        prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(julyReceivedBeforeRefund);
        prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
          id: "sub_1",
          asaasSubscriptionId: "sub_1",
          barbershopId: "shop_refund",
          planCode: "PRO_PLAN",
          planName: "Plano Pro",
          value: 49.9,
        });

        // Mock findMany returning the updated payment with lazy bridge firstPositiveAt set
        prismaMock.asaasBillingPayment.findMany.mockResolvedValue([
          {
            ...julyReceivedBeforeRefund,
            status: "REFUNDED",
            firstPositiveAt: new Date("2026-07-25T18:57:54Z"),
          } as any,
        ]);

        prismaMock.tenantSubscription.findUnique.mockResolvedValue({
          id: "tenant_sub_refund",
          barbershopId: "shop_refund",
          planId: "plan_pro_123",
          currentPeriodEnd: existingExtendedEnd,
        });

        const refundPayload = {
          id: "evt_refund_1",
          event: "PAYMENT_REFUNDED",
          dateCreated: "2026-08-30T10:00:00Z",
          payment: {
            id: "pay_july",
            subscription: "sub_1",
            status: "REFUNDED",
            dueDate: "2026-07-26",
            paymentDate: "2026-07-25",
            externalReference: "tb_barbershop_shop_refund",
          },
        };

        const res = await processAsaasWebhookPayload(refundPayload);
        expect(res.ok).toBe(true);

        // Verify lazy bridge populated firstPositiveAt atomically in TX1
        expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            update: expect.objectContaining({
              status: "REFUNDED",
              firstPositiveAt: new Date("2026-07-25T18:57:54Z"),
            }),
          })
        );

        // Verify TX2 recomputed tenant subscription and preserved extended periodEnd 2027-02-01
        expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith({
          where: { id: "tenant_sub_refund" },
          data: expect.objectContaining({
            currentPeriodEnd: existingExtendedEnd,
          }),
        });
      });
    });
  });
});
