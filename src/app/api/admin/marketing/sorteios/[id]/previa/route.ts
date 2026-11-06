import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { calculateSweepstakeEligibility } from "@/lib/marketing/sweepstake-engine";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não identificada." }, { status: 403 });
  }
  const { id } = await context.params;

  const sweepstake = await prisma.customerSweepstake.findUnique({
    where: { id_barbershopId: { id, barbershopId } },
  });

  if (!sweepstake) {
    return NextResponse.json({ error: "Campanha de sorteio não encontrada." }, { status: 404 });
  }

  // Permite passar parâmetros opcionais no body para teste antes de salvar
  let customFilter: any = {};
  try {
    customFilter = await request.json();
  } catch {
    // Body vazio é aceitável, usa dados do sweepstake
  }

  const startDateCivil = customFilter.startDateCivil || sweepstake.startDateCivil;
  const endDateCivil = customFilter.endDateCivil || sweepstake.endDateCivil;
  const participationMode = customFilter.participationMode || sweepstake.participationMode;
  const targetSegment = customFilter.targetSegment || sweepstake.targetSegment;
  const serviceIds = customFilter.serviceIds !== undefined ? customFilter.serviceIds : (sweepstake.serviceIds as string[] | null);

  try {
    const preview = await prisma.$transaction(async (tx) => {
      return calculateSweepstakeEligibility(tx, {
        barbershopId,
        startDateCivil,
        endDateCivil,
        participationMode,
        targetSegment,
        serviceIds,
      });
    });

    return NextResponse.json({ preview });
  } catch (err: any) {
    console.error("Erro ao calcular prévia do sorteio:", err);
    return NextResponse.json({ error: err.message || "Erro ao calcular prévia." }, { status: 500 });
  }
}
