import {
  CustomerTimingState,
  ExpectedReturnSource,
} from "@prisma/client";
import { VirtualMarketingConsentStatus } from "./constants";

export type RecommendationSuppressionCode =
  | "UPCOMING_APPOINTMENT"
  | "BLOCKED"
  | "INVALID_PHONE"
  | "NO_HISTORY"
  | "RECENT_CONTACT";

export type DispatchSuppressionCode =
  | RecommendationSuppressionCode
  | "CONSENT_UNKNOWN"
  | "CONSENT_OPTED_OUT";

export interface ScoreReason {
  code: string;
  impact: number;
  label: string;
  detail?: string;
}

export interface ScoreComponents {
  timing: number;
  value: number;
  confidence: number;
  reliability: number;
  fatigue: number;
}

export interface CandidateCustomer {
  id: string;
  name: string;
  phone: string | null;
}

export interface FavoriteProfessional {
  id: string;
  name: string;
  occurrenceCount: number;
}

export interface DominantService {
  id: string;
  name: string;
  occurrenceCount: number;
}

export interface ReactivationCandidateItem {
  customer: CandidateCustomer;

  timingState: CustomerTimingState;
  timingLabel: string;

  lastVisitLocalDate: string | null;
  expectedReturnLocalDate: string | null;
  expectedReturnDays: number;
  expectedReturnSource: ExpectedReturnSource;

  daysSinceLastVisit: number | null;
  daysOverdue: number | null;
  returnRatio: number | null;

  score: number;
  scoreComponents: ScoreComponents;
  scoreReasons: ScoreReason[];

  completedVisitCount: number;
  averageTicket: number;
  potentialRevenue: number;
  noShowRate: number;

  favoriteProfessional: FavoriteProfessional | null;
  dominantService: DominantService | null;

  lastContactedAt: string | null;

  consentStatus: VirtualMarketingConsentStatus;

  recommendationEligible: boolean;
  dispatchEligible: boolean;

  recommendationSuppressions: RecommendationSuppressionCode[];
  dispatchSuppressions: DispatchSuppressionCode[];

  defaultSelected: boolean;
}

export interface CandidatePageInfo {
  limit: number;
  nextCursor: string | null;
}

export interface CandidateSummary {
  recommendedCount: number;
  dueSoonCount: number;
  dueCount: number;
  overdueCount: number;
  inactiveCount: number;
  potentialRevenue: number;
}

export interface CandidateQueryResponse {
  generatedAt: string;
  scoreVersion: string;
  recurrenceVersion: string;
  items: ReactivationCandidateItem[];
  page: CandidatePageInfo;
  summary: CandidateSummary;
  meta?: {
    queryCount: number;
    latencyMs?: number;
  };
}

export interface CursorPayload {
  v: number;
  score: number;
  daysOverdue: number;
  customerId: string;
}

export interface CandidateQueryOptions {
  barbershopId: string;
  limit?: number;
  cursor?: string | null;
  timingState?: CustomerTimingState | null;
  includeSuppressed?: boolean;
  now?: Date;
}
