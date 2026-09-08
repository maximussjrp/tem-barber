// ============================================================================
// SMART CRM / CUSTOMER REACTIVATION CONSTANTS (FROZEN V1)
// ============================================================================

export const SMART_CRM_SCORE_VERSION = "smart-crm-score-v1" as const;
export const SMART_CRM_RECURRENCE_VERSION = "smart-crm-recurrence-v1" as const;

export const DEFAULT_CRM_CHANNEL = "WHATSAPP" as const;
export const DEFAULT_CRM_PURPOSE = "MARKETING" as const;

export const PLATFORM_FALLBACK_RECURRENCE_DAYS = 30 as const;
export const MIN_HISTORICAL_COMPLETED_APPOINTMENTS_FOR_RECURRENCE = 2 as const;
export const MIN_HISTORICAL_DATES_FOR_RECURRENCE_AVG = 2 as const;

export const TIMING_RATIO_THRESHOLDS = {
  NOT_DUE_MAX_RATIO: 0.85,
  DUE_SOON_MAX_RATIO: 1.0,
  DUE_MAX_RATIO: 1.25,
  OVERDUE_MAX_RATIO: 2.0,
  // ratio >= 2.00 => INACTIVE
} as const;

export const SCORE_WEIGHTS_V1 = {
  TIMING_MAX: 45,
  VALUE_MAX: 20,
  CONFIDENCE_MAX: 20,
  RELIABILITY_MAX: 15,
  SUBTOTAL_MAX: 100,
  FATIGUE: {
    HARD_SUPPRESSION_DAYS: 14, // < 14 days => hard suppression
    MODERATE_PENALTY_WINDOW_DAYS: 30, // 14-30 days => -10
    MODERATE_PENALTY_AMOUNT: -10,
    CLEAR_DAYS: 30, // > 30 days => 0
  },
} as const;

export const CAMPAIGN_DEFAULTS = {
  BOOKING_ATTRIBUTION_WINDOW_DAYS: 14,
  DIRECT_RETURN_WINDOW_DAYS: 14,
  COOLDOWN_DAYS: 14,
} as const;

export const MARKETING_CONSENT_VIRTUAL_STATUS = {
  OPTED_IN: "OPTED_IN",
  OPTED_OUT: "OPTED_OUT",
  UNKNOWN: "UNKNOWN",
} as const;

export type VirtualMarketingConsentStatus =
  keyof typeof MARKETING_CONSENT_VIRTUAL_STATUS;
