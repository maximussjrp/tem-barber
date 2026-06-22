import { NextRequest, NextResponse } from "next/server";
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
  const rows = await prisma.appointment.findMany({
    where: { barbershopId },
    distinct: ["customerId"],
    orderBy: { dateTime: "desc" },
    take: 200,
    select: {
      customerId: true,
      dateTime: true,
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  const matches = rows
    .filter((row) => {
      const nameMatch = row.customer.name.toLowerCase().includes(query.toLowerCase());
      const phoneMatch =
        normalizedQueryPhone.length > 0 &&
        normalizePhone(row.customer.phone).includes(normalizedQueryPhone);
      return nameMatch || phoneMatch;
    })
    .slice(0, 10)
    .map((row) => ({
      id: row.customer.id,
      name: row.customer.name,
      phone: row.customer.phone,
      lastAppointmentAt: row.dateTime.toISOString(),
    }));

  return NextResponse.json({ clients: matches });
}
