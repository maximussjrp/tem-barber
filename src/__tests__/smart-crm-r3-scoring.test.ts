import { describe, expect, it } from "vitest";
import { CustomerTimingState } from "@prisma/client";
import {
  resolveCustomerTimingState,
  calculateTimingScore,
  calculateValueScore,
  calculateConfidenceScore,
  calculateReliabilityScore,
  calculateFatiguePenalty,
  calculateFinalScore,
  generateScoreReasons,
} from "@/lib/clients/reactivation";

describe("Smart CRM R3 — Scoring Engine Unit Tests", () => {
  describe("Timing State Boundaries", () => {
    it("NO_HISTORY when completedVisitCount is 0", () => {
      expect(resolveCustomerTimingState(0, 1.5)).toBe(CustomerTimingState.NO_HISTORY);
      expect(resolveCustomerTimingState(0, null)).toBe(CustomerTimingState.NO_HISTORY);
    });

    it("NOT_DUE when ratio < 0.85", () => {
      expect(resolveCustomerTimingState(5, 0.0)).toBe(CustomerTimingState.NOT_DUE);
      expect(resolveCustomerTimingState(5, 0.8499)).toBe(CustomerTimingState.NOT_DUE);
    });

    it("DUE_SOON when 0.85 <= ratio < 1.00", () => {
      expect(resolveCustomerTimingState(5, 0.85)).toBe(CustomerTimingState.DUE_SOON);
      expect(resolveCustomerTimingState(5, 0.9999)).toBe(CustomerTimingState.DUE_SOON);
    });

    it("DUE when 1.00 <= ratio < 1.25", () => {
      expect(resolveCustomerTimingState(5, 1.0)).toBe(CustomerTimingState.DUE);
      expect(resolveCustomerTimingState(5, 1.2499)).toBe(CustomerTimingState.DUE);
    });

    it("OVERDUE when 1.25 <= ratio < 2.00", () => {
      expect(resolveCustomerTimingState(5, 1.25)).toBe(CustomerTimingState.OVERDUE);
      expect(resolveCustomerTimingState(5, 1.9999)).toBe(CustomerTimingState.OVERDUE);
    });

    it("INACTIVE when ratio >= 2.00", () => {
      expect(resolveCustomerTimingState(5, 2.0)).toBe(CustomerTimingState.INACTIVE);
      expect(resolveCustomerTimingState(5, 3.5)).toBe(CustomerTimingState.INACTIVE);
    });
  });

  describe("Timing Score Mandatory Exact-Boundary Tests", () => {
    const testCases = [
      { r: 0, state: CustomerTimingState.NOT_DUE, score: 0 },
      { r: 0.84, state: CustomerTimingState.NOT_DUE, score: 0 },
      { r: 0.8499, state: CustomerTimingState.NOT_DUE, score: 0 },
      { r: 0.85, state: CustomerTimingState.DUE_SOON, score: 5 },
      { r: 0.90, state: CustomerTimingState.DUE_SOON, score: 8 },
      { r: 0.9999, state: CustomerTimingState.DUE_SOON, score: 15 },
      { r: 1.00, state: CustomerTimingState.DUE, score: 15 },
      { r: 1.10, state: CustomerTimingState.DUE, score: 21 },
      { r: 1.2499, state: CustomerTimingState.DUE, score: 30 },
      { r: 1.25, state: CustomerTimingState.OVERDUE, score: 30 },
      { r: 1.50, state: CustomerTimingState.OVERDUE, score: 35 },
      { r: 1.9999, state: CustomerTimingState.OVERDUE, score: 45 },
      { r: 2.00, state: CustomerTimingState.INACTIVE, score: 45 },
      { r: 2.50, state: CustomerTimingState.INACTIVE, score: 45 },
    ];

    testCases.forEach(({ r, state, score }) => {
      it(`ratio ${r} -> state ${state}, score ${score}`, () => {
        expect(resolveCustomerTimingState(1, r)).toBe(state);
        expect(calculateTimingScore(r)).toBe(score);
      });
    });

    it("clamps timing score 0..45", () => {
      expect(calculateTimingScore(0.0)).toBe(0);
      expect(calculateTimingScore(5.0)).toBe(45);
    });
  });

  describe("Value Score Quartile Tests", () => {
    const quartiles = { p25: 30, p50: 50, p75: 80, countPaid: 10 };

    it("zero or negative ticket -> 0", () => {
      expect(calculateValueScore(0, quartiles)).toBe(0);
      expect(calculateValueScore(-10, quartiles)).toBe(0);
    });

    it("small tenant (<4 paid customers)", () => {
      const small = { p25: 0, p50: 0, p75: 0, countPaid: 3 };
      expect(calculateValueScore(50, small)).toBe(10);
      expect(calculateValueScore(0, small)).toBe(0);
    });

    it("ticket <= P25 -> 5 points", () => {
      expect(calculateValueScore(25, quartiles)).toBe(5);
      expect(calculateValueScore(30, quartiles)).toBe(5);
    });

    it("P25 < ticket <= P50 -> 10 points", () => {
      expect(calculateValueScore(31, quartiles)).toBe(10);
      expect(calculateValueScore(50, quartiles)).toBe(10);
    });

    it("P50 < ticket <= P75 -> 15 points", () => {
      expect(calculateValueScore(51, quartiles)).toBe(15);
      expect(calculateValueScore(80, quartiles)).toBe(15);
    });

    it("ticket > P75 -> 20 points", () => {
      expect(calculateValueScore(81, quartiles)).toBe(20);
      expect(calculateValueScore(150, quartiles)).toBe(20);
    });
  });

  describe("Confidence Score Tests", () => {
    it("maps visit count to confidence score", () => {
      expect(calculateConfidenceScore(0)).toBe(0);
      expect(calculateConfidenceScore(1)).toBe(4);
      expect(calculateConfidenceScore(2)).toBe(8);
      expect(calculateConfidenceScore(3)).toBe(12);
      expect(calculateConfidenceScore(4)).toBe(16);
      expect(calculateConfidenceScore(5)).toBe(20);
      expect(calculateConfidenceScore(10)).toBe(20);
    });
  });

  describe("Reliability Score Tests", () => {
    it("denominator < 3 -> 8 points", () => {
      expect(calculateReliabilityScore(1, 0)).toBe(8);
      expect(calculateReliabilityScore(2, 0)).toBe(8);
    });

    it("noShowRate < 5% -> 15 points", () => {
      // 0 no-shows out of 5 -> 0% -> 15
      expect(calculateReliabilityScore(5, 0)).toBe(15);
    });

    it("5% <= noShowRate < 15% -> 10 points", () => {
      // 1 no-show out of 10 -> 10% -> 10
      expect(calculateReliabilityScore(9, 1)).toBe(10);
    });

    it("15% <= noShowRate < 30% -> 5 points", () => {
      // 2 no-shows out of 10 -> 20% -> 5
      expect(calculateReliabilityScore(8, 2)).toBe(5);
    });

    it("noShowRate >= 30% -> 0 points", () => {
      // 3 no-shows out of 10 -> 30% -> 0
      expect(calculateReliabilityScore(7, 3)).toBe(0);
    });
  });

  describe("Fatigue Penalty Tests", () => {
    it("13 days ago -> 0 fatigue penalty (hard suppression handled separately)", () => {
      expect(calculateFatiguePenalty(13)).toBe(0);
    });

    it("14 days ago -> -10 penalty", () => {
      expect(calculateFatiguePenalty(14)).toBe(-10);
    });

    it("30 days ago -> -10 penalty", () => {
      expect(calculateFatiguePenalty(30)).toBe(-10);
    });

    it("31 days ago or null -> 0 penalty", () => {
      expect(calculateFatiguePenalty(31)).toBe(0);
      expect(calculateFatiguePenalty(null)).toBe(0);
    });
  });

  describe("Final Score Clamping", () => {
    it("clamps subtotal + fatigue between 0 and 100", () => {
      const componentsHigh = { timing: 45, value: 20, confidence: 20, reliability: 15, fatigue: 0 };
      expect(calculateFinalScore(componentsHigh)).toBe(100);

      const componentsWithFatigue = { timing: 45, value: 20, confidence: 20, reliability: 15, fatigue: -10 };
      expect(calculateFinalScore(componentsWithFatigue)).toBe(90);

      const componentsLow = { timing: 0, value: 0, confidence: 0, reliability: 0, fatigue: -10 };
      expect(calculateFinalScore(componentsLow)).toBe(0);
    });
  });

  describe("Score Reasons Match Calculations", () => {
    it("generates pt-BR reasons matching exact score calculations", () => {
      const reasons = generateScoreReasons({
        timingState: CustomerTimingState.OVERDUE,
        daysOverdue: 8,
        expectedReturnDays: 23,
        expectedReturnSource: "PERSONAL",
        completedVisitCount: 7,
        averageTicket: 85,
        scoreComponents: { timing: 30, value: 15, confidence: 20, reliability: 15, fatigue: -10 },
        noShowRate: 0.0,
        daysSinceLastContact: 18,
      });

      expect(reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "RETURN_OVERDUE", label: "Está 8 dias além do retorno esperado." }),
          expect.objectContaining({ code: "PERSONAL_CADENCE", label: "Costuma retornar a cada 23 dias." }),
          expect.objectContaining({ code: "HIGH_VISIT_CONFIDENCE", label: "Possui 7 visita(s) concluída(s)." }),
          expect.objectContaining({ code: "HIGH_RELATIVE_TICKET", label: "Ticket médio entre os mais altos da barbearia." }),
          expect.objectContaining({ code: "GOOD_ATTENDANCE", label: "Baixa taxa de ausências (0% no-show)." }),
          expect.objectContaining({ code: "RECENT_CONTACT_PENALTY", label: "Foi contatado há 18 dias: -10 pontos." }),
        ])
      );
    });
  });
});
