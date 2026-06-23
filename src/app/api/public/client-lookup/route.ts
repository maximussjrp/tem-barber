import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
    }

    const { phone } = body || {};

    if (!phone) {
      return NextResponse.json({ error: "Telefone é obrigatório." }, { status: 400 });
    }

    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      return NextResponse.json({ error: "Telefone inválido. Informe o DDD + Número." }, { status: 400 });
    }

    // Buscar usuário pelo telefone limpo
    const user = await prisma.user.findFirst({
      where: { phone: cleanPhone },
    });

    if (!user) {
      return NextResponse.json({ linkedBarbershops: [] });
    }

    // Buscar barbearias vinculadas por agendamentos e comandas
    const [appointments, comandas] = await Promise.all([
      prisma.appointment.findMany({
        where: { customerId: user.id },
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
        where: { customerId: user.id },
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

    const linkedBarbershops = Array.from(barbershopMap.values());

    return NextResponse.json({ linkedBarbershops });
  } catch (error) {
    console.error("Erro ao buscar vínculos do cliente:", error);
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
  }
}
