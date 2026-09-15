import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";

export interface FinancialSessionData {
  userId: string;
  role: "OWNER" | "MANAGER";
  memberId: string;
  barbershopId: string;
}

export async function requireFinancialSession(): Promise<{
  error: NextResponse | null;
  data: FinancialSessionData | null;
}> {
  const { error, data } = await getAdminSession();
  if (error) return { error, data: null };

  if (!data || !data.barbershopId || !data.memberId) {
    return {
      error: NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 }),
      data: null,
    };
  }

  // Apenas OWNER ou MANAGER. BARBER e outros papéis recebem 403.
  if (!["OWNER", "MANAGER"].includes(data.role)) {
    return {
      error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
      data: null,
    };
  }

  return {
    error: null,
    data: {
      userId: data.userId,
      role: data.role as "OWNER" | "MANAGER",
      memberId: data.memberId,
      barbershopId: data.barbershopId,
    },
  };
}
