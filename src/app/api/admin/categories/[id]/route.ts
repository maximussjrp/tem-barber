import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { slugify } from "@/lib/utils";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;

  try {
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Nome é obrigatório." }, { status: 400 });
    }

    // Ensure category belongs to this barbershop
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category || category.barbershopId !== data!.barbershopId!) {
      return NextResponse.json({ error: "Categoria não encontrada." }, { status: 404 });
    }

    const slug = slugify(name.trim());
    const barbershopId = data!.barbershopId!;

    const conflict = await prisma.category.findFirst({
      where: { barbershopId, slug, NOT: { id } },
    });
    if (conflict) {
      return NextResponse.json({ error: "Já existe uma categoria com este nome." }, { status: 409 });
    }

    const updated = await prisma.category.update({
      where: { id },
      data: { name: name.trim(), slug },
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Erro ao atualizar categoria." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;

  const category = await prisma.category.findUnique({ where: { id } });
  if (!category || category.barbershopId !== data!.barbershopId!) {
    return NextResponse.json({ error: "Categoria não encontrada." }, { status: 404 });
  }

  const serviceCount = await prisma.service.count({ where: { categoryId: id } });
  if (serviceCount > 0) {
    return NextResponse.json(
      { error: `Não é possível excluir: ${serviceCount} serviço(s) vinculado(s) a esta categoria.` },
      { status: 409 }
    );
  }

  await prisma.category.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
