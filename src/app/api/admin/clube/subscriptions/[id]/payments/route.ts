import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PaymentMethod } from "@prisma/client";
import { requireOperationalSession } from "@/lib/api-auth";
import { ClubError, registerManualClubSubscriptionPayment } from "@/lib/operations/club";
import { z } from "zod";

const createPaymentSchema = z.object({
  amount: z.number().positive().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  paidAt: z.string().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { id } = await params;

  try {
    const sub = await prisma.customerClubSubscription.findFirst({
      where: { id, barbershopId: data.barbershopId },
    });

    if (!sub) {
      return NextResponse.json({ error: "SUBSCRIPTION_NOT_FOUND", message: "Assinatura não encontrada." }, { status: 404 });
    }

    const payments = await prisma.clubSubscriptionPayment.findMany({
      where: { subscriptionId: id, barbershopId: data.barbershopId },
      orderBy: { paidAt: "desc" },
    });

    return NextResponse.json(payments);
  } catch {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao buscar pagamentos." }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { id } = await params;

  try {
    const json = await request.json();
    const result = createPaymentSchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json({ error: "VALIDATION_ERROR", details: result.error.format() }, { status: 400 });
    }

    const payData = result.data;

    const { payment, subscription } = await registerManualClubSubscriptionPayment({
      barbershopId: data.barbershopId,
      subscriptionId: id,
      paymentMethod: payData.paymentMethod,
      paidAt: payData.paidAt ? new Date(payData.paidAt) : new Date(),
      amount: payData.amount,
    });

    return NextResponse.json({ payment, subscription }, { status: 201 });
  } catch (err) {
    if (err instanceof ClubError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao registrar pagamento." }, { status: 500 });
  }
}
