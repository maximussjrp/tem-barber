import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { searchBarbershopClients } from "@/lib/customers";

export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia nao encontrada." }, { status: 403 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ clients: [] });
  }

  const clients = await searchBarbershopClients(prisma, barbershopId, query);
  return NextResponse.json({ clients });
}
