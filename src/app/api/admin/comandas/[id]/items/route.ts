import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  addAdjustmentItem,
  addProductItem,
  addServiceItem,
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
      if (body.type === "DISCOUNT" || body.type === "SURCHARGE") {
        return addAdjustmentItem(tx, {
          comandaId: id,
          barbershopId: data!.barbershopId,
          type: body.type,
          description: body.description ?? "",
          amount: body.amount ?? 0,
        });
      }
      throw new Error("Tipo de item invalido.");
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return operationErrorResponse(err);
  }
}

