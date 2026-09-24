import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { isPlatformAdmin, isSubscriptionActive, getTenantSubscription } from "@/lib/subscription-utils";
import { resolveSingleActiveMembership } from "@/lib/tenant-context";
const STRICT_ADMIN_ROLES = ["SUPER_ADMIN", "OWNER", "MANAGER"];

async function resolveSessionInternal(options: {
  checkSubscription: boolean;
  allowedRoles: string[];
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
      data: null,
    };
  }

  const user = session.user as { id?: string; role?: string; email?: string | null };
  const userId = user.id as string;
  const sessionRole = user.role as string;
  const email = session.user?.email as string | null;

  const isPlatform = isPlatformAdmin(email) || sessionRole === "SUPER_ADMIN";

  if (!options.allowedRoles.includes(sessionRole) && !isPlatform) {
    return {
      error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
      data: null,
    };
  }

  const membershipResolution = await resolveSingleActiveMembership(userId);

  if (membershipResolution.status === "MULTIPLE") {
    return {
      error: NextResponse.json(
        {
          error: "TENANT_SELECTION_REQUIRED",
          message: "Existe mais de uma barbearia ativa para este usuário.",
        },
        { status: 409 }
      ),
      data: null,
    };
  }

  const member = membershipResolution.membership;

  if (!member && !isPlatform) {
    return {
      error: NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 }),
      data: null,
    };
  }

  const role = member?.role ?? "SUPER_ADMIN";

  if (!options.allowedRoles.includes(role) && !isPlatform) {
    return {
      error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
      data: null,
    };
  }

  // Se não for platform admin e tiver barbearia vinculada, validar assinatura quando solicitado
  if (options.checkSubscription && !isPlatform && member) {
    const subscription = await getTenantSubscription(member.barbershopId);
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

/**
 * Standard admin session guard. Strictly limited to SUPER_ADMIN, OWNER, and MANAGER.
 * RECEPTIONIST is explicitly NOT allowed here.
 */
export async function getAdminSession() {
  return resolveSessionInternal({
    checkSubscription: true,
    allowedRoles: STRICT_ADMIN_ROLES,
  });
}

export async function getBillingAdminSession() {
  return resolveSessionInternal({
    checkSubscription: false,
    allowedRoles: STRICT_ADMIN_ROLES,
  });
}

/**
 * Operational staff session guard for shared operational resources
 * (Appointments, Customers, Comandas, Waitlist).
 * Allows RECEPTIONIST alongside OWNER and MANAGER, with optional granular permission check.
 */
export { getOperationalStaffSession } from "./operational-session";

export async function requireOperationalSession() {
  const { error, data } = await getAdminSession();
  if (error) return { error, data: null };

  if (!data || !data.barbershopId) {
    return {
      error: NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 }),
      data: null,
    };
  }

  // Apenas OWNER, MANAGER ou SUPER_ADMIN com tenant associado na sessão operacional
  if (!["OWNER", "MANAGER", "SUPER_ADMIN"].includes(data.role)) {
    return {
      error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
      data: null,
    };
  }

  return {
    error: null,
    data: data as { userId: string; role: string; memberId: string; barbershopId: string },
  };
}
