import { CommissionConfigType } from "@prisma/client";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { CommissionError, upsertCommissionConfig } from "@/lib/operations/commissions";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  try {
    const current = await prisma.commissionConfig.findFirst({
      where: { id, barbershopId: data!.barbershopId! },
    });
    if (!current) return NextResponse.json({ error: "Configuracao nao encontrada." }, { status: 404 });

    const body = await request.json();
    const type = body.type ?? current.type;
    if (!Object.values(CommissionConfigType).includes(type)) {
      return NextResponse.json({ error: "Tipo de comissao invalido." }, { status: 400 });
    }

    const config = await prisma.$transaction((tx) =>
      upsertCommissionConfig(tx, {
        barbershopId: data!.barbershopId!,
        memberId: body.memberId ?? current.memberId,
        serviceId: body.serviceId ?? current.serviceId,
        categoryId: body.categoryId ?? current.categoryId,
        type,
        value: body.value ?? current.value,
        active: body.active ?? current.active,
      })
    );
    return NextResponse.json(config);
  } catch (err) {
    if (err instanceof CommissionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao atualizar configuracao." }, { status: 500 });
  }
}
