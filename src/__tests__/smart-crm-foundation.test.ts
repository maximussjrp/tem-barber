/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import {
  MarketingConsentStatus,
  MarketingConsentSource,
  CampaignStatus,
  RecipientDispatchStatus,
  RecipientConversionStatus,
  CustomerTimingState,
  ExpectedReturnSource,
} from "@prisma/client";
import {
  SMART_CRM_SCORE_VERSION,
  SMART_CRM_RECURRENCE_VERSION,
  DEFAULT_CRM_CHANNEL,
  DEFAULT_CRM_PURPOSE,
  PLATFORM_FALLBACK_RECURRENCE_DAYS,
  TIMING_RATIO_THRESHOLDS,
  SCORE_WEIGHTS_V1,
  CAMPAIGN_DEFAULTS,
  canTransitionCampaign,
  assertValidCampaignTransition,
  canTransitionDispatch,
  assertValidDispatchTransition,
  canTransitionConversion,
  assertValidConversionTransition,
  recordMarketingConsent,
  getMarketingConsentStatus,
  createReactivationContactLog,
} from "@/lib/clients/reactivation";

describe("Smart CRM Foundation — Authoritative Enums Contract", () => {
  it("MarketingConsentStatus contains exact frozen values", () => {
    const keys = Object.values(MarketingConsentStatus).sort();
    expect(keys).toEqual(["OPTED_IN", "OPTED_OUT"].sort());
  });

  it("MarketingConsentSource contains exact frozen values", () => {
    const keys = Object.values(MarketingConsentSource).sort();
    expect(keys).toEqual([
      "ADMIN_WITH_PROOF",
      "BOOKING_CHECKBOX",
      "CUSTOMER_REQUEST_IN_PERSON",
      "CUSTOMER_REQUEST_WHATSAPP",
      "IMPORT_WITH_PROOF",
    ].sort());
  });

  it("CampaignStatus contains exact frozen values", () => {
    const keys = Object.values(CampaignStatus).sort();
    expect(keys).toEqual(["CANCELLED", "COMPLETED", "DRAFT", "IN_PROGRESS", "READY"].sort());
  });

  it("RecipientDispatchStatus contains exact frozen values", () => {
    const keys = Object.values(RecipientDispatchStatus).sort();
    expect(keys).toEqual([
      "EXCLUDED",
      "FAILED",
      "OPTED_OUT",
      "READY",
      "SENT_CONFIRMED",
      "WHATSAPP_OPENED",
    ].sort());
  });

  it("RecipientConversionStatus contains exact frozen values", () => {
    const keys = Object.values(RecipientConversionStatus).sort();
    expect(keys).toEqual([
      "ATTENDED",
      "BOOKED",
      "DIRECT_RETURN",
      "NONE",
      "REVENUE_ATTRIBUTED",
    ].sort());
  });

  it("CustomerTimingState contains exact frozen values", () => {
    const keys = Object.values(CustomerTimingState).sort();
    expect(keys).toEqual([
      "DUE",
      "DUE_SOON",
      "INACTIVE",
      "NOT_DUE",
      "NO_HISTORY",
      "OVERDUE",
    ].sort());
  });

  it("ExpectedReturnSource contains exact frozen values", () => {
    const keys = Object.values(ExpectedReturnSource).sort();
    expect(keys).toEqual([
      "BARBERSHOP_MEDIAN",
      "PERSONAL",
      "PLATFORM_FALLBACK",
      "SERVICE_MEDIAN",
    ].sort());
  });
});

