import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { openCashSession } from "@/lib/operations/cash";
import { canManageFinancial, forbidden, requireOperationalSession } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";

export async function POST(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canManageFinancial(data!.role)) return forbidden();

  const body = await request.json();
  try {
    const session = await prisma.$transaction((tx) =>
      openCashSession(tx, {
        barbershopId: data!.barbershopId,
        userId: data!.userId,
        openingAmount: body.openingAmount ?? 0,
      })
    );
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    return operationErrorResponse(err);
  }
}

