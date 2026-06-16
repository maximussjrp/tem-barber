import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMemberSession } from "@/lib/member-api-auth";

export async function GET() {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const member = await prisma.barbershopMember.findUnique({
    where: { id: data!.memberId },
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true, avatarUrl: true },
      },
      barbershop: { select: { name: true, logoUrl: true } },
    },
  });

  if (!member) {
    return NextResponse.json({ error: "Membro não encontrado." }, { status: 404 });
  }

  return NextResponse.json(member);
}

export async function PUT(request: NextRequest) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  let body: { name?: string; bio?: string; avatarUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const { name, bio, avatarUrl } = body;

  if (name !== undefined && (typeof name !== "string" || name.trim().length < 2)) {
    return NextResponse.json({ error: "Nome inválido (mínimo 2 caracteres)." }, { status: 400 });
  }

  const [member] = await Promise.all([
    prisma.barbershopMember.update({
      where: { id: data!.memberId },
      data: { bio: bio ?? null },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, avatarUrl: true },
        },
        barbershop: { select: { name: true, logoUrl: true } },
      },
    }),
    prisma.user.update({
      where: { id: data!.userId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(avatarUrl !== undefined && { avatarUrl }),
      },
    }),
  ]);

  return NextResponse.json(member);
}
