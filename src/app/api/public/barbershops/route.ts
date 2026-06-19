import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const barbershops = await prisma.barbershop.findMany({
      where: {
        active: true,
      },
      select: {
        slug: true,
        name: true,
        logoUrl: true,
        coverUrl: true,
        city: true,
        neighborhood: true,
        latitude: true,
        longitude: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    // Filtramos apenas as propriedades públicas de fato (DTO pattern simulado no select)
    return NextResponse.json(barbershops);
  } catch (error) {
    console.error("Erro ao buscar barbearias parceiras:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar as barbearias parceiras no momento." },
      { status: 500 }
    );
  }
}
