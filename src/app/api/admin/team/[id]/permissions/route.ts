import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { getEffectivePermissions } from "@/lib/permissions/engine";
import { ALL_PERMISSION_KEYS, PermissionKey } from "@/lib/permissions/types";
import { ROLE_PRESETS } from "@/lib/permissions/presets";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const { id } = await params;

  const member = await prisma.barbershopMember.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      barbershopId: true,
      user: { select: { id: true, name: true, email: true } },
      permissionOverrides: true,
    },
  });

  if (!member || member.barbershopId !== data!.barbershopId) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  // Apenas OWNER e SUPER_ADMIN podem visualizar a matriz de permissões
  if (data!.role !== "OWNER" && data!.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Apenas o proprietário pode visualizar permissões detalhadas." },
      { status: 403 }
    );
  }

  const effective = await getEffectivePermissions(member.id, member.role);

  return NextResponse.json({
    memberId: member.id,
    userName: member.user.name,
    role: member.role,
    isOwner: member.role === "OWNER",
    presetDefaults: ROLE_PRESETS[member.role] || ROLE_PRESETS.BARBER,
    effective,
    overrides: member.permissionOverrides,
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  // Apenas OWNER e SUPER_ADMIN podem alterar permissões
  if (data!.role !== "OWNER" && data!.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Apenas o proprietário pode alterar permissões de colaboradores." },
      { status: 403 }
    );
  }

  const { id } = await params;

  const member = await prisma.barbershopMember.findUnique({
    where: { id },
  });

  if (!member || member.barbershopId !== data!.barbershopId) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  if (member.role === "OWNER") {
    return NextResponse.json(
      { error: "Não é permitido alterar permissões do proprietário da barbearia." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    let overridesList: Array<{ permissionKey: string; allowed: boolean }> = [];

    if (Array.isArray(body.overrides)) {
      overridesList = body.overrides;
    } else if (body.overrides && typeof body.overrides === "object") {
      overridesList = Object.entries(body.overrides).map(([k, v]) => ({
        permissionKey: k,
        allowed: Boolean(v),
      }));
    } else {
      return NextResponse.json(
        { error: "Formato inválido. 'overrides' deve ser um objeto ou lista." },
        { status: 400 }
      );
    }

    // Validar todas as chaves
    for (const item of overridesList) {
      if (!ALL_PERMISSION_KEYS.includes(item.permissionKey as PermissionKey)) {
        return NextResponse.json(
          { error: `Chave de permissão inválida: '${item.permissionKey}'` },
          { status: 400 }
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const item of overridesList) {
        await tx.memberPermissionOverride.upsert({
          where: {
            memberId_permissionKey: {
              memberId: member.id,
              permissionKey: item.permissionKey,
            },
          },
          update: {
            allowed: item.allowed,
            updatedByUserId: data!.userId,
          },
          create: {
            barbershopId: data!.barbershopId!,
            memberId: member.id,
            permissionKey: item.permissionKey,
            allowed: item.allowed,
            updatedByUserId: data!.userId,
          },
        });
      }
    });

    const updatedEffective = await getEffectivePermissions(member.id, member.role);

    return NextResponse.json({
      success: true,
      message: "Permissões atualizadas com sucesso.",
      effective: updatedEffective,
    });
  } catch (err: any) {
    console.error("Erro ao atualizar permissões:", err);
    return NextResponse.json(
      { error: "Erro interno ao atualizar permissões." },
      { status: 500 }
    );
  }
}