describe("Smart CRM Foundation — Constants & Versions", () => {
  it("exports exact stable version strings and defaults", () => {
    expect(SMART_CRM_SCORE_VERSION).toBe("smart-crm-score-v1");
    expect(SMART_CRM_RECURRENCE_VERSION).toBe("smart-crm-recurrence-v1");
    expect(DEFAULT_CRM_CHANNEL).toBe("WHATSAPP");
    expect(DEFAULT_CRM_PURPOSE).toBe("MARKETING");
    expect(PLATFORM_FALLBACK_RECURRENCE_DAYS).toBe(30);
    expect(CAMPAIGN_DEFAULTS.BOOKING_ATTRIBUTION_WINDOW_DAYS).toBe(14);
    expect(CAMPAIGN_DEFAULTS.DIRECT_RETURN_WINDOW_DAYS).toBe(14);
    expect(CAMPAIGN_DEFAULTS.COOLDOWN_DAYS).toBe(14);
  });

  it("exports correct timing ratio thresholds", () => {
    expect(TIMING_RATIO_THRESHOLDS.NOT_DUE_MAX_RATIO).toBe(0.85);
    expect(TIMING_RATIO_THRESHOLDS.DUE_SOON_MAX_RATIO).toBe(1.0);
    expect(TIMING_RATIO_THRESHOLDS.DUE_MAX_RATIO).toBe(1.25);
    expect(TIMING_RATIO_THRESHOLDS.OVERDUE_MAX_RATIO).toBe(2.0);
  });

  it("exports score weights adding up to 100 subtotal max with fatigue rules", () => {
    expect(SCORE_WEIGHTS_V1.TIMING_MAX).toBe(45);
    expect(SCORE_WEIGHTS_V1.VALUE_MAX).toBe(20);
    expect(SCORE_WEIGHTS_V1.CONFIDENCE_MAX).toBe(20);
    expect(SCORE_WEIGHTS_V1.RELIABILITY_MAX).toBe(15);
    expect(SCORE_WEIGHTS_V1.SUBTOTAL_MAX).toBe(100);
    expect(SCORE_WEIGHTS_V1.FATIGUE.HARD_SUPPRESSION_DAYS).toBe(14);
    expect(SCORE_WEIGHTS_V1.FATIGUE.MODERATE_PENALTY_AMOUNT).toBe(-10);
  });
});

