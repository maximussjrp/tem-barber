import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isPlatformAdmin, isSubscriptionActive, getTenantSubscription } from "@/lib/subscription-utils";
import { resolveSingleActiveMembership } from "@/lib/tenant-context";

const MEMBER_ROLES = ["OWNER", "MANAGER", "BARBER"];

export async function requireMember() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const userId = (session.user as any).id as string;
  const sessionRole = (session.user as any).role as string;
  const email = session.user?.email as string | null;

  const isPlatform = isPlatformAdmin(email) || sessionRole === "SUPER_ADMIN";

  if (!MEMBER_ROLES.includes(sessionRole) && !isPlatform) {
    redirect("/acesso-negado");
  }

  const membershipResolution = await resolveSingleActiveMembership(userId);

  if (membershipResolution.status === "MULTIPLE") {
    redirect("/acesso-negado?error=TENANT_SELECTION_REQUIRED");
  }

  const member = membershipResolution.membership;

  if (!member) {
    redirect("/acesso-negado");
  }

  const role = member.role;

  if (!MEMBER_ROLES.includes(role) && !isPlatform) {
    redirect("/acesso-negado");
  }

  // Se não for platform admin e tiver barbearia vinculada, validar assinatura
  if (!isPlatform) {
    const subscription = await getTenantSubscription(member.barbershopId);
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
