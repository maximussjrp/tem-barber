import { NextResponse } from "next/server";
import { getMemberSession } from "@/lib/member-api-auth";

export type OperationalRole = "OWNER" | "MANAGER" | "BARBER";

export interface OperationalSession {
  userId: string;
  role: string;
  memberId: string;
  barbershopId: string;
}

export interface LegacyOwnComanda {
  appointment?: { memberId: string } | null;
  items: Array<{ executorId: string | null }>;
}

export async function requireOperationalSession() {
  const { error, data } = await getMemberSession();
  if (error) return { error, data: null };
  if (!data?.barbershopId || !data.memberId) {
    return {
      error: NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 }),
      data: null,
    };
  }
  return { error: null, data: data as OperationalSession };
}

export function canManageComandas(role: string) {
  return role === "OWNER" || role === "MANAGER" || role === "BARBER";
}

/**
 * Temporary ownership definition until Comanda has a responsibleMemberId.
 * Empty standalone comandas never grant ownership implicitly.
 */
export function isLegacyOwnComanda(comanda: LegacyOwnComanda, memberId: string) {
  return (
    comanda.appointment?.memberId === memberId ||
    comanda.items.some((item) => item.executorId === memberId)
  );
}

export function comandaScopeForbidden() {
  return NextResponse.json(
    {
      error: "COMANDA_SCOPE_FORBIDDEN",
      message: "Esta comanda não pertence ao profissional autenticado.",
    },
    { status: 403 }
  );
}

export function discountPermissionRequired() {
  return NextResponse.json(
    {
      error: "DISCOUNT_PERMISSION_REQUIRED",
      message: "Descontos dependem de autorização da barbearia.",
    },
    { status: 403 }
  );
}

export function canReopenComandas(role: string) {
  return role === "OWNER" || role === "MANAGER" || role === "SUPER_ADMIN";
}

export function canManageFinancial(role: string) {
  return role === "OWNER" || role === "MANAGER";
}

export function canRefundPayments(role: string) {
  return role === "OWNER" || role === "MANAGER" || role === "SUPER_ADMIN";
}

export function canCancelComandas(role: string) {
  return role === "OWNER" || role === "MANAGER" || role === "SUPER_ADMIN";
}

export function forbidden() {
  return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
}
