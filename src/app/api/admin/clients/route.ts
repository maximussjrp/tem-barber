import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import {
  createManualBarbershopClient,
  listBarbershopClients,
  type AdminClientFilter,
} from "@/lib/customers";

export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const search = sp.get("search")?.trim() ?? "";
  const page = Math.max(1, parseInt(sp.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "30")));
  const filter = (sp.get("filter") ?? "all") as AdminClientFilter;

  const result = await listBarbershopClients(prisma, {
    barbershopId,
    search,
    filter,
    page,
    pageSize,
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const payload = body as {
    name?: string;
    phone?: string;
    email?: string;
    birthDate?: string | null;
    notes?: string | null;
  };
  if (
    (payload.birthDate !== undefined && payload.birthDate !== null && typeof payload.birthDate !== "string") ||
    (payload.notes !== undefined && payload.notes !== null && typeof payload.notes !== "string")
  ) {
    return NextResponse.json({ error: "Perfil do cliente invalido." }, { status: 400 });
  }
  const result = await createManualBarbershopClient(prisma, barbershopId, {
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    birthDate: payload.birthDate,
    notes: payload.notes,
  });

  if ("error" in result) {
    const status = result.error === "CUSTOMER_BLOCKED" ? 409 : 400;
    return NextResponse.json({ error: result.error, message: result.message }, { status });
  }

  return NextResponse.json(result.client, { status: 201 });
}
