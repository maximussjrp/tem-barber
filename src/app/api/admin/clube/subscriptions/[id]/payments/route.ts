import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { PaymentMethod, Prisma } from "@prisma/client";
import { requireOperationalSession } from "@/lib/api-auth";
import { z } from "zod";

const createPaymentSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  competence: z.string().regex(/^\d{4}-\d{2}$/, "Competência deve seguir o formato YYYY-MM"),
  paidAt: z.string().datetime().optional(),
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
  } catch (err) {
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
    const sub = await prisma.customerClubSubscription.findFirst({
      where: { id, barbershopId: data.barbershopId },
      include: { clubPlan: true },
    });

    if (!sub) {
      return NextResponse.json({ error: "SUBSCRIPTION_NOT_FOUND", message: "Assinatura não encontrada." }, { status: 404 });
    }

    const json = await request.json();
    const result = createPaymentSchema.safeParse(json);
    if (!result.success) {
      return NextResponse.json({ error: "VALIDATION_ERROR", details: result.error.format() }, { status: 400 });
    }

    const payData = result.data;

    const payment = await prisma.clubSubscriptionPayment.create({
      data: {
        barbershopId: data.barbershopId,
        subscriptionId: id,
        customerId: sub.customerId,
        clubPlanId: sub.clubPlanId,
        amount: new Prisma.Decimal(payData.amount),
        paymentMethod: payData.paymentMethod,
        competence: payData.competence,
        shopSharePercentSnapshot: sub.clubPlan.shopSharePercent,
        barberPoolPercentSnapshot: sub.clubPlan.barberPoolPercent,
        paidAt: payData.paidAt ? new Date(payData.paidAt) : new Date(),
      },
    });

    return NextResponse.json(payment, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "Erro ao registrar pagamento." }, { status: 500 });
  }
}
