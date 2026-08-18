import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { phoneLookupVariants } from "@/lib/customers";

type SessionUserWithId = {
  id?: string;
  authLevel?: string;
};

function hasClientAccess(sessionUser: SessionUserWithId | undefined) {
  return sessionUser?.authLevel === "verified_link" || sessionUser?.authLevel === "verified_otp";
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
    }

    if (!hasClientAccess(session.user as SessionUserWithId)) {
      return NextResponse.json(
        { error: "Verificação necessária para acessar sua conta." },
        { status: 403 }
      );
    }

    const userId = (session.user as SessionUserWithId).id;
    if (!userId) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    });

    const phoneVariants = user?.phone ? phoneLookupVariants(user.phone) : [];

    const [links, appointments, comandas] = await Promise.all([
      prisma.customerBarbershopLink.findMany({
        where: { customerId: userId },
        select: { barbershopId: true },
      }),
      prisma.appointment.findMany({
        where: {
          OR: [
            { customerId: userId },
            ...(phoneVariants.length > 0 ? [{ customer: { phone: { in: phoneVariants } } }] : []),
          ],
        },
        select: { barbershopId: true },
      }),
      prisma.comanda.findMany({
        where: {
          OR: [
            { customerId: userId },
            ...(phoneVariants.length > 0 ? [{ customer: { phone: { in: phoneVariants } } }] : []),
          ],
        },
        select: { barbershopId: true },
      }),
    ]);

    const linkedBarbershopIds = Array.from(
      new Set([
        ...links.map((l) => l.barbershopId),
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
