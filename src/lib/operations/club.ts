import {
  Prisma,
  ClubPlanBenefitType,
  ClubSubscriptionStatus,
  ClubPaymentStatus,
  ClubPointStatus,
  ClubSettlementStatus,
  ClubBenefitUsageStatus,
} from "@prisma/client";
import prisma from "../prisma";
import { fromCents, toCents } from "./money";

export class ClubError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

/**
 * 1. getActiveCustomerClubSubscription
 * Busca a assinatura ativa ou em período de carência do cliente final para a barbearia na data específica.
 */
export async function getActiveCustomerClubSubscription(params: {
  barbershopId: string;
  customerId: string;
  atDate: Date;
  tx?: Prisma.TransactionClient;
}) {
  if (!params.customerId) return null;
  const client = params.tx ?? prisma;
  
  const subscriptions = await client.customerClubSubscription.findMany({
    where: {
      barbershopId: params.barbershopId,
      customerId: params.customerId,
      status: { in: [ClubSubscriptionStatus.ACTIVE, ClubSubscriptionStatus.GRACE_PERIOD] },
      currentPeriodStart: { lte: params.atDate },
      currentPeriodEnd: { gt: params.atDate },
    },
    include: {
      clubPlan: true,
    },
  });

  if (subscriptions.length === 0) return null;

  // Sort deterministically in memory:
  // 1. ACTIVE before GRACE_PERIOD
  // 2. clubPlan.isActive desc
  // 3. currentPeriodStart desc
  // 4. createdAt desc
  // 5. updatedAt desc
  subscriptions.sort((a, b) => {
    if (a.status === ClubSubscriptionStatus.ACTIVE && b.status === ClubSubscriptionStatus.GRACE_PERIOD) return -1;
    if (a.status === ClubSubscriptionStatus.GRACE_PERIOD && b.status === ClubSubscriptionStatus.ACTIVE) return 1;

    if (a.clubPlan.isActive && !b.clubPlan.isActive) return -1;
    if (!a.clubPlan.isActive && b.clubPlan.isActive) return 1;

    const aStart = a.currentPeriodStart.getTime();
    const bStart = b.currentPeriodStart.getTime();
    if (aStart !== bStart) return bStart - aStart;

    const aCreated = a.createdAt.getTime();
    const bCreated = b.createdAt.getTime();
    if (aCreated !== bCreated) return bCreated - aCreated;

    const aUpdated = a.updatedAt.getTime();
    const bUpdated = b.updatedAt.getTime();
    return bUpdated - aUpdated;
  });

  return subscriptions[0];
}

/**
 * 2. getClubBenefitsBalance
 * Calcula o saldo de benefícios de uma assinatura em uma data de referência (ciclo ativo).
 */
export async function getClubBenefitsBalance(params: {
  barbershopId: string;
  subscriptionId: string;
  atDate: Date;
  tx?: Prisma.TransactionClient;
}) {
  const client = params.tx ?? prisma;

  const subscription = await client.customerClubSubscription.findFirst({
    where: {
      id: params.subscriptionId,
      barbershopId: params.barbershopId,
    },
    include: {
      clubPlan: {
        include: {
          benefits: {
            include: {
              service: { select: { id: true, name: true, price: true } },
              product: { select: { id: true, name: true, salePrice: true } },
            },
          },
        },
      },
    },
  });

  if (!subscription) {
    throw new ClubError("SUBSCRIPTION_NOT_FOUND", "Assinatura não encontrada.", 404);
  }

  // Get active usages within current cycle [currentPeriodStart, currentPeriodEnd)
  const usages = await client.clubBenefitUsage.findMany({
    where: {
      subscriptionId: params.subscriptionId,
      barbershopId: params.barbershopId,
      status: ClubBenefitUsageStatus.APPLIED,
      usedAt: {
        gte: subscription.currentPeriodStart,
        lt: subscription.currentPeriodEnd,
      },
    },
  });

  const benefitBalances = subscription.clubPlan.benefits.map((benefit) => {
    if (benefit.benefitType === ClubPlanBenefitType.INCLUDED_SERVICE) {
      const usedQty = usages.filter(
        (u) => u.clubPlanBenefitId === benefit.id && u.benefitType === ClubPlanBenefitType.INCLUDED_SERVICE
      ).length;
      const allowedQty = benefit.includedQty ?? 0;
      const availableQty = Math.max(0, allowedQty - usedQty);

      return {
        id: benefit.id,
        benefitType: benefit.benefitType,
        serviceId: benefit.serviceId,
        productId: benefit.productId,
        service: benefit.service,
        product: benefit.product,
        includedQty: allowedQty,
        usedQty,
        availableQty,
        discountPercent: null,
        pointWeight: benefit.pointWeight ? Number(benefit.pointWeight) : 0,
      };
    } else {
      // SERVICE_DISCOUNT or PRODUCT_DISCOUNT
      return {
        id: benefit.id,
        benefitType: benefit.benefitType,
        serviceId: benefit.serviceId,
        productId: benefit.productId,
        service: benefit.service,
        product: benefit.product,
        includedQty: null,
        usedQty: 0,
        availableQty: null,
        discountPercent: benefit.discountPercent ? Number(benefit.discountPercent) : 0,
        pointWeight: benefit.pointWeight ? Number(benefit.pointWeight) : 0,
      };
    }
  });

  return {
    subscriptionId: subscription.id,
    clubPlan: {
      id: subscription.clubPlan.id,
      name: subscription.clubPlan.name,
      monthlyPrice: Number(subscription.clubPlan.monthlyPrice),
    },
    cycle: {
      start: subscription.currentPeriodStart,
      end: subscription.currentPeriodEnd,
    },
    benefits: benefitBalances,
  };
}

