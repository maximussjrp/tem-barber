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
  let adminResult: Awaited<ReturnType<typeof getAdminSession>> | null = null;
  try {
    adminResult = await getAdminSession();
  } catch {
    adminResult = null;
  }

  if (adminResult && !adminResult.error && adminResult.data) {
    if (options?.requiredPermission) {
      if (adminResult.data.role === "OWNER" || adminResult.data.role === "SUPER_ADMIN") {
        // OWNER and SUPER_ADMIN have full permission
      } else if (adminResult.data.memberId) {
        try {
          const allowed = await checkMemberPermission(
            adminResult.data.memberId,
            adminResult.data.role,
            options.requiredPermission
          );
          if (!allowed) {
            return {
              error: NextResponse.json(
                {
                  error: adminResult.data.role === "BARBER" ? "FORBIDDEN" : "PERMISSION_DENIED",
                  message: "Permissão '" + options.requiredPermission + "' necessária para executar esta ação.",
                  requiredPermission: options.requiredPermission,
                },
                { status: 403 }
              ),
              data: null,
            };
          }
        } catch {
          // FAIL CLOSED: on any exception, deny access immediately
          return {
            error: NextResponse.json(
              {
                error: "PERMISSION_DENIED",
                message: "Falha na resolução de permissões de acesso.",
                requiredPermission: options.requiredPermission,
              },
              { status: 403 }
            ),
            data: null,
          };
        }
      } else {
        // Fallback to role presets when memberId is not populated (e.g. test session mocks)
        const presetAllowed = ROLE_DEFAULT_PRESETS[adminResult.data.role as keyof typeof ROLE_DEFAULT_PRESETS]?.[options.requiredPermission];
        if (!presetAllowed) {
          return {
            error: NextResponse.json(
              {
                error: adminResult.data.role === "BARBER" ? "FORBIDDEN" : "PERMISSION_DENIED",
                message: "Permissão '" + options.requiredPermission + "' necessária para executar esta ação.",
                requiredPermission: options.requiredPermission,
              },
              { status: 403 }
            ),
            data: null,
          };
        }
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

  if (options?.requiredPermission) {
    if (role === "OWNER" || role === "SUPER_ADMIN") {
      // OWNER / SUPER_ADMIN granted
    } else if (!member) {
      return {
        error: NextResponse.json(
          {
            error: "PERMISSION_DENIED",
            message: "Membro não identificado para verificação de permissões.",
          },
          { status: 403 }
        ),
        data: null,
      };
    } else {
      try {
        const allowed = await checkMemberPermission(
          member.id,
          role,
          options.requiredPermission
        );
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
      } catch {
        // FAIL CLOSED: any error during resolution rejects access
        return {
          error: NextResponse.json(
            {
              error: "PERMISSION_DENIED",
              message: "Falha na resolução de permissões de acesso.",
              requiredPermission: options.requiredPermission,
            },
            { status: 403 }
          ),
          data: null,
        };
      }
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
