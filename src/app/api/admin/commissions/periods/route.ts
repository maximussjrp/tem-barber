import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const competence = request.nextUrl.searchParams.get("competence") || undefined;
  const memberId = request.nextUrl.searchParams.get("memberId") || undefined;

  const periods = await prisma.commissionPeriod.findMany({
    where: { barbershopId: data!.barbershopId!, ...(competence ? { competence } : {}), ...(memberId ? { memberId } : {}) },
    include: { member: { include: { user: { select: { name: true } } } } },
    orderBy: [{ competence: "desc" }, { status: "asc" }],
  });
  return NextResponse.json(periods);
}
