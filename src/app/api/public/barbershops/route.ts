import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { publicBarbershopWhere, isPublicBarbershop } from "@/lib/public-barbershops";
import { consumeRateLimit, resolveClientIp } from "@/lib/public-rate-limit";

export async function GET(request: Request) {
  try {
    const ip = resolveClientIp(request);
    const rateLimit = consumeRateLimit({
      bucket: "public-barbershops",
      key: ip,
      max: 60,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Muitas requisicoes. Tente novamente em instantes." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    const barbershops = await prisma.barbershop.findMany({
      where: publicBarbershopWhere(),
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

    const filtered = barbershops.filter(isPublicBarbershop);
    return NextResponse.json(filtered);
  } catch (error) {
    console.error("Erro ao buscar barbearias parceiras:", error);
    return NextResponse.json(
      { error: "Não foi possível carregar as barbearias parceiras no momento." },
      { status: 500 }
    );
  }
}
