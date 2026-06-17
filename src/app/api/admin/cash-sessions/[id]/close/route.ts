import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { closeCashSession } from "@/lib/operations/cash";
import { canManageFinancial, forbidden, requireOperationalSession } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canManageFinancial(data!.role)) return forbidden();
  const { id } = await params;
  const body = await request.json();

  try {
    const session = await prisma.$transaction((tx) =>
      closeCashSession(tx, {
        barbershopId: data!.barbershopId,
        cashSessionId: id,
        userId: data!.userId,
        closingAmount: body.closingAmount ?? 0,
      })
    );
    return NextResponse.json(session);
  } catch (err) {
    return operationErrorResponse(err);
  }
}

