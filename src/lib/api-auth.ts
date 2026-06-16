import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function getAdminSession() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
      data: null,
    };
  }

  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;

  if (!["SUPER_ADMIN", "OWNER", "MANAGER"].includes(role)) {
    return {
      error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
      data: null,
    };
  }

  const member = await prisma.barbershopMember.findFirst({
    where: { userId, isActive: true },
  });

  if (!member && role !== "SUPER_ADMIN") {
    return {
      error: NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 }),
      data: null,
    };
  }

  return {
    error: null,
    data: {
      userId,
      role,
      memberId: member?.id ?? null,
      barbershopId: member?.barbershopId ?? null,
    },
  };
}
