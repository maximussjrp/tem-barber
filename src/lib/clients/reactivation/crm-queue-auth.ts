/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getEffectivePermissions } from "@/lib/permissions/engine";
import { PermissionKey } from "@/lib/permissions/types";
import { resolveSingleActiveMembership } from "@/lib/tenant-context";
import { getTenantSubscription, isSubscriptionActive } from "@/lib/subscription-utils";

export interface CrmQueueSessionData {
  userId: string;
  role: string;
  memberId: string | null;
  barbershopId: string;
}

export interface CrmQueueAuthOptions {
  requiredPermission?: PermissionKey;
  db?: typeof prisma;
}

/**
 * Resolve a sessão autenticada, tenant ativo e assinatura do usuário,
 * sem aplicar antecipadamente decisão de permissão específica da campanha
 * (permitindo que o serviço identifique a origem real no banco antes de aplicar a política de acesso).
 */
export async function resolveTenantUserSession(
  db: typeof prisma = prisma
): Promise<
  | { error: NextResponse; data: null }
  | { error: null; data: CrmQueueSessionData }
> {
  // 1. Tenta getAdminSession() primeiro (cobre mocks de testes e papéis administrativos padrão)
  let adminResult: Awaited<ReturnType<typeof getAdminSession>> | null = null;
  try {
    adminResult = await getAdminSession();
  } catch {
    adminResult = null;
  }

  let userId: string | null = null;
  let role: string | null = null;
  let memberId: string | null = null;
  let barbershopId: string | null = null;

  if (adminResult && !adminResult.error && adminResult.data) {
    userId = adminResult.data.userId;
    role = adminResult.data.role;
    memberId = adminResult.data.memberId ?? null;
    barbershopId = adminResult.data.barbershopId ?? null;

    // Regra proprietário / G24-04: SUPER_ADMIN não possui acesso operacional automático sem vínculo ativo com o tenant
    if (role === "SUPER_ADMIN") {
      if (!barbershopId || !userId) {
        return {
          error: NextResponse.json(
            {
              error: "Acesso não autorizado.",
              code: "FORBIDDEN",
              message: "SUPER_ADMIN não possui acesso operacional automático sem vínculo ativo com a barbearia.",
            },
            { status: 403 }
          ),
          data: null,
        };
      }
      // Sempre valida vínculo ativo em barbershopMember mesmo se memberId vier populado na sessão
      const member = typeof db.barbershopMember?.findFirst === "function"
        ? await db.barbershopMember.findFirst({
            where: { userId, barbershopId, isActive: true },
          })
        : null;
      if (!member || (member.role as string) === "SUPER_ADMIN") {
        return {
          error: NextResponse.json(
            {
              error: "Acesso não autorizado.",
              code: "FORBIDDEN",
              message: "SUPER_ADMIN não possui vínculo ativo como membro nesta barbearia.",
            },
            { status: 403 }
          ),
          data: null,
        };
      }
      memberId = member.id;
      role = member.role;
    }
  } else {
    // 2. Se getAdminSession negou (ex: BARBER ou RECEPTIONIST autenticados), resolve via NextAuth session e membership
    let session = null;
    try {
      session = await getServerSession(authOptions);
    } catch {
      session = null;
    }

    const sessionUserId = (session?.user as any)?.id;
    if (!sessionUserId || typeof sessionUserId !== "string") {
      if (adminResult?.error) {
        return adminResult;
      }
      return {
        error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
        data: null,
      };
    }

    userId = sessionUserId;
    const membershipResolution = await resolveSingleActiveMembership(sessionUserId);
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
    if (!member) {
      return {
        error: NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 }),
        data: null,
      };
    }

    // Valida assinatura ativa do tenant
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

    role = member.role;
    memberId = member.id;
    barbershopId = member.barbershopId;
  }

  if (!barbershopId || !userId || !role) {
    return {
      error: NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 }),
      data: null,
    };
  }

  return {
    error: null,
    data: {
      userId,
      role,
      memberId,
      barbershopId,
    },
  };
}

