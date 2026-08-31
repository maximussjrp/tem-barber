import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  CandidateSubscriptionFacts,
  classifySubscriptionFreshness,
  StoredSubscriptionSnapshot,
} from "@/lib/asaas/mappers";
import { processAsaasWebhookPayload } from "@/lib/asaas/webhooks";
import { AsaasSubscriptionStatus } from "@prisma/client";

describe("Phase 2.3D1B — Subscription Webhook Freshness & Strict Ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Pure Freshness Classifier (classifySubscriptionFreshness)", () => {
    const baseStored: StoredSubscriptionSnapshot = {
      id: "sub-db-1",
      barbershopId: "shop-1",
      asaasSubscriptionId: "sub_asaas_1",
      asaasCustomerId: "cus_1",
      planCode: "pro_monthly",
      planName: "Plano Tem Barber",
      value: 49.9,
      cycle: "MONTHLY",
      status: "ACTIVE" as AsaasSubscriptionStatus,
      nextDueDate: new Date("2026-09-01T00:00:00Z"),
      billingType: "CREDIT_CARD",
      externalReference: "barbershopId:shop-1",
      canceledAt: null,
      sourceEventAt: new Date("2026-08-31T10:00:00Z"),
      sourceEventId: "evt_100",
    };

    it("no stored -> ACCEPT", () => {
      const candidate: CandidateSubscriptionFacts = {
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_asaas_1",
        status: "ACTIVE" as AsaasSubscriptionStatus,
        nextDueDate: new Date("2026-09-01T00:00:00Z"),
        billingType: "CREDIT_CARD",
        canceledAt: null,
        sourceEventAt: new Date("2026-08-31T10:00:00Z"),
        sourceEventId: "evt_100",
      };
      expect(classifySubscriptionFreshness(null, candidate)).toBe("ACCEPT");
    });

    it("historical unwatermarked + incoming watermarked -> ACCEPT", () => {
      const storedUnwatermarked: StoredSubscriptionSnapshot = {
        ...baseStored,
        sourceEventAt: null,
        sourceEventId: null,
      };
      const candidate: CandidateSubscriptionFacts = {
        ...baseStored,
        sourceEventAt: new Date("2026-08-31T10:00:00Z"),
        sourceEventId: "evt_100",
      };
      expect(classifySubscriptionFreshness(storedUnwatermarked, candidate)).toBe("ACCEPT");
    });

    it("historical unwatermarked + incoming unwatermarked -> STALE", () => {
      const storedUnwatermarked: StoredSubscriptionSnapshot = {
        ...baseStored,
        sourceEventAt: null,
        sourceEventId: null,
      };
      const candidate: CandidateSubscriptionFacts = {
        ...baseStored,
        sourceEventAt: null,
        sourceEventId: null,
      };
      expect(classifySubscriptionFreshness(storedUnwatermarked, candidate)).toBe("STALE");
    });

    it("newer timestamp -> ACCEPT", () => {
      const candidate: CandidateSubscriptionFacts = {
        ...baseStored,
        sourceEventAt: new Date("2026-08-31T11:00:00Z"),
        sourceEventId: "evt_101",
      };
      expect(classifySubscriptionFreshness(baseStored, candidate)).toBe("ACCEPT");
    });

    it("older timestamp -> STALE", () => {
      const candidate: CandidateSubscriptionFacts = {
        ...baseStored,
        sourceEventAt: new Date("2026-08-31T09:00:00Z"),
        sourceEventId: "evt_099",
      };
      expect(classifySubscriptionFreshness(baseStored, candidate)).toBe("STALE");
    });

    it("same timestamp higher eventId -> ACCEPT", () => {
      const candidate: CandidateSubscriptionFacts = {
        ...baseStored,
        sourceEventAt: new Date("2026-08-31T10:00:00Z"),
        sourceEventId: "evt_101",
      };
      expect(classifySubscriptionFreshness(baseStored, candidate)).toBe("ACCEPT");
    });

    it("same timestamp lower eventId -> STALE", () => {
      const candidate: CandidateSubscriptionFacts = {
        ...baseStored,
        sourceEventAt: new Date("2026-08-31T10:00:00Z"),
        sourceEventId: "evt_099",
      };
      expect(classifySubscriptionFreshness(baseStored, candidate)).toBe("STALE");
    });

    it("same watermark equal facts -> REPLAY_CURRENT", () => {
      const candidate: CandidateSubscriptionFacts = {
        ...baseStored,
        sourceEventAt: new Date("2026-08-31T10:00:00Z"),
        sourceEventId: "evt_100",
      };
      expect(classifySubscriptionFreshness(baseStored, candidate)).toBe("REPLAY_CURRENT");
    });

    it("same watermark different facts -> CONFLICT", () => {
      const candidate: CandidateSubscriptionFacts = {
        ...baseStored,
        status: "INACTIVE" as AsaasSubscriptionStatus,
        sourceEventAt: new Date("2026-08-31T10:00:00Z"),
        sourceEventId: "evt_100",
      };
      expect(classifySubscriptionFreshness(baseStored, candidate)).toBe("CONFLICT");
    });

    it("stored watermark + incoming missing -> STALE", () => {
      const candidate: CandidateSubscriptionFacts = {
        ...baseStored,
        sourceEventAt: null,
        sourceEventId: null,
      };
      expect(classifySubscriptionFreshness(baseStored, candidate)).toBe("STALE");
    });
  });

  describe("2. Terminal Deletion Invariants (DELETE Dominance)", () => {
    const activeStored: StoredSubscriptionSnapshot = {
      id: "sub-db-1",
      barbershopId: "shop-1",
      asaasSubscriptionId: "sub_asaas_1",
      asaasCustomerId: "cus_1",
      planCode: "pro_monthly",
      planName: "Plano Tem Barber",
      value: 49.9,
      cycle: "MONTHLY",
      status: "ACTIVE" as AsaasSubscriptionStatus,
      nextDueDate: new Date("2026-09-01T00:00:00Z"),
      billingType: "CREDIT_CARD",
      externalReference: "barbershopId:shop-1",
      canceledAt: null,
      sourceEventAt: new Date("2026-08-31T12:00:00Z"),
      sourceEventId: "evt_200",
    };

    it("ACTIVE stored, newer DELETE arrives -> ACCEPT", () => {
      const deleteCandidate: CandidateSubscriptionFacts = {
        ...activeStored,
        status: "INACTIVE" as AsaasSubscriptionStatus,
        canceledAt: new Date("2026-08-31T13:00:00Z"),
        sourceEventAt: new Date("2026-08-31T13:00:00Z"),
        sourceEventId: "evt_201",
        isDeleteEvent: true,
      };
      expect(classifySubscriptionFreshness(activeStored, deleteCandidate)).toBe("ACCEPT");
    });

    it("ACTIVE stored, older DELETE arrives -> ACCEPT (Delete Dominance)", () => {
      const olderDeleteCandidate: CandidateSubscriptionFacts = {
        ...activeStored,
        status: "INACTIVE" as AsaasSubscriptionStatus,
        canceledAt: new Date("2026-08-31T10:00:00Z"),
        sourceEventAt: new Date("2026-08-31T10:00:00Z"),
        sourceEventId: "evt_150",
        isDeleteEvent: true,
      };
      expect(classifySubscriptionFreshness(activeStored, olderDeleteCandidate)).toBe("ACCEPT");
    });

    it("DELETE stored, newer ACTIVE arrives -> STALE (remains DELETED)", () => {
      const deletedStored: StoredSubscriptionSnapshot = {
        ...activeStored,
        status: "INACTIVE" as AsaasSubscriptionStatus,
        canceledAt: new Date("2026-08-31T13:00:00Z"),
        sourceEventAt: new Date("2026-08-31T13:00:00Z"),
        sourceEventId: "evt_201",
      };
      const newerActiveCandidate: CandidateSubscriptionFacts = {
        ...activeStored,
        status: "ACTIVE" as AsaasSubscriptionStatus,
        sourceEventAt: new Date("2026-08-31T14:00:00Z"),
        sourceEventId: "evt_202",
        isDeleteEvent: false,
      };
      expect(classifySubscriptionFreshness(deletedStored, newerActiveCandidate)).toBe("STALE");
    });

    it("DELETE stored, older ACTIVE arrives -> STALE (remains DELETED)", () => {
      const deletedStored: StoredSubscriptionSnapshot = {
        ...activeStored,
        status: "INACTIVE" as AsaasSubscriptionStatus,
        canceledAt: new Date("2026-08-31T13:00:00Z"),
        sourceEventAt: new Date("2026-08-31T13:00:00Z"),
        sourceEventId: "evt_201",
      };
      const olderActiveCandidate: CandidateSubscriptionFacts = {
        ...activeStored,
        status: "ACTIVE" as AsaasSubscriptionStatus,
        sourceEventAt: new Date("2026-08-31T10:00:00Z"),
        sourceEventId: "evt_150",
        isDeleteEvent: false,
      };
      expect(classifySubscriptionFreshness(deletedStored, olderActiveCandidate)).toBe("STALE");
    });

    it("DELETE vs ACTIVE opposite arrival orders converge to DELETED", () => {
      const stepA = classifySubscriptionFreshness(activeStored, {
        ...activeStored,
        canceledAt: new Date("2026-08-31T10:00:00Z"),
        sourceEventAt: new Date("2026-08-31T10:00:00Z"),
        sourceEventId: "evt_150",
        isDeleteEvent: true,
      });
      expect(stepA).toBe("ACCEPT");

      const stepB = classifySubscriptionFreshness(
        {
          ...activeStored,
          canceledAt: new Date("2026-08-31T10:00:00Z"),
          sourceEventAt: new Date("2026-08-31T10:00:00Z"),
          sourceEventId: "evt_150",
        },
        {
          ...activeStored,
          status: "ACTIVE" as AsaasSubscriptionStatus,
          sourceEventAt: new Date("2026-08-31T12:00:00Z"),
          sourceEventId: "evt_200",
          isDeleteEvent: false,
        }
      );
      expect(stepB).toBe("STALE");
    });
  });

  describe("3. Production Regression & Strict Ownership", () => {
    it("PAYMENT events write ZERO fields to AsaasBillingSubscription", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "evt-db-1" });
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue(null);
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_asaas_1",
        status: "ACTIVE",
        billingType: "CREDIT_CARD",
        canceledAt: null,
      });
      prismaMock.asaasBillingPayment.upsert.mockResolvedValue({ id: "pay-db-1" });
      prismaMock.asaasBillingPayment.findMany.mockResolvedValue([]);
      prismaMock.tenantSubscription.findUnique.mockResolvedValue(null);

      const result = await processAsaasWebhookPayload({
        id: "evt_pay_1",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_1",
          customer: "cus_1",
          subscription: "sub_asaas_1",
          value: 49.9,
          status: "RECEIVED",
          externalReference: "barbershopId:shop-1",
        },
      });

      expect(result.ok).toBe(true);
      expect(prismaMock.asaasBillingSubscription.update).not.toHaveBeenCalled();
    });

    it("Historical tombstoned subscription with NULL watermarks does NOT reactivate on SUBSCRIPTION_UPDATED ACTIVE", async () => {
      const historicalTombstoned: StoredSubscriptionSnapshot = {
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_asaas_1",
        asaasCustomerId: "cus_1",
        planCode: "pro_monthly",
        planName: "Plano Tem Barber",
        value: 49.9,
        cycle: "MONTHLY",
        status: "OVERDUE" as AsaasSubscriptionStatus,
        nextDueDate: new Date("2026-09-01T00:00:00Z"),
        billingType: "CREDIT_CARD",
        externalReference: "barbershopId:shop-1",
        canceledAt: new Date("2026-08-20T00:00:00Z"),
        sourceEventAt: null,
        sourceEventId: null,
      };

      const activeIncoming: CandidateSubscriptionFacts = {
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_asaas_1",
        status: "ACTIVE" as AsaasSubscriptionStatus,
        nextDueDate: new Date("2026-10-01T00:00:00Z"),
        billingType: "CREDIT_CARD",
        canceledAt: null,
        sourceEventAt: new Date("2026-08-31T14:00:00Z"),
        sourceEventId: "evt_300",
        isDeleteEvent: false,
      };

      expect(classifySubscriptionFreshness(historicalTombstoned, activeIncoming)).toBe("STALE");
    });

    it("Uses subscription advisory lock namespace 2 in $transaction", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "evt-db-1" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_asaas_1",
        status: "ACTIVE",
        billingType: "CREDIT_CARD",
        canceledAt: null,
        sourceEventAt: null,
        sourceEventId: null,
      });

      await processAsaasWebhookPayload({
        id: "evt_sub_1",
        event: "SUBSCRIPTION_UPDATED",
        subscription: {
          id: "sub_asaas_1",
          customer: "cus_1",
          status: "ACTIVE",
          value: 49.9,
          externalReference: "barbershopId:shop-1",
        },
      });

      expect(prismaMock.$executeRaw).toHaveBeenCalled();
    });
  });

  describe("4. Mandatory Corrections 1-4 Verification Tests", () => {
    it("A. sourceEventId comes from webhook payload.id, NOT subscription.id", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "evt-db-1", receivedAt: new Date() });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_ABC",
        status: "ACTIVE",
        billingType: "CREDIT_CARD",
        canceledAt: null,
        sourceEventAt: null,
        sourceEventId: null,
      });

      await processAsaasWebhookPayload({
        id: "evt_500",
        event: "SUBSCRIPTION_UPDATED",
        dateCreated: "2026-08-31T15:00:00Z",
        subscription: {
          id: "sub_ABC",
          customer: "cus_1",
          status: "ACTIVE",
          value: 49.9,
          externalReference: "barbershopId:shop-1",
        },
      });

      expect(prismaMock.asaasBillingSubscription.update).toHaveBeenCalledWith({
        where: { id: "sub-db-1" },
        data: expect.objectContaining({
          sourceEventId: "evt_500",
        }),
      });
      const updateData = prismaMock.asaasBillingSubscription.update.mock.calls[0][0].data;
      expect(updateData.sourceEventId).not.toBe("sub_ABC");
    });

    it("B. sourceEventAt uses top-level payload.dateCreated, NEVER subscription.dateCreated", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "evt-db-1", receivedAt: new Date() });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_ABC",
        status: "ACTIVE",
        billingType: "CREDIT_CARD",
        canceledAt: null,
        sourceEventAt: null,
        sourceEventId: null,
      });

      await processAsaasWebhookPayload({
        id: "evt_501",
        event: "SUBSCRIPTION_UPDATED",
        dateCreated: "2026-08-31T15:00:00Z",
        subscription: {
          id: "sub_ABC",
          dateCreated: "2026-01-01T00:00:00Z",
          customer: "cus_1",
          status: "ACTIVE",
          value: 49.9,
          externalReference: "barbershopId:shop-1",
        },
      });

      expect(prismaMock.asaasBillingSubscription.update).toHaveBeenCalledWith({
        where: { id: "sub-db-1" },
        data: expect.objectContaining({
          sourceEventAt: new Date("2026-08-31T15:00:00Z"),
        }),
      });
      const updateData = prismaMock.asaasBillingSubscription.update.mock.calls[0][0].data;
      expect(updateData.sourceEventAt).not.toEqual(new Date("2026-01-01T00:00:00Z"));
    });

    it("C. top-level payload.dateCreated invalid does NOT fallback to subscription.dateCreated", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "evt-db-1", receivedAt: new Date() });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_ABC",
        status: "ACTIVE",
        billingType: "CREDIT_CARD",
        canceledAt: null,
        sourceEventAt: null,
        sourceEventId: null,
      });

      await processAsaasWebhookPayload({
        id: "evt_502",
        event: "SUBSCRIPTION_UPDATED",
        dateCreated: "invalid-date",
        subscription: {
          id: "sub_ABC",
          dateCreated: "2026-01-01T00:00:00Z",
          customer: "cus_1",
          status: "ACTIVE",
          value: 49.9,
          externalReference: "barbershopId:shop-1",
        },
      });

      expect(prismaMock.asaasBillingSubscription.update).toHaveBeenCalledWith({
        where: { id: "sub-db-1" },
        data: expect.objectContaining({
          sourceEventAt: null,
        }),
      });
    });

    it("D. non-delete event with subscription.deleted = true sets isDeleteEvent = false", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "evt-db-1", receivedAt: new Date() });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_ABC",
        status: "ACTIVE",
        billingType: "CREDIT_CARD",
        canceledAt: null,
        sourceEventAt: null,
        sourceEventId: null,
      });

      await processAsaasWebhookPayload({
        id: "evt_503",
        event: "SUBSCRIPTION_UPDATED",
        dateCreated: "2026-08-31T15:00:00Z",
        subscription: {
          id: "sub_ABC",
          customer: "cus_1",
          status: "ACTIVE",
          deleted: true,
          externalReference: "barbershopId:shop-1",
        },
      });

      expect(prismaMock.asaasBillingSubscription.update).toHaveBeenCalledWith({
        where: { id: "sub-db-1" },
        data: expect.objectContaining({
          canceledAt: null,
        }),
      });
    });

    it("E. invalid dateCreated DELETE on stored watermarked row persists sourceEventAt = null", async () => {
      const receivedDate = new Date("2026-08-31T16:00:00Z");
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "evt-db-1", receivedAt: receivedDate });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_ABC",
        status: "ACTIVE",
        billingType: "CREDIT_CARD",
        canceledAt: null,
        sourceEventAt: new Date("2026-08-31T12:00:00Z"),
        sourceEventId: "evt_200",
      });

      await processAsaasWebhookPayload({
        id: "evt_300",
        event: "SUBSCRIPTION_DELETED",
        dateCreated: "invalid-date-string",
        subscription: {
          id: "sub_ABC",
          customer: "cus_1",
          status: "INACTIVE",
          externalReference: "barbershopId:shop-1",
        },
      });

      expect(prismaMock.asaasBillingSubscription.update).toHaveBeenCalledWith({
        where: { id: "sub-db-1" },
        data: expect.objectContaining({
          status: "INACTIVE",
          canceledAt: receivedDate,
          sourceEventAt: null,
          sourceEventId: "evt_300",
        }),
      });
    });

    it("F. event ID tie-break uses payload.id across events with same payload.dateCreated and same subscription.id", () => {
      const stored: StoredSubscriptionSnapshot = {
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_same_id",
        asaasCustomerId: "cus_1",
        planCode: "pro_monthly",
        planName: "Plano Tem Barber",
        value: 49.9,
        cycle: "MONTHLY",
        status: "ACTIVE" as AsaasSubscriptionStatus,
        nextDueDate: new Date("2026-09-01T00:00:00Z"),
        billingType: "CREDIT_CARD",
        externalReference: "barbershopId:shop-1",
        canceledAt: null,
        sourceEventAt: new Date("2026-08-31T15:00:00Z"),
        sourceEventId: "evt_100",
      };

      const candidateHigherId: CandidateSubscriptionFacts = {
        ...stored,
        sourceEventAt: new Date("2026-08-31T15:00:00Z"),
        sourceEventId: "evt_200",
      };

      const candidateLowerId: CandidateSubscriptionFacts = {
        ...stored,
        sourceEventAt: new Date("2026-08-31T15:00:00Z"),
        sourceEventId: "evt_050",
      };

      expect(classifySubscriptionFreshness(stored, candidateHigherId)).toBe("ACCEPT");
      expect(classifySubscriptionFreshness(stored, candidateLowerId)).toBe("STALE");
    });
  });
});
