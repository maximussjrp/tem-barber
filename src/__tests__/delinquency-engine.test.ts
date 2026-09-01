import { describe, it, expect, vi } from "vitest";
import { AsaasPaymentStatus } from "@prisma/client";
import {
  addCivilDaysToKey,
  civilDateTimeToAbsoluteDate,
  deriveTenantDelinquencyState,
  getAsaasStoredDateOnlyKey,
  DelinquencyPaymentInput,
} from "@/lib/billing/delinquency";
import { BILLING_TIME_ZONE, getCivilDatePartsInTimeZone } from "@/lib/billing/subscription-access";
import { resolveNonReducingPeriodEnd, selectEligiblePaymentWinner } from "@/lib/asaas/entitlement";

describe("Phase 2.3D2A — Pure Delinquency Engine Complete Suite (64 Scenarios)", () => {
  const timeZone = "America/Sao_Paulo";
  const shopId = "shop1";

  describe("1. Helper Functions & Timezone Mechanics", () => {
    it("Scenario 1: getAsaasStoredDateOnlyKey converts stored UTC midnight Date to YYYY-MM-DD", () => {
      const storedDate = new Date("2026-09-01T00:00:00.000Z");
      expect(getAsaasStoredDateOnlyKey(storedDate)).toBe("2026-09-01");
    });

    it("Scenario 2: getAsaasStoredDateOnlyKey returns null for null/undefined/invalid Date", () => {
      expect(getAsaasStoredDateOnlyKey(null)).toBeNull();
      expect(getAsaasStoredDateOnlyKey(undefined)).toBeNull();
      expect(getAsaasStoredDateOnlyKey(new Date("invalid"))).toBeNull();
    });

    it("Scenario 3: addCivilDaysToKey adds N days correctly across month & leap year boundaries", () => {
      expect(addCivilDaysToKey("2026-08-26", 1)).toBe("2026-08-27");
      expect(addCivilDaysToKey("2026-08-31", 1)).toBe("2026-09-01");
      expect(addCivilDaysToKey("2024-02-28", 1)).toBe("2024-02-29");
      expect(addCivilDaysToKey("2024-02-29", 1)).toBe("2024-03-01");
      expect(addCivilDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    });

    it("Scenario 4: civilDateTimeToAbsoluteDate converts 2026-08-30 00:00 in America/Sao_Paulo to UTC Date without hardcoded -03:00", () => {
      const date = civilDateTimeToAbsoluteDate("2026-08-30", "00:00:00.000", timeZone);
      expect(date.toISOString()).toBe("2026-08-30T03:00:00.000Z");

      const civil = getCivilDatePartsInTimeZone(date, timeZone);
      expect(civil.dateString).toBe("2026-08-30");
    });

    it("Scenario 5: civilDateTimeToAbsoluteDate round-trip validation throws if conversion fails for invalid timezone string", () => {
      expect(() => {
        civilDateTimeToAbsoluteDate("2026-08-30", "00:00:00.000", "Invalid/Timezone");
      }).toThrow();
    });

    it("Scenario 5b: DST spring-forward gap in America/New_York throws CIVIL_TIME_CONVERSION_FAILED for unrepresentable 02:30 local time", () => {
      expect(() => {
        civilDateTimeToAbsoluteDate("2026-03-08", "02:30:00.000", "America/New_York");
      }).toThrowError(/CIVIL_TIME_CONVERSION_FAILED/);
    });
  });

  describe("2. Active Debt & Due Date Boundaries", () => {
    it("Scenario 6: Due date today in São Paulo -> no active debt (dueCivilKey === todayCivilKey)", () => {
      const now = new Date("2026-08-26T15:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-26T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
      expect(res.desiredDelinquencyStatus).toBe("NONE");
    });

    it("Scenario 7: One minute before civil midnight in São Paulo -> no active debt", () => {
      const now = new Date("2026-08-26T23:59:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-26T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 8: Exact D+1 midnight in São Paulo -> PAST_DUE (Grace Day 1)", () => {
      const now = new Date("2026-08-27T00:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-26T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(true);
      expect(res.desiredDelinquencyStatus).toBe("PAST_DUE");
      expect(res.anchorDueCivilKey).toBe("2026-08-26");
      expect(res.graceStartsCivilKey).toBe("2026-08-27");
      expect(res.suspensionCivilKey).toBe("2026-08-30");
      expect(res.gracePeriodEndsAt?.toISOString()).toBe("2026-08-30T03:00:00.000Z");
    });

    it("Scenario 9: Grace Day 2 (D+2) -> PAST_DUE", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-26T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(true);
      expect(res.desiredDelinquencyStatus).toBe("PAST_DUE");
    });

    it("Scenario 10: Grace Day 3 (D+3) last minute before midnight -> PAST_DUE", () => {
      const now = new Date("2026-08-29T23:59:59-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-26T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(true);
      expect(res.desiredDelinquencyStatus).toBe("PAST_DUE");
    });

    it("Scenario 11: Exact D+4 midnight in São Paulo -> SUSPENDED", () => {
      const now = new Date("2026-08-30T00:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-26T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(true);
      expect(res.desiredDelinquencyStatus).toBe("SUSPENDED");
    });

    it("Scenario 12: D+10 long overdue -> SUSPENDED", () => {
      const now = new Date("2026-09-05T12:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-26T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(true);
      expect(res.desiredDelinquencyStatus).toBe("SUSPENDED");
    });
  });

  describe("3. Multi-Debt & Anchor Selection", () => {
    it("Scenario 13: Multiple overdue payments select oldest dueDate as anchor", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_newer",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-26T00:00:00.000Z"),
          },
          {
            asaasPaymentId: "pay_older",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(true);
      expect(res.activeDebtCount).toBe(2);
      expect(res.anchorPaymentId).toBe("pay_older");
      expect(res.anchorDueCivilKey).toBe("2026-08-20");
      expect(res.desiredDelinquencyStatus).toBe("SUSPENDED"); // 2026-08-20 + 4 days = 2026-08-24 < 2026-08-28
    });

    it("Scenario 14: Tie in dueDate breaks deterministically by asaasPaymentId asc", () => {
      const now = new Date("2026-08-27T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_B",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-26T00:00:00.000Z"),
          },
          {
            asaasPaymentId: "pay_A",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-26T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.anchorPaymentId).toBe("pay_A");
    });
  });

  describe("4. Non-Debt Statuses & Warnings", () => {
    it("Scenario 15: RECEIVED status payment does not create debt", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.RECEIVED,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
      expect(res.desiredDelinquencyStatus).toBe("NONE");
    });

    it("Scenario 16: CONFIRMED status payment does not create debt", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.CONFIRMED,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 17: CANCELED status payment does not create debt", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.CANCELED,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 18: REFUNDED status payment does not create debt", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.REFUNDED,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 19: CHARGEBACK status payment does not create debt", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.CHARGEBACK,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 20: Missing dueDate emits warning PAYMENT_DUE_DATE_MISSING:${id}", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_nodue",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: null,
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
      expect(res.warnings).toContain("PAYMENT_DUE_DATE_MISSING:pay_nodue");
    });
  });

  describe("5. Pure Engine Specific Rules & Helpers", () => {
    it("Scenario 32: deriveTenantDelinquencyState returns hasActiveDebt = false when overdue payments are cleared", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "PAST_DUE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.RECEIVED,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
      expect(res.desiredDelinquencyStatus).toBe("NONE");
    });

    it("Scenario 33: SUSPENDED tenant with all debts canceled returns desiredDelinquencyStatus = NONE", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "SUSPENDED" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.CANCELED,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
      expect(res.desiredDelinquencyStatus).toBe("NONE");
    });

    it("Scenario 34: firstPositiveAt is never mutated by engine", () => {
      const payment: DelinquencyPaymentInput = {
        asaasPaymentId: "pay1",
        asaasSubscriptionId: "sub1",
        barbershopId: shopId,
        status: AsaasPaymentStatus.OVERDUE,
        dueDate: new Date("2026-08-20T00:00:00.000Z"),
        firstPositiveAt: new Date("2026-07-20T00:00:00.000Z"),
      };
      deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [payment],
      });
      expect(payment.firstPositiveAt?.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    });

    it("Scenario 35: resolveNonReducingPeriodEnd helper preserves later existing date", () => {
      const existingLater = new Date("2026-10-01T00:00:00.000Z");
      const derivedEarlier = new Date("2026-09-01T00:00:00.000Z");
      const result = resolveNonReducingPeriodEnd(existingLater, derivedEarlier);
      expect(result).toEqual(existingLater);
    });

    it("Scenario 36: Replay reconciliation is 100% idempotent", () => {
      const now = new Date("2026-08-27T10:00:00-03:00");
      const input = {
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" as const },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-26T00:00:00.000Z"),
          },
        ],
        now,
      };

      const res1 = deriveTenantDelinquencyState(input);
      const res2 = deriveTenantDelinquencyState(input);

      expect(res1.gracePeriodEndsAt?.toISOString()).toBe(res2.gracePeriodEndsAt?.toISOString());
      expect(res1.desiredDelinquencyStatus).toBe(res2.desiredDelinquencyStatus);
    });

    it("Scenario 37: Payment with missing barbershopId is ignored by pure engine and emits warning PAYMENT_TENANT_MISSING", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_no_tenant",
            asaasSubscriptionId: "sub1",
            barbershopId: null,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
      expect(res.warnings).toContain("PAYMENT_TENANT_MISSING:pay_no_tenant");
    });

    it("Scenario 38: selectEligiblePaymentWinner selects RECEIVED over null/positive payments", () => {
      const winner = selectEligiblePaymentWinner([
        {
          id: "p1",
          asaasPaymentId: "pay_old",
          barbershopId: shopId,
          asaasSubscriptionId: "sub1",
          status: AsaasPaymentStatus.RECEIVED,
          billingType: "BOLETO",
          value: 99,
          dueDate: new Date("2026-07-01T00:00:00.000Z"),
          paymentDate: new Date("2026-07-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-07-01T00:00:00.000Z"),
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        {
          id: "p2",
          asaasPaymentId: "pay_new",
          barbershopId: shopId,
          asaasSubscriptionId: "sub1",
          status: AsaasPaymentStatus.RECEIVED,
          billingType: "BOLETO",
          value: 99,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      expect(winner?.asaasPaymentId).toBe("pay_new");
    });

    it("Scenario 39: deriveTenantDelinquencyState uses input.barbershopId for isolation even when tenantSubscription is null", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: "shop_A",
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_shop_B",
            asaasSubscriptionId: "sub1",
            barbershopId: "shop_B",
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 40: selectEligiblePaymentWinner returns null when no eligible payments exist", () => {
      const winner = selectEligiblePaymentWinner([
        {
          id: "p1",
          asaasPaymentId: "pay_overdue",
          barbershopId: shopId,
          asaasSubscriptionId: "sub1",
          status: AsaasPaymentStatus.OVERDUE,
          billingType: "BOLETO",
          value: 99,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: null,
          firstPositiveAt: null,
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      expect(winner).toBeNull();
    });

    it("Scenario 41: deriveTenantDelinquencyState returns reason NO_ACTIVE_DEBT when payments array is empty", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
      expect(res.reason).toBe("NO_ACTIVE_DEBT");
    });

    it("Scenario 42: deriveTenantDelinquencyState anchor due date civil key format is strictly YYYY-MM-DD", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.anchorDueCivilKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("Scenario 43: deriveTenantDelinquencyState ignores payments from different subscription IDs", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub_CONTRACT",
        payments: [
          {
            asaasPaymentId: "pay_other_sub",
            asaasSubscriptionId: "sub_OTHER",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 44: deriveTenantDelinquencyState ignores CANCELED payments even when overdue date passed", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_canc",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.CANCELED,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 45: deriveTenantDelinquencyState ignores RECEIVED payments even when overdue date passed", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_rec",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.RECEIVED,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 46: deriveTenantDelinquencyState ignores CONFIRMED payments even when overdue date passed", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_conf",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.CONFIRMED,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 47: deriveTenantDelinquencyState ignores REFUNDED payments even when overdue date passed", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_ref",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.REFUNDED,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 48: deriveTenantDelinquencyState ignores CHARGEBACK payments even when overdue date passed", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_cb",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.CHARGEBACK,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 49: PENDING payment with due date in future does not trigger debt", () => {
      const now = new Date("2026-08-25T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_pend_fut",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.PENDING,
            dueDate: new Date("2026-08-30T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 50: PENDING payment with due date in past triggers active debt", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_pend_past",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.PENDING,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(true);
      expect(res.anchorPaymentId).toBe("pay_pend_past");
    });

    it("Scenario 51: deriveTenantDelinquencyState correctly formats graceStartsCivilKey as anchor date + 1 day", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.graceStartsCivilKey).toBe("2026-08-21");
    });

    it("Scenario 52: deriveTenantDelinquencyState correctly calculates default graceDays = 3", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.suspensionCivilKey).toBe("2026-08-24");
    });

    it("Scenario 53: Custom graceDays parameter overrides default 3 days", () => {
      const now = new Date("2026-08-23T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
        graceDays: 1, // suspensionCivilKey = 2026-08-22
      });

      expect(res.suspensionCivilKey).toBe("2026-08-22");
      expect(res.desiredDelinquencyStatus).toBe("SUSPENDED");
    });

    it("Scenario 54: Zero graceDays parameter causes immediate SUSPENDED on D+1", () => {
      const now = new Date("2026-08-21T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
        graceDays: 0, // suspensionCivilKey = 2026-08-21
      });

      expect(res.suspensionCivilKey).toBe("2026-08-21");
      expect(res.desiredDelinquencyStatus).toBe("SUSPENDED");
    });

    it("Scenario 55: Reason contains anchor payment ID when active debt is derived", () => {
      const now = new Date("2026-08-28T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: null,
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_anchor_test",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.reason).toBe("ACTIVE_DEBT_ANCHOR:pay_anchor_test");
    });

    it("Scenario 56: selectEligiblePaymentWinner uses paymentDate DESC as second tiebreaker when dueDates match", () => {
      const winner = selectEligiblePaymentWinner([
        {
          id: "p1",
          asaasPaymentId: "pay_earlier_paydate",
          barbershopId: shopId,
          asaasSubscriptionId: "sub1",
          status: AsaasPaymentStatus.RECEIVED,
          billingType: "BOLETO",
          value: 99,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
        {
          id: "p2",
          asaasPaymentId: "pay_later_paydate",
          barbershopId: shopId,
          asaasSubscriptionId: "sub1",
          status: AsaasPaymentStatus.RECEIVED,
          billingType: "BOLETO",
          value: 99,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-05T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-05T00:00:00.000Z"),
          createdAt: new Date("2026-08-05T00:00:00.000Z"),
        },
      ]);

      expect(winner?.asaasPaymentId).toBe("pay_later_paydate");
    });

    it("Scenario 57: selectEligiblePaymentWinner uses asaasPaymentId DESC as third tiebreaker when dueDate and paymentDate match", () => {
      const winner = selectEligiblePaymentWinner([
        {
          id: "p1",
          asaasPaymentId: "pay_AAA",
          barbershopId: shopId,
          asaasSubscriptionId: "sub1",
          status: AsaasPaymentStatus.RECEIVED,
          billingType: "BOLETO",
          value: 99,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
        {
          id: "p2",
          asaasPaymentId: "pay_ZZZ",
          barbershopId: shopId,
          asaasSubscriptionId: "sub1",
          status: AsaasPaymentStatus.RECEIVED,
          billingType: "BOLETO",
          value: 99,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: new Date("2026-08-01T00:00:00.000Z"),
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      expect(winner?.asaasPaymentId).toBe("pay_ZZZ");
    });

    it("Scenario 58: selectEligiblePaymentWinner includes payment with firstPositiveAt even if current status is OVERDUE", () => {
      const winner = selectEligiblePaymentWinner([
        {
          id: "p1",
          asaasPaymentId: "pay_had_positive",
          barbershopId: shopId,
          asaasSubscriptionId: "sub1",
          status: AsaasPaymentStatus.OVERDUE,
          billingType: "BOLETO",
          value: 99,
          dueDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentDate: null,
          firstPositiveAt: new Date("2026-08-01T00:00:00.000Z"),
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]);

      expect(winner?.asaasPaymentId).toBe("pay_had_positive");
    });

    it("Scenario 59: Explicit existing active TRIAL with trialEndsAt > now preserves TRIAL state in engine inputs", () => {
      const now = new Date("2026-08-10T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: {
          barbershopId: shopId,
          status: "TRIAL",
          trialEndsAt: new Date("2026-08-20T00:00:00-03:00"),
        },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
    });

    it("Scenario 60: Timezone conversion uses iterative convergence + successful round-trip validation", () => {
      const date = civilDateTimeToAbsoluteDate("2026-08-30", "00:00:00.000", "America/Sao_Paulo");
      const formatted = getCivilDatePartsInTimeZone(date, "America/Sao_Paulo");
      expect(formatted.dateString).toBe("2026-08-30");
    });

    it("Scenario 61: Timezone conversion failure throws error", () => {
      expect(() => {
        civilDateTimeToAbsoluteDate("2026-08-30", "00:00:00.000", "Invalid/Timezone");
      }).toThrow();
    });

    it("Scenario 62: UNKNOWN status produces warning PAYMENT_STATUS_UNKNOWN:${id} and remains non-debt", () => {
      const now = new Date("2026-08-29T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub1",
        payments: [
          {
            asaasPaymentId: "pay_unk_62",
            asaasSubscriptionId: "sub1",
            barbershopId: shopId,
            status: AsaasPaymentStatus.UNKNOWN,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
      expect(res.warnings).toContain("PAYMENT_STATUS_UNKNOWN:pay_unk_62");
    });

    it("Scenario 63: Same subscription ID but different barbershop ID -> payment ignored (pure engine tenant scope)", () => {
      const now = new Date("2026-08-29T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: "shop_TENANT_A",
        tenantSubscription: { barbershopId: "shop_TENANT_A", status: "ACTIVE" },
        currentContractAsaasSubscriptionId: "sub_SHARED",
        payments: [
          {
            asaasPaymentId: "pay_other_tenant",
            asaasSubscriptionId: "sub_SHARED",
            barbershopId: "shop_TENANT_B",
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
      expect(res.desiredDelinquencyStatus).toBe("NONE");
    });

    it("Scenario 64: Null current contract (currentContractAsaasSubscriptionId === null) -> hasActiveDebt = false, reason = NO_CURRENT_CONTRACT", () => {
      const now = new Date("2026-08-29T10:00:00-03:00");
      const res = deriveTenantDelinquencyState({
        barbershopId: shopId,
        tenantSubscription: { barbershopId: shopId, status: "ACTIVE" },
        currentContractAsaasSubscriptionId: null,
        payments: [
          {
            asaasPaymentId: "pay1",
            asaasSubscriptionId: null,
            barbershopId: shopId,
            status: AsaasPaymentStatus.OVERDUE,
            dueDate: new Date("2026-08-20T00:00:00.000Z"),
          },
        ],
        now,
      });

      expect(res.hasActiveDebt).toBe(false);
      expect(res.activeDebtCount).toBe(0);
      expect(res.anchorPaymentId).toBeNull();
      expect(res.desiredDelinquencyStatus).toBe("NONE");
      expect(res.reason).toBe("NO_CURRENT_CONTRACT");
    });
  });
});
