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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  const level = await prisma.careerLevel.findFirst({
    where: { id, barbershopId: data!.barbershopId! },
  });

  if (!level) {
    return NextResponse.json({ error: "Nível de carreira não encontrado." }, { status: 404 });
  }

  return NextResponse.json(level);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  const level = await prisma.careerLevel.findFirst({
    where: { id, barbershopId: data!.barbershopId! },
  });

  if (!level) {
    return NextResponse.json({ error: "Nível de carreira não encontrado." }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { name, description, defaultCommissionRate, sortOrder, active } = body;

    let cleanName = level.name;
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return NextResponse.json({ error: "Nome do nível de carreira é obrigatório." }, { status: 400 });
      }
      cleanName = name.trim();

      // Check unique per tenant ignoring current ID
      const duplicate = await prisma.careerLevel.findFirst({
        where: {
          barbershopId: data!.barbershopId!,
          name: { equals: cleanName, mode: "insensitive" },
          id: { not: id },
        },
      });

      if (duplicate) {
        return NextResponse.json(
          { error: "Já existe outro nível de carreira com este nome nesta barbearia." },
          { status: 409 }
        );
      }
    }

    let parsedRate = level.defaultCommissionRate;
    if (defaultCommissionRate !== undefined) {
      const rateResult = parseCommissionRate(defaultCommissionRate);
      if (rateResult.error) {
        return NextResponse.json({ error: rateResult.error }, { status: 400 });
      }
      parsedRate = rateResult.rate ?? null;
    }

    const updated = await prisma.careerLevel.update({
      where: { id },
      data: {
        name: cleanName,
        description: description !== undefined ? (description?.trim() || null) : level.description,
        defaultCommissionRate: parsedRate,
        sortOrder: typeof sortOrder === "number" ? sortOrder : level.sortOrder,
        active: typeof active === "boolean" ? active : level.active,
      },
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Erro ao atualizar nível de carreira." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  const level = await prisma.careerLevel.findFirst({
    where: { id, barbershopId: data!.barbershopId! },
  });

  if (!level) {
    return NextResponse.json({ error: "Nível de carreira não encontrado." }, { status: 404 });
  }

  // Soft delete by setting active: false to maintain operational history
  const deactivated = await prisma.careerLevel.update({
    where: { id },
    data: { active: false },
  });

  return NextResponse.json({ success: true, level: deactivated });
}
