import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import { blockCustomer, CustomerBlockError } from "@/lib/operations/blocked-customers";

export async function POST(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  if (!data?.barbershopId) {
    return NextResponse.json({ error: "Barbearia não especificada." }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { userId, phone, reason } = body ?? {};

    const result = await blockCustomer({
      barbershopId: data.barbershopId,
      userId,
      phone,
      reason,
      executorUserId: data.userId,
      executorMemberId: data.memberId,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    if (error instanceof CustomerBlockError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Erro ao bloquear cliente.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
