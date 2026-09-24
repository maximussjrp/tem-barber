import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getOperationalStaffSession } from "@/lib/operational-session";
import { deleteScheduleBlock } from "@/lib/schedule-blocks";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getOperationalStaffSession({ requiredPermission: "AGENDA_BLOCK_ALL" });
  if (error) return error;

  const { id } = await params;

  if (!data!.barbershopId) {
    return NextResponse.json({ error: "Sem barbearia vinculada." }, { status: 403 });
  }

  const timeOff = await prisma.timeOff.findUnique({
    where: { id },
    include: {
      member: { select: { id: true, barbershopId: true } },
    },
  });

  if (!timeOff || timeOff.member.barbershopId !== data!.barbershopId) {
    return NextResponse.json({ error: "Bloqueio não encontrado." }, { status: 404 });
  }

  if (data!.role === "BARBER" && data!.memberId !== timeOff.memberId) {
    return NextResponse.json(
      { error: "Você só pode excluir bloqueios da sua própria agenda." },
      { status: 403 }
    );
  }

  await prisma.$transaction((tx: any) =>
    deleteScheduleBlock(tx, {
      barbershopId: data!.barbershopId!,
      timeOffId: id,
      ...(data!.role === "BARBER" && data!.memberId ? { memberId: data!.memberId } : {}),
    })
  );

  return NextResponse.json({ success: true });
}
