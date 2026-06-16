import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";

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

  const timeOffs = await prisma.timeOff.findMany({
    where: { memberId: id },
    orderBy: { startDate: "asc" },
  });

  return NextResponse.json(timeOffs);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  if (!(await guardMember(id, data!.barbershopId!))) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { startDate, endDate, reason } = body;

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "Datas de início e fim são obrigatórias." }, { status: 400 });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: "Datas inválidas." }, { status: 400 });
    }

    if (end < start) {
      return NextResponse.json({ error: "A data de fim deve ser após a de início." }, { status: 400 });
    }

    const timeOff = await prisma.timeOff.create({
      data: {
        memberId: id,
        startDate: start,
        endDate: end,
        reason: reason?.trim() || null,
      },
    });

    return NextResponse.json(timeOff, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Erro ao registrar folga." }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;
  const { id } = await params;

  if (!(await guardMember(id, data!.barbershopId!))) {
    return NextResponse.json({ error: "Colaborador não encontrado." }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { timeOffId } = body;

    if (!timeOffId) {
      return NextResponse.json({ error: "timeOffId é obrigatório." }, { status: 400 });
    }

    const timeOff = await prisma.timeOff.findUnique({ where: { id: timeOffId } });
    if (!timeOff || timeOff.memberId !== id) {
      return NextResponse.json({ error: "Folga não encontrada." }, { status: 404 });
    }

    await prisma.timeOff.delete({ where: { id: timeOffId } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Erro ao excluir folga." }, { status: 500 });
  }
}
