import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDelinquencyScheduler } from "@/lib/billing/delinquency-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let schedulerRunActive = false;

function unauthorizedResponse() {
  return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
}

function isAuthorized(request: Request): boolean {
  const configuredSecret = process.env.D2B_JOB_SECRET;
  if (!configuredSecret) {
    return false;
  }

  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    return false;
  }

  const configuredBytes = Buffer.from(configuredSecret);
  const suppliedBytes = Buffer.from(match[1]);
  if (configuredBytes.byteLength !== suppliedBytes.byteLength) {
    return false;
  }

  return timingSafeEqual(configuredBytes, suppliedBytes);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return unauthorizedResponse();
  }

  if (schedulerRunActive) {
    return NextResponse.json({ error: "JOB_ALREADY_RUNNING" }, { status: 409 });
  }

  schedulerRunActive = true;
  try {
    const result = await runDelinquencyScheduler();
    if (result.failedCount > 0) {
      return NextResponse.json(
        { error: "JOB_PARTIAL_FAILURE", ...result },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "JOB_EXECUTION_FAILED" }, { status: 500 });
  } finally {
    schedulerRunActive = false;
  }
}

function methodNotAllowedResponse() {
  return NextResponse.json(
    { error: "METHOD_NOT_ALLOWED" },
    { status: 405, headers: { Allow: "POST" } }
  );
}

export const GET = methodNotAllowedResponse;
export const HEAD = methodNotAllowedResponse;
export const PUT = methodNotAllowedResponse;
export const PATCH = methodNotAllowedResponse;
export const DELETE = methodNotAllowedResponse;

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { Allow: "POST" },
  });
}