describe("Smart CRM Foundation — State Machines", () => {
  describe("CampaignStatus", () => {
    it("allows valid transitions for CampaignStatus", () => {
      expect(canTransitionCampaign(CampaignStatus.DRAFT, CampaignStatus.READY)).toBe(true);
      expect(canTransitionCampaign(CampaignStatus.DRAFT, CampaignStatus.CANCELLED)).toBe(true);
      expect(canTransitionCampaign(CampaignStatus.DRAFT, CampaignStatus.IN_PROGRESS)).toBe(false);

      expect(canTransitionCampaign(CampaignStatus.READY, CampaignStatus.IN_PROGRESS)).toBe(true);
      expect(canTransitionCampaign(CampaignStatus.READY, CampaignStatus.CANCELLED)).toBe(true);
      expect(canTransitionCampaign(CampaignStatus.READY, CampaignStatus.DRAFT)).toBe(false);

      expect(canTransitionCampaign(CampaignStatus.IN_PROGRESS, CampaignStatus.COMPLETED)).toBe(true);
      expect(canTransitionCampaign(CampaignStatus.IN_PROGRESS, CampaignStatus.CANCELLED)).toBe(true);
      expect(canTransitionCampaign(CampaignStatus.IN_PROGRESS, CampaignStatus.READY)).toBe(false);

      expect(canTransitionCampaign(CampaignStatus.COMPLETED, CampaignStatus.IN_PROGRESS)).toBe(false);
      expect(canTransitionCampaign(CampaignStatus.CANCELLED, CampaignStatus.DRAFT)).toBe(false);
    });

    it("assertValidCampaignTransition throws on invalid transition", () => {
      expect(() =>
        assertValidCampaignTransition(CampaignStatus.DRAFT, CampaignStatus.COMPLETED)
      ).toThrow("Invalid campaign status transition");
    });
  });

  describe("RecipientDispatchStatus", () => {
    it("allows valid transitions for RecipientDispatchStatus", () => {
      expect(canTransitionDispatch(RecipientDispatchStatus.READY, RecipientDispatchStatus.WHATSAPP_OPENED)).toBe(true);
      expect(canTransitionDispatch(RecipientDispatchStatus.READY, RecipientDispatchStatus.EXCLUDED)).toBe(true);
      expect(canTransitionDispatch(RecipientDispatchStatus.READY, RecipientDispatchStatus.OPTED_OUT)).toBe(true);
      expect(canTransitionDispatch(RecipientDispatchStatus.READY, RecipientDispatchStatus.FAILED)).toBe(true);

      // CRITICAL: READY -> SENT_CONFIRMED directly is INVALID (must pass through WHATSAPP_OPENED)
      expect(canTransitionDispatch(RecipientDispatchStatus.READY, RecipientDispatchStatus.SENT_CONFIRMED)).toBe(false);

      expect(canTransitionDispatch(RecipientDispatchStatus.WHATSAPP_OPENED, RecipientDispatchStatus.SENT_CONFIRMED)).toBe(true);
      expect(canTransitionDispatch(RecipientDispatchStatus.WHATSAPP_OPENED, RecipientDispatchStatus.EXCLUDED)).toBe(true);
      expect(canTransitionDispatch(RecipientDispatchStatus.WHATSAPP_OPENED, RecipientDispatchStatus.OPTED_OUT)).toBe(true);
      expect(canTransitionDispatch(RecipientDispatchStatus.WHATSAPP_OPENED, RecipientDispatchStatus.FAILED)).toBe(true);

      // SENT_CONFIRMED is terminal historical truth
      expect(canTransitionDispatch(RecipientDispatchStatus.SENT_CONFIRMED, RecipientDispatchStatus.READY)).toBe(false);
      expect(canTransitionDispatch(RecipientDispatchStatus.SENT_CONFIRMED, RecipientDispatchStatus.FAILED)).toBe(false);

      // FAILED can retry to READY
      expect(canTransitionDispatch(RecipientDispatchStatus.FAILED, RecipientDispatchStatus.READY)).toBe(true);
      expect(canTransitionDispatch(RecipientDispatchStatus.FAILED, RecipientDispatchStatus.EXCLUDED)).toBe(true);
    });

    it("assertValidDispatchTransition throws on direct READY -> SENT_CONFIRMED", () => {
      expect(() =>
        assertValidDispatchTransition(RecipientDispatchStatus.READY, RecipientDispatchStatus.SENT_CONFIRMED)
      ).toThrow("Invalid recipient dispatch status transition");
    });
  });

  describe("RecipientConversionStatus", () => {
    it("allows valid transitions for RecipientConversionStatus", () => {
      expect(canTransitionConversion(RecipientConversionStatus.NONE, RecipientConversionStatus.BOOKED)).toBe(true);
      expect(canTransitionConversion(RecipientConversionStatus.NONE, RecipientConversionStatus.DIRECT_RETURN)).toBe(true);
      expect(canTransitionConversion(RecipientConversionStatus.NONE, RecipientConversionStatus.ATTENDED)).toBe(false);

      expect(canTransitionConversion(RecipientConversionStatus.BOOKED, RecipientConversionStatus.ATTENDED)).toBe(true);
      expect(canTransitionConversion(RecipientConversionStatus.ATTENDED, RecipientConversionStatus.REVENUE_ATTRIBUTED)).toBe(true);
      expect(canTransitionConversion(RecipientConversionStatus.DIRECT_RETURN, RecipientConversionStatus.REVENUE_ATTRIBUTED)).toBe(true);

      // REVENUE_ATTRIBUTED is terminal
      expect(canTransitionConversion(RecipientConversionStatus.REVENUE_ATTRIBUTED, RecipientConversionStatus.NONE)).toBe(false);
    });

    it("assertValidConversionTransition throws on invalid transition", () => {
      expect(() =>
        assertValidConversionTransition(RecipientConversionStatus.NONE, RecipientConversionStatus.REVENUE_ATTRIBUTED)
      ).toThrow("Invalid recipient conversion status transition");
    });
  });
});

