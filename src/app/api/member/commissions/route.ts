import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMemberSession } from "@/lib/member-api-auth";

export async function GET(request: NextRequest) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const competence = request.nextUrl.searchParams.get("competence") || new Date().toISOString().slice(0, 7);
  const [period, entries, adjustments] = await Promise.all([
    prisma.commissionPeriod.findUnique({
      where: {
        barbershopId_memberId_competence: {
          barbershopId: data!.barbershopId,
          memberId: data!.memberId,
          competence,
        },
      },
    }),
    prisma.commissionEntry.findMany({
      where: { barbershopId: data!.barbershopId, memberId: data!.memberId, competence },
      include: { comandaItem: { select: { description: true, total: true, completedAt: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.commissionAdjustment.findMany({
      where: { barbershopId: data!.barbershopId, memberId: data!.memberId, competence },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return NextResponse.json({ period, entries, adjustments, competence });
}
