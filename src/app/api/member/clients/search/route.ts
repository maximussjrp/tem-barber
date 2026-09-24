import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMemberSession } from "@/lib/member-api-auth";
import { checkMemberPermission } from "@/lib/permissions/engine";
import { searchBarbershopClients } from "@/lib/customers";

export async function GET(request: NextRequest) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const canSearch = await checkMemberPermission(data!.memberId, data!.role, "AGENDA_CREATE_OWN");
  if (!canSearch) {
    return NextResponse.json(
      { error: "PERMISSION_DENIED", message: "Você não possui permissão para buscar clientes." },
      { status: 403 }
    );
  }

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
