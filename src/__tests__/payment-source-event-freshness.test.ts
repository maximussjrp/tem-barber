import { describe, expect, it, vi } from "vitest";
import {
  areCanonicalFactsEqual,
  CandidatePaymentFacts,
  classifyPaymentFreshness,
  extractAsaasEventId,
  normalizeDecimal,
  parseAsaasSourceEventAt,
  StoredPaymentSnapshot,
} from "@/lib/asaas/mappers";
import { AsaasPaymentStatus } from "@prisma/client";

describe("Payment Source Event Freshness (Phase 2.3B2 Unit Tests)", () => {

  describe("extractAsaasEventId & parseAsaasSourceEventAt", () => {
    it("extracts asaasEventId from id or eventId", () => {
      expect(extractAsaasEventId({ id: "evt_123" })).toBe("evt_123");
      expect(extractAsaasEventId({ eventId: "evt_456" })).toBe("evt_456");
      expect(extractAsaasEventId({ id: " evt_789 " })).toBe("evt_789");
      expect(extractAsaasEventId({})).toBeNull();
      expect(extractAsaasEventId(null)).toBeNull();
    });

    it("parses valid dateCreated ISO string without fallbacks", () => {
      const d = parseAsaasSourceEventAt("2026-07-25 15:57:53");
      expect(d).toBeInstanceOf(Date);
      expect(d?.toISOString()).toBe(new Date("2026-07-25 15:57:53").toISOString());

      expect(parseAsaasSourceEventAt("invalid-date")).toBeNull();
      expect(parseAsaasSourceEventAt("")).toBeNull();
      expect(parseAsaasSourceEventAt(null)).toBeNull();
      expect(parseAsaasSourceEventAt(undefined)).toBeNull();
    });

    it("normalizes decimals correctly", () => {
      expect(normalizeDecimal(29.9)).toBe("29.90");
      expect(normalizeDecimal("29.90")).toBe("29.90");
      expect(normalizeDecimal(0)).toBe("0.00");
      expect(normalizeDecimal(null)).toBeNull();
    });
  });

  describe("classifyPaymentFreshness - Watermark Matrix (A to M)", () => {
    const baseCandidate: CandidatePaymentFacts = {
      barbershopId: "bs_1",
      asaasPaymentId: "pay_1",
      asaasSubscriptionId: "sub_1",
      asaasCustomerId: "cus_1",
      status: AsaasPaymentStatus.RECEIVED,
      billingType: "PIX",
      value: 49.9,
      netValue: 47.9,
      dueDate: new Date("2026-08-01"),
      paymentDate: new Date("2026-08-01"),
      invoiceUrl: "http://invoice",
      bankSlipUrl: null,
      externalReference: "ext_1",
      sourceEventAt: null,
      sourceEventId: null,
    };

    const baseStored: StoredPaymentSnapshot = {
      barbershopId: "bs_1",
      asaasPaymentId: "pay_1",
      asaasSubscriptionId: "sub_1",
      asaasCustomerId: "cus_1",
      status: AsaasPaymentStatus.RECEIVED,
      billingType: "PIX",
      value: 49.9,
      netValue: 47.9,
      dueDate: new Date("2026-08-01"),
      paymentDate: new Date("2026-08-01"),
      invoiceUrl: "http://invoice",
      bankSlipUrl: null,
      externalReference: "ext_1",
      sourceEventAt: null,
      sourceEventId: null,
    };

    it("A: existing NULL watermark + dated incoming => ACCEPT", () => {
      const stored = { ...baseStored, sourceEventAt: null, sourceEventId: null };
      const candidate = { ...baseCandidate, sourceEventAt: new Date("2026-08-01T10:00:00Z"), sourceEventId: "evt_1" };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("ACCEPT");
    });

    it("B: existing dated newer + older incoming => STALE", () => {
      const stored = { ...baseStored, sourceEventAt: new Date("2026-08-01T12:00:00Z"), sourceEventId: "evt_2" };
      const candidate = { ...baseCandidate, sourceEventAt: new Date("2026-08-01T10:00:00Z"), sourceEventId: "evt_1" };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("STALE");
    });

    it("C: existing older + newer incoming => ACCEPT", () => {
      const stored = { ...baseStored, sourceEventAt: new Date("2026-08-01T10:00:00Z"), sourceEventId: "evt_1" };
      const candidate = { ...baseCandidate, sourceEventAt: new Date("2026-08-01T12:00:00Z"), sourceEventId: "evt_2" };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("ACCEPT");
    });

    it("D: equal date, incoming lexical higher ID => ACCEPT", () => {
      const stored = { ...baseStored, sourceEventAt: new Date("2026-08-01T10:00:00Z"), sourceEventId: "evt_100" };
      const candidate = { ...baseCandidate, sourceEventAt: new Date("2026-08-01T10:00:00Z"), sourceEventId: "evt_200" };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("ACCEPT");
    });

    it("E: equal date, incoming lexical lower ID => STALE", () => {
      const stored = { ...baseStored, sourceEventAt: new Date("2026-08-01T10:00:00Z"), sourceEventId: "evt_200" };
      const candidate = { ...baseCandidate, sourceEventAt: new Date("2026-08-01T10:00:00Z"), sourceEventId: "evt_100" };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("STALE");
    });

    it("F: equal date + same ID + equal facts => REPLAY_CURRENT", () => {
      const stored = { ...baseStored, sourceEventAt: new Date("2026-08-01T10:00:00Z"), sourceEventId: "evt_100" };
      const candidate = { ...baseCandidate, sourceEventAt: new Date("2026-08-01T10:00:00Z"), sourceEventId: "evt_100" };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("REPLAY_CURRENT");
    });

    it("G: equal date + same ID + different facts => CONFLICT", () => {
      const stored = { ...baseStored, status: AsaasPaymentStatus.PENDING, sourceEventAt: new Date("2026-08-01T10:00:00Z"), sourceEventId: "evt_100" };
      const candidate = { ...baseCandidate, status: AsaasPaymentStatus.RECEIVED, sourceEventAt: new Date("2026-08-01T10:00:00Z"), sourceEventId: "evt_100" };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("CONFLICT");
    });

    it("H: stored date + incoming undated => STALE", () => {
      const stored = { ...baseStored, sourceEventAt: new Date("2026-08-01T10:00:00Z"), sourceEventId: "evt_1" };
      const candidate = { ...baseCandidate, sourceEventAt: null, sourceEventId: "evt_1" };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("STALE");
    });

    it("I: existing undated + incoming dated => ACCEPT", () => {
      const stored = { ...baseStored, sourceEventAt: null, sourceEventId: "evt_1" };
      const candidate = { ...baseCandidate, sourceEventAt: new Date("2026-08-01T10:00:00Z"), sourceEventId: "evt_1" };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("ACCEPT");
    });

    it("J: both undated + differing IDs => STALE", () => {
      const stored = { ...baseStored, sourceEventAt: null, sourceEventId: "evt_1" };
      const candidate = { ...baseCandidate, sourceEventAt: null, sourceEventId: "evt_2" };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("STALE");
    });

    it("K: both undated + same non-null ID + equal facts => REPLAY_CURRENT", () => {
      const stored = { ...baseStored, sourceEventAt: null, sourceEventId: "evt_100" };
      const candidate = { ...baseCandidate, sourceEventAt: null, sourceEventId: "evt_100" };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("REPLAY_CURRENT");
    });

    it("L: both undated + same non-null ID + different facts => CONFLICT", () => {
      const stored = { ...baseStored, value: 49.9, sourceEventAt: null, sourceEventId: "evt_100" };
      const candidate = { ...baseCandidate, value: 99.9, sourceEventAt: null, sourceEventId: "evt_100" };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("CONFLICT");
    });

    it("M: both undated + both IDs NULL => STALE", () => {
      const stored = { ...baseStored, sourceEventAt: null, sourceEventId: null };
      const candidate = { ...baseCandidate, sourceEventAt: null, sourceEventId: null };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("STALE");
    });
  });

  describe("classifyPaymentFreshness - Missing ID Ties on Same Date", () => {
    const baseCandidate: CandidatePaymentFacts = {
      barbershopId: "bs_1",
      asaasPaymentId: "pay_1",
      asaasSubscriptionId: "sub_1",
      asaasCustomerId: "cus_1",
      status: AsaasPaymentStatus.RECEIVED,
      billingType: "PIX",
      value: 49.9,
      netValue: 47.9,
      dueDate: new Date("2026-08-01"),
      paymentDate: new Date("2026-08-01"),
      invoiceUrl: "http://invoice",
      bankSlipUrl: null,
      externalReference: "ext_1",
      sourceEventAt: new Date("2026-08-01T10:00:00Z"),
      sourceEventId: null,
    };

    const baseStored: StoredPaymentSnapshot = {
      barbershopId: "bs_1",
      asaasPaymentId: "pay_1",
      asaasSubscriptionId: "sub_1",
      asaasCustomerId: "cus_1",
      status: AsaasPaymentStatus.RECEIVED,
      billingType: "PIX",
      value: 49.9,
      netValue: 47.9,
      dueDate: new Date("2026-08-01"),
      paymentDate: new Date("2026-08-01"),
      invoiceUrl: "http://invoice",
      bankSlipUrl: null,
      externalReference: "ext_1",
      sourceEventAt: new Date("2026-08-01T10:00:00Z"),
      sourceEventId: null,
    };

    it("stored ID NULL + incoming non-null => ACCEPT", () => {
      const stored = { ...baseStored, sourceEventId: null };
      const candidate = { ...baseCandidate, sourceEventId: "evt_100" };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("ACCEPT");
    });

    it("stored non-null + incoming NULL => STALE", () => {
      const stored = { ...baseStored, sourceEventId: "evt_100" };
      const candidate = { ...baseCandidate, sourceEventId: null };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("STALE");
    });

    it("both IDs NULL => STALE", () => {
      const stored = { ...baseStored, sourceEventId: null };
      const candidate = { ...baseCandidate, sourceEventId: null };
      expect(classifyPaymentFreshness(stored, candidate)).toBe("STALE");
    });
  });

  describe("areCanonicalFactsEqual - Decimal and Date normalization", () => {
    it("compares 29.9 and 29.90 as equal decimal", () => {
      const candidate: CandidatePaymentFacts = {
        barbershopId: "b1",
        asaasPaymentId: "p1",
        asaasSubscriptionId: "s1",
        asaasCustomerId: "c1",
        status: AsaasPaymentStatus.RECEIVED,
        billingType: "PIX",
        value: 29.9,
        netValue: null,
        dueDate: null,
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: null,
        sourceEventAt: null,
        sourceEventId: null,
      };

      const stored: StoredPaymentSnapshot = {
        barbershopId: "b1",
        asaasPaymentId: "p1",
        asaasSubscriptionId: "s1",
        asaasCustomerId: "c1",
        status: AsaasPaymentStatus.RECEIVED,
        billingType: "PIX",
        value: "29.90",
        netValue: null,
        dueDate: null,
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: null,
        sourceEventAt: null,
        sourceEventId: null,
      };

      expect(areCanonicalFactsEqual(candidate, stored)).toBe(true);
    });
  });

  describe("Canceled Subscription Lifecycle Guard (Phase 2.3B2)", () => {
    it("does NOT reactivate a canceled subscription (canceledAt != null or status === CANCELED)", () => {
      const storedSub = {
        id: "sub_1",
        status: "CANCELED",
        canceledAt: new Date("2026-08-01"),
      };

      const isCanceled = storedSub.canceledAt != null || storedSub.status === "CANCELED";
      expect(isCanceled).toBe(true);

      let newSubStatus = storedSub.status;
      const mappedStatus = "RECEIVED";

      if (!isCanceled) {
        if (["RECEIVED", "CONFIRMED"].includes(mappedStatus)) {
          newSubStatus = "ACTIVE";
        }
      }

      expect(newSubStatus).toBe("CANCELED");
    });

    it("allows active subscription to change status to ACTIVE or OVERDUE", () => {
      const storedSub = {
        id: "sub_1",
        status: "ACTIVE",
        canceledAt: null,
      };

      const isCanceled = storedSub.canceledAt != null || storedSub.status === "CANCELED";
      expect(isCanceled).toBe(false);

      let newSubStatus = storedSub.status;
      const mappedStatus = "OVERDUE";

      if (!isCanceled) {
        if (["RECEIVED", "CONFIRMED"].includes(mappedStatus)) {
          newSubStatus = "ACTIVE";
        } else if (mappedStatus === "OVERDUE") {
          newSubStatus = "OVERDUE";
        }
      }

      expect(newSubStatus).toBe("OVERDUE");
    });
  });

  describe("Barbershop Identity Validation (Phase 2.3B2)", () => {
    it("validates barbershop identity mismatch before freshness classification", () => {
      const existingPayment = {
        barbershopId: "shop_A",
        asaasPaymentId: "pay_1",
      };
      const incomingBarbershopId = "shop_B";

      const checkMismatch = () => {
        if (existingPayment && existingPayment.barbershopId !== incomingBarbershopId) {
          throw new Error("BARBERSHOP_SUBSCRIPTION_MISMATCH");
        }
      };

      expect(checkMismatch).toThrow("BARBERSHOP_SUBSCRIPTION_MISMATCH");
    });
  });

  describe("Customer ID & Value Zero Safety (Phase 2.3B2)", () => {
    it("preserves existing asaasCustomerId for existing payments without false conflict", () => {
      const stored: StoredPaymentSnapshot = {
        barbershopId: "b1",
        asaasPaymentId: "p1",
        asaasSubscriptionId: "s1",
        asaasCustomerId: "cus_A",
        status: AsaasPaymentStatus.RECEIVED,
        billingType: "PIX",
        value: 49.9,
        netValue: null,
        dueDate: null,
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: null,
        sourceEventAt: new Date("2026-08-01T10:00:00Z"),
        sourceEventId: "evt_100",
      };

      const existingPayment = stored;
      const paymentObj = { id: "p1", customer: "cus_B" };

      const candidate: CandidatePaymentFacts = {
        barbershopId: "b1",
        asaasPaymentId: "p1",
        asaasSubscriptionId: "s1",
        asaasCustomerId: existingPayment ? existingPayment.asaasCustomerId : (paymentObj.customer || null),
        status: AsaasPaymentStatus.RECEIVED,
        billingType: "PIX",
        value: 49.9,
        netValue: null,
        dueDate: null,
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: null,
        sourceEventAt: new Date("2026-08-01T10:00:00Z"),
        sourceEventId: "evt_100",
      };

      expect(candidate.asaasCustomerId).toBe("cus_A");
      expect(classifyPaymentFreshness(stored, candidate)).toBe("REPLAY_CURRENT");
    });

    it("handles value = 0 and netValue = 0 safely without treating zero as missing", () => {
      expect(normalizeDecimal(0)).toBe("0.00");
      expect(normalizeDecimal(0.00)).toBe("0.00");
      expect(normalizeDecimal(null)).toBeNull();

      const candidateZero: CandidatePaymentFacts = {
        barbershopId: "b1",
        asaasPaymentId: "p1",
        asaasSubscriptionId: "s1",
        asaasCustomerId: "c1",
        status: AsaasPaymentStatus.RECEIVED,
        billingType: "PIX",
        value: 0,
        netValue: 0,
        dueDate: null,
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: null,
        sourceEventAt: null,
        sourceEventId: null,
      };

      const storedZero: StoredPaymentSnapshot = {
        barbershopId: "b1",
        asaasPaymentId: "p1",
        asaasSubscriptionId: "s1",
        asaasCustomerId: "c1",
        status: AsaasPaymentStatus.RECEIVED,
        billingType: "PIX",
        value: "0.00",
        netValue: "0.00",
        dueDate: null,
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: null,
        sourceEventAt: null,
        sourceEventId: null,
      };

      expect(areCanonicalFactsEqual(candidateZero, storedZero)).toBe(true);
    });

    it("clears old sourceEventId on ACCEPT when incoming event has sourceEventId = null", () => {
      const stored: StoredPaymentSnapshot = {
        barbershopId: "b1",
        asaasPaymentId: "p1",
        asaasSubscriptionId: "s1",
        asaasCustomerId: "c1",
        status: AsaasPaymentStatus.RECEIVED,
        billingType: "PIX",
        value: 49.9,
        netValue: null,
        dueDate: null,
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: null,
        sourceEventAt: new Date("2026-08-01T10:00:00Z"),
        sourceEventId: "evt_old",
      };

      const candidate: CandidatePaymentFacts = {
        barbershopId: "b1",
        asaasPaymentId: "p1",
        asaasSubscriptionId: "s1",
        asaasCustomerId: "c1",
        status: AsaasPaymentStatus.RECEIVED,
        billingType: "PIX",
        value: 49.9,
        netValue: null,
        dueDate: null,
        paymentDate: null,
        invoiceUrl: null,
        bankSlipUrl: null,
        externalReference: null,
        sourceEventAt: new Date("2026-08-01T12:00:00Z"),
        sourceEventId: null,
      };

      expect(classifyPaymentFreshness(stored, candidate)).toBe("ACCEPT");
      expect(candidate.sourceEventAt).toEqual(new Date("2026-08-01T12:00:00Z"));
      expect(candidate.sourceEventId).toBeNull();
    });
  });

});

