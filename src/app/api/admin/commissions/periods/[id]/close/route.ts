import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { closeCommissionPeriod, CommissionError } from "@/lib/operations/commissions";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  try {
    const period = await prisma.commissionPeriod.findFirst({
      where: { id, barbershopId: data!.barbershopId! },
    });
    if (!period) return NextResponse.json({ error: "Periodo nao encontrado." }, { status: 404 });
    const closed = await prisma.$transaction((tx) =>
      closeCommissionPeriod(tx, {
        barbershopId: data!.barbershopId!,
        memberId: period.memberId,
        competence: period.competence,
        userId: data!.userId,
      })
    );
    return NextResponse.json(closed);
  } catch (err) {
    if (err instanceof CommissionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao fechar periodo." }, { status: 500 });
  }
}
