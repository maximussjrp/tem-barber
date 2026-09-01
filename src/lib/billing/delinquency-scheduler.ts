import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { reconcileTenantSubscriptionBillingState } from "@/lib/asaas/entitlement";

export const DELINQUENCY_SCHEDULER_PAGE_SIZE = 100;
export const DELINQUENCY_SCHEDULER_MAX_CONCURRENCY = 4;

const SKIPPED_REASONS = new Set([
  "NO_CONTRACT",
  "NO_WINNER",
  "NO_VALID_ENTITLEMENT",
]);

const KNOWN_FAILURE_CODES = new Set([
  "ASAAS_PLAN_CODE_MISSING",
  "PLAN_CODE_NOT_FOUND",
  "TENANT_PLAN_CODE_MISMATCH",
  "CIVIL_TIME_CONVERSION_FAILED",
]);

type SchedulerCandidate = {
  barbershopId: string;
};

export type DelinquencySchedulerFailure = {
  barbershopId: string;
  reasonCode: string;
};

export type DelinquencySchedulerResult = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  candidateCount: number;
  processedCount: number;
  reconciledCount: number;
  noChangeCount: number;
  skippedCount: number;
  failedCount: number;
  failures: DelinquencySchedulerFailure[];
};

type MutableSchedulerCounts = Pick<
  DelinquencySchedulerResult,
  | "candidateCount"
  | "processedCount"
  | "reconciledCount"
  | "noChangeCount"
  | "skippedCount"
  | "failedCount"
>;

function mapFailureReason(error: unknown): string {
  if (error instanceof Error && KNOWN_FAILURE_CODES.has(error.message)) {
    return error.message;
  }

  return "INTERNAL_RECONCILIATION_ERROR";
}

async function fetchCandidatePage(cursor: string | null): Promise<SchedulerCandidate[]> {
  if (cursor === null) {
    return prisma.$queryRaw<SchedulerCandidate[]>(Prisma.sql`
      SELECT DISTINCT barbershop_id AS "barbershopId"
      FROM asaas_billing_subscriptions
      ORDER BY barbershop_id ASC
      LIMIT ${DELINQUENCY_SCHEDULER_PAGE_SIZE}
    `);
  }

  return prisma.$queryRaw<SchedulerCandidate[]>(Prisma.sql`
    SELECT DISTINCT barbershop_id AS "barbershopId"
    FROM asaas_billing_subscriptions
    WHERE barbershop_id > ${cursor}
    ORDER BY barbershop_id ASC
    LIMIT ${DELINQUENCY_SCHEDULER_PAGE_SIZE}
  `);
}

async function processCandidate(
  candidate: SchedulerCandidate,
  runId: string,
  counts: MutableSchedulerCounts,
  failures: DelinquencySchedulerFailure[]
): Promise<void> {
  try {
    const result = await reconcileTenantSubscriptionBillingState(candidate.barbershopId);

    if (result.recomputed && result.reason === "IDEMPOTENT_NO_CHANGE") {
      counts.noChangeCount += 1;
    } else if (result.recomputed) {
      counts.reconciledCount += 1;
    } else if (result.reason && SKIPPED_REASONS.has(result.reason)) {
      counts.skippedCount += 1;
    } else {
      const failure = {
        barbershopId: candidate.barbershopId,
        reasonCode: "INTERNAL_RECONCILIATION_ERROR",
      };
      counts.failedCount += 1;
      failures.push(failure);
      console.error(JSON.stringify({
        event: "billing.delinquency_reconciliation.tenant_failed",
        runId,
        ...failure,
      }));
    }
  } catch (error: unknown) {
    const failure = {
      barbershopId: candidate.barbershopId,
      reasonCode: mapFailureReason(error),
    };
    counts.failedCount += 1;
    failures.push(failure);
    console.error(JSON.stringify({
      event: "billing.delinquency_reconciliation.tenant_failed",
      runId,
      ...failure,
    }));
  } finally {
    counts.processedCount += 1;
  }
}

async function processPage(
  candidates: SchedulerCandidate[],
  runId: string,
  counts: MutableSchedulerCounts,
  failures: DelinquencySchedulerFailure[]
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(DELINQUENCY_SCHEDULER_MAX_CONCURRENCY, candidates.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const candidateIndex = nextIndex;
      nextIndex += 1;

      if (candidateIndex >= candidates.length) {
        return;
      }

      await processCandidate(candidates[candidateIndex], runId, counts, failures);
    }
  });

  await Promise.all(workers);
}

export async function runDelinquencyScheduler(): Promise<DelinquencySchedulerResult> {
  const runId = randomUUID();
  const startedAtDate = new Date();
  const counts: MutableSchedulerCounts = {
    candidateCount: 0,
    processedCount: 0,
    reconciledCount: 0,
    noChangeCount: 0,
    skippedCount: 0,
    failedCount: 0,
  };
  const failures: DelinquencySchedulerFailure[] = [];
  let cursor: string | null = null;

  while (true) {
    const candidates = await fetchCandidatePage(cursor);
    if (candidates.length === 0) {
      break;
    }

    counts.candidateCount += candidates.length;
    await processPage(candidates, runId, counts, failures);
    cursor = candidates[candidates.length - 1].barbershopId;

    if (candidates.length < DELINQUENCY_SCHEDULER_PAGE_SIZE) {
      break;
    }
  }

  const finishedAtDate = new Date();
  const result: DelinquencySchedulerResult = {
    runId,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
    ...counts,
    failures,
  };

  console.info(JSON.stringify({
    event: "billing.delinquency_reconciliation.completed",
    runId: result.runId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    candidateCount: result.candidateCount,
    processedCount: result.processedCount,
    reconciledCount: result.reconciledCount,
    noChangeCount: result.noChangeCount,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
  }));

  return result;
}
