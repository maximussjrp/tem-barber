import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { normalizePhone } from "@/lib/customers";

export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia nao encontrada." }, { status: 403 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ clients: [] });
  }

  const normalizedQueryPhone = normalizePhone(query);
  const filters: Prisma.AppointmentWhereInput[] = [
    { customer: { name: { contains: query, mode: "insensitive" } } },
  ];

  if (normalizedQueryPhone) {
    filters.push({ customer: { phone: { contains: normalizedQueryPhone } } });
    if (normalizedQueryPhone.length >= 8) {
      filters.push({ customer: { phone: { contains: normalizedQueryPhone.slice(-8) } } });
    }
  }

  const rows = await prisma.appointment.findMany({
    where: {
      barbershopId,
      OR: filters,
    },
    distinct: ["customerId"],
    orderBy: { dateTime: "desc" },
    take: 25,
    select: {
      customerId: true,
      dateTime: true,
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  const clients = rows
    .filter((row) => {
      const nameMatch = row.customer.name.toLowerCase().includes(query.toLowerCase());
      const phoneMatch =
        normalizedQueryPhone.length > 0 &&
        normalizePhone(row.customer.phone).includes(normalizedQueryPhone);
      const phoneTailMatch =
        normalizedQueryPhone.length >= 8 &&
        normalizePhone(row.customer.phone).includes(normalizedQueryPhone.slice(-8));
      return nameMatch || phoneMatch || phoneTailMatch;
    })
    .slice(0, 10)
    .map((row) => ({
      id: row.customer.id,
      name: row.customer.name,
      phone: row.customer.phone,
      lastAppointmentAt: row.dateTime.toISOString(),
    }));

  return NextResponse.json({ clients });
}