describe("Smart CRM Foundation — Consent Service Unit Tests", () => {
  it("getMarketingConsentStatus returns UNKNOWN when no row exists", async () => {
    const mockPrisma = {
      customerMarketingConsent: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const result = await getMarketingConsentStatus(mockPrisma as any, {
      barbershopId: "shop-1",
      customerId: "cust-1",
    });

    expect(result.status).toBe("UNKNOWN");
    expect(result.consent).toBeNull();
  });

  it("getMarketingConsentStatus returns OPTED_IN when row exists", async () => {
    const mockConsent = {
      id: "consent-1",
      barbershopId: "shop-1",
      customerId: "cust-1",
      channel: "WHATSAPP",
      purpose: "MARKETING",
      status: MarketingConsentStatus.OPTED_IN,
      source: MarketingConsentSource.BOOKING_CHECKBOX,
      lastEventId: "event-1",
      optedOutAt: null,
      lastConfirmedAt: new Date(),
    };

    const mockPrisma = {
      customerMarketingConsent: {
        findUnique: vi.fn().mockResolvedValue(mockConsent),
      },
    };

    const result = await getMarketingConsentStatus(mockPrisma as any, {
      barbershopId: "shop-1",
      customerId: "cust-1",
    });

    expect(result.status).toBe("OPTED_IN");
    expect(result.consent).toEqual(mockConsent);
  });

  it("recordMarketingConsent acquires advisory lock, creates event, links lastEventId, and upserts consent", async () => {
    const mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      customerMarketingConsentEvent: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "event-1",
          barbershopId: "shop-1",
          customerId: "cust-1",
          channel: "WHATSAPP",
          purpose: "MARKETING",
          eventType: MarketingConsentStatus.OPTED_IN,
          source: MarketingConsentSource.BOOKING_CHECKBOX,
          eventKey: "opt-in-key-1",
          occurredAt: new Date("2026-09-04T12:00:00Z"),
        }),
      },
      customerMarketingConsent: {
        upsert: vi.fn().mockResolvedValue({
          id: "consent-1",
          barbershopId: "shop-1",
          customerId: "cust-1",
          channel: "WHATSAPP",
          purpose: "MARKETING",
          status: MarketingConsentStatus.OPTED_IN,
          source: MarketingConsentSource.BOOKING_CHECKBOX,
          lastEventId: "event-1",
          optedOutAt: null,
          lastConfirmedAt: new Date("2026-09-04T12:00:00Z"),
        }),
      },
    };

    const res = await recordMarketingConsent(mockTx as any, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      status: MarketingConsentStatus.OPTED_IN,
      source: MarketingConsentSource.BOOKING_CHECKBOX,
      eventKey: "opt-in-key-1",
      occurredAt: new Date("2026-09-04T12:00:00Z"),
    });

    expect(mockTx.$executeRaw).toHaveBeenCalled();
    expect(mockTx.customerMarketingConsentEvent.create).toHaveBeenCalled();
    expect(mockTx.customerMarketingConsent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          lastEventId: "event-1",
          status: MarketingConsentStatus.OPTED_IN,
        }),
        update: expect.objectContaining({
          lastEventId: "event-1",
          status: MarketingConsentStatus.OPTED_IN,
        }),
      })
    );
    expect(res.isDuplicateEvent).toBe(false);
    expect(res.consent.status).toBe(MarketingConsentStatus.OPTED_IN);
    expect(res.consent.lastEventId).toBe("event-1");
  });

  it("recordMarketingConsent handles duplicate eventKey idempotently", async () => {
    const mockExistingEvent = {
      id: "event-1",
      barbershopId: "shop-1",
      customerId: "cust-1",
      eventKey: "opt-in-key-1",
      eventType: MarketingConsentStatus.OPTED_IN,
      channel: "WHATSAPP",
      source: MarketingConsentSource.ADMIN_WITH_PROOF,
      purpose: "MARKETING",
    };
    const mockExistingConsent = {
      id: "consent-1",
      barbershopId: "shop-1",
      customerId: "cust-1",
      status: MarketingConsentStatus.OPTED_IN,
      lastEventId: "event-1",
    };

    const mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      customerMarketingConsentEvent: {
        findUnique: vi.fn().mockResolvedValue(mockExistingEvent),
        create: vi.fn(),
      },
      customerMarketingConsent: {
        findUnique: vi.fn().mockResolvedValue(mockExistingConsent),
        upsert: vi.fn(),
      },
    };

    const res = await recordMarketingConsent(mockTx as any, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      status: MarketingConsentStatus.OPTED_IN,
      source: MarketingConsentSource.ADMIN_WITH_PROOF,
      eventKey: "opt-in-key-1",
    });

    expect(res.isDuplicateEvent).toBe(true);
    expect(mockTx.customerMarketingConsentEvent.create).not.toHaveBeenCalled();
    expect(mockTx.customerMarketingConsent.upsert).not.toHaveBeenCalled();
  });
});

