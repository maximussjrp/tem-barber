import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { isPlatformAdmin, isSubscriptionActive, getOrCreateSubscription } from "@/lib/subscription-utils";

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
  const email = session.user?.email as string | null;

  const isPlatform = isPlatformAdmin(email) || role === "SUPER_ADMIN";

  if (!["SUPER_ADMIN", "OWNER", "MANAGER"].includes(role) && !isPlatform) {
    return {
      error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
      data: null,
    };
  }

  const member = await prisma.barbershopMember.findFirst({
    where: { userId, isActive: true },
  });

  if (!member && !isPlatform) {
    return {
      error: NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 }),
      data: null,
    };
  }

  // Se não for platform admin e tiver barbearia vinculada, validar assinatura
  if (!isPlatform && member) {
    const subscription = await getOrCreateSubscription(member.barbershopId);
    if (!isSubscriptionActive(subscription)) {
      return {
        error: NextResponse.json(
          { error: "SUBSCRIPTION_SUSPENDED", message: "Sua assinatura está suspensa." },
          { status: 403 }
        ),
        data: null,
      };
    }
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
