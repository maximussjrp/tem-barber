import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { isValidCpf } from "@/lib/utils";
import bcrypt from "bcryptjs";
import { Prisma, StaffAccessTokenPurpose } from "@prisma/client";
import { getBrazilianPhoneVariants } from "@/lib/phone/br-phone";
import { createStaffAccessToken } from "@/lib/auth/staff-tokens";

type StaffInvitePayload = {
  activationUrl: string;
  whatsappMessage: string;
  whatsappLink: string;
  expiresAt: Date;
};

export async function GET() {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const members = await prisma.barbershopMember.findMany({
    where: { barbershopId: data!.barbershopId! },
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true, cpf: true, avatarUrl: true },
      },
      careerLevel: {
        select: { id: true, name: true, defaultCommissionRate: true },
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
    const { name, phone, cpf, email, password, role, bio, careerLevelId } = body;

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
    if (password && (typeof password !== "string" || password.length < 8)) {
      return NextResponse.json({ error: "Senha deve ter no mínimo 8 caracteres." }, { status: 400 });
    }
    if (!["BARBER", "MANAGER", "RECEPTIONIST"].includes(role)) {
      return NextResponse.json({ error: "Cargo inválido." }, { status: 400 });
    }

    // Hierarquia: Gerente não pode convidar outro Gerente nem Dono
    if (data!.role === "MANAGER" && role === "MANAGER") {
      return NextResponse.json(
        { error: "ROLE_ESCALATION_FORBIDDEN", message: "Gerentes só podem convidar Barbeiros ou Recepcionistas." },
        { status: 403 }
      );
    }

    let validCareerLevelId: string | null = null;
    if (careerLevelId && typeof careerLevelId === "string" && careerLevelId.trim().length > 0) {
      const level = await prisma.careerLevel.findFirst({
        where: { id: careerLevelId, barbershopId: data!.barbershopId!, active: true },
      });
      if (!level) {
        return NextResponse.json({ error: "Nível de carreira não encontrado ou inválido." }, { status: 400 });
      }
      validCareerLevelId = level.id;
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

    // 1. Coleta independente por identificador exato (@unique)
    const phoneVariants = getBrazilianPhoneVariants(cleanPhone);
    const userByPhone = await prisma.user.findFirst({
      where: { phone: { in: phoneVariants } },
    });

    const userByCpf = await prisma.user.findUnique({
      where: { cpf: cleanCpf },
    });

    const userByEmail = cleanEmail
      ? await prisma.user.findUnique({ where: { email: cleanEmail } })
      : null;

    // Coleta os IDs encontrados
    const userIds = new Set<string>();
    if (userByPhone) userIds.add(userByPhone.id);
    if (userByCpf) userIds.add(userByCpf.id);
    if (userByEmail) userIds.add(userByEmail.id);

    // Se apontarem para IDs diferentes, há conflito de identidade
    if (userIds.size > 1) {
      return NextResponse.json(
        {
          error: "IDENTITY_CONFLICT",
          message: "Os dados informados pertencem a cadastros diferentes. Revise telefone, CPF e e-mail.",
        },
        { status: 409 }
      );
    }

    const existingUser = userByPhone ?? userByCpf ?? userByEmail ?? null;

    if (existingUser) {
      // Validações básicas fora da transação
      const cleanPhoneVariants = getBrazilianPhoneVariants(cleanPhone);
      const existingUserPhoneVariants = getBrazilianPhoneVariants(existingUser.phone);
      const phoneMatches = cleanPhoneVariants.some((v) => existingUserPhoneVariants.includes(v));
      if (!phoneMatches) {
        return NextResponse.json(
          {
            error: "IDENTITY_MISMATCH",
            message: "Os dados informados não correspondem ao cadastro existente.",
          },
          { status: 409 }
        );
      }

      if (existingUser.cpf !== null && existingUser.cpf !== cleanCpf) {
        return NextResponse.json(
          {
            error: "IDENTITY_MISMATCH",
            message: "O CPF informado difere do cadastro existente.",
          },
          { status: 409 }
        );
      }

      if (
        cleanEmail !== null &&
        existingUser.email !== null &&
        existingUser.email !== cleanEmail
      ) {
        return NextResponse.json(
          {
            error: "IDENTITY_MISMATCH",
            message: "O e-mail informado difere do cadastro existente.",
          },
          { status: 409 }
        );
      }

      // Preparar senha com hash se fornecida
      const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

      // Executar lock e mutação dentro de transação serializável
      const result = await prisma.$transaction(async (tx) => {
        // 1. Advisory lock serializa criação de membership para este userId
        const lockKey = `team-membership:${existingUser.id}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

        // 2. Releitura do User pós-lock
        const currentUser = await tx.user.findUnique({
          where: { id: existingUser.id },
        });

        if (!currentUser) {
          return { conflict: "USER_NOT_FOUND", message: "Usuário não encontrado." } as const;
        }

        // Revalidação dos dados pós-lock
        const currentUserPhoneVariants = getBrazilianPhoneVariants(currentUser.phone);
        const currentPhoneMatches = cleanPhoneVariants.some((v) => currentUserPhoneVariants.includes(v));
        if (!currentPhoneMatches) {
          return {
            conflict: "IDENTITY_MISMATCH",
            message: "Os dados informados não correspondem ao cadastro existente.",
          } as const;
        }

        if (currentUser.cpf !== null && currentUser.cpf !== cleanCpf) {
          return {
            conflict: "IDENTITY_MISMATCH",
            message: "Os dados informados não correspondem ao cadastro existente.",
          } as const;
        }

        if (cleanEmail && currentUser.email !== null && currentUser.email !== cleanEmail) {
          return {
            conflict: "IDENTITY_MISMATCH",
            message: "Os dados informados não correspondem ao cadastro existente.",
          } as const;
        }

        // Releitura das memberships DENTRO da transação, após o lock
        const memberships = await tx.barbershopMember.findMany({
          where: { userId: currentUser.id },
        });

        const activeInCurrent = memberships.find((m) => m.barbershopId === data!.barbershopId! && m.isActive);
        const activeInOther = memberships.find((m) => m.barbershopId !== data!.barbershopId! && m.isActive);
        const inactiveInCurrent = memberships.find((m) => m.barbershopId === data!.barbershopId! && !m.isActive);

        if (activeInCurrent) {
          return { conflict: "Este colaborador já está cadastrado nesta barbearia." } as const;
        }

        if (activeInOther) {
          return {
            conflict: "ACTIVE_MEMBERSHIP_CONFLICT",
            message: "Este usuário já possui vínculo ativo com outra barbearia.",
          } as const;
        }

        if (inactiveInCurrent) {
          return {
            conflict: "Este colaborador já está cadastrado nesta barbearia, mas está inativo. Reative-o na listagem de equipe.",
          } as const;
        }

        // 3. Atualizar apenas os identificadores administrativos ausentes e/ou senha ausente
        const updateData: { cpf?: string; email?: string; passwordHash?: string } = {};
        if (currentUser.cpf === null) {
          updateData.cpf = cleanCpf;
        }
        if (currentUser.email === null && cleanEmail) {
          updateData.email = cleanEmail;
        }
        if (currentUser.passwordHash === null && hashedPassword) {
          updateData.passwordHash = hashedPassword;
        }

        if (Object.keys(updateData).length > 0) {
          await tx.user.update({
            where: { id: currentUser.id },
            data: updateData,
          });
        }

        // 4. Criar membership
        const member = await tx.barbershopMember.create({
          data: {
            barbershopId: data!.barbershopId!,
            userId: currentUser.id,
            role,
            bio: bio?.trim() || null,
            careerLevelId: validCareerLevelId,
          },
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true, cpf: true, avatarUrl: true },
            },
            careerLevel: {
              select: { id: true, name: true, defaultCommissionRate: true },
            },
          },
        });

        return { member, hadPassword: Boolean(currentUser.passwordHash || hashedPassword) } as const;
      });

      // Interpretar resultado da transação
      if ("conflict" in result) {
        if (
          result.conflict === "ACTIVE_MEMBERSHIP_CONFLICT" ||
          result.conflict === "IDENTITY_MISMATCH" ||
          result.conflict === "USER_NOT_FOUND"
        ) {
          return NextResponse.json(
            { error: result.conflict, message: "message" in result ? result.message : undefined },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: result.conflict }, { status: 409 });
      }

      // Se o usuário não tinha senha, gerar convite de ativação
      let inviteInfo: StaffInvitePayload | null = null;
      if (!result.hadPassword) {
        const tokenResult = await createStaffAccessToken({
          barbershopId: data!.barbershopId!,
          memberId: result.member.id,
          userId: result.member.userId,
          purpose: StaffAccessTokenPurpose.INVITE,
          createdByUserId: data!.userId,
        });

        const barbershop = await prisma.barbershop.findUnique({
          where: { id: data!.barbershopId! },
          select: { name: true },
        });

        const rawUserPhone = result.member.user.phone.replace(/\D/g, "");
        const formattedUserPhone = rawUserPhone.startsWith("55") ? rawUserPhone : `55${rawUserPhone}`;
        const whatsappMessage = `Olá, ${result.member.user.name}! Você foi convidado para a equipe da ${barbershop?.name || "nossa barbearia"}.\n\nPara ativar seu acesso e definir sua senha, acesse o link:\n${tokenResult.activationUrl}\n\n(Válido por 48 horas)`;
        const whatsappLink = `https://wa.me/${formattedUserPhone}?text=${encodeURIComponent(whatsappMessage)}`;

        inviteInfo = {
          activationUrl: tokenResult.activationUrl,
          whatsappMessage,
          whatsappLink,
          expiresAt: tokenResult.expiresAt,
        };
      }

      return NextResponse.json({ ...result.member, ...(inviteInfo ? { invite: inviteInfo } : {}) }, { status: 201 });
    }

    // Criar novo User + BarbershopMember em transação
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

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
          careerLevelId: validCareerLevelId,
        },
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true, cpf: true, avatarUrl: true },
          },
          careerLevel: {
            select: { id: true, name: true, defaultCommissionRate: true },
          },
        },
      });
    });

    // Se foi criado sem senha, gerar convite de ativação
    let inviteInfo: StaffInvitePayload | null = null;
    if (!hashedPassword) {
      const tokenResult = await createStaffAccessToken({
        barbershopId: data!.barbershopId!,
        memberId: member.id,
        userId: member.userId,
        purpose: StaffAccessTokenPurpose.INVITE,
        createdByUserId: data!.userId,
      });

      const barbershop = await prisma.barbershop.findUnique({
        where: { id: data!.barbershopId! },
        select: { name: true },
      });

      const rawUserPhone = member.user.phone.replace(/\D/g, "");
      const formattedUserPhone = rawUserPhone.startsWith("55") ? rawUserPhone : `55${rawUserPhone}`;
      const whatsappMessage = `Olá, ${member.user.name}! Você foi convidado para a equipe da ${barbershop?.name || "nossa barbearia"}.\n\nPara ativar seu acesso e definir sua senha, acesse o link:\n${tokenResult.activationUrl}\n\n(Válido por 48 horas)`;
      const whatsappLink = `https://wa.me/${formattedUserPhone}?text=${encodeURIComponent(whatsappMessage)}`;

      inviteInfo = {
        activationUrl: tokenResult.activationUrl,
        whatsappMessage,
        whatsappLink,
        expiresAt: tokenResult.expiresAt,
      };
    }

    return NextResponse.json({ ...member, invite: inviteInfo }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = error.meta?.target;
      const targetStr = Array.isArray(target) ? target.join(",") : String(target ?? "");

      if (targetStr.includes("barbershop_id") || targetStr.includes("barbershopId") || targetStr.includes("user_id") || targetStr.includes("userId")) {
        return NextResponse.json(
          { error: "Este colaborador já está cadastrado nesta barbearia." },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: "Conflito de cadastro concorrente. Telefone, CPF ou e-mail já estão em uso por outro usuário." },
        { status: 409 }
      );
    }
    console.error("Erro ao criar colaborador:", error);
    return NextResponse.json({ error: "Erro ao criar colaborador." }, { status: 500 });
  }
}
