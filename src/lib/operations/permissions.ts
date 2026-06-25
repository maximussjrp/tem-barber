import { NextResponse } from "next/server";
import { getMemberSession } from "@/lib/member-api-auth";

export type OperationalRole = "OWNER" | "MANAGER" | "BARBER";

export interface OperationalSession {
  userId: string;
  role: string;
  memberId: string;
  barbershopId: string;
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

export function canManageFinancial(role: string) {
  return role === "OWNER" || role === "MANAGER";
}

export function forbidden() {
  return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
}

