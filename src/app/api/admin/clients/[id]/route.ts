import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getPublicAppUrl } from "@/lib/public-url";
import { computeClientMetrics } from "@/lib/clients/client-metrics";
import {
  buildClientWhatsappLink,
  buildClientWhatsappMessage,
  formatCustomerBirthDate,
  phoneLookupVariants,
  validateCustomerBarbershopProfile,
} from "@/lib/customers";
import { WHATSAPP_TEMPLATES } from "@/lib/customer-whatsapp-templates";

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
      select: { id: true, birthDate: true, notes: true },
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

  const baseUrl = getPublicAppUrl(request);
  const bookingUrl = barbershop?.slug ? `${baseUrl}/${barbershop.slug}/agendar` : null;
  const whatsappMessages: Record<string, string> = {};

  // Legacy
  const legacyKeys = ["invite", "week", "return", "feedback"];
  for (const k of legacyKeys) {
    whatsappMessages[k] = buildClientWhatsappMessage({
      template: k,
      customerName: user.name,
      barbershopName: barbershop?.name ?? "barbearia",
      bookingUrl,
    });
  }

  // LOTE B3A templates
  for (const t of WHATSAPP_TEMPLATES) {
    whatsappMessages[t.key] = buildClientWhatsappMessage({
      template: t.key,
      customerName: user.name,
      barbershopName: barbershop?.name ?? "barbearia",
      bookingUrl,
    });
  }

  return NextResponse.json({
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
    birthDate: formatCustomerBirthDate(link?.birthDate),
    notes: link?.notes ?? null,
    barbershopName: barbershop?.name ?? "Barbearia",
    bookingUrl,
    contactHistoryConfigured: true,
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: sessionError, data: sessionData } = await getAdminSession();
  if (sessionError) return sessionError;

  const barbershopId = sessionData!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia nao vinculada." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  const payload = body as { birthDate?: string | null; notes?: string | null };
  if (
    (payload.birthDate !== undefined && payload.birthDate !== null && typeof payload.birthDate !== "string") ||
    (payload.notes !== undefined && payload.notes !== null && typeof payload.notes !== "string")
  ) {
    return NextResponse.json({ error: "Perfil do cliente invalido." }, { status: 400 });
  }
  if (payload.birthDate === undefined && payload.notes === undefined) {
    return NextResponse.json({ error: "Nenhum campo de perfil informado." }, { status: 400 });
  }
  const profileResult = validateCustomerBarbershopProfile(payload);
  if ("error" in profileResult) {
    return NextResponse.json(
      { error: profileResult.error, message: profileResult.message },
      { status: 400 }
    );
  }

  const { id: customerId } = await params;
  const [link, appointmentCountRaw, comandaCountRaw, clubCountRaw] = await Promise.all([
    prisma.customerBarbershopLink.findUnique({
      where: { barbershopId_customerId: { barbershopId, customerId } },
      select: { id: true },
    }),
    prisma.appointment.count({ where: { customerId, barbershopId } }),
    prisma.comanda.count({ where: { customerId, barbershopId } }),
    prisma.customerClubSubscription.count({ where: { customerId, barbershopId } }),
  ]);

  if (!link && Number(appointmentCountRaw ?? 0) === 0 && Number(comandaCountRaw ?? 0) === 0 && Number(clubCountRaw ?? 0) === 0) {
    return NextResponse.json(
      { error: "Cliente nao encontrado ou sem historico nesta barbearia." },
      { status: 404 }
    );
  }

  const profile = await prisma.customerBarbershopLink.upsert({
    where: { barbershopId_customerId: { barbershopId, customerId } },
    create: {
      barbershopId,
      customerId,
      birthDate: profileResult.profile.birthDate,
      notes: profileResult.profile.notes,
    },
    update: {
      ...(profileResult.profile.birthDate !== undefined
        ? { birthDate: profileResult.profile.birthDate }
        : {}),
      ...(profileResult.profile.notes !== undefined ? { notes: profileResult.profile.notes } : {}),
    },
    select: { birthDate: true, notes: true },
  });

  return NextResponse.json({
    birthDate: formatCustomerBirthDate(profile.birthDate),
    notes: profile.notes,
  });
}
