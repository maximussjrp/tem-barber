import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAvailableSlots } from "@/lib/appointments/availability";
import { getTenantSubscription, isSubscriptionActive } from "@/lib/subscription-utils";
import { publicBarbershopWhere, sanitizeBarbershopSlug, isPublicBarbershop } from "@/lib/public-barbershops";

// GET /api/public/barbershop/[slug]/availability
// Query params: memberId, serviceIds (comma-separated), date (YYYY-MM-DD)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const sp = request.nextUrl.searchParams;

  const memberIdParam = sp.get("memberId");
  const serviceIdsParam = sp.get("serviceIds"); // legacy "id1,id2"
  const servicesParam = sp.get("services"); // new "id1:2,id2:1"
  const dateStr = sp.get("date"); // YYYY-MM-DD

  if ((!servicesParam && !serviceIdsParam) || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json(
      { error: "Parâmetros obrigatórios: services ou serviceIds, date (YYYY-MM-DD)." },
      { status: 400 }
    );
  }

  let rawServicesInput: { serviceId: string; quantity: number }[] = [];
  if (servicesParam) {
    const parts = servicesParam.split(",").filter(Boolean);
    parts.forEach((p) => {
      const [id, qtyStr] = p.split(":");
      if (id) {
        const qty = parseInt(qtyStr, 10) || 1;
        rawServicesInput.push({ serviceId: id, quantity: Math.min(5, Math.max(1, qty)) });
      }
    });
  } else if (serviceIdsParam) {
    const ids = serviceIdsParam.split(",").filter(Boolean);
    rawServicesInput = ids.map((id) => ({ serviceId: id, quantity: 1 }));
  }

  // Aggregate duplicate serviceIds, limiting quantity to 5
  const aggregatedMap = new Map<string, number>();
  rawServicesInput.forEach((s) => {
    const existing = aggregatedMap.get(s.serviceId) ?? 0;
    aggregatedMap.set(s.serviceId, Math.min(5, existing + s.quantity));
  });

  const servicesInput = Array.from(aggregatedMap.entries()).map(([serviceId, quantity]) => ({
    serviceId,
    quantity,
  }));
  const serviceIds = servicesInput.map((s) => s.serviceId);

  const safeSlug = sanitizeBarbershopSlug(slug);
  if (!safeSlug) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 404 });
  }

  // Resolve barbershop
  const barbershop = await prisma.barbershop.findFirst({
    where: { ...publicBarbershopWhere(), slug: safeSlug },
  });
  if (!barbershop || !isPublicBarbershop(barbershop)) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 404 });
  }

  // Verificar status de assinatura do tenant
  const subscription = await getTenantSubscription(barbershop.id);
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
    services: servicesInput,
    memberId: memberIdParam || undefined,
  });

  return NextResponse.json({ results, totalDuration });
}
