import { describe, expect, it, vi } from "vitest";
import {
  assertCommercialConsistency,
  getActivePlanByCode,
  getPlanByCode,
  PlanResolutionError,
} from "@/lib/billing/plans-db";
import { ACTIVE_BILLING_PLAN_CODE, getBillingPlanByCode } from "@/lib/billing/plans";

describe("Plan Code Resolution & Commercial Consistency (D2A)", () => {
  const catalogPlan = getBillingPlanByCode(ACTIVE_BILLING_PLAN_CODE)!;

  const mockDbPlanActive = {
    id: "plan-111",
    code: "pro_monthly",
    name: "Plano Tem Barber",
    description: "Plano completo",
    price: 49.9,
    period: "MONTHLY",
    maxMembers: 3,
    isActive: true,
  };

  const mockDbPlanInactive = {
    ...mockDbPlanActive,
    id: "plan-222",
    code: "legacy_plan",
    isActive: false,
  };

  const mockDbFounderPlan = {
    id: "plan-333",
    code: "founder_2026",
    name: "Plano Founder 2026",
    price: 39.9,
    period: "MONTHLY",
    maxMembers: 10,
    isActive: true,
  };

  it("getPlanByCode uses findUnique to resolve plan by code and does NOT call findFirst", async () => {
    const mockDb = {
      plan: {
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: { code: string } }) => {
          if (where.code === "pro_monthly") return mockDbPlanActive;
          if (where.code === "legacy_plan") return mockDbPlanInactive;
          return null;
        }),
        findFirst: vi.fn(),
      },
    };

    const activeResult = await getPlanByCode(mockDb as any, "pro_monthly");
    expect(activeResult).toEqual(mockDbPlanActive);
    expect(mockDb.plan.findUnique).toHaveBeenCalledWith({ where: { code: "pro_monthly" } });
    expect(mockDb.plan.findFirst).not.toHaveBeenCalled();

    const inactiveResult = await getPlanByCode(mockDb as any, "legacy_plan");
    expect(inactiveResult).toEqual(mockDbPlanInactive);
  });

  it("getActivePlanByCode throws PLAN_CODE_NOT_FOUND if code does not exist", async () => {
    const mockDb = {
      plan: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    await expect(getActivePlanByCode(mockDb as any, "non_existent_code")).rejects.toThrow(
      PlanResolutionError
    );
    try {
      await getActivePlanByCode(mockDb as any, "non_existent_code");
    } catch (err: any) {
      expect(err.code).toBe("PLAN_CODE_NOT_FOUND");
    }
  });

  it("getActivePlanByCode throws PLAN_CODE_INACTIVE if plan exists but isActive=false", async () => {
    const mockDb = {
      plan: {
        findUnique: vi.fn().mockResolvedValue(mockDbPlanInactive),
      },
    };

    await expect(getActivePlanByCode(mockDb as any, "legacy_plan")).rejects.toThrow(
      PlanResolutionError
    );
    try {
      await getActivePlanByCode(mockDb as any, "legacy_plan");
    } catch (err: any) {
      expect(err.code).toBe("PLAN_CODE_INACTIVE");
    }
  });

  it("coexisting second active plan (founder_2026) does not interfere with pro_monthly resolution", async () => {
    const mockDb = {
      plan: {
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: { code: string } }) => {
          if (where.code === "pro_monthly") return mockDbPlanActive;
          if (where.code === "founder_2026") return mockDbFounderPlan;
          return null;
        }),
      },
    };

    const proResult = await getActivePlanByCode(mockDb as any, "pro_monthly");
    expect(proResult.id).toBe("plan-111");
    expect(proResult.code).toBe("pro_monthly");
  });

  it("assertCommercialConsistency passes when code, price, and period match", () => {
    expect(() => assertCommercialConsistency(catalogPlan, mockDbPlanActive)).not.toThrow();
  });

  it("assertCommercialConsistency throws PLAN_CATALOG_DB_MISMATCH on code mismatch", () => {
    const wrongCodeDbPlan = { ...mockDbPlanActive, code: "founder_2026" };

    try {
      assertCommercialConsistency(catalogPlan, wrongCodeDbPlan);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(PlanResolutionError);
      expect(err.code).toBe("PLAN_CATALOG_DB_MISMATCH");
    }
  });

  it("assertCommercialConsistency throws PLAN_CATALOG_DB_MISMATCH when dbPlan.code differs from catalogPlan.code", () => {
    const wrongCodeDbPlan = { ...mockDbPlanActive, code: "different_code" };

    try {
      assertCommercialConsistency(catalogPlan, wrongCodeDbPlan);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(PlanResolutionError);
      expect(err.code).toBe("PLAN_CATALOG_DB_MISMATCH");
    }
  });

  it("assertCommercialConsistency logs warning on name mismatch but does not throw", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renamedDbPlan = { ...mockDbPlanActive, name: "Plano Profissional Renomeado" };

    expect(() => assertCommercialConsistency(catalogPlan, renamedDbPlan)).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Nome do plano no banco")
    );
    consoleSpy.mockRestore();
  });

  it("assertCommercialConsistency throws PLAN_CATALOG_DB_MISMATCH on price mismatch", () => {
    const wrongPriceDbPlan = { ...mockDbPlanActive, price: 99.9 };

    try {
      assertCommercialConsistency(catalogPlan, wrongPriceDbPlan);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(PlanResolutionError);
      expect(err.code).toBe("PLAN_CATALOG_DB_MISMATCH");
    }
  });

  it("assertCommercialConsistency throws PLAN_CATALOG_DB_MISMATCH on period mismatch", () => {
    const wrongPeriodDbPlan = { ...mockDbPlanActive, period: "YEARLY" };

    try {
      assertCommercialConsistency(catalogPlan, wrongPeriodDbPlan);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(PlanResolutionError);
      expect(err.code).toBe("PLAN_CATALOG_DB_MISMATCH");
    }
  });
});
