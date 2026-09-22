import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { canViewTips, requireOperationalSession } from "@/lib/operations/permissions";
import { Prisma, TipStatus } from "@prisma/client";

export async function GET(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  if (!canViewTips(data!.role)) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get("memberId");
  const status = searchParams.get("status");

  const where: Prisma.TipEntryWhereInput = { barbershopId: data!.barbershopId };
  if (memberId) where.memberId = memberId;
  if (status) where.status = status as TipStatus;

  const tips = await prisma.tipEntry.findMany({
    where,
    include: {
      member: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
      createdBy: { select: { id: true, name: true } },
      tipRefunds: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(tips);
}
