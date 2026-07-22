import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { Prisma } from "@prisma/client";

function parseCommissionRate(val: unknown): { error?: string; rate?: Prisma.Decimal | null } {
  if (val === null || val === undefined || val === "") {
    return { rate: null };
  }
  const str = String(val).replace(",", ".").trim();
  const num = Number(str);
  if (isNaN(num) || !isFinite(num) || num < 0 || num > 100) {
    return { error: "Percentual de comissão deve ser um número entre 0 e 100." };
  }
  return { rate: new Prisma.Decimal(str) };
}

export async function GET() {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const levels = await prisma.careerLevel.findMany({
    where: { barbershopId: data!.barbershopId! },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(levels);
}

export async function POST(request: Request) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  try {
    const body = await request.json();
    const { name, description, defaultCommissionRate, sortOrder, active } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Nome do nível de carreira é obrigatório." }, { status: 400 });
    }

    const cleanName = name.trim();

    // Tenant unique check
    const existing = await prisma.careerLevel.findFirst({
      where: {
        barbershopId: data!.barbershopId!,
        name: { equals: cleanName, mode: "insensitive" },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Já existe um nível de carreira com este nome nesta barbearia." },
        { status: 409 }
      );
    }

    const rateResult = parseCommissionRate(defaultCommissionRate);
    if (rateResult.error) {
      return NextResponse.json({ error: rateResult.error }, { status: 400 });
    }

    const created = await prisma.careerLevel.create({
      data: {
        barbershopId: data!.barbershopId!,
        name: cleanName,
        description: description?.trim() || null,
        defaultCommissionRate: rateResult.rate,
        sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
        active: active !== false,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erro ao criar nível de carreira." }, { status: 500 });
  }
}
