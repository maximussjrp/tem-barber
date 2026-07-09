import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";

// GET /api/admin/clients
// Lista todos os clientes que têm agendamentos nesta barbearia
// Isolado por barbershopId — sem vazamento entre tenants
export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const search = sp.get("search")?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "30")));

  // 1. Otimização P0: Filtro direto via relação Prisma sem carregar todos os IDs em memória
  const userWhere = {
    appointments: {
      some: {
        barbershopId,
      },
    },
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { phone: { contains: search.replace(/\D/g, "") } },
          ],
        }
      : {}),
  };

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

  // 2. Buscar dados brutos dos agendamentos e comandas para os usuários paginados
  const userIds = users.map((u) => u.id);
  const [appointments, comandas] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        barbershopId,
        customerId: { in: userIds },
      },
      select: {
        customerId: true,
        status: true,
        dateTime: true,
      },
    }),
    prisma.comanda.findMany({
      where: {
        barbershopId,
        customerId: { in: userIds },
        status: { not: "CANCELLED" },
        paidTotal: { gt: 0 },
      },
      select: {
        customerId: true,
        paidTotal: true,
      },
    }),
  ]);

  // 3. Agregar estatísticas por cliente de acordo com as novas regras
  const statsMap: Record<
    string,
    { total: number; completed: number; cancelled: number; noShows: number; totalSpent: number; lastVisit: string | null }
  > = {};

  for (const u of users) {
    statsMap[u.id] = {
      total: 0,
      completed: 0,
      cancelled: 0,
      noShows: 0,
      totalSpent: 0,
      lastVisit: null,
    };
  }

  // Agregar agendamentos
  for (const appt of appointments) {
    const s = statsMap[appt.customerId];
    if (!s) continue;
    s.total += 1;

    if (appt.status === "COMPLETED") {
      s.completed += 1;
      // Última visita baseia-se apenas em atendimentos concluídos
      const dt = appt.dateTime.toISOString();
      if (!s.lastVisit || dt > s.lastVisit) {
        s.lastVisit = dt;
      }
    } else if (appt.status === "CANCELLED") {
      s.cancelled += 1;
    } else if (appt.status === "NO_SHOW") {
      s.noShows += 1;
    }
  }

  // Agregar faturamento das comandas válidas
  for (const cmd of comandas) {
    if (!cmd.customerId) continue;
    const s = statsMap[cmd.customerId];
    if (s) {
      s.totalSpent += Number(cmd.paidTotal);
    }
  }

  const clients = users.map((u) => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    createdAt: u.createdAt,
    stats: statsMap[u.id],
  }));

  return NextResponse.json({ clients, total: totalCount, page, pageSize });
}
