import React from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isPlatformAdmin, getOrCreateSubscription } from "@/lib/subscription-utils";
import { PlatformDashboard } from "@/components/admin/PlatformDashboard";

export const metadata = {
  title: "Plataforma Tem Barber | Admin",
  description: "Gerenciamento de Assinaturas e Clientes",
};

export default async function PlatformAdminPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const role = (session.user as any).role as string;
  const email = session.user?.email as string | null;

  const isPlatform = isPlatformAdmin(email) || role === "SUPER_ADMIN";

  if (!isPlatform) {
    redirect("/acesso-negado");
  }

  // 1. Buscar barbearias com a assinatura mais recente e o membro proprietário
  let barbershops = await prisma.barbershop.findMany({
    include: {
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { plan: true },
      },
      members: {
        where: { role: "OWNER" },
        include: { user: true },
      },
    },
    orderBy: { name: "asc" },
  });

  // 2. Backfill controlado: se houver alguma barbearia sem assinatura, inicializar como TRIAL
  let hasMissing = false;
  for (const shop of barbershops) {
    if (shop.subscriptions.length === 0) {
      await getOrCreateSubscription(shop.id);
      hasMissing = true;
    }
  }

  // 3. Atualizar consulta se realizou algum backfill
  if (hasMissing) {
    barbershops = await prisma.barbershop.findMany({
      include: {
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { plan: true },
        },
        members: {
          where: { role: "OWNER" },
          include: { user: true },
        },
      },
      orderBy: { name: "asc" },
    });
  }

  // 4. Buscar planos ativos para exibir no formulário de edição
  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: { price: "asc" },
  });

  // Converter objetos Prisma para JSON limpo compatível com Next.js Client Component props
  const serializedBarbershops = JSON.parse(JSON.stringify(barbershops));
  const serializedPlans = JSON.parse(JSON.stringify(plans));

  return (
    <PlatformDashboard
      initialBarbershops={serializedBarbershops}
      plans={serializedPlans}
    />
  );
}
