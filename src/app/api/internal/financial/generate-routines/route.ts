import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { todayIsoBR } from "@/lib/time-utils";
import {
  FinancialRoutineError,
  generateRoutineOccurrencesForMonth,
} from "@/lib/financial/routines";
import { GenerateRoutineMonthOutput } from "@/lib/financial/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let schedulerRunActive = false;

function unauthorizedResponse() {
  return NextResponse.json({ error: "UNAUTHORIZED", message: "Credencial de job inválida." }, { status: 401 });
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

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorizedResponse();
  }

  if (schedulerRunActive) {
    return NextResponse.json(
      { error: "SCHEDULER_RUN_IN_PROGRESS", message: "Execução de geração de rotinas já em andamento." },
      { status: 409 }
    );
  }

  schedulerRunActive = true;

  try {
    const currentReferenceMonth = todayIsoBR().substring(0, 7); // YYYY-MM (America/Sao_Paulo)

    const tenants = await prisma.barbershop.findMany({
      where: {
        financialRoutines: {
          some: {},
        },
      },
      select: { id: true, name: true },
    });

    const tenantOutputs: GenerateRoutineMonthOutput[] = [];
    let hasUnexpectedFailure = false;

    for (const tenant of tenants) {
      const output = await generateRoutineOccurrencesForMonth({
        barbershopId: tenant.id,
        referenceMonth: currentReferenceMonth,
        source: "ROUTINE_SCHEDULER",
        actorUserId: null,
      });

      if (output.summary.failed > 0) {
        hasUnexpectedFailure = true;
      }

      tenantOutputs.push(output);
    }

    const grandSummary = {
      referenceMonth: currentReferenceMonth,
      processedTenants: tenants.length,
      totalRoutines: tenantOutputs.reduce((acc, t) => acc + t.summary.total, 0),
      totalGenerated: tenantOutputs.reduce((acc, t) => acc + t.summary.generated, 0),
      totalReplayed: tenantOutputs.reduce((acc, t) => acc + t.summary.replayed, 0),
      totalSkipped: tenantOutputs.reduce((acc, t) => acc + t.summary.skipped, 0),
      totalBlocked: tenantOutputs.reduce((acc, t) => acc + t.summary.blocked, 0),
      totalFailed: tenantOutputs.reduce((acc, t) => acc + t.summary.failed, 0),
    };

    const status = hasUnexpectedFailure ? 500 : 200;

    return NextResponse.json(
      {
        success: !hasUnexpectedFailure,
        summary: grandSummary,
        tenants: tenantOutputs,
      },
      { status }
    );
  } catch (err: unknown) {
    if (err instanceof FinancialRoutineError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    const errorMessage = err instanceof Error ? err.message : "Erro ao executar agendador de rotinas financeiras.";
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: errorMessage },
      { status: 500 }
    );
  } finally {
    schedulerRunActive = false;
  }
}
