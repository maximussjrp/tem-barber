import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { CommissionError, payCommissionPeriod } from "@/lib/operations/commissions";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  try {
    const paid = await prisma.$transaction((tx) =>
      payCommissionPeriod(tx, {
        barbershopId: data!.barbershopId!,
        periodId: id,
        paidByMemberId: data!.memberId!,
        userId: data!.userId,
      })
    );
    return NextResponse.json(paid);
  } catch (err) {
    if (err instanceof CommissionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao marcar comissao como paga." }, { status: 500 });
  }
}
