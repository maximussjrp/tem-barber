import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { checkMemberPermission } from "@/lib/permissions/engine";

async function guardMember(memberId: string, barbershopId: string) {
  const m = await prisma.barbershopMember.findUnique({ where: { id: memberId } });
  return m && m.barbershopId === barbershopId ? m : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  if (!(await guardMember(id, data!.barbershopId!))) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  // Return current service IDs linked to this barber
  const barberServices = await prisma.barberService.findMany({
    where: { barberId: id },
    select: { serviceId: true },
  });

  return NextResponse.json(barberServices.map((bs) => bs.serviceId));
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  // Permissões: OWNER e SUPER_ADMIN têm acesso direto. MANAGER exige SERVICES_MANAGE.
  if (data!.role === "OWNER" || data!.role === "SUPER_ADMIN") {
    // Permitido
  } else if (data!.role === "MANAGER") {
    if (!data!.memberId) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }
    const hasPermission = await checkMemberPermission(
      data!.memberId,
      data!.role,
      "SERVICES_MANAGE"
    );
    if (!hasPermission) {
      return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const { id } = await params;

  if (!(await guardMember(id, data!.barbershopId!))) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { serviceIds } = body as { serviceIds: string[] };

    if (!Array.isArray(serviceIds)) {
      return NextResponse.json({ error: "serviceIds deve ser um array." }, { status: 400 });
    }

    // Validate all services belong to this barbershop
    if (serviceIds.length > 0) {
      const valid = await prisma.service.count({
        where: { id: { in: serviceIds }, barbershopId: data!.barbershopId! },
      });
      if (valid !== serviceIds.length) {
        return NextResponse.json({ error: "Um ou mais serviços são inválidos." }, { status: 400 });
      }
    }

    await prisma.$transaction([
      prisma.barberService.deleteMany({ where: { barberId: id } }),
      ...(serviceIds.length > 0
        ? [
            prisma.barberService.createMany({
              data: serviceIds.map((serviceId) => ({ barberId: id, serviceId })),
            }),
          ]
        : []),
    ]);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Erro ao salvar serviços." }, { status: 500 });
  }
}
