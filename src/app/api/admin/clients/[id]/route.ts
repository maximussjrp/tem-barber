import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { computeClientMetrics } from "@/lib/clients/client-metrics";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: sessionError, data: sessionData } = await getAdminSession();
  if (sessionError) return sessionError;

  const barbershopId = sessionData!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não vinculada." }, { status: 403 });
  }

  const { id: customerId } = await params;

  // 1. Verificar se o cliente tem agendamentos nesse tenant (Regra Multi-Tenancy P0)
  const appointmentCount = await prisma.appointment.count({
    where: { customerId, barbershopId },
  });

  if (appointmentCount === 0) {
    return NextResponse.json(
      { error: "Cliente não encontrado ou sem histórico nesta barbearia." },
      { status: 404 }
    );
  }

  // 2. Buscar o usuário
  const user = await prisma.user.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      phone: true,
      createdAt: true,
    },
  });

  if (!user) {
    return NextResponse.json(
      { error: "Usuário não encontrado no sistema." },
      { status: 404 }
    );
  }

  // 3. Buscar dados brutos para cálculo das métricas
  const [appointments, comandas, reviews] = await Promise.all([
    prisma.appointment.findMany({
      where: { customerId, barbershopId },
      include: {
        barber: {
          select: {
            id: true,
            user: { select: { name: true } },
          },
        },
        services: {
          include: {
            service: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.comanda.findMany({
      where: { customerId, barbershopId },
      select: {
        id: true,
        status: true,
        paidTotal: true,
      },
    }),
    prisma.review.findMany({
      where: { customerId, appointment: { barbershopId } },
      select: {
        rating: true,
      },
    }),
  ]);

  // 4. Computar métricas usando o helper centralizado
  const metrics = computeClientMetrics({
    barbershopId,
    customerId,
    appointments,
    comandas,
    reviews,
    now: new Date(),
  });

  // 5. Obter histórico dos últimos 20 agendamentos (ordenado decrescente por data)
  const recentAppointments = await prisma.appointment.findMany({
    where: { customerId, barbershopId },
    include: {
      barber: {
        select: {
          user: { select: { name: true } },
        },
      },
      services: {
        include: {
          service: { select: { name: true } },
        },
      },
    },
    orderBy: { dateTime: "desc" },
    take: 20,
  });

  const history = recentAppointments.map((h) => ({
    id: h.id,
    dateTime: h.dateTime ? new Date(h.dateTime).toISOString() : new Date().toISOString(),
    status: h.status,
    bookingMode: h.bookingMode,
    totalPrice: Number(h.totalPrice ?? 0),
    professional: h.barber?.user?.name ?? "Profissional",
    services: Array.isArray(h.services) ? h.services.map((s: { service?: { name: string } }) => s.service?.name ?? "") : [],
  }));

  // 6. Verificar se o cliente está bloqueado na barbearia
  const activeBlock = prisma.barbershopBlockedCustomer
    ? await prisma.barbershopBlockedCustomer.findFirst({
        where: {
          barbershopId,
          active: true,
          OR: [
            { userId: customerId },
            { phoneNormalized: user.phone },
          ],
        },
        select: {
          id: true,
          reason: true,
          blockedAt: true,
        },
      })
    : null;

  // Retornar payload consolidado
  return NextResponse.json({
    id: user.id,
    name: user.name,
    phone: user.phone,
    createdAt: user.createdAt.toISOString(),
    isBlocked: Boolean(activeBlock),
    blockRecord: activeBlock ? {
      id: activeBlock.id,
      reason: activeBlock.reason,
      blockedAt: activeBlock.blockedAt.toISOString(),
    } : null,
    metrics,
    history,
  });
}
