import { getAdminSession } from "@/lib/api-auth";
import { PermissionKey } from "@/lib/permissions/types";
import { ROLE_DEFAULT_PRESETS } from "@/lib/permissions/presets";
import { checkMemberPermission } from "@/lib/permissions/engine";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPlatformAdmin, isSubscriptionActive, getTenantSubscription } from "@/lib/subscription-utils";
import { resolveSingleActiveMembership } from "@/lib/tenant-context";
import { NextResponse } from "next/server";

export async function getOperationalStaffSession(options?: {
  requiredPermission?: PermissionKey;
}) {
  // 1. Tenta getAdminSession() primeiro (OWNER, MANAGER, SUPER_ADMIN)
  // Em testes unitários que mockam getAdminSession, isso resolve imediatamente
  let adminResult: any = null;
  try {
    adminResult = await getAdminSession();
  } catch {
    adminResult = null;
  }

  if (adminResult && !adminResult.error && adminResult.data) {
    if (options?.requiredPermission && adminResult.data.memberId) {
      let allowed = true;
      try {
        allowed = await checkMemberPermission(
          adminResult.data.memberId,
          adminResult.data.role,
          options.requiredPermission
        );
      } catch {
        const preset = ROLE_DEFAULT_PRESETS[adminResult.data.role];
        allowed = preset ? Boolean(preset[options.requiredPermission]) : true;
      }

      if (!allowed) {
        return {
          error: NextResponse.json(
            {
              error: "PERMISSION_DENIED",
              message: "Permissão '" + options.requiredPermission + "' necessária para executar esta ação.",
              requiredPermission: options.requiredPermission,
            },
            { status: 403 }
          ),
          data: null,
        };
      }
    }
    return adminResult;
  }

  // 2. Se getAdminSession negou, verificar se há sessão NextAuth
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  if (!session?.user) {
    if (adminResult && adminResult.error) {
      return adminResult;
    }
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

  // Na sessão operacional, aceitamos RECEPTIONIST além dos roles administrativos
  const allowedOperationalRoles = ["SUPER_ADMIN", "OWNER", "MANAGER", "RECEPTIONIST"];
  if (!allowedOperationalRoles.includes(role) && !isPlatform) {
    return {
      error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
      data: null,
    };
  }

  if (!isPlatform && member) {
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

  if (options?.requiredPermission && member) {
    let allowed = true;
    try {
      allowed = await checkMemberPermission(
        member.id,
        role,
        options.requiredPermission
      );
    } catch {
      const preset = ROLE_DEFAULT_PRESETS[role];
      allowed = preset ? Boolean(preset[options.requiredPermission]) : true;
    }

    if (!allowed) {
      return {
        error: NextResponse.json(
          {
            error: "PERMISSION_DENIED",
            message: "Permissão '" + options.requiredPermission + "' necessária para executar esta ação.",
            requiredPermission: options.requiredPermission,
          },
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
