import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { canManageFinancial, forbidden, requireOperationalSession } from "@/lib/operations/permissions";
import { parseMoney } from "@/lib/operations/money";

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

  if (body.name !== undefined && (!body.name || !String(body.name).trim())) {
    return NextResponse.json({ error: "O nome do produto nao pode ser vazio." }, { status: 400 });
  }

  let salePrice;
  if (body.salePrice !== undefined) {
    salePrice = parseMoney(body.salePrice);
    if (salePrice < 0) return NextResponse.json({ error: "O preco de venda nao pode ser negativo." }, { status: 400 });
  }

  const product = await prisma.product.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: String(body.name).trim() }),
      ...(body.description !== undefined && { description: body.description?.trim() || null }),
      ...(salePrice !== undefined && { salePrice: salePrice }),
      ...(body.costPrice !== undefined && { costPrice: body.costPrice ? parseMoney(body.costPrice) : null }),
      ...(body.unit !== undefined && { unit: body.unit?.trim() || "un" }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.trackStock !== undefined && { trackStock: body.trackStock }),
      ...(body.currentStock !== undefined && { currentStock: parseMoney(body.currentStock) }),
    },
  });
  return NextResponse.json(product);
}