/**
 * 3. resolveClubBenefitForComandaItem
 * Determina a aplicação de benefícios do plano clube sobre um item de comanda simulado ou real.
 */
export async function resolveClubBenefitForComandaItem(params: {
  barbershopId: string;
  customerId: string;
  serviceId?: string;
  productId?: string;
  itemType: "SERVICE" | "PRODUCT";
  atDate: Date;
  tx?: Prisma.TransactionClient;
}) {
  const client = params.tx ?? prisma;

  if (params.itemType !== "SERVICE" && params.itemType !== "PRODUCT") {
    return {
      hasActiveSubscription: false,
      isApplicable: false,
      blockedReason: "INVALID_ITEM_TYPE" as const,
    };
  }

  // 1. Check active subscription
  const subscription = await getActiveCustomerClubSubscription({
    barbershopId: params.barbershopId,
    customerId: params.customerId,
    atDate: params.atDate,
    tx: client,
  });

  if (!subscription) {
    const anySub = await client.customerClubSubscription.findFirst({
      where: {
        barbershopId: params.barbershopId,
        customerId: params.customerId,
      },
    });

    if (!anySub) {
      return {
        hasActiveSubscription: false,
        isApplicable: false,
        blockedReason: "NO_ACTIVE_SUBSCRIPTION" as const,
      };
    } else {
      return {
        hasActiveSubscription: false,
        isApplicable: false,
        blockedReason: "SUBSCRIPTION_NOT_USABLE" as const,
      };
    }
  }

  // 2. Fetch benefits balance
  const balance = await getClubBenefitsBalance({
    barbershopId: params.barbershopId,
    subscriptionId: subscription.id,
    atDate: params.atDate,
    tx: client,
  });

  // 3. Find matching benefit
  const matchingBenefit = balance.benefits.find((b) => {
    if (params.itemType === "SERVICE" && b.serviceId === params.serviceId) {
      return true;
    }
    if (params.itemType === "PRODUCT" && b.productId === params.productId) {
      return true;
    }
    return false;
  });

  if (!matchingBenefit) {
    return {
      hasActiveSubscription: true,
      isApplicable: false,
      blockedReason: "BENEFIT_NOT_FOUND" as const,
    };
  }

  // 4. Evaluate limits
  if (matchingBenefit.benefitType === ClubPlanBenefitType.INCLUDED_SERVICE) {
    if (matchingBenefit.availableQty === 0) {
      return {
        hasActiveSubscription: true,
        isApplicable: false,
        blockedReason: "BENEFIT_LIMIT_REACHED" as const,
      };
    }

    const service = await client.service.findFirst({
      where: { id: params.serviceId, barbershopId: params.barbershopId },
    });
    if (!service) {
      return {
        hasActiveSubscription: true,
        isApplicable: false,
        blockedReason: "BENEFIT_NOT_FOUND" as const,
      };
    }

    return {
      hasActiveSubscription: true,
      isApplicable: true,
      benefitType: ClubPlanBenefitType.INCLUDED_SERVICE,
      clubPlanBenefitId: matchingBenefit.id,
      clubPlanId: balance.clubPlan.id,
      coveredAmount: Number(service.price),
      discountPercent: null,
      pointWeight: matchingBenefit.pointWeight,
    };
  } else {
    // SERVICE_DISCOUNT or PRODUCT_DISCOUNT
    return {
      hasActiveSubscription: true,
      isApplicable: true,
      benefitType: matchingBenefit.benefitType,
      clubPlanBenefitId: matchingBenefit.id,
      clubPlanId: balance.clubPlan.id,
      coveredAmount: null,
      discountPercent: matchingBenefit.discountPercent,
      pointWeight: matchingBenefit.pointWeight,
    };
  }
}

