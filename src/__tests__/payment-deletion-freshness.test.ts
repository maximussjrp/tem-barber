import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findUnique: vi.fn() },
    asaasBillingCustomer: { findUnique: vi.fn() },
    asaasBillingSubscription: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    asaasBillingPayment: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    asaasWebhookEvent: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    plan: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    tenantSubscription: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((cb: any) => cb(prismaMock)),
    $executeRaw: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import { processAsaasWebhookPayload } from "@/lib/asaas/webhooks";
import { resolveNonReducingPeriodEnd, selectEligiblePaymentWinner } from "@/lib/asaas/entitlement";
import { AsaasPaymentStatus } from "@prisma/client";

describe("Phase 2.3D1C — Payment Deletion & Restoration Operational Freshness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Freshness Ordering for Deletion & Restoration", () => {
    it("1. stored OVERDUE + newer PAYMENT_DELETED -> ACCEPT -> CANCELED", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-1" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        id: "pay-db-1",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_100",
        asaasSubscriptionId: "sub_100",
        asaasCustomerId: "cus_1",
        status: "OVERDUE",
        billingType: "BOLETO",
        value: 49.9,
        netValue: 47.9,
        dueDate: new Date("2026-08-01T00:00:00Z"),
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: "tb_sub_shop-1_pro_monthly",
        sourceEventAt: new Date("2026-08-01T10:00:00Z"),
        sourceEventId: "evt_100",
        firstPositiveAt: null,
        createdAt: new Date("2026-08-01T10:00:00Z"),
      });

      const res = await processAsaasWebhookPayload({
        id: "evt_200",
        event: "PAYMENT_DELETED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_100",
          customer: "cus_1",
          subscription: "sub_100",
          status: "OVERDUE",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(res.ok).toBe(true);
      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { asaasPaymentId: "pay_100" },
          update: expect.objectContaining({
            status: AsaasPaymentStatus.CANCELED,
            sourceEventAt: new Date("2026-08-02T10:00:00Z"),
            sourceEventId: "evt_200",
          }),
        })
      );
    });

    it("2. stored OVERDUE + older PAYMENT_DELETED -> STALE -> remains OVERDUE", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-2" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        id: "pay-db-1",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_100",
        asaasSubscriptionId: "sub_100",
        asaasCustomerId: "cus_1",
        status: "OVERDUE",
        billingType: "BOLETO",
        value: 49.9,
        netValue: 47.9,
        dueDate: new Date("2026-08-01T00:00:00Z"),
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: "tb_sub_shop-1_pro_monthly",
        sourceEventAt: new Date("2026-08-02T10:00:00Z"),
        sourceEventId: "evt_200",
        firstPositiveAt: null,
        createdAt: new Date("2026-08-01T10:00:00Z"),
      });

      const res = await processAsaasWebhookPayload({
        id: "evt_100",
        event: "PAYMENT_DELETED",
        dateCreated: "2026-08-01T10:00:00Z",
        payment: {
          id: "pay_100",
          customer: "cus_1",
          subscription: "sub_100",
          status: "OVERDUE",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(res.ok).toBe(true);
      expect(res.ignored).toBe(true);
      expect(prismaMock.asaasBillingPayment.upsert).not.toHaveBeenCalled();
    });

    it("3. stored CANCELED + newer PAYMENT_RESTORED status OVERDUE -> ACCEPT -> OVERDUE", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-3" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        id: "pay-db-1",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_100",
        asaasSubscriptionId: "sub_100",
        asaasCustomerId: "cus_1",
        status: AsaasPaymentStatus.CANCELED,
        billingType: "BOLETO",
        value: 49.9,
        netValue: 47.9,
        dueDate: new Date("2026-08-01T00:00:00Z"),
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: "tb_sub_shop-1_pro_monthly",
        sourceEventAt: new Date("2026-08-02T10:00:00Z"),
        sourceEventId: "evt_200",
        firstPositiveAt: null,
        createdAt: new Date("2026-08-01T10:00:00Z"),
      });

      const res = await processAsaasWebhookPayload({
        id: "evt_300",
        event: "PAYMENT_RESTORED",
        dateCreated: "2026-08-03T10:00:00Z",
        payment: {
          id: "pay_100",
          customer: "cus_1",
          subscription: "sub_100",
          status: "OVERDUE",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(res.ok).toBe(true);
      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { asaasPaymentId: "pay_100" },
          update: expect.objectContaining({
            status: AsaasPaymentStatus.OVERDUE,
            sourceEventAt: new Date("2026-08-03T10:00:00Z"),
            sourceEventId: "evt_300",
          }),
        })
      );
    });

    it("4. stored CANCELED + older PAYMENT_RESTORED -> STALE -> remains CANCELED", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-4" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        id: "pay-db-1",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_100",
        asaasSubscriptionId: "sub_100",
        asaasCustomerId: "cus_1",
        status: AsaasPaymentStatus.CANCELED,
        billingType: "BOLETO",
        value: 49.9,
        netValue: 47.9,
        dueDate: new Date("2026-08-01T00:00:00Z"),
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: "tb_sub_shop-1_pro_monthly",
        sourceEventAt: new Date("2026-08-03T10:00:00Z"),
        sourceEventId: "evt_300",
        firstPositiveAt: null,
        createdAt: new Date("2026-08-01T10:00:00Z"),
      });

      const res = await processAsaasWebhookPayload({
        id: "evt_150",
        event: "PAYMENT_RESTORED",
        dateCreated: "2026-08-01T12:00:00Z",
        payment: {
          id: "pay_100",
          customer: "cus_1",
          subscription: "sub_100",
          status: "OVERDUE",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(res.ok).toBe(true);
      expect(res.ignored).toBe(true);
      expect(prismaMock.asaasBillingPayment.upsert).not.toHaveBeenCalled();
    });

    it("5. PAYMENT_DELETED replay -> REPLAY_CURRENT -> canonical zero-write", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-5" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        id: "pay-db-1",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_100",
        asaasSubscriptionId: "sub_100",
        asaasCustomerId: "cus_1",
        status: AsaasPaymentStatus.CANCELED,
        billingType: "BOLETO",
        value: 49.9,
        netValue: 47.9,
        dueDate: new Date("2026-08-01T00:00:00Z"),
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: "tb_sub_shop-1_pro_monthly",
        sourceEventAt: new Date("2026-08-02T10:00:00Z"),
        sourceEventId: "evt_200",
        firstPositiveAt: null,
        createdAt: new Date("2026-08-01T10:00:00Z"),
      });

      const res = await processAsaasWebhookPayload({
        id: "evt_200",
        event: "PAYMENT_DELETED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_100",
          customer: "cus_1",
          subscription: "sub_100",
          status: "OVERDUE",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(res.ok).toBe(true);
      expect(res.ignored).not.toBe(true);
      expect(prismaMock.asaasBillingPayment.upsert).not.toHaveBeenCalled();
    });

    it("6. PAYMENT_RESTORED replay -> REPLAY_CURRENT -> canonical zero-write", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-6" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        id: "pay-db-1",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_100",
        asaasSubscriptionId: "sub_100",
        asaasCustomerId: "cus_1",
        status: AsaasPaymentStatus.OVERDUE,
        billingType: "BOLETO",
        value: 49.9,
        netValue: 47.9,
        dueDate: new Date("2026-08-01T00:00:00Z"),
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: "tb_sub_shop-1_pro_monthly",
        sourceEventAt: new Date("2026-08-03T10:00:00Z"),
        sourceEventId: "evt_300",
        firstPositiveAt: null,
        createdAt: new Date("2026-08-01T10:00:00Z"),
      });

      const res = await processAsaasWebhookPayload({
        id: "evt_300",
        event: "PAYMENT_RESTORED",
        dateCreated: "2026-08-03T10:00:00Z",
        payment: {
          id: "pay_100",
          customer: "cus_1",
          subscription: "sub_100",
          status: "OVERDUE",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(res.ok).toBe(true);
      expect(res.ignored).not.toBe(true);
      expect(prismaMock.asaasBillingPayment.upsert).not.toHaveBeenCalled();
    });

    it("7. same exact watermark + conflicting canonical facts -> PAYMENT_SOURCE_EVENT_CONFLICT", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-7" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        id: "pay-db-1",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_100",
        asaasSubscriptionId: "sub_100",
        asaasCustomerId: "cus_1",
        status: AsaasPaymentStatus.OVERDUE,
        billingType: "BOLETO",
        value: 49.9,
        netValue: 47.9,
        dueDate: new Date("2026-08-01T00:00:00Z"),
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: "tb_sub_shop-1_pro_monthly",
        sourceEventAt: new Date("2026-08-02T10:00:00Z"),
        sourceEventId: "evt_200",
        firstPositiveAt: null,
        createdAt: new Date("2026-08-01T10:00:00Z"),
      });

      const res = await processAsaasWebhookPayload({
        id: "evt_200",
        event: "PAYMENT_DELETED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_100",
          customer: "cus_1",
          subscription: "sub_100",
          status: "OVERDUE",
          value: 99.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(res.error).toBe("PAYMENT_SOURCE_EVENT_CONFLICT");
    });
  });

  describe("2. Event Semantics Override Tests", () => {
    it("8. PAYMENT_DELETED payload.status = OVERDUE -> candidate.status CANCELED", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-8" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(null);

      await processAsaasWebhookPayload({
        id: "evt_800",
        event: "PAYMENT_DELETED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_800",
          customer: "cus_1",
          subscription: "sub_100",
          status: "OVERDUE",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: AsaasPaymentStatus.CANCELED,
          }),
        })
      );
    });

    it("9. PAYMENT_DELETED payload.status = PENDING -> candidate.status CANCELED", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-9" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(null);

      await processAsaasWebhookPayload({
        id: "evt_900",
        event: "PAYMENT_DELETED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_900",
          customer: "cus_1",
          subscription: "sub_100",
          status: "PENDING",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: AsaasPaymentStatus.CANCELED,
          }),
        })
      );
    });

    it("10. PAYMENT_RESTORED payload.status = OVERDUE -> OVERDUE", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-10" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(null);

      await processAsaasWebhookPayload({
        id: "evt_1000",
        event: "PAYMENT_RESTORED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_1000",
          customer: "cus_1",
          subscription: "sub_100",
          status: "OVERDUE",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: AsaasPaymentStatus.OVERDUE,
          }),
        })
      );
    });

    it("11. PAYMENT_RESTORED payload.status = PENDING -> PENDING", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-11" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(null);

      await processAsaasWebhookPayload({
        id: "evt_1100",
        event: "PAYMENT_RESTORED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_1100",
          customer: "cus_1",
          subscription: "sub_100",
          status: "PENDING",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: AsaasPaymentStatus.PENDING,
          }),
        })
      );
    });
  });

  describe("3. Historical Positive Proof & Entitlement Invariants", () => {
    it("12. RECEIVED + firstPositiveAt set -> PAYMENT_DELETED -> CANCELED -> firstPositiveAt unchanged", async () => {
      const positiveDate = new Date("2026-07-25T12:00:00Z");
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-12" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        id: "pay-db-12",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_1200",
        asaasSubscriptionId: "sub_100",
        asaasCustomerId: "cus_1",
        status: "RECEIVED",
        billingType: "CREDIT_CARD",
        value: 49.9,
        netValue: 47.9,
        dueDate: new Date("2026-07-25T00:00:00Z"),
        paymentDate: positiveDate,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: "tb_sub_shop-1_pro_monthly",
        sourceEventAt: positiveDate,
        sourceEventId: "evt_pos_1",
        firstPositiveAt: positiveDate,
        createdAt: positiveDate,
      });

      await processAsaasWebhookPayload({
        id: "evt_del_1",
        event: "PAYMENT_DELETED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_1200",
          customer: "cus_1",
          subscription: "sub_100",
          status: "RECEIVED",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { asaasPaymentId: "pay_1200" },
          update: expect.objectContaining({
            status: AsaasPaymentStatus.CANCELED,
            firstPositiveAt: positiveDate,
          }),
        })
      );
    });

    it("13. CONFIRMED + firstPositiveAt set -> PAYMENT_DELETED -> CANCELED -> firstPositiveAt unchanged", async () => {
      const positiveDate = new Date("2026-07-25T12:00:00Z");
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-13" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        id: "pay-db-13",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_1300",
        asaasSubscriptionId: "sub_100",
        asaasCustomerId: "cus_1",
        status: "CONFIRMED",
        billingType: "CREDIT_CARD",
        value: 49.9,
        netValue: 47.9,
        dueDate: new Date("2026-07-25T00:00:00Z"),
        paymentDate: positiveDate,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: "tb_sub_shop-1_pro_monthly",
        sourceEventAt: positiveDate,
        sourceEventId: "evt_pos_2",
        firstPositiveAt: positiveDate,
        createdAt: positiveDate,
      });

      await processAsaasWebhookPayload({
        id: "evt_del_2",
        event: "PAYMENT_DELETED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_1300",
          customer: "cus_1",
          subscription: "sub_100",
          status: "CONFIRMED",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { asaasPaymentId: "pay_1300" },
          update: expect.objectContaining({
            status: AsaasPaymentStatus.CANCELED,
            firstPositiveAt: positiveDate,
          }),
        })
      );
    });

    it("14. legacy positive + firstPositiveAt NULL -> accepted PAYMENT_DELETED -> existing lazy positive proof behavior preserved", async () => {
      const legacyDate = new Date("2026-07-20T12:00:00Z");
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-14" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        id: "pay-db-14",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_1400",
        asaasSubscriptionId: "sub_100",
        asaasCustomerId: "cus_1",
        status: "RECEIVED",
        billingType: "CREDIT_CARD",
        value: 49.9,
        netValue: 47.9,
        dueDate: legacyDate,
        paymentDate: legacyDate,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: "tb_sub_shop-1_pro_monthly",
        sourceEventAt: legacyDate,
        sourceEventId: "evt_pos_legacy",
        firstPositiveAt: null,
        createdAt: legacyDate,
      });

      await processAsaasWebhookPayload({
        id: "evt_del_legacy",
        event: "PAYMENT_DELETED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_1400",
          customer: "cus_1",
          subscription: "sub_100",
          status: "RECEIVED",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { asaasPaymentId: "pay_1400" },
          update: expect.objectContaining({
            status: AsaasPaymentStatus.CANCELED,
            firstPositiveAt: legacyDate,
          }),
        })
      );
    });

    it("15. CANCELED + firstPositiveAt != null -> remains eligible for historical entitlement in selectEligiblePaymentWinner", () => {
      const positiveDate = new Date("2026-07-25T12:00:00Z");
      const payments = [
        {
          id: "pay-1",
          asaasPaymentId: "pay_1",
          barbershopId: "shop-1",
          asaasSubscriptionId: "sub_1",
          status: AsaasPaymentStatus.CANCELED,
          billingType: "CREDIT_CARD",
          value: 49.9,
          dueDate: new Date("2026-07-25T00:00:00Z"),
          paymentDate: positiveDate,
          firstPositiveAt: positiveDate,
          createdAt: positiveDate,
        },
      ];

      const winner = selectEligiblePaymentWinner(payments);
      expect(winner).not.toBeNull();
      expect(winner?.id).toBe("pay-1");
    });

    it("16. currentPeriodEnd is not reduced when positive payment becomes CANCELED", () => {
      const existingFutureDate = new Date("2026-12-31T23:59:59Z");
      const derivedShorterDate = new Date("2026-08-25T00:00:00Z");

      const preserved = resolveNonReducingPeriodEnd(existingFutureDate, derivedShorterDate);
      expect(preserved).toEqual(existingFutureDate);
    });
  });

  describe("4. Ownership & Creation Edge Case Verification", () => {
    it("17. payment subscription identity mismatch still fails", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-17" });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        id: "pay-db-17",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_1700",
        asaasSubscriptionId: "sub_ORIGINAL",
        asaasCustomerId: "cus_1",
        status: "PENDING",
        billingType: "BOLETO",
        value: 49.9,
        netValue: null,
        dueDate: null,
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: "tb_sub_shop-1_pro_monthly",
        sourceEventAt: null,
        sourceEventId: null,
        firstPositiveAt: null,
        createdAt: new Date(),
      });

      const res = await processAsaasWebhookPayload({
        id: "evt_1700",
        event: "PAYMENT_DELETED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_1700",
          customer: "cus_1",
          subscription: "sub_DIFFERENT",
          status: "PENDING",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(res.error).toBe("PAYMENT_SUBSCRIPTION_MISMATCH");
    });

    it("18. PAYMENT_DELETED causes 0 AsaasBillingSubscription writes", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-18" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(null);

      await processAsaasWebhookPayload({
        id: "evt_1800",
        event: "PAYMENT_DELETED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_1800",
          customer: "cus_1",
          subscription: "sub_100",
          status: "OVERDUE",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(prismaMock.asaasBillingSubscription.update).not.toHaveBeenCalled();
    });

    it("19. PAYMENT_RESTORED causes 0 AsaasBillingSubscription writes", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-19" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(null);

      await processAsaasWebhookPayload({
        id: "evt_1900",
        event: "PAYMENT_RESTORED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_1900",
          customer: "cus_1",
          subscription: "sub_100",
          status: "OVERDUE",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(prismaMock.asaasBillingSubscription.update).not.toHaveBeenCalled();
    });

    it("20. no existing local payment + valid PAYMENT_DELETED -> ACCEPT -> creates canonical payment with status CANCELED", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-20" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_100",
      });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(null);

      await processAsaasWebhookPayload({
        id: "evt_2000",
        event: "PAYMENT_DELETED",
        dateCreated: "2026-08-02T10:00:00Z",
        payment: {
          id: "pay_2000",
          customer: "cus_1",
          subscription: "sub_100",
          status: "OVERDUE",
          value: 49.9,
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            asaasPaymentId: "pay_2000",
            status: AsaasPaymentStatus.CANCELED,
            sourceEventAt: new Date("2026-08-02T10:00:00Z"),
            sourceEventId: "evt_2000",
          }),
        })
      );
    });
  });
});
