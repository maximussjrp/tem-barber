import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { canManageFinancial, forbidden, requireOperationalSession } from "@/lib/operations/permissions";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  const { id } = await params;
  const product = await prisma.product.findFirst({
    where: { id, barbershopId: data!.barbershopId },
    include: { movements: { orderBy: { createdAt: "desc" }, take: 100 } },
  });
  if (!product) return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
  return NextResponse.json(product);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canManageFinancial(data!.role)) return forbidden();
  const { id } = await params;
  const body = await request.json();
  const existing = await prisma.product.findFirst({ where: { id, barbershopId: data!.barbershopId } });
  if (!existing) return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
  const product = await prisma.product.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: String(body.name).trim() }),
      ...(body.description !== undefined && { description: body.description?.trim() || null }),
      ...(body.salePrice !== undefined && { salePrice: body.salePrice }),
      ...(body.costPrice !== undefined && { costPrice: body.costPrice || null }),
      ...(body.unit !== undefined && { unit: body.unit?.trim() || "un" }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.trackStock !== undefined && { trackStock: body.trackStock }),
      ...(body.currentStock !== undefined && { currentStock: body.currentStock }),
    },
  });
  return NextResponse.json(product);
}

