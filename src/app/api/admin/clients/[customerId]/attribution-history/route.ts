/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getCustomerAttributionHistory } from "@/lib/clients/reactivation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  }

  const { customerId } = await params;
  if (!customerId) {
    return NextResponse.json({ error: "ID do cliente não informado." }, { status: 400 });
  }

  try {
    const history = await getCustomerAttributionHistory(prisma, {
      barbershopId,
      customerId,
    });

    return NextResponse.json(
      {
        success: true,
        history,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Error retrieving customer attribution history:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao buscar histórico de atribuição do cliente." },
      { status: 500 }
    );
  }
}