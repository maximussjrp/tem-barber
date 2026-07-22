import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { Prisma } from "@prisma/client";

function parseCommissionRate(val: unknown): { error?: string; rate?: Prisma.Decimal | null } {
  if (val === null || val === undefined || val === "") {
    return { rate: null };
  }
  const str = String(val).replace(",", ".").trim();
  const num = Number(str);
  if (isNaN(num) || !isFinite(num) || num < 0 || num > 100) {
    return { error: "Percentual de comissão deve ser um número entre 0 e 100." };
  }
  return { rate: new Prisma.Decimal(str) };
}

export async function GET() {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data!.barbershopId!;

  const [services, careerLevels, rules] = await Promise.all([
    prisma.service.findMany({
      where: { barbershopId, isActive: true },
      select: {
        id: true,
        name: true,
        price: true,
        categoryId: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    }),
    prisma.careerLevel.findMany({
      where: { barbershopId, active: true },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        defaultCommissionRate: true,
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.serviceCommissionRule.findMany({
      where: { barbershopId, active: true },
      select: {
        id: true,
        serviceId: true,
        careerLevelId: true,
        type: true,
        commissionRate: true,
        active: true,
      },
    }),
  ]);

  return NextResponse.json({ services, careerLevels, rules });
}

export async function PUT(request: Request) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data!.barbershopId!;

  try {
    const body = await request.json();
    const { rules } = body;

    if (!Array.isArray(rules)) {
      return NextResponse.json({ error: "Payload inválido. 'rules' deve ser uma lista." }, { status: 400 });
    }

    // Collect all serviceIds and careerLevelIds to validate tenant isolation
    const serviceIds = Array.from(new Set(rules.map((r) => r.serviceId).filter(Boolean)));
    const careerLevelIds = Array.from(new Set(rules.map((r) => r.careerLevelId).filter(Boolean)));

    if (serviceIds.length > 0) {
      const validServicesCount = await prisma.service.count({
        where: { id: { in: serviceIds as string[] }, barbershopId },
      });
      if (validServicesCount !== serviceIds.length) {
        return NextResponse.json(
          { error: "Operação negada. Foi detectado serviço não pertencente à barbearia." },
          { status: 403 }
        );
      }
    }

    if (careerLevelIds.length > 0) {
      const validLevelsCount = await prisma.careerLevel.count({
        where: { id: { in: careerLevelIds as string[] }, barbershopId },
      });
      if (validLevelsCount !== careerLevelIds.length) {
        return NextResponse.json(
          { error: "Operação negada. Foi detectado nível de carreira não pertencente à barbearia." },
          { status: 403 }
        );
      }
    }

    // Validate rates
    for (const ruleItem of rules) {
      if (!ruleItem.serviceId || !ruleItem.careerLevelId) {
        return NextResponse.json({ error: "serviceId e careerLevelId são obrigatórios." }, { status: 400 });
      }
      if (ruleItem.commissionRate !== null && ruleItem.commissionRate !== undefined && ruleItem.commissionRate !== "") {
        const rateResult = parseCommissionRate(ruleItem.commissionRate);
        if (rateResult.error) {
          return NextResponse.json({ error: rateResult.error }, { status: 400 });
        }
      }
    }

    // Execute in transaction
    await prisma.$transaction(async (tx) => {
      for (const item of rules) {
        const { serviceId, careerLevelId, commissionRate } = item;
        const rateResult = parseCommissionRate(commissionRate);

        if (rateResult.rate === null || rateResult.rate === undefined) {
          // Inactivate existing rule for this cell
          await tx.serviceCommissionRule.updateMany({
            where: { barbershopId, serviceId, careerLevelId },
            data: { active: false },
          });
        } else {
          // Upsert matrix cell rule
          await tx.serviceCommissionRule.upsert({
            where: {
              barbershopId_serviceId_careerLevelId: {
                barbershopId,
                serviceId,
                careerLevelId,
              },
            },
            create: {
              barbershopId,
              serviceId,
              careerLevelId,
              commissionRate: rateResult.rate,
              type: "PERCENTAGE",
              active: true,
            },
            update: {
              commissionRate: rateResult.rate,
              type: "PERCENTAGE",
              active: true,
            },
          });
        }
      }
    });

    return NextResponse.json({ success: true, count: rules.length });
  } catch {
    return NextResponse.json({ error: "Erro ao salvar matriz de comissão." }, { status: 500 });
  }
}
