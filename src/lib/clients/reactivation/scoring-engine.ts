import { CustomerTimingState } from "@prisma/client";
import { ScoreComponents, ScoreReason } from "./types";

export function resolveCustomerTimingState(
  completedVisitCount: number,
  returnRatio: number | null
): CustomerTimingState {
  if (completedVisitCount === 0 || returnRatio === null) {
    return CustomerTimingState.NO_HISTORY;
  }

  if (returnRatio < 0.85) {
    return CustomerTimingState.NOT_DUE;
  }
  if (returnRatio < 1.0) {
    return CustomerTimingState.DUE_SOON;
  }
  if (returnRatio < 1.25) {
    return CustomerTimingState.DUE;
  }
  if (returnRatio < 2.0) {
    return CustomerTimingState.OVERDUE;
  }
  return CustomerTimingState.INACTIVE;
}

export function getTimingStateLabel(timingState: CustomerTimingState): string {
  switch (timingState) {
    case CustomerTimingState.NO_HISTORY:
      return "Sem histórico de visitas";
    case CustomerTimingState.NOT_DUE:
      return "Em dia";
    case CustomerTimingState.DUE_SOON:
      return "Próximo do retorno";
    case CustomerTimingState.DUE:
      return "No prazo de retorno";
    case CustomerTimingState.OVERDUE:
      return "Atrasado";
    case CustomerTimingState.INACTIVE:
      return "Inativo";
  }
}

/**
 * Calculates Timing Score (0-45) based on returnRatio r.
 */
export function calculateTimingScore(returnRatio: number | null): number {
  if (returnRatio === null || returnRatio < 0.85) {
    return 0;
  }
  if (returnRatio < 1.0) {
    const score = Math.round(5 + ((returnRatio - 0.85) / 0.15) * 10);
    return Math.max(0, Math.min(45, score));
  }
  if (returnRatio < 1.25) {
    const score = Math.round(15 + ((returnRatio - 1.0) / 0.25) * 15);
    return Math.max(0, Math.min(45, score));
  }
  if (returnRatio < 2.0) {
    const score = Math.round(30 + ((returnRatio - 1.25) / 0.75) * 15);
    return Math.max(0, Math.min(45, score));
  }
  return 45;
}

export interface ValueQuartiles {
  p25: number;
  p50: number;
  p75: number;
  countPaid: number;
}

/**
 * Calculates Value Score (0-20) based on tenant quartiles.
 */
export function calculateValueScore(
  averageTicket: number,
  quartiles: ValueQuartiles
): number {
  if (averageTicket <= 0) return 0;

  if (quartiles.countPaid < 4) {
    return 10;
  }

  if (averageTicket <= quartiles.p25) {
    return 5;
  }
  if (averageTicket <= quartiles.p50) {
    return 10;
  }
  if (averageTicket <= quartiles.p75) {
    return 15;
  }
  return 20;
}

/**
 * Calculates Confidence Score (0-20) based on canonical completed visit count.
 */
export function calculateConfidenceScore(completedVisitCount: number): number {
  if (completedVisitCount <= 0) return 0;
  if (completedVisitCount === 1) return 4;
  if (completedVisitCount === 2) return 8;
  if (completedVisitCount === 3) return 12;
  if (completedVisitCount === 4) return 16;
  return 20;
}

/**
 * Calculates Reliability Score (0-15) based on no-show rate.
 */
export function calculateReliabilityScore(
  completedVisitCount: number,
  noShowCount: number
): number {
  const denominator = completedVisitCount + noShowCount;
  if (denominator < 3) return 8;

  const noShowRate = noShowCount / denominator;
  if (noShowRate < 0.05) return 15;
  if (noShowRate < 0.15) return 10;
  if (noShowRate < 0.30) return 5;
  return 0;
}

/**
 * Calculates Fatigue Penalty (-10 or 0) based on days since last CRM contact.
 */
export function calculateFatiguePenalty(daysSinceLastContact: number | null): number {
  if (daysSinceLastContact !== null && daysSinceLastContact >= 14 && daysSinceLastContact <= 30) {
    return -10;
  }
  return 0;
}

export function calculateFinalScore(
  scoreComponents: ScoreComponents
): number {
  const subtotal =
    scoreComponents.timing +
    scoreComponents.value +
    scoreComponents.confidence +
    scoreComponents.reliability;
  const clampedSubtotal = Math.min(100, Math.max(0, subtotal));
  return Math.max(0, Math.min(100, clampedSubtotal + scoreComponents.fatigue));
}

/**
 * Generates human-readable pt-BR score explainability reasons.
 */
export function generateScoreReasons(params: {
  timingState: CustomerTimingState;
  daysOverdue: number | null;
  expectedReturnDays: number;
  expectedReturnSource: string;
  completedVisitCount: number;
  averageTicket: number;
  scoreComponents: ScoreComponents;
  noShowRate: number;
  daysSinceLastContact: number | null;
}): ScoreReason[] {
  const reasons: ScoreReason[] = [];

  // Timing reason
  if (
    params.daysOverdue !== null &&
    (params.timingState === CustomerTimingState.DUE ||
      params.timingState === CustomerTimingState.OVERDUE ||
      params.timingState === CustomerTimingState.INACTIVE)
  ) {
    reasons.push({
      code: "RETURN_OVERDUE",
      impact: params.scoreComponents.timing,
      label: `Está ${params.daysOverdue} dias além do retorno esperado.`,
    });
  }

  // Recurrence source reason
  if (params.expectedReturnSource === "PERSONAL") {
    reasons.push({
      code: "PERSONAL_CADENCE",
      impact: 0,
      label: `Costuma retornar a cada ${params.expectedReturnDays} dias.`,
    });
  }

  // Confidence reason
  if (params.completedVisitCount > 0) {
    reasons.push({
      code: "HIGH_VISIT_CONFIDENCE",
      impact: params.scoreComponents.confidence,
      label: `Possui ${params.completedVisitCount} visita(s) concluída(s).`,
    });
  }

  // Value reason
  if (params.scoreComponents.value >= 15) {
    reasons.push({
      code: "HIGH_RELATIVE_TICKET",
      impact: params.scoreComponents.value,
      label: "Ticket médio entre os mais altos da barbearia.",
    });
  }

  // Reliability reason
  if (params.scoreComponents.reliability >= 10 && params.completedVisitCount >= 3) {
    const pct = Math.round(params.noShowRate * 100);
    reasons.push({
      code: "GOOD_ATTENDANCE",
      impact: params.scoreComponents.reliability,
      label: `Baixa taxa de ausências (${pct}% no-show).`,
    });
  }

  // Fatigue reason
  if (params.scoreComponents.fatigue < 0 && params.daysSinceLastContact !== null) {
    reasons.push({
      code: "RECENT_CONTACT_PENALTY",
      impact: params.scoreComponents.fatigue,
      label: `Foi contatado há ${params.daysSinceLastContact} dias: ${params.scoreComponents.fatigue} pontos.`,
    });
  }

  return reasons;
}
