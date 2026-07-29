import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { reopenComanda } from "@/lib/operations/comandas";
import {
  canReopenComandas,
  forbidden,
  requireOperationalSession,
} from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";

interface ReopenBody {
  reason?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canReopenComandas(data!.role)) return forbidden();
  const { id } = await params;

  let body: ReopenBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction((tx) =>
      reopenComanda(tx, {
        barbershopId: data!.barbershopId,
        comandaId: id,
        reason: body.reason ?? "",
        userId: data!.userId,
        memberId: data!.memberId,
      })
    );

    return NextResponse.json({
      ...result,
      permissions: {
        canReopen: false,
      },
    });
  } catch (err) {
    return operationErrorResponse(err);
  }
}
