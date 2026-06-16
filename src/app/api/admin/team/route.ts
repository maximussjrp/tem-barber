import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { isValidCpf } from "@/lib/utils";
import bcrypt from "bcryptjs";

export async function GET() {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const members = await prisma.barbershopMember.findMany({
    where: { barbershopId: data!.barbershopId! },
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true, cpf: true, avatarUrl: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(members);
}

export async function POST(request: Request) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  try {
    const body = await request.json();
    const { name, phone, cpf, email, password, role, bio } = body;

    // Validation
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Nome é obrigatório." }, { status: 400 });
    }
    if (!phone || typeof phone !== "string") {
      return NextResponse.json({ error: "Telefone é obrigatório." }, { status: 400 });
    }
    if (!cpf || typeof cpf !== "string") {
      return NextResponse.json({ error: "CPF é obrigatório." }, { status: 400 });
    }
    if (!password || password.length < 6) {
      return NextResponse.json({ error: "Senha deve ter no mínimo 6 caracteres." }, { status: 400 });
    }
    if (!["BARBER", "MANAGER"].includes(role)) {
      return NextResponse.json({ error: "Cargo inválido." }, { status: 400 });
    }

    const cleanPhone = phone.replace(/\D/g, "");
    const cleanCpf = cpf.replace(/\D/g, "");
    const cleanEmail = email?.trim().toLowerCase() || null;

    if (cleanPhone.length < 10) {
      return NextResponse.json({ error: "Telefone inválido." }, { status: 400 });
    }
    if (!isValidCpf(cleanCpf)) {
      return NextResponse.json({ error: "CPF inválido." }, { status: 400 });
    }

    // Check conflicts
    const conditions: object[] = [
      { phone: cleanPhone },
      { cpf: cleanCpf },
    ];
    if (cleanEmail) conditions.push({ email: cleanEmail });

    const existingUser = await prisma.user.findFirst({
      where: { OR: conditions },
    });

    if (existingUser) {
      // If user exists but is not yet a member of this barbershop, allow linking
      const existingMember = await prisma.barbershopMember.findUnique({
        where: {
          barbershopId_userId: {
            barbershopId: data!.barbershopId!,
            userId: existingUser.id,
          },
        },
      });

      if (existingMember) {
        return NextResponse.json(
          { error: "Este colaborador já está cadastrado nesta barbearia." },
          { status: 409 }
        );
      }

      // Link existing user to this barbershop
      const member = await prisma.barbershopMember.create({
        data: {
          barbershopId: data!.barbershopId!,
          userId: existingUser.id,
          role,
          bio: bio?.trim() || null,
        },
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true, cpf: true, avatarUrl: true },
          },
        },
      });

      return NextResponse.json(member, { status: 201 });
    }

    // Create new user + member in a transaction
    const hashedPassword = await bcrypt.hash(password, 10);

    const member = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: name.trim(),
          phone: cleanPhone,
          cpf: cleanCpf,
          email: cleanEmail,
          passwordHash: hashedPassword,
          role: "USER",
        },
      });

      return tx.barbershopMember.create({
        data: {
          barbershopId: data!.barbershopId!,
          userId: user.id,
          role,
          bio: bio?.trim() || null,
        },
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true, cpf: true, avatarUrl: true },
          },
        },
      });
    });

    return NextResponse.json(member, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erro ao criar colaborador." }, { status: 500 });
  }
}
