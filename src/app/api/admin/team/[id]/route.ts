import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import {
  assertCanManageMember,
  MemberManagementError,
  type TenantMemberRole,
} from "@/lib/team/member-management";

async function findMember(id: string, barbershopId: string) {
  const m = await prisma.barbershopMember.findUnique({ where: { id } });
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
    const { role, bio, careerLevelId } = body;

    if (role && !["BARBER", "MANAGER", "OWNER"].includes(role)) {
      return NextResponse.json({ error: "Cargo inválido." }, { status: 400 });
    }

    assertCanManageMember(
      {
        memberId: data!.memberId,
        role: data!.role,
        barbershopId: data!.barbershopId!,
      },
      member,
      { requestedRole: role as TenantMemberRole | undefined }
    );

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

    const updated = await prisma.barbershopMember.update({
      where: { id },
      data: {
        ...(role ? { role } : {}),
        bio: bio !== undefined ? (bio?.trim() || null) : member.bio,
        ...(updatedCareerLevelId !== undefined ? { careerLevelId: updatedCareerLevelId } : {}),
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

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof MemberManagementError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 403 }
      );
    }
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
      member,
      { requestedIsActive: body.isActive }
    );

    const updated = await prisma.barbershopMember.update({
      where: { id },
      data: { isActive: body.isActive },
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof MemberManagementError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: "Erro ao atualizar status." }, { status: 500 });
  }
}