/**
 * 4. registerClubBenefitUsage
 * Registra a utilização de um benefício e gera os pontos do barbeiro de forma atômica e transacional.
 */
export async function registerClubBenefitUsage(params: {
  barbershopId: string;
  subscriptionId: string;
  comandaItemId: string;
  serviceId?: string;
  productId?: string;
  memberId: string;
  pointWeight: number;
  competence: string;
  originalAmount?: number;
  coveredAmount?: number;
  discountAmount?: number;
  tx?: Prisma.TransactionClient;
}) {
  const runInTx = async (tx: Prisma.TransactionClient) => {
    // 1. Check idempotency
    const existingUsage = await tx.clubBenefitUsage.findUnique({
      where: { comandaItemId: params.comandaItemId },
    });

    if (existingUsage) {
      const existingPoint = await tx.clubPointEntry.findUnique({
        where: { comandaItemId: params.comandaItemId },
      });
      return {
        usage: existingUsage,
        pointEntry: existingPoint,
      };
    }

    // 2. Fetch subscription
    const subscription = await tx.customerClubSubscription.findFirst({
      where: { id: params.subscriptionId, barbershopId: params.barbershopId },
      include: { clubPlan: true },
    });
    if (!subscription) {
      throw new ClubError("SUBSCRIPTION_NOT_FOUND", "Assinatura não encontrada.", 404);
    }

    // Determine benefit type and matching benefitId
    const itemType = params.serviceId ? "SERVICE" : "PRODUCT";
    const resolved = await resolveClubBenefitForComandaItem({
      barbershopId: params.barbershopId,
      customerId: subscription.customerId,
      serviceId: params.serviceId,
      productId: params.productId,
      itemType,
      atDate: new Date(),
      tx,
    });

    if (!resolved.isApplicable) {
      throw new ClubError(
        resolved.blockedReason || "BENEFIT_NOT_APPLICABLE",
        `Benefício indisponível: ${resolved.blockedReason}`,
        422
      );
    }

    // 3. Create ClubBenefitUsage
    const usage = await tx.clubBenefitUsage.create({
      data: {
        barbershopId: params.barbershopId,
        subscriptionId: params.subscriptionId,
        clubPlanId: subscription.clubPlanId,
        clubPlanBenefitId: resolved.clubPlanBenefitId,
        comandaItemId: params.comandaItemId,
        serviceId: params.serviceId,
        productId: params.productId,
        benefitType: resolved.benefitType!,
        originalAmount: params.originalAmount,
        coveredAmount: params.coveredAmount,
        discountAmount: params.discountAmount,
        pointWeightApplied: new Prisma.Decimal(params.pointWeight),
        status: ClubBenefitUsageStatus.APPLIED,
        competence: params.competence,
        usedAt: new Date(),
      },
    });

    // 4. Create ClubPointEntry if pointWeight > 0
    let pointEntry = null;
    if (params.pointWeight > 0) {
      pointEntry = await tx.clubPointEntry.create({
        data: {
          barbershopId: params.barbershopId,
          subscriptionId: params.subscriptionId,
          comandaItemId: params.comandaItemId,
          memberId: params.memberId,
          points: new Prisma.Decimal(params.pointWeight),
          status: ClubPointStatus.GENERATED,
          competence: params.competence,
        },
      });
    }

    return {
      usage,
      pointEntry,
    };
  };

  if (params.tx) {
    return runInTx(params.tx);
  } else {
    return prisma.$transaction(runInTx);
  }
}

/**
 * 5. reverseClubBenefitUsage
 * Reverte o uso de um benefício, estornando os pontos gerados.
 */
