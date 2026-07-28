import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMemberSession } from "@/lib/member-api-auth";
import { deleteScheduleBlock } from "@/lib/schedule-blocks";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getMemberSession();
  if (error) return error;

  const { id } = await params;

  try {
    await prisma.$transaction((tx) =>
      deleteScheduleBlock(tx, {
        barbershopId: data!.barbershopId,
        memberId: data!.memberId,
        timeOffId: id,
      })
    );
  } catch (err) {
    if (err instanceof Error && err.message === "SCHEDULE_BLOCK_NOT_FOUND") {
      return NextResponse.json({ error: "Bloqueio nao encontrado." }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ success: true });
}
