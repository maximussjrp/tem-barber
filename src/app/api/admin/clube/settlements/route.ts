import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireOperationalSession } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  try {
    const settlements = await prisma.clubSettlement.findMany({
      where: { barbershopId: data.barbershopId },
      include: {
        members: {
          include: {
            member: {
              include: {
                user: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { competence: "desc" },
    });

    return NextResponse.json(settlements);
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao buscar fechamentos." }, { status: 500 });
  }
}
