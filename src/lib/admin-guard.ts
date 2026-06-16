import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function requireAdmin() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string;

  if (!["SUPER_ADMIN", "OWNER", "MANAGER"].includes(role)) {
    redirect("/acesso-negado");
  }

  const member = await prisma.barbershopMember.findFirst({
    where: { userId, isActive: true },
    include: { barbershop: true },
  });

  if (!member && role !== "SUPER_ADMIN") {
    redirect("/acesso-negado");
  }

  return {
    session,
    userId,
    role,
    member: member ?? null,
    barbershop: member?.barbershop ?? null,
    barbershopId: member?.barbershopId ?? null,
  };
}
