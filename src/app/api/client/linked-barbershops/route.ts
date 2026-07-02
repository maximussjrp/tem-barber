import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

type SessionUserWithId = {
  id?: string;
  authLevel?: string;
};

function hasStrongClientAccess(sessionUser: SessionUserWithId | undefined) {
  return sessionUser?.authLevel === "verified_link" || sessionUser?.authLevel === "verified_otp";
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    if (!hasStrongClientAccess(session.user as SessionUserWithId)) {
      return NextResponse.json(
        { error: "Acesso restrito. Use um link seguro para acessar sua conta." },
        { status: 403 }
      );
    }

    const userId = (session.user as SessionUserWithId).id;
    if (!userId) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    // A regra correta de vínculo é verificar se o cliente interagiu com a barbearia
    // seja por Agendamento ou por Comanda (ex: cliente walk-in).
    const [appointments, comandas] = await Promise.all([
      prisma.appointment.findMany({
        where: { customerId: userId },
        select: { barbershopId: true },
      }),
      prisma.comanda.findMany({
        where: { customerId: userId },
        select: { barbershopId: true },
      }),
    ]);

    const linkedBarbershopIds = Array.from(
      new Set([
        ...appointments.map((a) => a.barbershopId),
        ...comandas.map((c) => c.barbershopId),
      ])
    );

    return NextResponse.json({ linkedBarbershopIds });
  } catch {
    return NextResponse.json(
      { error: "Erro ao buscar vínculos." },
      { status: 500 }
    );
  }
}
