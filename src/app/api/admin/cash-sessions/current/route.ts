import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentCashSession } from "@/lib/operations/cash";
import { requireOperationalSession } from "@/lib/operations/permissions";

export async function GET() {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  const session = await getCurrentCashSession(prisma, data!.barbershopId);
  if (data!.role === "BARBER") {
    return NextResponse.json({
      session: session ? { id: session.id, status: session.status } : null,
    });
  }
  return NextResponse.json({ session });
}