/**
 * Guard de autorização para operações da Fila Assistida de WhatsApp e Consentimento (DEC-05 / G23-01 / G23-02).
 * - OWNER: acesso total irrestrito.
 * - MANAGER, RECEPTIONIST, BARBER: desativado por padrão (fail-closed).
 * - Colaboradores só operam com concessão explícita de WHATSAPP_ASSISTED_OPERATE e CLIENTS_VIEW.
 * - CLIENTS_MANAGE não concede automaticamente permissão de WhatsApp.
 * - SUPER_ADMIN sem vínculo ativo com o tenant é sumariamente bloqueado.
 * - Ausência de memberId para colaboradores falha fechado (403 MEMBER_IDENTIFICATION_REQUIRED).
 */
export async function requireCrmQueueSession(
  options: CrmQueueAuthOptions = {}
): Promise<
  | { error: NextResponse; data: null }
  | { error: null; data: CrmQueueSessionData }
> {
  const db = options.db || prisma;
  const requiredPermission: PermissionKey =
    options.requiredPermission || "WHATSAPP_ASSISTED_OPERATE";

  const sessionRes = await resolveTenantUserSession(db);
  if (sessionRes.error) return sessionRes;

  const { userId, role, memberId, barbershopId } = sessionRes.data;

  // G24-04: Fail-closed explícito caso SUPER_ADMIN chegue aqui sem resolução de papel de membro do tenant
  if (role === "SUPER_ADMIN") {
    return {
      error: NextResponse.json(
        {
          error: "FORBIDDEN",
          code: "SUPER_ADMIN_TENANT_MEMBERSHIP_REQUIRED",
          message:
            "SUPER_ADMIN sem vínculo ativo de membro na barbearia não possui permissão operacional na fila assistida.",
        },
        { status: 403 }
      ),
      data: null,
    };
  }

  // O proprietário (OWNER) da barbearia tem controle total irrestrito
  if (role === "OWNER") {
    return {
      error: null,
      data: {
        userId,
        role,
        memberId,
        barbershopId,
      },
    };
  }

  // G23-02: Fail-closed se memberId estiver ausente para colaboradores
  if (!memberId) {
    return {
      error: NextResponse.json(
        {
          error: "FORBIDDEN",
          code: "MEMBER_IDENTIFICATION_REQUIRED",
          message: "Identificação de membro do tenant é obrigatória para colaboradores.",
        },
        { status: 403 }
      ),
      data: null,
    };
  }

  // Para qualquer outro colaborador, resolve permissões efetivas a partir dos overrides do banco
  const effectivePermissions = await getEffectivePermissions(memberId, role, db);

  // DEC-05: Regras de autorização da Fila Assistida
  if (requiredPermission === "WHATSAPP_ASSISTED_OPERATE") {
    // 1) WHATSAPP_ASSISTED_OPERATE deve ter sido expressamente concedida pelo OWNER
    if (!effectivePermissions.WHATSAPP_ASSISTED_OPERATE) {
      return {
        error: NextResponse.json(
          {
            error: "PERMISSION_DENIED",
            message:
              "Permissão 'WHATSAPP_ASSISTED_OPERATE' necessária para operar a fila assistida.",
            requiredPermission: "WHATSAPP_ASSISTED_OPERATE",
          },
          { status: 403 }
        ),
        data: null,
      };
    }
    // 2) CLIENTS_VIEW é obrigatória para acessar os dados dos clientes
    if (!effectivePermissions.CLIENTS_VIEW) {
      return {
        error: NextResponse.json(
          {
            error: "PERMISSION_DENIED",
            message:
              "Permissão 'CLIENTS_VIEW' necessária para acessar os dados dos clientes na fila assistida.",
            requiredPermission: "CLIENTS_VIEW",
          },
          { status: 403 }
        ),
        data: null,
      };
    }
  } else {
    // Para outras permissões específicas (ex: CLIENTS_MANAGE no consentimento)
    if (!effectivePermissions[requiredPermission]) {
      return {
        error: NextResponse.json(
          {
            error: "PERMISSION_DENIED",
            message: `Permissão '${requiredPermission}' necessária para executar esta ação.`,
            requiredPermission,
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
      memberId,
      barbershopId,
    },
  };
}

export async function requireCrmQueueManageSession(
  db: typeof prisma = prisma
): Promise<
  | { error: NextResponse; data: null }
  | { error: null; data: CrmQueueSessionData }
> {
  return requireCrmQueueSession({ requiredPermission: "WHATSAPP_ASSISTED_OPERATE", db });
}

export async function requireCrmQueueViewSession(
  db: typeof prisma = prisma
): Promise<
  | { error: NextResponse; data: null }
  | { error: null; data: CrmQueueSessionData }
> {
  return requireCrmQueueSession({ requiredPermission: "WHATSAPP_ASSISTED_OPERATE", db });
}

export async function checkCrmQueuePermission(
  memberId: string | null,
  role: string,
  permission: PermissionKey = "WHATSAPP_ASSISTED_OPERATE",
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<boolean> {
  if (role === "OWNER") return true;
  if (!role || role === "SUPER_ADMIN" || !memberId) return false; // G23-02 / G24-04: Fail-closed

  const effective = await getEffectivePermissions(memberId, role, db);
  if (permission === "WHATSAPP_ASSISTED_OPERATE") {
    return Boolean(effective.WHATSAPP_ASSISTED_OPERATE && effective.CLIENTS_VIEW);
  }
  return Boolean(effective[permission]);
}

export interface UiQueuePermissions {
  canViewClients: boolean;
  canManageClients: boolean;
  canOperateWhatsappAssisted: boolean;
}

export async function resolveUiQueuePermissions(params: {
  userId?: string | null;
  role?: string | null;
  memberId?: string | null;
  barbershopId?: string | null;
  db?: typeof prisma;
}): Promise<UiQueuePermissions> {
  const db = params.db || prisma;
  let effectiveRole = params.role || "";
  let effectiveMemberId = params.memberId ?? null;

  if (effectiveRole === "SUPER_ADMIN") {
    if (
      !params.userId ||
      !params.barbershopId ||
      typeof db.barbershopMember?.findFirst !== "function"
    ) {
      return {
        canViewClients: false,
        canManageClients: false,
        canOperateWhatsappAssisted: false,
      };
    }
    const member = await db.barbershopMember.findFirst({
      where: {
        userId: params.userId,
        barbershopId: params.barbershopId,
        isActive: true,
      },
    });
    if (!member || (member.role as string) === "SUPER_ADMIN") {
      return {
        canViewClients: false,
        canManageClients: false,
        canOperateWhatsappAssisted: false,
      };
    }
    effectiveRole = member.role;
    effectiveMemberId = member.id;
  }

  if (effectiveRole === "OWNER") {
    return {
      canViewClients: true,
      canManageClients: true,
      canOperateWhatsappAssisted: true,
    };
  }

  if (
    !effectiveRole ||
    !effectiveMemberId ||
    typeof db.memberPermissionOverride?.findMany !== "function"
  ) {
    return {
      canViewClients: false,
      canManageClients: false,
      canOperateWhatsappAssisted: false,
    };
  }

  const effective = await getEffectivePermissions(
    effectiveMemberId,
    effectiveRole,
    db
  );
  const canViewClients = Boolean(effective.CLIENTS_VIEW);
  return {
    canViewClients,
    canManageClients: Boolean(effective.CLIENTS_MANAGE),
    canOperateWhatsappAssisted: Boolean(
      canViewClients && effective.WHATSAPP_ASSISTED_OPERATE
    ),
  };
}
