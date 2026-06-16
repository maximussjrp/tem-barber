import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";

// GET /api/admin/clients
// Lista todos os clientes únicos que têm agendamentos nesta barbearia
// Isolado por barbershopId — sem vazamento entre tenants
export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const barbershopId = data!.barbershopId;
  if (!barbershopId) return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const search = sp.get("search")?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "30")));

  // Buscar IDs únicos de clientes desta barbearia
  const customerIdRows = await prisma.appointment.findMany({
    where: { barbershopId },
    select: { customerId: true },
    distinct: ["customerId"],
  });
  const allCustomerIds = customerIdRows.map((r) => r.customerId);

  // Filtrar por nome/telefone se houver busca
  const userWhere = search
    ? {
        id: { in: allCustomerIds },
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search.replace(/\D/g, "") } },
        ],
      }
    : { id: { in: allCustomerIds } };

  const [totalCount, users] = await Promise.all([
    prisma.user.count({ where: userWhere }),
    prisma.user.findMany({
      where: userWhere,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        phone: true,
        createdAt: true,
      },
    }),
  ]);

  if (users.length === 0) {
    return NextResponse.json({ clients: [], total: 0, page, pageSize });
  }

  // Buscar stats dos agendamentos por cliente (apenas desta barbearia)
  const userIds = users.map((u) => u.id);
  const appointments = await prisma.appointment.findMany({
    where: {
      barbershopId,
      customerId: { in: userIds },
    },
    select: {
      customerId: true,
      status: true,
      totalPrice: true,
      dateTime: true,
    },
  });

  // Agregar stats por cliente
  const statsMap: Record<
    string,
    { total: number; completed: number; cancelled: number; totalSpent: number; lastVisit: string | null }
  > = {};

  for (const appt of appointments) {
    if (!statsMap[appt.customerId]) {
      statsMap[appt.customerId] = {
        total: 0,
        completed: 0,
        cancelled: 0,
        totalSpent: 0,
        lastVisit: null,
      };
    }
    const s = statsMap[appt.customerId];
    s.total += 1;
    if (appt.status === "COMPLETED") {
      s.completed += 1;
      s.totalSpent += Number(appt.totalPrice);
    }
    if (appt.status === "CANCELLED" || appt.status === "NO_SHOW") s.cancelled += 1;

    const dt = appt.dateTime.toISOString();
    if (!s.lastVisit || dt > s.lastVisit) s.lastVisit = dt;
  }

  const clients = users.map((u) => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    createdAt: u.createdAt,
    stats: statsMap[u.id] ?? { total: 0, completed: 0, cancelled: 0, totalSpent: 0, lastVisit: null },
  }));

  return NextResponse.json({ clients, total: totalCount, page, pageSize });
}
