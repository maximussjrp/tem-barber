import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";

export async function GET() {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershop = await prisma.barbershop.findUnique({
    where: { id: data!.barbershopId! },
  });

  if (!barbershop) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 404 });
  }

  return NextResponse.json(barbershop);
}

export async function PUT(request: Request) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  try {
    const body = await request.json();
    const {
      name,
      description,
      phone,
      logoUrl,
      coverUrl,
      zipCode,
      street,
      number,
      complement,
      neighborhood,
      city,
      state,
    } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Nome é obrigatório." }, { status: 400 });
    }

    if (!phone || typeof phone !== "string") {
      return NextResponse.json({ error: "Telefone é obrigatório." }, { status: 400 });
    }

    const updated = await prisma.barbershop.update({
      where: { id: data!.barbershopId! },
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        phone: phone.replace(/\D/g, ""),
        logoUrl: logoUrl?.trim() || null,
        coverUrl: coverUrl?.trim() || null,
        zipCode: zipCode?.replace(/\D/g, "") || "00000000",
        street: street?.trim() || "Rua Não Cadastrada",
        number: number?.trim() || "S/N",
        complement: complement?.trim() || null,
        neighborhood: neighborhood?.trim() || "Centro",
        city: city?.trim() || "Cidade Exemplo",
        state: state?.trim().toUpperCase() || "UF",
      },
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Erro ao atualizar as configurações." }, { status: 500 });
  }
}
