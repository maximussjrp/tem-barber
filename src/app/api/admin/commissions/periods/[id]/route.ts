import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  const period = await prisma.commissionPeriod.findFirst({
    where: { id, barbershopId: data!.barbershopId! },
    include: {
      member: { include: { user: { select: { name: true } } } },
    },
  });
  if (!period) return NextResponse.json({ error: "Periodo nao encontrado." }, { status: 404 });

  const [entries, adjustments] = await Promise.all([
    prisma.commissionEntry.findMany({
      where: { barbershopId: data!.barbershopId!, memberId: period.memberId, competence: period.competence },
      include: { comandaItem: { select: { description: true, total: true, completedAt: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.commissionAdjustment.findMany({
      where: { barbershopId: data!.barbershopId!, memberId: period.memberId, competence: period.competence },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return NextResponse.json({ period, entries, adjustments });
}
