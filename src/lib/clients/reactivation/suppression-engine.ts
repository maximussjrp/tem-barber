import { CustomerTimingState } from "@prisma/client";
import { validateBrazilianMobilePhone } from "@/lib/phone/br-phone";
import { VirtualMarketingConsentStatus } from "./constants";
import {
  DispatchSuppressionCode,
  RecommendationSuppressionCode,
} from "./types";

const phoneValidationCache = new Map<string, boolean>();

export function isPhoneValidMemoized(phone: string | null): boolean {
  if (!phone) return false;
  const cached = phoneValidationCache.get(phone);
  if (cached !== undefined) return cached;

  const valid = validateBrazilianMobilePhone(phone);
  if (phoneValidationCache.size < 50000) {
    phoneValidationCache.set(phone, valid);
  }
  return valid;
}

export interface SuppressionInput {
  phone: string | null;
  completedVisitCount: number;
  hasUpcomingAppointment: boolean; // PENDING or CONFIRMED dateTime > now
  isBlocked: boolean; // active BarbershopBlockedCustomer
  daysSinceLastContact: number | null; // CustomerContactLog
  consentStatus: VirtualMarketingConsentStatus;
  timingState: CustomerTimingState;
}

export interface SuppressionResult {
  recommendationEligible: boolean;
  dispatchEligible: boolean;
  recommendationSuppressions: RecommendationSuppressionCode[];
  dispatchSuppressions: DispatchSuppressionCode[];
  defaultSelected: boolean;
}

export function evaluateSuppressions(input: SuppressionInput): SuppressionResult {
  const recommendationSuppressions: RecommendationSuppressionCode[] = [];
  const dispatchSuppressions: DispatchSuppressionCode[] = [];

  // 1. Upcoming Appointment
  if (input.hasUpcomingAppointment) {
    recommendationSuppressions.push("UPCOMING_APPOINTMENT");
  }

  // 2. Blocked Customer
  if (input.isBlocked) {
    recommendationSuppressions.push("BLOCKED");
  }

  // 3. Phone Validity
  if (!isPhoneValidMemoized(input.phone)) {
    recommendationSuppressions.push("INVALID_PHONE");
  }

  // 4. No History
  if (input.completedVisitCount === 0) {
    recommendationSuppressions.push("NO_HISTORY");
  }

  // 5. Recent Contact (< 14 days)
  if (input.daysSinceLastContact !== null && input.daysSinceLastContact < 14) {
    recommendationSuppressions.push("RECENT_CONTACT");
  }

  const recommendationEligible = recommendationSuppressions.length === 0;

  // Build dispatch suppressions (includes recommendation suppressions + consent)
  dispatchSuppressions.push(...recommendationSuppressions);

  if (input.consentStatus === "UNKNOWN") {
    dispatchSuppressions.push("CONSENT_UNKNOWN");
  } else if (input.consentStatus === "OPTED_OUT") {
    dispatchSuppressions.push("CONSENT_OPTED_OUT");
  }

  const dispatchEligible = dispatchSuppressions.length === 0;

  // Default selected for reactivation campaign:
  // recommendationEligible AND timingState IN ('DUE', 'OVERDUE', 'INACTIVE')
  const defaultSelected =
    recommendationEligible &&
    (input.timingState === CustomerTimingState.DUE ||
      input.timingState === CustomerTimingState.OVERDUE ||
      input.timingState === CustomerTimingState.INACTIVE);

  return {
    recommendationEligible,
    dispatchEligible,
    recommendationSuppressions,
    dispatchSuppressions,
    defaultSelected,
  };
}
