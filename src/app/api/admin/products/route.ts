import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { canManageFinancial, forbidden, requireOperationalSession } from "@/lib/operations/permissions";

export async function GET() {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const products = await prisma.product.findMany({
    where: { barbershopId: data!.barbershopId },
    orderBy: { name: "asc" },
    include: { movements: { orderBy: { createdAt: "desc" }, take: 10 } },
  });
  return NextResponse.json({ products });
}

import { parseMoney } from "@/lib/operations/money";

export async function POST(request: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;
  if (!canManageFinancial(data!.role)) return forbidden();

  const body = await request.json();

  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "O nome do produto e obrigatorio." }, { status: 400 });
  }

  const salePrice = parseMoney(body.salePrice);
  if (salePrice < 0) {
    return NextResponse.json({ error: "O preco de venda nao pode ser negativo." }, { status: 400 });
  }

  const currentStock = parseMoney(body.currentStock);

  const product = await prisma.product.create({
    data: {
      barbershopId: data!.barbershopId,
      name: String(body.name).trim(),
      description: body.description?.trim() || null,
      salePrice: salePrice,
      costPrice: body.costPrice ? parseMoney(body.costPrice) : null,
      unit: body.unit?.trim() || "un",
      isActive: body.isActive ?? true,
      trackStock: body.trackStock ?? false,
      currentStock: body.trackStock ? currentStock : 0,
    },
  });
  return NextResponse.json(product, { status: 201 });
}

