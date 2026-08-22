import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isPlatformAdmin, isSubscriptionActive, getTenantSubscription } from "@/lib/subscription-utils";
import { resolveSingleActiveMembership } from "@/lib/tenant-context";

export async function requireAdmin() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const userId = (session.user as any).id as string;
  const sessionRole = (session.user as any).role as string;
  const email = session.user?.email as string | null;

  const isPlatform = isPlatformAdmin(email) || sessionRole === "SUPER_ADMIN";

  if (!["SUPER_ADMIN", "OWNER", "MANAGER"].includes(sessionRole) && !isPlatform) {
    redirect("/acesso-negado");
  }

  const membershipResolution = await resolveSingleActiveMembership(userId);

  if (membershipResolution.status === "MULTIPLE") {
    redirect("/acesso-negado?error=TENANT_SELECTION_REQUIRED");
  }

  const member = membershipResolution.membership;

  if (!member && !isPlatform) {
    redirect("/acesso-negado");
  }

  const role = isPlatform ? "SUPER_ADMIN" : member?.role ?? sessionRole;

  if (!["SUPER_ADMIN", "OWNER", "MANAGER"].includes(role)) {
    redirect("/acesso-negado");
  }

  // Se não for platform admin e tiver barbearia vinculada, validar assinatura
  if (!isPlatform && member) {
    const subscription = await getTenantSubscription(member.barbershopId);
    if (!isSubscriptionActive(subscription)) {
      redirect("/assinatura-suspensa");
    }
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