export async function reverseClubBenefitUsage(params: {
  barbershopId: string;
  comandaItemId: string;
  reversalReason?: string;
  tx?: Prisma.TransactionClient;
}) {
  const runInTx = async (tx: Prisma.TransactionClient) => {
    const usage = await tx.clubBenefitUsage.findUnique({
      where: { comandaItemId: params.comandaItemId },
    });

    if (!usage) {
      return { success: true };
    }

    const point = await tx.clubPointEntry.findUnique({
      where: { comandaItemId: params.comandaItemId },
    });

    if (point && point.status === ClubPointStatus.SETTLED) {
      throw new ClubError(
        "SETTLEMENT_LOCKED",
        "Ponto já liquidado em fechamento e não pode ser revertido.",
        422
      );
    }

    const updatedUsage = await tx.clubBenefitUsage.update({
      where: { id: usage.id },
      data: {
        status: ClubBenefitUsageStatus.REVERSED,
        reversedAt: new Date(),
        reversalReason: params.reversalReason ?? "Estorno de item",
      },
    });

    let updatedPoint = null;
    if (point) {
      updatedPoint = await tx.clubPointEntry.update({
        where: { id: point.id },
        data: {
          status: ClubPointStatus.REVERSED,
        },
      });
    }

    return {
      usage: updatedUsage,
      pointEntry: updatedPoint,
    };
  };

  if (params.tx) {
    return runInTx(params.tx);
  } else {
    return prisma.$transaction(runInTx);
  }
}

function getPreviousCompetence(competence: string): string {
  const [year, month] = competence.split("-").map(Number);
  if (month === 1) {
    return `${year - 1}-12`;
  }
  const prevMonth = String(month - 1).padStart(2, "0");
  return `${year}-${prevMonth}`;
}

/**
 * 6. calculateClubSettlement
 * Simula e calcula o rateio financeiro de uma competência.
 */
export async function calculateClubSettlement(params: {
  barbershopId: string;
  competence: string;
  shopSharePercent?: number;
  tx?: Prisma.TransactionClient;
}) {
  const runInTx = async (tx: Prisma.TransactionClient) => {
    // 1. Sum PAID payments
    const payments = await tx.clubSubscriptionPayment.findMany({
      where: {
        barbershopId: params.barbershopId,
        competence: params.competence,
        status: ClubPaymentStatus.PAID,
      },
    });

    let totalRevenueCents = 0;
    let shopAmountCents = 0;
    let poolPortionCents = 0;

    for (const payment of payments) {
      const amtCents = toCents(payment.amount);
      totalRevenueCents += amtCents;

      const shopPct = Number(payment.shopSharePercentSnapshot);
      const shopPortion = Math.round((amtCents * shopPct) / 100);
      const poolPortion = amtCents - shopPortion;

      shopAmountCents += shopPortion;
      poolPortionCents += poolPortion;
    }

    // 1.1. Fetch carry-in from previous competence
    const prevComp = getPreviousCompetence(params.competence);
    const prevSettlement = await tx.clubSettlement.findFirst({
      where: { barbershopId: params.barbershopId, competence: prevComp },
    });
    const carryInAmount = prevSettlement ? prevSettlement.carryOutAmount : new Prisma.Decimal(0);
    const carryInCents = toCents(carryInAmount);
    const totalBarberPoolCents = poolPortionCents + carryInCents;

    // 2. Fetch point entries
    const pointEntries = await tx.clubPointEntry.findMany({
      where: {
        barbershopId: params.barbershopId,
        competence: params.competence,
        status: ClubPointStatus.GENERATED,
        settlementId: null,
      },
    });

    const totalPoints = pointEntries.reduce((sum, p) => sum + Number(p.points), 0);

    // Re-calculation check
    const existingSettlement = await tx.clubSettlement.findFirst({
      where: { barbershopId: params.barbershopId, competence: params.competence },
    });

    if (existingSettlement) {
      if (existingSettlement.status === ClubSettlementStatus.APPROVED) {
        throw new ClubError("SETTLEMENT_APPROVED", "Não é permitido recalcular um fechamento aprovado.", 422);
      }
      if (existingSettlement.status === ClubSettlementStatus.PAID) {
        throw new ClubError("SETTLEMENT_PAID", "Não é permitido alterar um fechamento pago.", 422);
      }

      await tx.clubSettlementMember.deleteMany({
        where: { settlementId: existingSettlement.id },
      });
      await tx.clubSettlement.delete({
        where: { id: existingSettlement.id },
      });
    }

    let carryOutCents = 0;
    if (totalPoints === 0) {
      carryOutCents = totalBarberPoolCents;
    }

    const settlement = await tx.clubSettlement.create({
      data: {
        barbershopId: params.barbershopId,
        competence: params.competence,
        totalRevenue: fromCents(totalRevenueCents),
        shopSharePercent: params.shopSharePercent ?? 50.00,
        shopAmount: fromCents(shopAmountCents),
        barberPoolAmount: fromCents(totalBarberPoolCents),
        carryInAmount: carryInAmount,
        carryOutAmount: fromCents(carryOutCents),
        totalPoints: new Prisma.Decimal(totalPoints),
        status: ClubSettlementStatus.CALCULATED,
      },
    });

    if (pointEntries.length > 0) {
      await tx.clubPointEntry.updateMany({
        where: { id: { in: pointEntries.map((p) => p.id) } },
        data: { settlementId: settlement.id },
      });
    }

    if (totalPoints > 0) {
      const memberPointsMap = new Map<string, number>();
      for (const p of pointEntries) {
        const current = memberPointsMap.get(p.memberId) ?? 0;
        memberPointsMap.set(p.memberId, current + Number(p.points));
      }

      const membersList = Array.from(memberPointsMap.entries()).map(([memberId, points]) => ({
        memberId,
        points,
      }));

      // Sort deterministically by ID to distribute remainder cents
      membersList.sort((a, b) => a.memberId.localeCompare(b.memberId));

      let distributedCents = 0;
      const memberShares = membersList.map((m) => {
        const shareCents = Math.floor((m.points / totalPoints) * totalBarberPoolCents);
        distributedCents += shareCents;
        return {
          memberId: m.memberId,
          points: m.points,
          amountCents: shareCents,
        };
      });

      let remainderCents = totalBarberPoolCents - distributedCents;
      let i = 0;
      while (remainderCents > 0) {
        memberShares[i % memberShares.length].amountCents += 1;
        remainderCents -= 1;
        i += 1;
      }

      await Promise.all(
        memberShares.map((ms) =>
          tx.clubSettlementMember.create({
            data: {
              settlementId: settlement.id,
              memberId: ms.memberId,
              points: new Prisma.Decimal(ms.points),
              amount: fromCents(ms.amountCents),
            },
          })
        )
      );
    }

    return tx.clubSettlement.findUnique({
      where: { id: settlement.id },
      include: {
        members: true,
      },
    });
  };

  if (params.tx) {
    return runInTx(params.tx);
  } else {
    return prisma.$transaction(runInTx);
  }
}

