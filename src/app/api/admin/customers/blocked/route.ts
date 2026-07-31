import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import { listBlockedCustomers } from "@/lib/operations/blocked-customers";

export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  if (!data?.barbershopId) {
    return NextResponse.json({ error: "Barbearia não especificada." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("pageSize") || "30", 10);
  const activeOnly = searchParams.get("activeOnly") === "true";

  try {
    const result = await listBlockedCustomers({
      barbershopId: data.barbershopId,
      page,
      pageSize,
      activeOnly,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof CustomerBlockError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Erro ao listar clientes bloqueados.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
