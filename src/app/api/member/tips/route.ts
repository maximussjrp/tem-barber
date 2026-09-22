import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { canViewTips, requireOperationalSession } from "@/lib/operations/permissions";

export async function GET(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  if (!canViewTips(data!.role)) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const where: any = {
    barbershopId: data!.barbershopId,
    memberId: data!.memberId,
  };
  if (status) where.status = status;

  const tips = await prisma.tipEntry.findMany({
    where,
    include: {
      createdBy: { select: { id: true, name: true } },
      tipRefund: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(tips);
}
