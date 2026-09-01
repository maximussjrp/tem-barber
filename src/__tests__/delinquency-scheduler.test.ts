import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock("@/lib/asaas/entitlement", () => ({
  reconcileTenantSubscriptionBillingState: mocks.reconcile,
}));

import {
  DELINQUENCY_SCHEDULER_MAX_CONCURRENCY,
  DELINQUENCY_SCHEDULER_PAGE_SIZE,
  runDelinquencyScheduler,
} from "@/lib/billing/delinquency-scheduler";

type SqlQuery = {
  strings: readonly string[];
  values: unknown[];
};

function candidates(from: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    barbershopId: `shop-${String(from + index).padStart(4, "0")}`,
  }));
}

function successfulReconciliation(reason = "RECONCILED") {
  return { recomputed: true, reason };
}

describe("D2B delinquency scheduler", () => {
  beforeEach(() => {
    mocks.queryRaw.mockReset();
    mocks.reconcile.mockReset();
    mocks.reconcile.mockResolvedValue(successfulReconciliation());
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("uses the frozen distinct, unfiltered first-page population query", async () => {
    mocks.queryRaw.mockResolvedValue([]);

    await runDelinquencyScheduler();

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const query = mocks.queryRaw.mock.calls[0][0] as SqlQuery;
    const sql = query.strings.join("?").replace(/\s+/g, " ").trim();
    expect(sql).toContain("SELECT DISTINCT barbershop_id AS \"barbershopId\"");
    expect(sql).toContain("FROM asaas_billing_subscriptions");
    expect(sql).toContain("ORDER BY barbershop_id ASC");
    expect(sql).toContain("LIMIT ?");
    expect(sql).not.toMatch(/\bWHERE\b/i);
    expect(sql).not.toMatch(/\bstatus\b/i);
    expect(sql).not.toMatch(/canceled_at|canceledAt/i);
    expect(query.values).toEqual([DELINQUENCY_SCHEDULER_PAGE_SIZE]);
  });

  it("uses the previous page's final id as a parameterized later-page cursor", async () => {
    const firstPage = candidates(0, 100);
    mocks.queryRaw.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([]);

    await runDelinquencyScheduler();

    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    const query = mocks.queryRaw.mock.calls[1][0] as SqlQuery;
    const sql = query.strings.join("?").replace(/\s+/g, " ").trim();
    expect(sql).toContain("WHERE barbershop_id > ?");
    expect(sql).toContain("ORDER BY barbershop_id ASC");
    expect(query.values).toEqual(["shop-0099", DELINQUENCY_SCHEDULER_PAGE_SIZE]);
  });

  it("handles the exact 100-record boundary without duplicates or omissions", async () => {
    const page = candidates(0, 100);
    mocks.queryRaw.mockResolvedValueOnce(page).mockResolvedValueOnce([]);

    const result = await runDelinquencyScheduler();

    const processed = mocks.reconcile.mock.calls.map(([barbershopId]) => barbershopId);
    expect(processed).toEqual(page.map(({ barbershopId }) => barbershopId));
    expect(new Set(processed).size).toBe(100);
    expect(result.candidateCount).toBe(100);
    expect(result.processedCount).toBe(100);
  });

  it("traverses 1,000 candidates page-by-page and never exceeds four reconciliations", async () => {
    const population = candidates(0, 1_000);
    let pageIndex = 0;
    mocks.queryRaw.mockImplementation(async () => {
      const page = population.slice(pageIndex * 100, (pageIndex + 1) * 100);
      pageIndex += 1;
      return page;
    });
    let active = 0;
    let maximumActive = 0;
    mocks.reconcile.mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      return successfulReconciliation();
    });

    const result = await runDelinquencyScheduler();

    const processed = mocks.reconcile.mock.calls.map(([barbershopId]) => barbershopId);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(11);
    expect(processed).toHaveLength(1_000);
    expect(new Set(processed).size).toBe(1_000);
    expect(processed).toEqual(expect.arrayContaining(population.map(({ barbershopId }) => barbershopId)));
    expect(maximumActive).toBe(DELINQUENCY_SCHEDULER_MAX_CONCURRENCY);
    expect(maximumActive).toBeLessThanOrEqual(4);
    expect(result.candidateCount).toBe(1_000);
    expect(result.processedCount).toBe(1_000);
  });

  it("classifies reconciled, no-change, and every frozen skip reason", async () => {
    mocks.queryRaw.mockResolvedValueOnce(candidates(0, 5));
    mocks.reconcile
      .mockResolvedValueOnce(successfulReconciliation())
      .mockResolvedValueOnce(successfulReconciliation("IDEMPOTENT_NO_CHANGE"))
      .mockResolvedValueOnce({ recomputed: false, reason: "NO_CONTRACT" })
      .mockResolvedValueOnce({ recomputed: false, reason: "NO_WINNER" })
      .mockResolvedValueOnce({ recomputed: false, reason: "NO_VALID_ENTITLEMENT" });

    const result = await runDelinquencyScheduler();

    expect(result).toMatchObject({
      candidateCount: 5,
      processedCount: 5,
      reconciledCount: 1,
      noChangeCount: 1,
      skippedCount: 3,
      failedCount: 0,
    });
    expect(result.processedCount).toBe(
      result.reconciledCount + result.noChangeCount + result.skippedCount + result.failedCount
    );
  });

  it("isolates tenant failures and maps only exact known error messages", async () => {
    const knownCodes = [
      "ASAAS_PLAN_CODE_MISSING",
      "PLAN_CODE_NOT_FOUND",
      "TENANT_PLAN_CODE_MISMATCH",
      "CIVIL_TIME_CONVERSION_FAILED",
    ];
    mocks.queryRaw.mockResolvedValueOnce(candidates(0, 7));
    for (const code of knownCodes) {
      mocks.reconcile.mockRejectedValueOnce(new Error(code));
    }
    mocks.reconcile
      .mockRejectedValueOnce(new Error("CIVIL_TIME_CONVERSION_FAILED: raw details"))
      .mockRejectedValueOnce({ sensitive: "payload" })
      .mockResolvedValueOnce(successfulReconciliation());

    const result = await runDelinquencyScheduler();

    expect(result.processedCount).toBe(7);
    expect(result.reconciledCount).toBe(1);
    expect(result.failedCount).toBe(6);
    expect(result.failures.map(({ reasonCode }) => reasonCode)).toEqual([
      ...knownCodes,
      "INTERNAL_RECONCILIATION_ERROR",
      "INTERNAL_RECONCILIATION_ERROR",
    ]);
    const failureLogs = vi.mocked(console.error).mock.calls.map(([line]) => String(line));
    expect(failureLogs.join("\n")).not.toContain("raw details");
    expect(failureLogs.join("\n")).not.toContain("sensitive");
    expect(failureLogs.join("\n")).not.toContain("payload");
  });

  it("classifies an unexpected non-throwing result as an internal failure", async () => {
    mocks.queryRaw.mockResolvedValueOnce(candidates(0, 1));
    mocks.reconcile.mockResolvedValueOnce({ recomputed: false, reason: "UNEXPECTED" });

    const result = await runDelinquencyScheduler();

    expect(result.failedCount).toBe(1);
    expect(result.failures).toEqual([
      { barbershopId: "shop-0000", reasonCode: "INTERNAL_RECONCILIATION_ERROR" },
    ]);
  });

  it("calls D2A with barbershopId only and emits the frozen completion fields", async () => {
    mocks.queryRaw.mockResolvedValueOnce(candidates(0, 1));

    const result = await runDelinquencyScheduler();

    expect(mocks.reconcile).toHaveBeenCalledWith("shop-0000");
    expect(mocks.reconcile.mock.calls[0]).toHaveLength(1);
    expect(result.runId).toMatch(/^[0-9a-f-]{36}$/i);
    const completion = JSON.parse(String(vi.mocked(console.info).mock.calls[0][0]));
    expect(Object.keys(completion)).toEqual([
      "event",
      "runId",
      "startedAt",
      "finishedAt",
      "durationMs",
      "candidateCount",
      "processedCount",
      "reconciledCount",
      "noChangeCount",
      "skippedCount",
      "failedCount",
    ]);
    expect(completion.event).toBe("billing.delinquency_reconciliation.completed");
  });
});
