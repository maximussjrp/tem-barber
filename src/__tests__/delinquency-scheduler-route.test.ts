import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  scheduler: vi.fn(),
  timingSafeEqual: vi.fn(),
}));

vi.mock("@/lib/billing/delinquency-scheduler", () => ({
  runDelinquencyScheduler: mocks.scheduler,
}));

vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:crypto")>();
  return {
    ...original,
    timingSafeEqual: mocks.timingSafeEqual,
  };
});

import {
  DELETE,
  GET,
  HEAD,
  OPTIONS,
  PATCH,
  POST,
  PUT,
  dynamic,
  runtime,
} from "@/app/api/internal/billing/reconcile-delinquency/route";

const SECRET = "0123456789abcdef0123456789abcdef";

function schedulerResult(failedCount = 0) {
  return {
    runId: "00000000-0000-4000-8000-000000000000",
    startedAt: "2026-09-01T00:00:00.000Z",
    finishedAt: "2026-09-01T00:00:01.000Z",
    durationMs: 1_000,
    candidateCount: 1,
    processedCount: 1,
    reconciledCount: failedCount ? 0 : 1,
    noChangeCount: 0,
    skippedCount: 0,
    failedCount,
    failures: failedCount
      ? [{ barbershopId: "shop-1", reasonCode: "INTERNAL_RECONCILIATION_ERROR" }]
      : [],
  };
}

function request(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) {
    headers.set("Authorization", authorization);
  }
  return new Request("https://app.tembarber.com.br/api/internal/billing/reconcile-delinquency", {
    method: "POST",
    headers,
  });
}

describe("D2B internal scheduler route", () => {
  beforeEach(() => {
    process.env.D2B_JOB_SECRET = SECRET;
    mocks.scheduler.mockReset();
    mocks.scheduler.mockResolvedValue(schedulerResult());
    mocks.timingSafeEqual.mockReset();
    mocks.timingSafeEqual.mockReturnValue(true);
  });

  afterEach(() => {
    delete process.env.D2B_JOB_SECRET;
  });

  it("exports the required Node runtime and dynamic route settings", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
  });

  it.each([
    ["missing configured secret", undefined, `Bearer ${SECRET}`],
    ["missing Authorization", SECRET, undefined],
    ["malformed Bearer", SECRET, `bearer ${SECRET}`],
    ["Bearer with extra whitespace", SECRET, `Bearer  ${SECRET}`],
  ])("returns the same 401 with zero work for %s", async (_label, configured, authorization) => {
    if (configured === undefined) {
      delete process.env.D2B_JOB_SECRET;
    } else {
      process.env.D2B_JOB_SECRET = configured;
    }

    const response = await POST(request(authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
    expect(mocks.scheduler).not.toHaveBeenCalled();
  });

  it("rejects a wrong equal-length secret using timingSafeEqual", async () => {
    mocks.timingSafeEqual.mockReturnValue(false);

    const response = await POST(request(`Bearer ${"x".repeat(SECRET.length)}`));

    expect(response.status).toBe(401);
    expect(mocks.timingSafeEqual).toHaveBeenCalledTimes(1);
    expect(mocks.scheduler).not.toHaveBeenCalled();
  });

  it("rejects a different-length secret without calling timingSafeEqual", async () => {
    const response = await POST(request("Bearer short"));

    expect(response.status).toBe(401);
    expect(mocks.timingSafeEqual).not.toHaveBeenCalled();
    expect(mocks.scheduler).not.toHaveBeenCalled();
  });

  it("authenticates before scheduler population and returns 200 on success", async () => {
    const response = await POST(request(`Bearer ${SECRET}`));

    expect(mocks.timingSafeEqual).toHaveBeenCalledTimes(1);
    expect(mocks.scheduler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, failedCount: 0 });
  });

  it("returns 500 JOB_PARTIAL_FAILURE when any tenant fails", async () => {
    mocks.scheduler.mockResolvedValueOnce(schedulerResult(1));

    const response = await POST(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "JOB_PARTIAL_FAILURE",
      failedCount: 1,
    });
  });

  it("returns 409 to an authorized duplicate without starting duplicate work", async () => {
    let release!: (value: ReturnType<typeof schedulerResult>) => void;
    mocks.scheduler.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve;
    }));

    const firstResponsePromise = POST(request(`Bearer ${SECRET}`));
    await vi.waitFor(() => expect(mocks.scheduler).toHaveBeenCalledTimes(1));
    const duplicateResponse = await POST(request(`Bearer ${SECRET}`));

    expect(duplicateResponse.status).toBe(409);
    await expect(duplicateResponse.json()).resolves.toEqual({ error: "JOB_ALREADY_RUNNING" });
    expect(mocks.scheduler).toHaveBeenCalledTimes(1);
    release(schedulerResult());
    expect((await firstResponsePromise).status).toBe(200);
  });

  it("releases the single-flight guard after success", async () => {
    expect((await POST(request(`Bearer ${SECRET}`))).status).toBe(200);
    expect((await POST(request(`Bearer ${SECRET}`))).status).toBe(200);
    expect(mocks.scheduler).toHaveBeenCalledTimes(2);
  });

  it("returns a generic execution failure and releases the guard after a throw", async () => {
    mocks.scheduler.mockRejectedValueOnce(new Error("sensitive stack or SQL"));

    const failedResponse = await POST(request(`Bearer ${SECRET}`));
    const nextResponse = await POST(request(`Bearer ${SECRET}`));

    expect(failedResponse.status).toBe(500);
    await expect(failedResponse.json()).resolves.toEqual({ error: "JOB_EXECUTION_FAILED" });
    expect(nextResponse.status).toBe(200);
    expect(mocks.scheduler).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["GET", GET],
    ["HEAD", HEAD],
    ["PUT", PUT],
    ["PATCH", PATCH],
    ["DELETE", DELETE],
  ])("returns 405 and performs zero scheduler work for %s", async (_method, handler) => {
    const response = await handler();

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(mocks.scheduler).not.toHaveBeenCalled();
  });

  it("returns 204 and performs zero scheduler work for OPTIONS", async () => {
    const response = OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(mocks.scheduler).not.toHaveBeenCalled();
  });
});
