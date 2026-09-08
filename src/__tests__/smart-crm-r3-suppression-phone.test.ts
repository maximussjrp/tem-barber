import { describe, expect, it } from "vitest";
import { CustomerTimingState } from "@prisma/client";
import { validateBrazilianMobilePhone } from "@/lib/phone/br-phone";
import { evaluateSuppressions } from "@/lib/clients/reactivation";

describe("Smart CRM R3 — Suppression & Phone Parity Unit Tests", () => {
  describe("Individual Suppression Matrix", () => {
    it("Upcoming Appointment PENDING or CONFIRMED -> suppresses recommendation", () => {
      const res = evaluateSuppressions({
        phone: "5511999991234",
        completedVisitCount: 5,
        hasUpcomingAppointment: true,
        isBlocked: false,
        daysSinceLastContact: null,
        consentStatus: "OPTED_IN",
        timingState: CustomerTimingState.DUE,
      });

      expect(res.recommendationEligible).toBe(false);
      expect(res.recommendationSuppressions).toContain("UPCOMING_APPOINTMENT");
      expect(res.dispatchEligible).toBe(false);
    });

    it("Active Blocked customer -> suppresses recommendation", () => {
      const res = evaluateSuppressions({
        phone: "5511999991234",
        completedVisitCount: 5,
        hasUpcomingAppointment: false,
        isBlocked: true,
        daysSinceLastContact: null,
        consentStatus: "OPTED_IN",
        timingState: CustomerTimingState.DUE,
      });

      expect(res.recommendationEligible).toBe(false);
      expect(res.recommendationSuppressions).toContain("BLOCKED");
    });

    it("NO_HISTORY -> suppresses recommendation", () => {
      const res = evaluateSuppressions({
        phone: "5511999991234",
        completedVisitCount: 0,
        hasUpcomingAppointment: false,
        isBlocked: false,
        daysSinceLastContact: null,
        consentStatus: "OPTED_IN",
        timingState: CustomerTimingState.NO_HISTORY,
      });

      expect(res.recommendationEligible).toBe(false);
      expect(res.recommendationSuppressions).toContain("NO_HISTORY");
    });

    it("Recent contact <14 days -> suppresses recommendation", () => {
      const res = evaluateSuppressions({
        phone: "5511999991234",
        completedVisitCount: 5,
        hasUpcomingAppointment: false,
        isBlocked: false,
        daysSinceLastContact: 13,
        consentStatus: "OPTED_IN",
        timingState: CustomerTimingState.DUE,
      });

      expect(res.recommendationEligible).toBe(false);
      expect(res.recommendationSuppressions).toContain("RECENT_CONTACT");
    });

    it("Contact >=14 days -> recommendation eligible", () => {
      const res = evaluateSuppressions({
        phone: "5511999991234",
        completedVisitCount: 5,
        hasUpcomingAppointment: false,
        isBlocked: false,
        daysSinceLastContact: 14,
        consentStatus: "OPTED_IN",
        timingState: CustomerTimingState.DUE,
      });

      expect(res.recommendationEligible).toBe(true);
      expect(res.recommendationSuppressions).toHaveLength(0);
    });

    it("Consent Status Rules (UNKNOWN / OPTED_IN / OPTED_OUT)", () => {
      // UNKNOWN: recommendation eligible YES, dispatch eligible NO
      const resUnknown = evaluateSuppressions({
        phone: "5511999991234",
        completedVisitCount: 5,
        hasUpcomingAppointment: false,
        isBlocked: false,
        daysSinceLastContact: null,
        consentStatus: "UNKNOWN",
        timingState: CustomerTimingState.DUE,
      });
      expect(resUnknown.recommendationEligible).toBe(true);
      expect(resUnknown.dispatchEligible).toBe(false);
      expect(resUnknown.dispatchSuppressions).toContain("CONSENT_UNKNOWN");

      // OPTED_IN: recommendation eligible YES, dispatch eligible YES
      const resOptedIn = evaluateSuppressions({
        phone: "5511999991234",
        completedVisitCount: 5,
        hasUpcomingAppointment: false,
        isBlocked: false,
        daysSinceLastContact: null,
        consentStatus: "OPTED_IN",
        timingState: CustomerTimingState.DUE,
      });
      expect(resOptedIn.recommendationEligible).toBe(true);
      expect(resOptedIn.dispatchEligible).toBe(true);

      // OPTED_OUT: recommendation eligible YES, dispatch eligible NO
      const resOptedOut = evaluateSuppressions({
        phone: "5511999991234",
        completedVisitCount: 5,
        hasUpcomingAppointment: false,
        isBlocked: false,
        daysSinceLastContact: null,
        consentStatus: "OPTED_OUT",
        timingState: CustomerTimingState.DUE,
      });
      expect(resOptedOut.recommendationEligible).toBe(true);
      expect(resOptedOut.dispatchEligible).toBe(false);
      expect(resOptedOut.dispatchSuppressions).toContain("CONSENT_OPTED_OUT");
    });
  });

  describe("Phone Validator Parity Test Matrix", () => {
    it("verifies 100% parity between candidate phone eligibility and validateBrazilianMobilePhone", () => {
      const validDdds = [
        11, 12, 13, 14, 15, 16, 17, 18, 19,
        21, 22, 24, 27, 28,
        31, 32, 33, 34, 35, 37, 38,
        41, 42, 43, 44, 45, 46, 47, 48, 49,
        51, 53, 54, 55,
        61, 62, 64, 63, 65, 66, 67, 68, 69,
        71, 73, 74, 75, 77, 79,
        81, 87, 82, 83, 84, 85, 88, 86, 89,
        91, 93, 94, 92, 97, 95, 96, 98, 99
      ];

      const testFixtures: string[] = [];

      // Valid DDD canonical phones
      for (const ddd of validDdds) {
        testFixtures.push(`55${ddd}991089190`);
        testFixtures.push(`(${ddd}) 99108-9190`);
      }

      // Invalid DDDs
      testFixtures.push("5510991089190");
      testFixtures.push("5520991089190");
      testFixtures.push("5530991089190");

      // Landlines (starts with 2,3,4,5)
      testFixtures.push("551133334444");
      testFixtures.push("1133334444");

      // Legacy bypasses
      testFixtures.push("5511999999999");
      testFixtures.push("557988240050");
      testFixtures.push("5579988240050");

      // Fake / repeating / sequential
      testFixtures.push("5511911111111");
      testFixtures.push("5511912345678");
      testFixtures.push("5511987654321");
      testFixtures.push("5511900000123");

      // Invalid length / null / garbage
      testFixtures.push("");
      testFixtures.push("123");
      testFixtures.push("abc");
      testFixtures.push("55119910");

      let parityMismatchCount = 0;

      for (const phone of testFixtures) {
        const canonicalValid = validateBrazilianMobilePhone(phone);
        const engineResult = evaluateSuppressions({
          phone,
          completedVisitCount: 5,
          hasUpcomingAppointment: false,
          isBlocked: false,
          daysSinceLastContact: null,
          consentStatus: "OPTED_IN",
          timingState: CustomerTimingState.DUE,
        });

        const enginePhoneValid = !engineResult.recommendationSuppressions.includes("INVALID_PHONE");

        if (canonicalValid !== enginePhoneValid) {
          parityMismatchCount++;
          console.error(`Parity mismatch for phone: ${phone}. Canonical: ${canonicalValid}, Engine: ${enginePhoneValid}`);
        }
      }

      expect(parityMismatchCount).toBe(0);
    });
  });
});
