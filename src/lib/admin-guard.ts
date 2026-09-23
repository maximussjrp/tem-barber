import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isPlatformAdmin, isSubscriptionActive, getTenantSubscription } from "@/lib/subscription-utils";
import { resolveSingleActiveMembership } from "@/lib/tenant-context";

async function resolveAdminGuardInternal(options: { checkSubscription: boolean }) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const user = session.user as { id?: string; role?: string; email?: string | null };
  const userId = user.id as string;
  const sessionRole = user.role as string;
  const email = session.user?.email as string | null;

  const isPlatform = isPlatformAdmin(email) || sessionRole === "SUPER_ADMIN";

  if (!["SUPER_ADMIN", "OWNER", "MANAGER"].includes(sessionRole) && !isPlatform) {
    redirect("/acesso-negado");
  }

  const membershipResolution = await resolveSingleActiveMembership(userId);

  if (membershipResolution.status === "MULTIPLE" && !isPlatform) {
    redirect("/acesso-negado?error=TENANT_SELECTION_REQUIRED");
  }

  const member = membershipResolution.status === "SINGLE" ? membershipResolution.membership : null;

  if (!member && !isPlatform) {
    redirect("/acesso-negado");
  }

  const role = isPlatform ? (member?.role ?? "SUPER_ADMIN") : (member?.role ?? sessionRole);

  if (!["SUPER_ADMIN", "OWNER", "MANAGER"].includes(role) && !isPlatform) {
    redirect("/acesso-negado");
  }

  // Se não for platform admin e tiver barbearia vinculada, validar assinatura quando solicitado
  if (options.checkSubscription && !isPlatform && member) {
    const subscription = await getTenantSubscription(member.barbershopId);
    if (!isSubscriptionActive(subscription)) {
      redirect("/assinatura-suspensa");
    }
  }

  return {
    session,
    userId,
    role,
    isPlatform,
    member: member ?? null,
    barbershop: member?.barbershop ?? null,
    barbershopId: member?.barbershopId ?? null,
  };
}

export async function requireAdmin() {
  return resolveAdminGuardInternal({ checkSubscription: true });
}

export async function requireBillingAdmin() {
  return resolveAdminGuardInternal({ checkSubscription: false });
}
