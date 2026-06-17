import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { canManageFinancial, forbidden, requireOperationalSession } from "@/lib/operations/permissions";
import { fromCents, positiveCents } from "@/lib/operations/money";

export async function POST(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canManageFinancial(data!.role)) return forbidden();

  const body = await request.json();
  if (body.type !== "MANUAL_IN" && body.type !== "MANUAL_OUT") {
    return NextResponse.json({ error: "Tipo invalido." }, { status: 400 });
  }
  const amount = positiveCents(body.amount ?? 0, "Valor");
  const signed = body.type === "MANUAL_OUT" ? -amount : amount;

  const entry = await prisma.financialEntry.create({
    data: {
      barbershopId: data!.barbershopId,
      type: body.type,
      category: body.category?.trim() || "Manual",
      amount: fromCents(signed),
      description: body.description?.trim() || body.category?.trim() || "Lancamento manual",
      userId: data!.userId,
    },
  });

  return NextResponse.json(entry, { status: 201 });
}

