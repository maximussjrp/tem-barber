import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";

async function findService(id: string, barbershopId: string) {
  const service = await prisma.service.findUnique({ where: { id } });
  if (!service || service.barbershopId !== barbershopId) return null;
  return service;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;
  const service = await findService(id, data!.barbershopId!);
  if (!service) return NextResponse.json({ error: "Serviço não encontrado." }, { status: 404 });

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

    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category || category.barbershopId !== data!.barbershopId!) {
      return NextResponse.json({ error: "Categoria não encontrada." }, { status: 404 });
    }

    const updated = await prisma.service.update({
      where: { id },
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        categoryId,
        price: Number(price),
        durationMin: Number(durationMin),
        isActive: isActive !== false,
      },
      include: { category: { select: { id: true, name: true } } },
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Erro ao atualizar serviço." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;
  const service = await findService(id, data!.barbershopId!);
  if (!service) return NextResponse.json({ error: "Serviço não encontrado." }, { status: 404 });

  try {
    const body = await request.json();

    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "Campo isActive inválido." }, { status: 400 });
    }

    const updated = await prisma.service.update({
      where: { id },
      data: { isActive: body.isActive },
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Erro ao atualizar serviço." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;
  const service = await findService(id, data!.barbershopId!);
  if (!service) return NextResponse.json({ error: "Serviço não encontrado." }, { status: 404 });

  const usedCount = await prisma.appointmentService.count({ where: { serviceId: id } });
  if (usedCount > 0) {
    // Soft delete: just deactivate
    const updated = await prisma.service.update({
      where: { id },
      data: { isActive: false },
    });
    return NextResponse.json({ ...updated, softDeleted: true });
  }

  await prisma.service.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
