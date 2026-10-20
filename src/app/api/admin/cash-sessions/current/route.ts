import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentCashSession } from "@/lib/operations/cash";
import { canManageFinancial, requireOperationalSession } from "@/lib/operations/permissions";

export async function GET() {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  if (!canManageFinancial(data!.role) && data!.role !== "SUPER_ADMIN") {
    const session = await prisma.cashSession.findFirst({
      where: {
        barbershopId: data!.barbershopId,
        status: "OPEN",
      },
      select: {
        id: true,
        status: true,
      },
    });

    return NextResponse.json({
      session: session ? { id: session.id, status: session.status } : null,
    });
  }

  const session = await getCurrentCashSession(prisma, data!.barbershopId);
  return NextResponse.json({ session });
}

