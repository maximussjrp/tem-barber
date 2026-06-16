import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { slugify } from "@/lib/utils";

export async function GET() {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const categories = await prisma.category.findMany({
    where: { barbershopId: data!.barbershopId! },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(categories);
}

export async function POST(request: Request) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  try {
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Nome é obrigatório." }, { status: 400 });
    }

    const slug = slugify(name.trim());
    const barbershopId = data!.barbershopId!;

    const existing = await prisma.category.findUnique({
      where: { barbershopId_slug: { barbershopId, slug } },
    });

    if (existing) {
      return NextResponse.json({ error: "Já existe uma categoria com este nome." }, { status: 409 });
    }

    const category = await prisma.category.create({
      data: { barbershopId, name: name.trim(), slug },
    });

    return NextResponse.json(category, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erro ao criar categoria." }, { status: 500 });
  }
}
