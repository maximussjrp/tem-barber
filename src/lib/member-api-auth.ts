import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { NextResponse } from "next/server";
import { isPlatformAdmin, isSubscriptionActive, getTenantSubscription } from "@/lib/subscription-utils";
import { resolveSingleActiveMembership } from "@/lib/tenant-context";

const MEMBER_ROLES = ["OWNER", "MANAGER", "BARBER"];

export async function getMemberSession() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "Não autenticado." }, { status: 401 }),
      data: null,
    };
  }

  const userId = (session.user as any).id as string;
  const sessionRole = (session.user as any).role as string;
  const email = session.user?.email as string | null;

  const isPlatform = isPlatformAdmin(email) || sessionRole === "SUPER_ADMIN";

  if (!MEMBER_ROLES.includes(sessionRole) && !isPlatform) {
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

  if (!member) {
    return {
      error: NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 }),
      data: null,
    };
  }

  const role = isPlatform ? "SUPER_ADMIN" : member.role ?? sessionRole;

  if (!MEMBER_ROLES.includes(role) && !isPlatform) {
    return {
      error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
      data: null,
    };
  }

  // Se não for platform admin e tiver barbearia vinculada, validar assinatura
  if (!isPlatform) {
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
      memberId: member.id,
      barbershopId: member.barbershopId,
    },
  };
}
