/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { CustomerTimingState } from "@prisma/client";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getReactivationCandidates } from "@/lib/clients/reactivation";

export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const limitParam = sp.get("limit");
  const cursorParam = sp.get("cursor");
  const timingStateParam = sp.get("timingState");
  const includeSuppressedParam = sp.get("includeSuppressed");

  let limit = 50;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed <= 0) {
      return NextResponse.json({ error: "Parâmetro limit inválido." }, { status: 400 });
    }
    limit = Math.min(100, Math.max(1, parsed));
  }

  let timingState: CustomerTimingState | null = null;
  if (timingStateParam) {
    if (!Object.values(CustomerTimingState).includes(timingStateParam as CustomerTimingState)) {
      return NextResponse.json({ error: "Parâmetro timingState inválido." }, { status: 400 });
    }
    timingState = timingStateParam as CustomerTimingState;
  }

  const includeSuppressed = includeSuppressedParam === "true";

  try {
    const result = await getReactivationCandidates(prisma, {
      barbershopId,
      limit,
      cursor: cursorParam,
      timingState,
      includeSuppressed,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    if (err.message === "INVALID_CURSOR" || err.message?.includes("Invalid pagination cursor")) {
      return NextResponse.json({ error: "Invalid pagination cursor" }, { status: 400 });
    }
    console.error("Error fetching reactivation candidates:", err);
    return NextResponse.json(
      { error: "Erro interno ao consultar candidatos de reativação." },
      { status: 500 }
    );
  }
}
