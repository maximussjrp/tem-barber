import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { normalizePhone, phoneLookupVariants } from "@/lib/customers";
import { publicBarbershopWhere, isPublicBarbershop } from "@/lib/public-barbershops";
import { consumeRateLimit, resolveClientIp } from "@/lib/public-rate-limit";


export async function POST(request: Request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Corpo da requisicao invalido." }, { status: 400 });
    }

    const { phone } = body || {};

    if (!phone) {
      return NextResponse.json({ error: "Telefone e obrigatorio." }, { status: 400 });
    }

    const cleanPhone = normalizePhone(phone);
    if (cleanPhone.length < 10) {
      return NextResponse.json({ error: "Digite o DDD e o numero completo." }, { status: 400 });
    }

    const ip = resolveClientIp(request);
    const rateLimit = consumeRateLimit({
      bucket: "public-client-lookup",
      key: `${ip}:${cleanPhone}`,
      max: 15,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Muitas tentativas. Tente novamente em instantes." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    const user = await prisma.user.findFirst({
      where: { phone: { in: phoneLookupVariants(phone) } },
    });

    if (!user) {
      return NextResponse.json({
        linkedBarbershops: [],
        phoneHint:
          cleanPhone.length === 10
            ? "Nao encontramos este telefone. Confira se o numero esta completo, incluindo o 9o digito quando for celular."
            : undefined,
      });
    }

    const publicWhere = publicBarbershopWhere();

    const [appointments, comandas] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          customerId: user.id,
          barbershop: publicWhere,
        },
        select: {
          barbershop: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      }),
      prisma.comanda.findMany({
        where: {
          customerId: user.id,
          barbershop: publicWhere,
        },
        select: {
          barbershop: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      }),
    ]);

    const barbershopMap = new Map<string, { id: string; name: string; slug: string }>();

    for (const app of appointments) {
      if (app.barbershop) {
        barbershopMap.set(app.barbershop.id, {
          id: app.barbershop.id,
          name: app.barbershop.name,
          slug: app.barbershop.slug,
        });
      }
    }

    for (const cmd of comandas) {
      if (cmd.barbershop) {
        barbershopMap.set(cmd.barbershop.id, {
          id: cmd.barbershop.id,
          name: cmd.barbershop.name,
          slug: cmd.barbershop.slug,
        });
      }
    }

    const linkedBarbershops = Array.from(barbershopMap.values()).filter(isPublicBarbershop);

    return NextResponse.json({
      linkedBarbershops,
      phoneHint:
        linkedBarbershops.length === 0 && cleanPhone.length === 10
          ? "Nao encontramos este telefone. Confira se o numero esta completo, incluindo o 9o digito quando for celular."
          : undefined,
    });
  } catch (error) {
    console.error("Erro ao buscar vinculos do cliente:", error);
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
  }
}
