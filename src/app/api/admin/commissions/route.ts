import { NextRequest, NextResponse } from "next/server";
import { CommissionPeriodStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";

function getCompetence(request: NextRequest) {
  return request.nextUrl.searchParams.get("competence") || new Date().toISOString().slice(0, 7);
}

export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const competence = getCompetence(request);
  const memberId = request.nextUrl.searchParams.get("memberId") || undefined;
  const statusParam = request.nextUrl.searchParams.get("status") || undefined;
  const status = statusParam && Object.values(CommissionPeriodStatus).includes(statusParam as CommissionPeriodStatus)
    ? (statusParam as CommissionPeriodStatus)
    : undefined;

  const periods = await prisma.commissionPeriod.findMany({
    where: {
      barbershopId: data!.barbershopId!,
      competence,
      ...(memberId ? { memberId } : {}),
      ...(status ? { status } : {}),
    },
    include: { member: { include: { user: { select: { name: true } } } } },
    orderBy: [{ status: "asc" }, { member: { user: { name: "asc" } } }],
  });
  return NextResponse.json(periods);
}