describe("Smart CRM Foundation — Campaign Contact Log Helper", () => {
  it("rejects creating CustomerContactLog when dispatchStatus is not SENT_CONFIRMED", async () => {
    const mockTx = {
      customerContactLog: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      reactivationCampaignRecipient: {
        findUnique: vi.fn().mockResolvedValue({ dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED }),
      },
    };

    await expect(
      createReactivationContactLog(mockTx as any, {
        barbershopId: "shop-1",
        customerId: "cust-1",
        recipientId: "recip-1",
        dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
        templateKey: "REACTIVATION_V1",
        templateLabel: "Reativação Especial",
        createdByUserId: "user-1",
      })
    ).rejects.toThrow("Contact log is only allowed on SENT_CONFIRMED");

    expect(mockTx.customerContactLog.create).not.toHaveBeenCalled();
  });

  it("creates CustomerContactLog when dispatchStatus is SENT_CONFIRMED", async () => {
    const mockTx = {
      customerContactLog: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: "log-1",
          barbershopId: "shop-1",
          customerId: "cust-1",
          reactivationRecipientId: "recip-1",
          channel: "WHATSAPP",
          templateKey: "REACTIVATION_V1",
          templateLabel: "Reativação Especial",
          createdByUserId: "user-1",
        }),
      },
      reactivationCampaignRecipient: {
        findUnique: vi.fn().mockResolvedValue({ dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED }),
      },
    };

    const result = await createReactivationContactLog(mockTx as any, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      recipientId: "recip-1",
      dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
      templateKey: "REACTIVATION_V1",
      templateLabel: "Reativação Especial",
      createdByUserId: "user-1",
    });

    expect(result.isExisting).toBe(false);
    expect(result.contactLog.reactivationRecipientId).toBe("recip-1");
    expect(mockTx.customerContactLog.create).toHaveBeenCalled();
  });

  it("returns existing CustomerContactLog if already created for recipientId", async () => {
    const mockExistingLog = {
      id: "log-1",
      reactivationRecipientId: "recip-1",
      templateKey: "REACTIVATION_V1",
    };

    const mockTx = {
      customerContactLog: {
        findUnique: vi.fn().mockResolvedValue(mockExistingLog),
        create: vi.fn(),
      },
    };

    const result = await createReactivationContactLog(mockTx as any, {
      barbershopId: "shop-1",
      customerId: "cust-1",
      recipientId: "recip-1",
      templateKey: "REACTIVATION_V1",
      templateLabel: "Reativação Especial",
      createdByUserId: "user-1",
    });

    expect(result.isExisting).toBe(true);
    expect(result.contactLog).toEqual(mockExistingLog);
    expect(mockTx.customerContactLog.create).not.toHaveBeenCalled();
  });
});
