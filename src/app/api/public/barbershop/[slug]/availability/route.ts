import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAvailableSlots } from "@/lib/appointments/availability";
import { getOrCreateSubscription, isSubscriptionActive } from "@/lib/subscription-utils";

// GET /api/public/barbershop/[slug]/availability
// Query params: memberId, serviceIds (comma-separated), date (YYYY-MM-DD)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const sp = request.nextUrl.searchParams;

  const memberIdParam = sp.get("memberId");
  const serviceIdsParam = sp.get("serviceIds"); // "id1,id2"
  const dateStr = sp.get("date"); // YYYY-MM-DD

  if (!serviceIdsParam || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json(
      { error: "Parâmetros obrigatórios: serviceIds, date (YYYY-MM-DD)." },
      { status: 400 }
    );
  }

  const serviceIds = serviceIdsParam.split(",").filter(Boolean);

  // Resolve barbershop
  const barbershop = await prisma.barbershop.findUnique({
    where: { slug, active: true },
  });
  if (!barbershop) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 404 });
  }

  // Verificar status de assinatura do tenant
  const subscription = await getOrCreateSubscription(barbershop.id);
  if (!isSubscriptionActive(subscription)) {
    return NextResponse.json(
      { error: "SUBSCRIPTION_SUSPENDED", message: "Esta barbearia está temporariamente indisponível para agendamentos." },
      { status: 403 }
    );
  }

  const { results, totalDuration } = await getAvailableSlots({
    barbershopId: barbershop.id,
    dateStr,
    serviceIds,
    memberId: memberIdParam || undefined,
  });

  return NextResponse.json({ results, totalDuration });
}
