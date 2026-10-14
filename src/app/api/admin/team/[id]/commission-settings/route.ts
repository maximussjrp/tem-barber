import { CommissionConfigType, ComandaItemType } from "@prisma/client";
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import {
  CommissionError,
  buildCommissionScopeKey,
  resolveCommissionConfig,
  upsertCommissionConfig,
  validateCommissionConfig,
} from "@/lib/operations/commissions";
import { checkMemberPermission } from "@/lib/permissions/engine";

interface ServiceRuleInput {
  serviceId: string;
  type: CommissionConfigType;
  value: number | string;
  active?: boolean;
}

interface ProductRuleInput {
  productId: string;
  type: CommissionConfigType;
  value: number | string;
  active?: boolean;
}

interface ProductDefaultRuleInput {
  type: CommissionConfigType;
  value: number | string;
  active?: boolean;
}

interface PutCommissionSettingsBody {
  selectedServiceIds?: string[];
  serviceRules?: ServiceRuleInput[];
  removeServiceRuleIds?: string[];
  productDefaultRule?: ProductDefaultRuleInput | null;
  productRules?: ProductRuleInput[];
  removeProductRuleIds?: string[];
  isCommissionEligible?: boolean;
}

/**
 * GET /api/admin/team/[id]/commission-settings
 * Retorna a configuração completa de serviços e comissões do profissional,
 * resolvendo a regra efetiva sem efeitos colaterais no banco de dados.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }

  // Permissões: OWNER e SUPER_ADMIN têm acesso direto. MANAGER exige COMMISSIONS_MANAGE.
  if (data!.role === "OWNER" || data!.role === "SUPER_ADMIN") {
    // Permitido
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

  const { id: memberId } = await params;

  const targetMember = await prisma.barbershopMember.findFirst({
    where: { id: memberId, barbershopId },
    include: {
      user: { select: { name: true, email: true, phone: true } },
      careerLevel: { select: { id: true, name: true, defaultCommissionRate: true } },
    },
  });

  if (!targetMember) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  // 1. Serviços disponíveis na barbearia e serviços selecionados do colaborador
  const [availableServices, selectedBarberServices, availableProducts, existingConfigs] =
    await Promise.all([
      prisma.service.findMany({
        where: { barbershopId, isActive: true },
        include: { category: { select: { id: true, name: true } } },
        orderBy: [{ categoryId: "asc" }, { name: "asc" }],
      }),
      prisma.barberService.findMany({
        where: { barberId: memberId },
        select: { serviceId: true },
      }),
      prisma.product.findMany({
        where: { barbershopId, isActive: true },
        select: { id: true, name: true, salePrice: true },
        orderBy: { name: "asc" },
      }),
      prisma.commissionConfig.findMany({
        where: { barbershopId, memberId },
      }),
    ]);

  const selectedServiceIdSet = new Set(selectedBarberServices.map((bs) => bs.serviceId));

  // 2. Resolver a comissão efetiva para cada serviço utilizando resolveCommissionConfig
  const servicesWithEffectiveCommissions = await Promise.all(
    availableServices.map(async (service) => {
      const resolved = await resolveCommissionConfig(prisma as any, {
        barbershopId,
        memberId,
        serviceId: service.id,
        itemType: ComandaItemType.SERVICE,
      });

      const memberServiceScopeKey = buildCommissionScopeKey({ memberId, serviceId: service.id });
      const individualConfig = existingConfigs.find((c) => c.scopeKey === memberServiceScopeKey);

      return {
        id: service.id,
        name: service.name,
        categoryId: service.categoryId,
        categoryName: service.category?.name ?? null,
        price: service.price,
        isSelected: selectedServiceIdSet.has(service.id),
        effectiveCommission: resolved
          ? {
              type: resolved.type,
              value: Number(resolved.value),
              origin: resolved.origin,
              configId: resolved.configId,
              isCustomized: resolved.origin === "MEMBER_SERVICE",
            }
          : null,
        individualRule: individualConfig
          ? {
              id: individualConfig.id,
              type: individualConfig.type,
              value: Number(individualConfig.value),
              active: individualConfig.active,
            }
          : null,
      };
    })
  );

  // 3. Resolver comissão padrão de produto para o membro
  const memberProductDefaultScopeKey = buildCommissionScopeKey({ memberId, isProductDefault: true });
  const individualProductDefaultConfig = existingConfigs.find(
    (c) => c.scopeKey === memberProductDefaultScopeKey
  );

  const resolvedProductDefault = await resolveCommissionConfig(prisma as any, {
    barbershopId,
    memberId,
    itemType: ComandaItemType.PRODUCT,
  });

  // 4. Resolver comissão para cada produto disponível
  const productsWithEffectiveCommissions = await Promise.all(
    availableProducts.map(async (product) => {
      const resolved = await resolveCommissionConfig(prisma as any, {
        barbershopId,
        memberId,
        productId: product.id,
        itemType: ComandaItemType.PRODUCT,
      });

      const memberProductScopeKey = buildCommissionScopeKey({ memberId, productId: product.id });
      const individualConfig = existingConfigs.find((c) => c.scopeKey === memberProductScopeKey);

      return {
        id: product.id,
        name: product.name,
        salePrice: product.salePrice,
        effectiveCommission: resolved
          ? {
              type: resolved.type,
              value: Number(resolved.value),
              origin: resolved.origin,
              configId: resolved.configId,
              isCustomized: resolved.origin === "MEMBER_PRODUCT",
            }
          : null,
        individualRule: individualConfig
          ? {
              id: individualConfig.id,
              type: individualConfig.type,
              value: Number(individualConfig.value),
              active: individualConfig.active,
            }
          : null,
      };
    })
  );

  const serviceExceptions = existingConfigs
    .filter((c) => c.serviceId !== null)
    .map((c) => ({
      id: c.id,
      serviceId: c.serviceId,
      type: c.type,
      value: Number(c.value),
      active: c.active,
    }));

  const productExceptions = existingConfigs
    .filter((c) => c.productId !== null)
    .map((c) => ({
      id: c.id,
      productId: c.productId,
      type: c.type,
      value: Number(c.value),
      active: c.active,
    }));

  return NextResponse.json({
    memberId: targetMember.id,
    memberName: targetMember.user?.name ?? "",
    role: targetMember.role,
    careerLevelId: targetMember.careerLevelId,
    careerLevelName: targetMember.careerLevel?.name ?? null,
    isCommissionEligible: targetMember.isCommissionEligible,
    selectedServiceIds: Array.from(selectedServiceIdSet),
    services: servicesWithEffectiveCommissions,
    productDefaultRule: {
      effective: resolvedProductDefault
        ? {
            type: resolvedProductDefault.type,
            value: Number(resolvedProductDefault.value),
            origin: resolvedProductDefault.origin,
            isCustomized: resolvedProductDefault.origin === "MEMBER_PRODUCT_DEFAULT",
          }
        : null,
      individualRule: individualProductDefaultConfig
        ? {
            id: individualProductDefaultConfig.id,
            type: individualProductDefaultConfig.type,
            value: Number(individualProductDefaultConfig.value),
            active: individualProductDefaultConfig.active,
          }
        : null,
    },
    products: productsWithEffectiveCommissions,
    serviceExceptions,
    productExceptions,
  });
}

/**
 * PUT /api/admin/team/[id]/commission-settings
 * Executa todas as atualizações de serviços, regras individuais de comissão
 * e elegibilidade de forma estritamente transacional dentro de um único prisma.$transaction.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data!.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }

  // Permissões: OWNER e SUPER_ADMIN têm acesso direto. MANAGER exige COMMISSIONS_MANAGE.
  if (data!.role === "OWNER" || data!.role === "SUPER_ADMIN") {
    // Permitido
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

  const { id: memberId } = await params;

  // 1. Validar existência do membro e tenant isolation
  const targetMember = await prisma.barbershopMember.findFirst({
    where: { id: memberId, barbershopId },
  });

  if (!targetMember) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  let body: PutCommissionSettingsBody;
  try {
    const rawBody = await request.json();
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json({ error: "Payload JSON deve ser um objeto." }, { status: 400 });
    }
    body = rawBody;
  } catch {
    return NextResponse.json({ error: "Payload JSON inválido." }, { status: 400 });
  }

  // Validação de tipo estrito para isCommissionEligible
  if (body.isCommissionEligible !== undefined && typeof body.isCommissionEligible !== "boolean") {
    return NextResponse.json({ error: "isCommissionEligible deve ser um booleano." }, { status: 400 });
  }

  // 2. Proteção do OWNER: Gerente não pode enviar isCommissionEligible para um OWNER
  if (
    body.isCommissionEligible !== undefined &&
    targetMember.role === "OWNER" &&
    data!.role !== "OWNER" &&
    data!.role !== "SUPER_ADMIN"
  ) {
    return NextResponse.json(
      {
        error: "Apenas o proprietário pode alterar a elegibilidade de um proprietário.",
        code: "OWNER_ELIGIBILITY_PROTECTED",
      },
      { status: 403 }
    );
  }

  try {
    // 3. Validação prévia de selectedServiceIds
    if (body.selectedServiceIds !== undefined) {
      if (!Array.isArray(body.selectedServiceIds)) {
        return NextResponse.json({ error: "selectedServiceIds deve ser um array." }, { status: 400 });
      }
      if (new Set(body.selectedServiceIds).size !== body.selectedServiceIds.length) {
        return NextResponse.json({ error: "Serviços duplicados em selectedServiceIds." }, { status: 400 });
      }
      if (body.selectedServiceIds.length > 0) {
        const validCount = await prisma.service.count({
          where: { id: { in: body.selectedServiceIds }, barbershopId },
        });
        if (validCount !== body.selectedServiceIds.length) {
          return NextResponse.json(
            { error: "Um ou mais serviços são inválidos ou não pertencem à barbearia.", code: "INVALID_SCOPE" },
            { status: 400 }
          );
        }
      }
    }

    // 4. Validação prévia de serviceRules
    if (body.serviceRules !== undefined) {
      if (!Array.isArray(body.serviceRules)) {
        return NextResponse.json({ error: "serviceRules deve ser um array." }, { status: 400 });
      }
      const serviceIds = body.serviceRules.map((r) => r.serviceId);
      if (new Set(serviceIds).size !== serviceIds.length) {
        return NextResponse.json({ error: "Regras de serviço duplicadas.", code: "DUPLICATE_RULES" }, { status: 400 });
      }
      for (const rule of body.serviceRules) {
        if (!rule.serviceId || typeof rule.serviceId !== "string") {
          return NextResponse.json({ error: "serviceId inválido em serviceRules." }, { status: 400 });
        }
        if (!Object.values(CommissionConfigType).includes(rule.type)) {
          return NextResponse.json({ error: "Tipo de comissão inválido em serviceRules." }, { status: 400 });
        }
        if (rule.active !== undefined && typeof rule.active !== "boolean") {
          return NextResponse.json({ error: "active em serviceRules deve ser um booleano.", code: "INVALID_FIELD_TYPE" }, { status: 400 });
        }
        validateCommissionConfig({
          type: rule.type,
          value: rule.value,
          memberId,
          serviceId: rule.serviceId,
        });
      }
      if (serviceIds.length > 0) {
        const validCount = await prisma.service.count({
          where: { id: { in: serviceIds }, barbershopId },
        });
        if (validCount !== serviceIds.length) {
          return NextResponse.json(
            { error: "Um ou mais serviços em serviceRules não pertencem à barbearia.", code: "INVALID_SCOPE" },
            { status: 400 }
          );
        }
      }
    }

    // 5. Validação prévia de removeServiceRuleIds
    if (body.removeServiceRuleIds !== undefined) {
      if (!Array.isArray(body.removeServiceRuleIds)) {
        return NextResponse.json({ error: "removeServiceRuleIds deve ser um array." }, { status: 400 });
      }
      if (new Set(body.removeServiceRuleIds).size !== body.removeServiceRuleIds.length) {
        return NextResponse.json({ error: "removeServiceRuleIds contém IDs duplicados." }, { status: 400 });
      }
    }

    // 6. Validação prévia de productDefaultRule
    if (body.productDefaultRule !== undefined && body.productDefaultRule !== null) {
      if (!Object.values(CommissionConfigType).includes(body.productDefaultRule.type)) {
        return NextResponse.json({ error: "Tipo de comissão inválido em productDefaultRule." }, { status: 400 });
      }
      if (body.productDefaultRule.active !== undefined && typeof body.productDefaultRule.active !== "boolean") {
        return NextResponse.json({ error: "active em productDefaultRule deve ser um booleano.", code: "INVALID_FIELD_TYPE" }, { status: 400 });
      }
      validateCommissionConfig({
        type: body.productDefaultRule.type,
        value: body.productDefaultRule.value,
        memberId,
      });
    }

    // 7. Validação prévia de productRules
    if (body.productRules !== undefined) {
      if (!Array.isArray(body.productRules)) {
        return NextResponse.json({ error: "productRules deve ser um array." }, { status: 400 });
      }
      const productIds = body.productRules.map((r) => r.productId);
      if (new Set(productIds).size !== productIds.length) {
        return NextResponse.json({ error: "Regras de produto duplicadas.", code: "DUPLICATE_RULES" }, { status: 400 });
      }
      for (const rule of body.productRules) {
        if (!rule.productId || typeof rule.productId !== "string") {
          return NextResponse.json({ error: "productId inválido em productRules." }, { status: 400 });
        }
        if (!Object.values(CommissionConfigType).includes(rule.type)) {
          return NextResponse.json({ error: "Tipo de comissão inválido em productRules." }, { status: 400 });
        }
        if (rule.active !== undefined && typeof rule.active !== "boolean") {
          return NextResponse.json({ error: "active em productRules deve ser um booleano.", code: "INVALID_FIELD_TYPE" }, { status: 400 });
        }
        validateCommissionConfig({
          type: rule.type,
          value: rule.value,
          memberId,
          productId: rule.productId,
        });
      }
      if (productIds.length > 0) {
        const validCount = await prisma.product.count({
          where: { id: { in: productIds }, barbershopId },
        });
        if (validCount !== productIds.length) {
          return NextResponse.json(
            { error: "Um ou mais produtos em productRules não pertencem à barbearia.", code: "INVALID_SCOPE" },
            { status: 400 }
          );
        }
      }
    }

    // 8. Validação prévia de removeProductRuleIds
    if (body.removeProductRuleIds !== undefined) {
      if (!Array.isArray(body.removeProductRuleIds)) {
        return NextResponse.json({ error: "removeProductRuleIds deve ser um array." }, { status: 400 });
      }
      if (new Set(body.removeProductRuleIds).size !== body.removeProductRuleIds.length) {
        return NextResponse.json({ error: "removeProductRuleIds contém IDs duplicados." }, { status: 400 });
      }
    }

    // 9. Execução atômica dentro de uma única transação Prisma
    await prisma.$transaction(async (tx) => {
      // 9.1. Atualizar serviços selecionados (BarberService)
      if (body.selectedServiceIds !== undefined) {
        await tx.barberService.deleteMany({
          where: { barberId: memberId },
        });

        if (body.selectedServiceIds.length > 0) {
          await tx.barberService.createMany({
            data: body.selectedServiceIds.map((serviceId) => ({
              barberId: memberId,
              serviceId,
            })),
          });
        }
      }

      // 9.2. Remover regras individuais de serviços (restaurar padrão)
      if (body.removeServiceRuleIds !== undefined && body.removeServiceRuleIds.length > 0) {
        for (const serviceId of body.removeServiceRuleIds) {
          const scopeKey = buildCommissionScopeKey({ memberId, serviceId });
          await tx.commissionConfig.deleteMany({
            where: { barbershopId, scopeKey },
          });
        }
      }

      // 9.3. Criar ou atualizar regras individuais de serviços
      if (body.serviceRules !== undefined && body.serviceRules.length > 0) {
        for (const rule of body.serviceRules) {
          await upsertCommissionConfig(tx, {
            barbershopId,
            memberId,
            serviceId: rule.serviceId,
            type: rule.type,
            value: rule.value,
            active: rule.active !== false,
          });
        }
      }

      // 9.4. Configurar ou remover regra individual padrão de produtos
      if (body.productDefaultRule !== undefined) {
        const defaultProductScopeKey = buildCommissionScopeKey({ memberId, isProductDefault: true });
        if (body.productDefaultRule === null) {
          // Remover regra individual padrão de produto (volta a herdar da barbearia)
          await tx.commissionConfig.deleteMany({
            where: { barbershopId, scopeKey: defaultProductScopeKey },
          });
        } else {
          await upsertCommissionConfig(tx, {
            barbershopId,
            memberId,
            isProductDefault: true,
            type: body.productDefaultRule.type,
            value: body.productDefaultRule.value,
            active: body.productDefaultRule.active !== false,
          });
        }
      }

      // 9.5. Remover regras individuais de produtos (restaurar padrão)
      if (body.removeProductRuleIds !== undefined && body.removeProductRuleIds.length > 0) {
        for (const productId of body.removeProductRuleIds) {
          const scopeKey = buildCommissionScopeKey({ memberId, productId });
          await tx.commissionConfig.deleteMany({
            where: { barbershopId, scopeKey },
          });
        }
      }

      // 9.6. Criar ou atualizar regras individuais de produtos específicos
      if (body.productRules !== undefined && body.productRules.length > 0) {
        for (const rule of body.productRules) {
          await upsertCommissionConfig(tx, {
            barbershopId,
            memberId,
            productId: rule.productId,
            type: rule.type,
            value: rule.value,
            active: rule.active !== false,
          });
        }
      }

      // 9.7. Atualizar elegibilidade e registrar evento com concorrência segura (updateMany condicional)
      if (body.isCommissionEligible !== undefined) {
        const result = await tx.barbershopMember.updateMany({
          where: {
            id: memberId,
            barbershopId,
            isCommissionEligible: {
              not: body.isCommissionEligible,
            },
          },
          data: {
            isCommissionEligible: body.isCommissionEligible,
          },
        });

        if (result.count === 1) {
          const timestamp = new Date();
          await tx.memberCommissionEligibilityEvent.create({
            data: {
              barbershopId,
              memberId,
              enabled: body.isCommissionEligible,
              effectiveAt: timestamp,
              actorUserId: data!.userId,
              createdAt: timestamp,
            },
          });
        }
      }
    });

    return NextResponse.json({
      success: true,
      memberId,
      isCommissionEligible:
        body.isCommissionEligible !== undefined
          ? body.isCommissionEligible
          : targetMember.isCommissionEligible,
    });
  } catch (err) {
    if (err instanceof CommissionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Erro ao atualizar configurações de comissão e serviços." },
      { status: 500 }
    );
  }
}
