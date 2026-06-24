import { CommissionConfigType } from "@prisma/client";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { CommissionError, upsertCommissionConfig } from "@/lib/operations/commissions";

export async function GET() {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const configs = await prisma.commissionConfig.findMany({
    where: { barbershopId: data!.barbershopId! },
    include: {
      member: { include: { user: { select: { name: true } } } },
      service: { select: { name: true } },
      category: { select: { name: true } },
    },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(configs);
}

export async function POST(request: Request) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  try {
    const body = await request.json();
    if (!Object.values(CommissionConfigType).includes(body.type)) {
      return NextResponse.json({ error: "Tipo de comissao invalido." }, { status: 400 });
    }

    const config = await prisma.$transaction((tx) =>
      upsertCommissionConfig(tx, {
        barbershopId: data!.barbershopId!,
        memberId: body.memberId || null,
        serviceId: body.serviceId || null,
        categoryId: body.categoryId || null,
        productId: body.productId || null,
        isProductDefault: body.isProductDefault === true,
        type: body.type,
        value: body.value,
        active: body.active !== false,
      })
    );
    return NextResponse.json(config, { status: 201 });
  } catch (err) {
    if (err instanceof CommissionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao salvar configuracao de comissao." }, { status: 500 });
  }
}