/**
 * 7. approveClubSettlement
 * Aprova o fechamento de rateio, liquidando os pontos associados.
 */
export async function approveClubSettlement(params: {
  barbershopId: string;
  settlementId: string;
  tx?: Prisma.TransactionClient;
}) {
  const runInTx = async (tx: Prisma.TransactionClient) => {
    const settlement = await tx.clubSettlement.findFirst({
      where: { id: params.settlementId, barbershopId: params.barbershopId },
    });

    if (!settlement) {
      throw new ClubError("SETTLEMENT_NOT_FOUND", "Fechamento não encontrado.", 404);
    }

    if (settlement.status !== ClubSettlementStatus.CALCULATED) {
      throw new ClubError("INVALID_STATUS", "Somente fechamentos em status CALCULATED podem ser aprovados.", 400);
    }

    const updated = await tx.clubSettlement.update({
      where: { id: params.settlementId },
      data: { status: ClubSettlementStatus.APPROVED },
      include: { members: true },
    });

    await tx.clubPointEntry.updateMany({
      where: {
        settlementId: params.settlementId,
        barbershopId: params.barbershopId,
        status: ClubPointStatus.GENERATED,
      },
      data: { status: ClubPointStatus.SETTLED },
    });

    return updated;
  };

  if (params.tx) {
    return runInTx(params.tx);
  } else {
    return prisma.$transaction(runInTx);
  }
}

/**
 * 8. markClubSettlementPaid
 * Marca o fechamento de rateio como pago aos barbeiros.
 */
export async function markClubSettlementPaid(params: {
  barbershopId: string;
  settlementId: string;
  tx?: Prisma.TransactionClient;
}) {
  const runInTx = async (tx: Prisma.TransactionClient) => {
    const settlement = await tx.clubSettlement.findFirst({
      where: { id: params.settlementId, barbershopId: params.barbershopId },
    });

    if (!settlement) {
      throw new ClubError("SETTLEMENT_NOT_FOUND", "Fechamento não encontrado.", 404);
    }

    if (settlement.status !== ClubSettlementStatus.APPROVED) {
      throw new ClubError("INVALID_STATUS", "Somente fechamentos em status APPROVED podem ser pagos.", 400);
    }

    const updated = await tx.clubSettlement.update({
      where: { id: params.settlementId },
      data: { status: ClubSettlementStatus.PAID },
      include: { members: true },
    });

    await tx.clubSettlementMember.updateMany({
      where: { settlementId: params.settlementId },
      data: { paidAt: new Date() },
    });

    return updated;
  };

  if (params.tx) {
    return runInTx(params.tx);
  } else {
    return prisma.$transaction(runInTx);
  }
}
