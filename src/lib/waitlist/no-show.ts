import prisma from "@/lib/prisma";

export class WaitlistNoShowError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "WaitlistNoShowError";
  }
}

interface MarkWaitlistEntryNoShowInput {
  barbershopId: string;
  entryId: string;
  expectedMemberId?: string;
}

export async function markWaitlistEntryNoShow(input: MarkWaitlistEntryNoShowInput) {
  const entry = await prisma.onlineWaitlistEntry.findFirst({
    where: { id: input.entryId, barbershopId: input.barbershopId },
  });

  if (!entry) {
    throw new WaitlistNoShowError(
      "WAITLIST_ENTRY_NOT_FOUND",
      "Entrada da fila não encontrada.",
      404
    );
  }

  if (entry.status !== "CALLED" || entry.fitInAppointmentId !== null) {
    throw new WaitlistNoShowError(
      "WAITLIST_ENTRY_NOT_CALLED",
      "Somente um cliente chamado e ainda não iniciado pode ser marcado como não compareceu.",
      409
    );
  }

  if (!entry.calledByMemberId) {
    throw new WaitlistNoShowError(
      "WAITLIST_ENTRY_NOT_ASSIGNED",
      "A entrada chamada não possui um profissional responsável.",
      409
    );
  }

  if (input.expectedMemberId && entry.calledByMemberId !== input.expectedMemberId) {
    throw new WaitlistNoShowError(
      "WAITLIST_ENTRY_NOT_ASSIGNED",
      "Este cliente foi chamado por outro profissional.",
      403
    );
  }

  const updateResult = await prisma.onlineWaitlistEntry.updateMany({
    where: {
      id: entry.id,
      barbershopId: input.barbershopId,
      status: "CALLED",
      calledByMemberId: entry.calledByMemberId,
      fitInAppointmentId: null,
    },
    data: {
      status: "NO_SHOW",
      noShowCount: { increment: 1 },
      updatedAt: new Date(),
    },
  });

  if (updateResult.count === 0) {
    throw new WaitlistNoShowError(
      "WAITLIST_ENTRY_ALREADY_UPDATED",
      "A entrada já foi atualizada.",
      409
    );
  }

  const updatedEntry = await prisma.onlineWaitlistEntry.findUnique({
    where: { id: entry.id },
  });

  if (!updatedEntry) {
    throw new WaitlistNoShowError(
      "WAITLIST_ENTRY_NOT_FOUND",
      "Entrada da fila não encontrada após a atualização.",
      409
    );
  }

  return { entry: updatedEntry };
}
