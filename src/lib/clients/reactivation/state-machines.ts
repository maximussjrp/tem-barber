import {
  CampaignStatus,
  RecipientDispatchStatus,
  RecipientConversionStatus,
} from "@prisma/client";

// ============================================================================
// 1. CAMPAIGN STATUS STATE MACHINE (FROZEN V1)
// ============================================================================

export const CAMPAIGN_STATUS_TRANSITIONS: Record<
  CampaignStatus,
  readonly CampaignStatus[]
> = {
  DRAFT: [CampaignStatus.READY, CampaignStatus.CANCELLED],
  READY: [CampaignStatus.IN_PROGRESS, CampaignStatus.CANCELLED],
  IN_PROGRESS: [CampaignStatus.COMPLETED, CampaignStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionCampaign(
  from: CampaignStatus,
  to: CampaignStatus
): boolean {
  if (from === to) return true;
  return CAMPAIGN_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidCampaignTransition(
  from: CampaignStatus,
  to: CampaignStatus
): void {
  if (!canTransitionCampaign(from, to)) {
    throw new Error(
      `Invalid campaign status transition from ${from} to ${to}`
    );
  }
}

// ============================================================================
// 2. RECIPIENT DISPATCH STATUS STATE MACHINE (FROZEN V1)
// ============================================================================

export const RECIPIENT_DISPATCH_TRANSITIONS: Record<
  RecipientDispatchStatus,
  readonly RecipientDispatchStatus[]
> = {
  READY: [
    RecipientDispatchStatus.WHATSAPP_OPENED,
    RecipientDispatchStatus.EXCLUDED,
    RecipientDispatchStatus.OPTED_OUT,
    RecipientDispatchStatus.FAILED,
  ],
  WHATSAPP_OPENED: [
    RecipientDispatchStatus.SENT_CONFIRMED,
    RecipientDispatchStatus.EXCLUDED,
    RecipientDispatchStatus.OPTED_OUT,
    RecipientDispatchStatus.FAILED,
  ],
  SENT_CONFIRMED: [],
  FAILED: [RecipientDispatchStatus.READY, RecipientDispatchStatus.EXCLUDED],
  EXCLUDED: [],
  OPTED_OUT: [],
};

export function canTransitionDispatch(
  from: RecipientDispatchStatus,
  to: RecipientDispatchStatus
): boolean {
  if (from === to) return true;
  return RECIPIENT_DISPATCH_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidDispatchTransition(
  from: RecipientDispatchStatus,
  to: RecipientDispatchStatus
): void {
  if (!canTransitionDispatch(from, to)) {
    throw new Error(
      `Invalid recipient dispatch status transition from ${from} to ${to}`
    );
  }
}

// ============================================================================
// 3. RECIPIENT CONVERSION STATUS STATE MACHINE (FROZEN V1)
// ============================================================================

export const RECIPIENT_CONVERSION_TRANSITIONS: Record<
  RecipientConversionStatus,
  readonly RecipientConversionStatus[]
> = {
  NONE: [
    RecipientConversionStatus.BOOKED,
    RecipientConversionStatus.DIRECT_RETURN,
  ],
  BOOKED: [
    RecipientConversionStatus.ATTENDED,
  ],
  ATTENDED: [
    RecipientConversionStatus.REVENUE_ATTRIBUTED,
  ],
  DIRECT_RETURN: [
    RecipientConversionStatus.REVENUE_ATTRIBUTED,
  ],
  REVENUE_ATTRIBUTED: [],
};

export function canTransitionConversion(
  from: RecipientConversionStatus,
  to: RecipientConversionStatus
): boolean {
  if (from === to) return true;
  return RECIPIENT_CONVERSION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidConversionTransition(
  from: RecipientConversionStatus,
  to: RecipientConversionStatus
): void {
  if (!canTransitionConversion(from, to)) {
    throw new Error(
      `Invalid recipient conversion status transition from ${from} to ${to}`
    );
  }
}
