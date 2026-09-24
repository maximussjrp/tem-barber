import { NextResponse } from "next/server";
import { Prisma, MemberRole } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import {
  assertCanManageMember,
  MemberManagementError,
  type TenantMemberRole,
} from "@/lib/team/member-management";
import { isValidCpf } from "@/lib/utils";
import { getBrazilianPhoneVariants } from "@/lib/phone/br-phone";

async function findMember(id: string, barbershopId: string) {
  const m = await prisma.barbershopMember.findUnique({
    where: { id },
    include: {
      user: true,
      careerLevel: true,
    },
  });
  if (!m || m.barbershopId !== barbershopId) return null;
  return m;
}

export async function GET(
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
        select: { id: true, name: true, email: true, phone: true, cpf: true, avatarUrl: true },
      },
      careerLevel: {
        select: { id: true, name: true, defaultCommissionRate: true },
      },
      workingHours: { orderBy: { dayOfWeek: "asc" } },
      services: { include: { service: { select: { id: true, name: true, price: true } } } },
      timeOffs: { orderBy: { startDate: "asc" } },
    },
  });

  if (!member || member.barbershopId !== data!.barbershopId!) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  return NextResponse.json(member);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  const member = await findMember(id, data!.barbershopId!);
  if (!member) return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });

  try {
    const body = await request.json();
    const { name, phone, cpf, email, role, bio, careerLevelId } = body;

    if (role && !["BARBER", "MANAGER", "OWNER", "RECEPTIONIST"].includes(role)) {
      return NextResponse.json({ error: "Cargo inválido." }, { status: 400 });
    }

    assertCanManageMember(
      {
        memberId: data!.memberId,
        role: data!.role,
        barbershopId: data!.barbershopId!,
      },
      {
        id: member.id,
        role: member.role as TenantMemberRole,
        barbershopId: member.barbershopId,
        isActive: member.isActive,
      },
      { requestedRole: role as TenantMemberRole | undefined }
    );

    // Validações do usuário (name, phone, cpf, email)
    let cleanPhone: string | undefined = undefined;
    if (phone !== undefined) {
      if (!phone || typeof phone !== "string") {
        return NextResponse.json({ error: "Telefone inválido." }, { status: 400 });
      }
      const raw = phone.replace(/\D/g, "");
      if (raw.length < 10) {
        return NextResponse.json({ error: "Telefone deve ter DDD e no mínimo 10 dígitos." }, { status: 400 });
      }
      cleanPhone = raw;

      // Verificar colisão de telefone com outros usuários
      const phoneVariants = getBrazilianPhoneVariants(cleanPhone);
      const existingUserWithPhone = await prisma.user.findFirst({
        where: {
          phone: { in: phoneVariants },
          id: { not: member.userId },
        },
      });

      if (existingUserWithPhone) {
        return NextResponse.json(
          { error: "Telefone já está em uso por outro usuário." },
          { status: 409 }
        );
      }
    }

    let cleanCpf: string | undefined = undefined;
    if (cpf !== undefined) {
      if (cpf === null || cpf === "") {
        cleanCpf = undefined;
      } else {
        const raw = cpf.replace(/\D/g, "");
        if (!isValidCpf(raw)) {
          return NextResponse.json({ error: "CPF inválido." }, { status: 400 });
        }
        cleanCpf = raw;

        // Verificar colisão de CPF com outros usuários
        const existingUserWithCpf = await prisma.user.findFirst({
          where: {
            cpf: cleanCpf,
            id: { not: member.userId },
          },
        });

        if (existingUserWithCpf) {
          return NextResponse.json(
            { error: "CPF já está em uso por outro usuário." },
            { status: 409 }
          );
        }
      }
    }

    let cleanEmail: string | null | undefined = undefined;
    if (email !== undefined) {
      if (email === null || email === "") {
        cleanEmail = null;
      } else {
        const raw = email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
          return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
        }
        cleanEmail = raw;

        // Verificar colisão de email com outros usuários
        const existingUserWithEmail = await prisma.user.findFirst({
          where: {
            email: cleanEmail,
            id: { not: member.userId },
          },
        });

        if (existingUserWithEmail) {
          return NextResponse.json(
            { error: "E-mail já está em uso por outro usuário." },
            { status: 409 }
          );
        }
      }
    }

    if (name !== undefined) {
      if (!name || typeof name !== "string" || name.trim().length < 2) {
        return NextResponse.json({ error: "Nome deve ter no mínimo 2 caracteres." }, { status: 400 });
      }
    }

    let updatedCareerLevelId: string | null | undefined = undefined;
    if (careerLevelId !== undefined) {
      if (careerLevelId === null || careerLevelId === "") {
        updatedCareerLevelId = null;
      } else if (typeof careerLevelId === "string") {
        const level = await prisma.careerLevel.findFirst({
          where: { id: careerLevelId, barbershopId: data!.barbershopId!, active: true },
        });
        if (!level) {
          return NextResponse.json({ error: "Nível de carreira não encontrado ou inválido." }, { status: 400 });
        }
        updatedCareerLevelId = level.id;
      }
    }

    if (!member.isActive && (name !== undefined || phone !== undefined || cpf !== undefined || email !== undefined)) {
      return NextResponse.json(
        {
          error: "INACTIVE_MEMBER_IMMUTABLE_USER",
          message: "Não é permitido alterar dados cadastrais globais de um colaborador inativo.",
        },
        { status: 409 }
      );
    }

    const executeUpdate = async (tx: Prisma.TransactionClient | typeof prisma) => {
      // Atualizar dados do usuário se algum foi informado e membro estiver ativo
      const userUpdateData: { name?: string; phone?: string; cpf?: string; email?: string | null } = {};
      if (member.isActive) {
        if (name !== undefined) userUpdateData.name = name.trim();
        if (cleanPhone !== undefined) userUpdateData.phone = cleanPhone;
        if (cleanCpf !== undefined) userUpdateData.cpf = cleanCpf;
        if (cleanEmail !== undefined) userUpdateData.email = cleanEmail;
      }

      if (Object.keys(userUpdateData).length > 0) {
        await tx.user.update({
          where: { id: member.userId },
          data: userUpdateData,
        });
      }

      // Atualizar dados do member
      const memberUpdateData: { role?: MemberRole; bio?: string | null; careerLevelId?: string | null } = {};
      if (role && member.role !== "OWNER") memberUpdateData.role = role;
      if (bio !== undefined) memberUpdateData.bio = bio?.trim() || null;
      if (updatedCareerLevelId !== undefined) memberUpdateData.careerLevelId = updatedCareerLevelId;

      return await tx.barbershopMember.update({
        where: { id },
        data: memberUpdateData,
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true, cpf: true, avatarUrl: true },
          },
          careerLevel: {
            select: { id: true, name: true, defaultCommissionRate: true },
          },
        },
      });
    };

    const updated = typeof prisma.$transaction === "function"
      ? await prisma.$transaction((tx) => executeUpdate(tx))
      : await executeUpdate(prisma);

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof MemberManagementError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 403 }
      );
    }
    console.error("Erro ao atualizar colaborador:", err);
    return NextResponse.json({ error: "Erro ao atualizar colaborador." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  const member = await findMember(id, data!.barbershopId!);
  if (!member) return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });

  try {
    const body = await request.json();
    if (typeof body.isActive !== "boolean") {
      return NextResponse.json({ error: "Campo isActive inválido." }, { status: 400 });
    }

    assertCanManageMember(
      {
        memberId: data!.memberId,
        role: data!.role,
        barbershopId: data!.barbershopId!,
      },
      {
        id: member.id,
        role: member.role as TenantMemberRole,
        barbershopId: member.barbershopId,
        isActive: member.isActive,
      },
      { requestedIsActive: body.isActive }
    );

    // Multi-tenant check: if reactivating (false -> true), verify no other active membership exists
    if (body.isActive === true && !member.isActive) {
      const result = await prisma.$transaction(async (tx) => {
        const lockKey = `team-membership:${member.userId}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

        const activeInOther = await tx.barbershopMember.findFirst({
          where: {
            userId: member.userId,
            barbershopId: { not: data!.barbershopId! },
            isActive: true,
          },
        });

        if (activeInOther) {
          const conflictErr = Object.assign(
            new Error("Este profissional já possui um vínculo ativo em outra barbearia."),
            { code: "ACTIVE_MEMBERSHIP_CONFLICT", status: 409 }
          );
          throw conflictErr;
        }

        return await tx.barbershopMember.update({
          where: { id },
          data: { isActive: true },
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true, cpf: true, avatarUrl: true },
            },
          },
        });
      });

      return NextResponse.json(result);
    }

    const updated = await prisma.barbershopMember.update({
      where: { id },
      data: { isActive: body.isActive },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, cpf: true, avatarUrl: true },
        },
      },
    });

    return NextResponse.json(updated);
  } catch (err: unknown) {
    const errObj = err as { code?: string; message?: string } | null;
    if (errObj && typeof errObj === "object" && errObj.code === "ACTIVE_MEMBERSHIP_CONFLICT") {
      return NextResponse.json(
        { error: "ACTIVE_MEMBERSHIP_CONFLICT", message: errObj.message },
        { status: 409 }
      );
    }
    if (err instanceof MemberManagementError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: "Erro ao atualizar status." }, { status: 500 });
  }
}
