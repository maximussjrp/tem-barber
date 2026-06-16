import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";

export async function GET(request: Request) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const url = new URL(request.url);
  const categoryId = url.searchParams.get("categoryId") || undefined;

  const services = await prisma.service.findMany({
    where: {
      barbershopId: data!.barbershopId!,
      ...(categoryId ? { categoryId } : {}),
    },
    include: { category: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(services);
}

export async function POST(request: Request) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  try {
    const body = await request.json();
    const { name, description, categoryId, price, durationMin, isActive } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Nome é obrigatório." }, { status: 400 });
    }
    if (!categoryId) {
      return NextResponse.json({ error: "Categoria é obrigatória." }, { status: 400 });
    }
    if (price == null || isNaN(Number(price)) || Number(price) < 0) {
      return NextResponse.json({ error: "Preço inválido." }, { status: 400 });
    }
    if (!durationMin || isNaN(Number(durationMin)) || Number(durationMin) < 5) {
      return NextResponse.json({ error: "Duração mínima de 5 minutos." }, { status: 400 });
    }

    // Ensure category belongs to this barbershop
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category || category.barbershopId !== data!.barbershopId!) {
      return NextResponse.json({ error: "Categoria não encontrada." }, { status: 404 });
    }

    const service = await prisma.service.create({
      data: {
        barbershopId: data!.barbershopId!,
        categoryId,
        name: name.trim(),
        description: description?.trim() || null,
        price: Number(price),
        durationMin: Number(durationMin),
        isActive: isActive !== false,
      },
      include: { category: { select: { id: true, name: true } } },
    });

    return NextResponse.json(service, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erro ao criar serviço." }, { status: 500 });
  }
}
