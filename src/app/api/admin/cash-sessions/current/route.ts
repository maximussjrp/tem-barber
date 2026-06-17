import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentCashSession } from "@/lib/operations/cash";
import { requireOperationalSession } from "@/lib/operations/permissions";

export async function GET() {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  const session = await getCurrentCashSession(prisma, data!.barbershopId);
  return NextResponse.json({ session });
}

