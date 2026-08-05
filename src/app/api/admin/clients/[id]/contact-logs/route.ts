import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { createCustomerContactLog, listCustomerContactLogs } from "@/lib/customer-contact-logs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia nao encontrada." }, { status: 403 });
  }

  const { id: customerId } = await params;
  const result = await listCustomerContactLogs(prisma, barbershopId, customerId);
  if ("error" in result) {
    return NextResponse.json(
      { error: "Cliente nao encontrado ou sem historico nesta barbearia." },
      { status: 404 }
    );
  }

  return NextResponse.json({ logs: result.logs });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia nao encontrada." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  const { id: customerId } = await params;
  const result = await createCustomerContactLog(
    prisma,
    {
      barbershopId,
      userId: data!.userId,
      memberId: data!.memberId,
    },
    customerId,
    body as Record<string, unknown>
  );

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error, message: "message" in result ? result.message : undefined },
      { status: result.status }
    );
  }

  return NextResponse.json(result.log, { status: 201 });
}
