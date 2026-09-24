import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getOperationalStaffSession } from "@/lib/operational-session";
import { searchBarbershopClients } from "@/lib/customers";

export async function GET(request: NextRequest) {
  const { error, data } = await getOperationalStaffSession({ requiredPermission: "CLIENTS_VIEW" });
  if (error) return error;

  const barbershopId = data!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 403 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ clients: [] });
  }

  const clients = await searchBarbershopClients(prisma, barbershopId, query);
  return NextResponse.json({ clients });
}
