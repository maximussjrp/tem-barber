import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { createStaffAccessToken } from "@/lib/auth/staff-tokens";
import { StaffAccessTokenPurpose } from "@prisma/client";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;

  const member = await prisma.barbershopMember.findUnique({
    where: { id },
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true },
      },
      barbershop: {
        select: { id: true, name: true },
      },
    },
  });

  if (!member || member.barbershopId !== data!.barbershopId) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  if (!member.isActive) {
    return NextResponse.json(
      {
        error: "MEMBER_INACTIVE",
        message: "Não é possível redefinir o acesso de um colaborador inativo.",
      },
      { status: 409 }
    );
  }

  // Hierarchy check
  if (member.role === "OWNER") {
    return NextResponse.json(
      { error: "O proprietário deve alterar sua senha através do perfil pessoal." },
      { status: 403 }
    );
  }

  if (data!.role === "MANAGER") {
    if ((member.role as string) === "MANAGER") {
      return NextResponse.json(
        { error: "Gerentes só podem redefinir o acesso de Barbeiros e Recepcionistas." },
        { status: 403 }
      );
    }
  }

  const tokenResult = await createStaffAccessToken({
    barbershopId: data!.barbershopId!,
    memberId: member.id,
    userId: member.userId,
    purpose: StaffAccessTokenPurpose.PASSWORD_RESET,
    createdByUserId: data!.userId,
  });

  const cleanPhone = member.user.phone.replace(/\D/g, "");
  const formattedPhone = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;
  const whatsappMessage = `Olá ${member.user.name}, um link para redefinir sua senha na plataforma ${member.barbershop.name} foi gerado:\n\n${tokenResult.activationUrl}\n\nEste link é válido por 24 horas.`;
  const whatsappLink = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(whatsappMessage)}`;

  return NextResponse.json({
    success: true,
    activationUrl: tokenResult.activationUrl,
    expiresAt: tokenResult.expiresAt,
    whatsappMessage,
    whatsappLink,
    user: member.user,
  });
}
