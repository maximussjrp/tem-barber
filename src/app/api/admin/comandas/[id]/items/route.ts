import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  addAdjustmentItem,
  addProductItem,
  addServiceItem,
  upsertDiscountItem,
  OperationalError,
} from "@/lib/operations/comandas";
import { canManageComandas, forbidden, requireOperationalSession } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";

interface ItemBody {
  type?: "SERVICE" | "PRODUCT" | "DISCOUNT" | "SURCHARGE";
  serviceId?: string;
  productId?: string;
  executorId?: string;
  quantity?: number;
  discountAmount?: string | number;
  surchargeAmount?: string | number;
  description?: string;
  amount?: string | number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canManageComandas(data!.role)) return forbidden();
  const { id } = await params;

  if (data!.role === "BARBER") {
    const comanda = await prisma.comanda.findFirst({
      where: { id, barbershopId: data!.barbershopId },
      include: { items: true, appointment: true }
    });
    if (!comanda) return NextResponse.json({ error: "Comanda não encontrada." }, { status: 404 });
    const isExecutorOfAppt = comanda.appointment?.memberId === data!.memberId;
    const isExecutorOfItem = comanda.items.some(item => item.executorId === data!.memberId);
    const isCreator = comanda.customerId === null && comanda.items.length === 0;
    if (!isExecutorOfAppt && !isExecutorOfItem && !isCreator) {
      return forbidden();
    }
  }

  let body: ItemBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (body.type === "SERVICE") {
        if (!body.serviceId || !body.executorId) throw new Error("serviceId e executorId obrigatorios.");
        return addServiceItem(tx, {
          comandaId: id,
          barbershopId: data!.barbershopId,
          serviceId: body.serviceId,
          executorId: body.executorId,
          quantity: body.quantity,
          discountAmount: body.discountAmount,
          surchargeAmount: body.surchargeAmount,
        });
      }
      if (body.type === "PRODUCT") {
        if (!body.productId) throw new Error("productId obrigatorio.");
        return addProductItem(tx, {
          comandaId: id,
          barbershopId: data!.barbershopId,
          productId: body.productId,
          quantity: body.quantity,
          discountAmount: body.discountAmount,
          surchargeAmount: body.surchargeAmount,
        });
      }
      if (body.type === "DISCOUNT") {
        return upsertDiscountItem(tx, {
          comandaId: id,
          barbershopId: data!.barbershopId,
          description: body.description ?? "",
          amount: body.amount ?? 0,
        });
      }
      if (body.type === "SURCHARGE") {
        return addAdjustmentItem(tx, {
          comandaId: id,
          barbershopId: data!.barbershopId,
          type: "SURCHARGE",
          description: body.description ?? "",
          amount: body.amount ?? 0,
        });
      }
      throw new OperationalError("INVALID_ITEM_TYPE", "Tipo de item invalido.", 400);
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return operationErrorResponse(err);
  }
}

