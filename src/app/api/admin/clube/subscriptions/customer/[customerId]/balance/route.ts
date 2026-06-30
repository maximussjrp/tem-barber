import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getActiveCustomerClubSubscription, getClubBenefitsBalance } from "@/lib/operations/club";
import { requireOperationalSession } from "@/lib/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { customerId } = await params;

  try {
    const activeSubs = await prisma.customerClubSubscription.findMany({
      where: {
        barbershopId: data.barbershopId,
        customerId,
        status: { in: ["ACTIVE", "GRACE_PERIOD"] },
        currentPeriodStart: { lte: new Date() },
        currentPeriodEnd: { gt: new Date() },
      },
      include: { clubPlan: true },
    });

    if (activeSubs.length === 0) {
      const inactiveSub = await prisma.customerClubSubscription.findFirst({
        where: {
          barbershopId: data.barbershopId,
          customerId,
        },
        orderBy: { updatedAt: "desc" },
        include: { clubPlan: true },
      });

      if (inactiveSub) {
        return NextResponse.json({
          status: inactiveSub.status,
          clubPlan: {
            id: inactiveSub.clubPlan.id,
            name: inactiveSub.clubPlan.name,
          },
          benefits: [],
        });
      }

      return NextResponse.json({ benefits: [] });
    }

    // Sort deterministically in memory
    activeSubs.sort((a, b) => {
      if (a.status === "ACTIVE" && b.status === "GRACE_PERIOD") return -1;
      if (a.status === "GRACE_PERIOD" && b.status === "ACTIVE") return 1;

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

    const activeSub = activeSubs[0];

    const balance = await getClubBenefitsBalance({
      barbershopId: data.barbershopId,
      subscriptionId: activeSub.id,
      atDate: new Date(),
    });

    const responsePayload: any = {
      ...balance,
      status: activeSub.status,
    };

    if (activeSubs.length > 1) {
      responsePayload.duplicateActiveSubscriptions = true;
      responsePayload.duplicateCount = activeSubs.length;
    }

    return NextResponse.json(responsePayload);
  } catch (err: any) {
    return NextResponse.json({ error: "INTERNAL_ERROR", message: err.message || "Erro ao consultar benefícios do cliente." }, { status: 500 });
  }
}
