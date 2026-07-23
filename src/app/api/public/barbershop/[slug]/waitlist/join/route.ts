import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  normalizeBrazilianMobilePhone,
  validateBrazilianMobilePhone,
} from "@/lib/phone/br-phone";
import {
  buildWaitlistTokenHint,
  generateWaitlistPublicToken,
  hashWaitlistPublicToken,
} from "@/lib/waitlist/token";
import { calculateEntryPosition, getNextQueueNumber } from "@/lib/waitlist/positions";

interface Params {
  params: Promise<{ slug: string }>;
}

// POST /api/public/barbershop/[slug]/waitlist/join — join active waitlist
export async function POST(request: NextRequest, { params }: Params) {
  const { slug } = await params;

  let body: {
    customerName?: string;
    customerPhone?: string;
    serviceId?: string;
    preferredMemberId?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY", message: "Body JSON inválido." }, { status: 400 });
  }

  const { customerName, customerPhone, serviceId, preferredMemberId } = body;

  if (!customerName || !customerName.trim()) {
    return NextResponse.json({ error: "INVALID_CUSTOMER_NAME", message: "Nome do cliente é obrigatório." }, { status: 400 });
  }

  if (!customerPhone || !validateBrazilianMobilePhone(customerPhone)) {
    return NextResponse.json({ error: "INVALID_PHONE", message: "Telefone do cliente é inválido." }, { status: 400 });
  }

  if (!serviceId) {
    return NextResponse.json({ error: "INVALID_SERVICE", message: "Serviço é obrigatório." }, { status: 400 });
  }

  const normalizedPhone = normalizeBrazilianMobilePhone(customerPhone)!;

  const barbershop = await prisma.barbershop.findFirst({
    where: { slug, active: true },
    select: { id: true, slug: true },
  });

  if (!barbershop) {
    return NextResponse.json({ error: "BARBERSHOP_NOT_FOUND", message: "Barbearia não encontrada." }, { status: 404 });
  }

  const session = await prisma.onlineWaitlistSession.findFirst({
    where: { barbershopId: barbershop.id, status: "OPEN" },
  });

  if (!session) {
    return NextResponse.json({ error: "WAITLIST_CLOSED", message: "A fila de espera está fechada no momento." }, { status: 400 });
  }

  const service = await prisma.service.findFirst({
    where: { id: serviceId, barbershopId: barbershop.id, isActive: true },
  });

  if (!service) {
    return NextResponse.json({ error: "INVALID_SERVICE", message: "Serviço inválido ou indisponível." }, { status: 400 });
  }

  if (preferredMemberId) {
    const member = await prisma.barbershopMember.findFirst({
      where: { id: preferredMemberId, barbershopId: barbershop.id, isActive: true },
    });
    if (!member) {
      return NextResponse.json({ error: "INVALID_MEMBER", message: "Profissional preferido inválido ou indisponível." }, { status: 400 });
    }
  }

  // Find or create customer
  let customer = await prisma.user.findFirst({
    where: { phone: normalizedPhone },
  });

  if (!customer) {
    customer = await prisma.user.create({
      data: {
        name: customerName.trim(),
        phone: normalizedPhone,
        role: "USER",
      },
    });
  }

  // Upsert CustomerBarbershopLink
  await prisma.customerBarbershopLink.upsert({
    where: {
      barbershopId_customerId: {
        barbershopId: barbershop.id,
        customerId: customer.id,
      },
    },
    create: {
      barbershopId: barbershop.id,
      customerId: customer.id,
    },
    update: {},
  });

  const publicToken = generateWaitlistPublicToken();
  const publicTokenHash = hashWaitlistPublicToken(publicToken);
  const publicTokenHint = buildWaitlistTokenHint(publicToken);

  const result = await prisma.$transaction(async (tx) => {
    const queueNumber = await getNextQueueNumber(tx, session.id);
    const positionWeight = queueNumber * 10;

    const entry = await tx.onlineWaitlistEntry.create({
      data: {
        sessionId: session.id,
        barbershopId: barbershop.id,
        customerId: customer.id,
        customerName: customerName.trim(),
        customerPhone: normalizedPhone,
        serviceId,
        preferredMemberId: preferredMemberId || null,
        queueNumber,
        positionWeight,
        status: "WAITING",
        publicTokenHash,
        publicTokenHint,
      },
    });

    const position = await calculateEntryPosition(tx, session.id, positionWeight, entry.createdAt);

    return { entry, position };
  });

  const trackingUrl = `/${slug}/fila?entryId=${result.entry.id}&token=${publicToken}`;

  return NextResponse.json(
    {
      entryId: result.entry.id,
      queueNumber: result.entry.queueNumber,
      position: result.position,
      publicToken,
      status: result.entry.status,
      trackingUrl,
    },
    { status: 201 }
  );
}
