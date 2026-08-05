import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { computeClientMetrics } from "@/lib/clients/client-metrics";
import {
  buildClientWhatsappLink,
  buildClientWhatsappMessage,
  phoneLookupVariants,
} from "@/lib/customers";

function phoneBlockVariants(phone: string) {
  const variants = phoneLookupVariants(phone);
  const rawDigits = phone.replace(/\D/g, "");
  if (rawDigits) variants.push(rawDigits);
  return [...new Set(variants.filter(Boolean))];
}

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

  const [link, appointmentCountRaw, comandaCountRaw, clubCountRaw] = await Promise.all([
    prisma.customerBarbershopLink?.findUnique({
      where: { barbershopId_customerId: { barbershopId, customerId } },
      select: { id: true },
    }) ?? Promise.resolve(null),
    prisma.appointment.count({ where: { customerId, barbershopId } }),
    prisma.comanda?.count({ where: { customerId, barbershopId } }) ?? Promise.resolve(0),
    prisma.customerClubSubscription?.count({ where: { customerId, barbershopId } }) ?? Promise.resolve(0),
  ]);
  const appointmentCount = Number(appointmentCountRaw ?? 0);
  const comandaCount = Number(comandaCountRaw ?? 0);
  const clubCount = Number(clubCountRaw ?? 0);

  if (!link && appointmentCount === 0 && comandaCount === 0 && clubCount === 0) {
    return NextResponse.json(
      { error: "Cliente não encontrado ou sem histórico nesta barbearia." },
      { status: 404 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      createdAt: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado no sistema." }, { status: 404 });
  }

  const [barbershop, appointments, comandas, reviews, activeClubSubscription] = await Promise.all([
    prisma.barbershop.findUnique({
      where: { id: barbershopId },
      select: { name: true, slug: true },
    }),
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
      select: { rating: true },
    }),
    prisma.customerClubSubscription.findFirst({
      where: {
        customerId,
        barbershopId,
        status: { in: ["ACTIVE", "GRACE_PERIOD"] },
      },
      include: {
        clubPlan: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const metrics = computeClientMetrics({
    barbershopId,
    customerId,
    appointments,
    comandas,
    reviews,
    now: new Date(),
  });

  const recentAppointments = [...appointments]
    .sort((a, b) => b.dateTime.getTime() - a.dateTime.getTime())
    .slice(0, 20);

  const history = recentAppointments.map((h) => ({
    id: h.id,
    dateTime: h.dateTime.toISOString(),
    status: h.status,
    bookingMode: h.bookingMode,
    totalPrice: Number(h.totalPrice ?? 0),
    professional: h.barber?.user?.name ?? "Profissional",
    services: Array.isArray(h.services)
      ? h.services.map((s: { service?: { name: string } }) => s.service?.name ?? "")
      : [],
  }));

  const activeBlock = await prisma.barbershopBlockedCustomer.findFirst({
    where: {
      barbershopId,
      active: true,
      OR: [
        { userId: customerId },
        { phoneNormalized: { in: phoneBlockVariants(user.phone) } },
      ],
    },
    select: {
      id: true,
      reason: true,
      blockedAt: true,
    },
  });

  const bookingUrl = barbershop?.slug ? `/${barbershop.slug}/agendar` : null;
  const whatsappMessages = {
    invite: buildClientWhatsappMessage({
      template: "invite",
      customerName: user.name,
      barbershopName: barbershop?.name ?? "barbearia",
      bookingUrl,
    }),
    week: buildClientWhatsappMessage({
      template: "week",
      customerName: user.name,
      barbershopName: barbershop?.name ?? "barbearia",
      bookingUrl,
    }),
    return: buildClientWhatsappMessage({
      template: "return",
      customerName: user.name,
      barbershopName: barbershop?.name ?? "barbearia",
      bookingUrl,
    }),
    feedback: buildClientWhatsappMessage({
      template: "feedback",
      customerName: user.name,
      barbershopName: barbershop?.name ?? "barbearia",
      bookingUrl,
    }),
  };

  return NextResponse.json({
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
    barbershopName: barbershop?.name ?? "Barbearia",
    bookingUrl,
    contactHistoryConfigured: false,
    isBlocked: Boolean(activeBlock),
    blockRecord: activeBlock
      ? {
          id: activeBlock.id,
          reason: activeBlock.reason,
          blockedAt: activeBlock.blockedAt.toISOString(),
        }
      : null,
    clubSubscription: activeClubSubscription
      ? {
          id: activeClubSubscription.id,
          status: activeClubSubscription.status,
          planName: activeClubSubscription.clubPlan.name,
          currentPeriodEnd: activeClubSubscription.currentPeriodEnd.toISOString(),
        }
      : null,
    comandaSummary: {
      open: comandas.filter((c) => c.status === "OPEN" || c.status === "IN_SERVICE").length,
      closed: comandas.filter((c) => c.status === "CLOSED").length,
    },
    whatsapp: {
      link: buildClientWhatsappLink(user.phone, whatsappMessages.invite),
      messages: whatsappMessages,
    },
    metrics,
    history,
  });
}
