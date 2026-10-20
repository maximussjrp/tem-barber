import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isPlatformAdmin, isSubscriptionActive, getTenantSubscription } from "@/lib/subscription-utils";
import { resolveSingleActiveMembership } from "@/lib/tenant-context";

const OPERATIONAL_ADMIN_ROLES: readonly string[] = [
  "SUPER_ADMIN",
  "OWNER",
  "MANAGER",
  "RECEPTIONIST",
];

const MANAGERIAL_ADMIN_ROLES: readonly string[] = [
  "SUPER_ADMIN",
  "OWNER",
  "MANAGER",
];

export const RECEPTIONIST_HOME_PATH = "/admin/agendamentos";

async function resolveAdminGuardInternal(options: {
  checkSubscription: boolean;
  requireManagerial?: boolean;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return redirect("/login");
  }

  const user = session.user as { id?: string; role?: string; email?: string | null };
  const userId = user.id as string;
  const sessionRole = user.role as string;
  const email = session.user?.email as string | null;

  const isPlatform = isPlatformAdmin(email) || sessionRole === "SUPER_ADMIN";

  if (!OPERATIONAL_ADMIN_ROLES.includes(sessionRole) && !isPlatform) {
    return redirect("/acesso-negado");
  }

  const membershipResolution = await resolveSingleActiveMembership(userId);

  if (membershipResolution.status === "MULTIPLE" && !isPlatform) {
    return redirect("/acesso-negado?error=TENANT_SELECTION_REQUIRED");
  }

  const member = membershipResolution.status === "SINGLE" ? membershipResolution.membership : null;

  if (!member && !isPlatform) {
    return redirect("/acesso-negado");
  }

  const role = isPlatform ? (member?.role ?? "SUPER_ADMIN") : (member?.role ?? sessionRole);

  if (!OPERATIONAL_ADMIN_ROLES.includes(role) && !isPlatform) {
    return redirect("/acesso-negado");
  }

  // Se não for platform admin e tiver barbearia vinculada, validar assinatura quando solicitado
  if (options.checkSubscription && !isPlatform && member) {
    const subscription = await getTenantSubscription(member.barbershopId);
    if (!isSubscriptionActive(subscription)) {
      return redirect("/assinatura-suspensa");
    }
  }

  if (options.requireManagerial) {
    if (!member) {
      return redirect(isPlatform ? "/admin/platform" : "/acesso-negado");
    }
    if (!MANAGERIAL_ADMIN_ROLES.includes(role) && !isPlatform) {
      if (role === "RECEPTIONIST") {
        return redirect(RECEPTIONIST_HOME_PATH);
      }
      return redirect("/acesso-negado");
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

export async function requireManagerialAdmin() {
  return resolveAdminGuardInternal({ checkSubscription: true, requireManagerial: true });
}

export async function requireBillingAdmin() {
  return resolveAdminGuardInternal({ checkSubscription: false });
}
