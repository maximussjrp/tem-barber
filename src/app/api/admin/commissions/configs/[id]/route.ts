import { CommissionConfigType } from "@prisma/client";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { CommissionError, upsertCommissionConfig } from "@/lib/operations/commissions";
import { checkMemberPermission } from "@/lib/permissions/engine";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  if (data!.role === "OWNER" || data!.role === "SUPER_ADMIN") {
    // Acesso permitido
  } else if (data!.role === "MANAGER") {
    if (!data!.memberId) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }
    const hasPermission = await checkMemberPermission(
      data!.memberId,
      data!.role,
      "COMMISSIONS_MANAGE"
    );
    if (!hasPermission) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const { id } = await params;

  try {
    const current = await prisma.commissionConfig.findFirst({
      where: { id, barbershopId: data!.barbershopId! },
    });
    if (!current) return NextResponse.json({ error: "Configuracao nao encontrada." }, { status: 404 });

    const body = await request.json();
    const type = body.type ?? current.type;
    if (!Object.values(CommissionConfigType).includes(type)) {
      return NextResponse.json({ error: "Tipo de comissao invalido." }, { status: 400 });
    }

    // 1. Proibir alteração de escopo: a identidade e o escopo original devem ser preservados
    if (body.memberId !== undefined && (body.memberId || null) !== current.memberId) {
      return NextResponse.json(
        { error: "Não é permitido alterar o colaborador de uma configuração existente.", code: "SCOPE_MUTATION_FORBIDDEN" },
        { status: 400 }
      );
    }
    if (body.serviceId !== undefined && (body.serviceId || null) !== current.serviceId) {
      return NextResponse.json(
        { error: "Não é permitido alterar o serviço de uma configuração existente.", code: "SCOPE_MUTATION_FORBIDDEN" },
        { status: 400 }
      );
    }
    if (body.categoryId !== undefined && (body.categoryId || null) !== current.categoryId) {
      return NextResponse.json(
        { error: "Não é permitido alterar a categoria de uma configuração existente.", code: "SCOPE_MUTATION_FORBIDDEN" },
        { status: 400 }
      );
    }
    if (body.productId !== undefined && (body.productId || null) !== current.productId) {
      return NextResponse.json(
        { error: "Não é permitido alterar o produto de uma configuração existente.", code: "SCOPE_MUTATION_FORBIDDEN" },
        { status: 400 }
      );
    }

    // Proibir alteração da classificação isProductDefault
    const currentIsProductDefault = current.scopeKey.includes("product_default");
    if (body.isProductDefault !== undefined && typeof body.isProductDefault === "boolean") {
      if (body.isProductDefault !== currentIsProductDefault) {
        return NextResponse.json(
          { error: "Não é permitido alterar a classificação de produto padrão de uma configuração existente.", code: "SCOPE_MUTATION_FORBIDDEN" },
          { status: 400 }
        );
      }
    } else if (body.isProductDefault !== undefined && typeof body.isProductDefault !== "boolean") {
      return NextResponse.json({ error: "isProductDefault deve ser um booleano." }, { status: 400 });
    }

    if (body.active !== undefined && typeof body.active !== "boolean") {
      return NextResponse.json({ error: "active deve ser um booleano." }, { status: 400 });
    }

    const value = body.value !== undefined ? body.value : current.value;
    const active = body.active !== undefined ? body.active : current.active;

    // 2. Validar percentual e valores da regra
    const { validateCommissionConfig } = await import("@/lib/operations/commissions");
    validateCommissionConfig({
      type,
      value,
      memberId: current.memberId,
      serviceId: current.serviceId,
      categoryId: current.categoryId,
      productId: current.productId,
    });

    // 3. Atualizar diretamente pelo id preservando escopo e chave única original
    const config = await prisma.commissionConfig.update({
      where: { id: current.id },
      data: {
        type,
        value,
        active,
      },
    });

    return NextResponse.json(config);
  } catch (err) {
    if (err instanceof CommissionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro ao atualizar configuracao." }, { status: 500 });
  }
}
