import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { ComandaStatus, Prisma } from "@prisma/client";
import { comandaInclude, ensureComandaForAppointment, OperationalError } from "@/lib/operations/comandas";
import { canManageComandas, forbidden, requireOperationalSession } from "@/lib/operations/permissions";
import { operationErrorResponse } from "@/lib/operations/responses";
import {
  findBarbershopCustomerById,
  normalizePhone,
  resolveBarbershopCustomerForBooking,
} from "@/lib/customers";
import { validateBrazilianMobilePhone } from "@/lib/phone/br-phone";

interface CreateComandaBody {
  appointmentId?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
}

export async function GET(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const status = request.nextUrl.searchParams.get("status");
  const search = request.nextUrl.searchParams.get("search")?.trim();
  const date = request.nextUrl.searchParams.get("date");
  const where: Prisma.ComandaWhereInput = { barbershopId: data!.barbershopId };
  if (status && status !== "ALL") where.status = status as ComandaStatus;
  if (search) {
    where.OR = [
      { customerName: { contains: search, mode: "insensitive" } },
      { customerPhone: { contains: search } },
    ];
  }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split("-").map(Number);
    where.openedAt = {
      gte: new Date(Date.UTC(y, m - 1, d, 0, 0, 0)),
      lte: new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)),
    };
  }

  if (data!.role === "BARBER") {
    where.items = { some: { executorId: data!.memberId } };
  }

  const comandas = await prisma.comanda.findMany({
    where,
    include: comandaInclude,
    orderBy: { openedAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ comandas });
}

export async function POST(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canManageComandas(data!.role)) return forbidden();

  let body: CreateComandaBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (body.appointmentId) {
        return ensureComandaForAppointment(tx, {
          barbershopId: data!.barbershopId,
          appointmentId: body.appointmentId,
        });
      }

      let customerId = body.customerId;
      let customerName = body.customerName?.trim();
      let customerPhone = normalizePhone(body.customerPhone) || undefined;
      if (customerId) {
        const customer = await findBarbershopCustomerById(tx, data!.barbershopId, customerId);
        if (!customer) throw new OperationalError("CUSTOMER_NOT_FOUND", "Cliente nao encontrado.", 404);
        customerName = customer.name;
        customerPhone = customer.phone;
      } else {
        if (!customerName || !customerPhone) {
          throw new OperationalError("CUSTOMER_REQUIRED", "Informe cliente, nome e telefone.", 400);
        }
        if (!validateBrazilianMobilePhone(customerPhone)) {
          throw new OperationalError("INVALID_PHONE", "Informe um WhatsApp válido com DDD.", 400);
        }
        const customer = await resolveBarbershopCustomerForBooking(tx, {
          barbershopId: data!.barbershopId,
          customerName,
          customerPhone,
        });
        customerId = customer.id;
        customerName = customer.name;
        customerPhone = customer.phone;
      }

      return tx.comanda.create({
        data: {
          barbershopId: data!.barbershopId,
          customerId,
          customerName: customerName!,
          customerPhone,
          status: "OPEN",
        },
        include: comandaInclude,
      });
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return operationErrorResponse(err);
  }
}
