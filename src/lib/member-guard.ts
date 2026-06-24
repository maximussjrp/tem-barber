import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isPlatformAdmin, isSubscriptionActive, getOrCreateSubscription } from "@/lib/subscription-utils";

const MEMBER_ROLES = ["OWNER", "MANAGER", "BARBER"];

export async function requireMember() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;
  const email = session.user?.email as string | null;

  const isPlatform = isPlatformAdmin(email) || role === "SUPER_ADMIN";

  if (!MEMBER_ROLES.includes(role) && !isPlatform) {
    redirect("/acesso-negado");
  }

  const member = await prisma.barbershopMember.findFirst({
    where: { userId, isActive: true },
    include: { barbershop: true, user: true },
  });

  if (!member) {
    redirect("/acesso-negado");
  }

  // Se não for platform admin e tiver barbearia vinculada, validar assinatura
  if (!isPlatform) {
    const subscription = await getOrCreateSubscription(member.barbershopId);
    if (!isSubscriptionActive(subscription)) {
      redirect("/assinatura-suspensa");
    }
  }

  return {
    session,
    userId,
    role,
    member,
    barbershop: member.barbershop,
    barbershopId: member.barbershopId,
    memberId: member.id,
  };
}
