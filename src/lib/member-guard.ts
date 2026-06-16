import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

const MEMBER_ROLES = ["OWNER", "MANAGER", "BARBER"];

export async function requireMember() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;

  if (!MEMBER_ROLES.includes(role)) {
    redirect("/acesso-negado");
  }

  const member = await prisma.barbershopMember.findFirst({
    where: { userId, isActive: true },
    include: { barbershop: true, user: true },
  });

  if (!member) {
    redirect("/acesso-negado");
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
