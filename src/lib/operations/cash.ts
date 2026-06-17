import { Prisma } from "@prisma/client";
import { OperationalError } from "./comandas";
import { fromCents, positiveCents, toCents } from "./money";

export async function getCurrentCashSession(tx: Prisma.TransactionClient, barbershopId: string) {
  return tx.cashSession.findFirst({
    where: { barbershopId, status: "OPEN" },
    include: { movements: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
}

export async function openCashSession(
  tx: Prisma.TransactionClient,
  input: { barbershopId: string; userId: string; openingAmount: string | number }
) {
  const existing = await tx.cashSession.findFirst({
    where: { barbershopId: input.barbershopId, status: "OPEN" },
  });
  if (existing) throw new OperationalError("CASH_ALREADY_OPEN", "Ja existe caixa aberto.", 409);

  const opening = positiveCents(input.openingAmount, "Valor inicial");
  return tx.cashSession.create({
    data: {
      barbershopId: input.barbershopId,
      openedById: input.userId,
      openingAmount: fromCents(opening),
      expectedAmount: fromCents(opening),
    },
    include: { movements: true },
  });
}

export async function closeCashSession(
  tx: Prisma.TransactionClient,
  input: { barbershopId: string; cashSessionId: string; userId: string; closingAmount: string | number }
) {
  const session = await tx.cashSession.findFirst({
    where: { id: input.cashSessionId, barbershopId: input.barbershopId, status: "OPEN" },
    include: { movements: true },
  });
  if (!session) throw new OperationalError("CASH_NOT_FOUND", "Caixa aberto nao encontrado.", 404);

  const movements = session.movements.reduce((sum, movement) => sum + toCents(movement.amount), 0);
  const expected = toCents(session.openingAmount) + movements;
  const closing = toCents(input.closingAmount);

  return tx.cashSession.update({
    where: { id: session.id },
    data: {
      status: "CLOSED",
      closedById: input.userId,
      closingAmount: fromCents(closing),
      expectedAmount: fromCents(expected),
      difference: fromCents(closing - expected),
      closedAt: new Date(),
    },
    include: { movements: true },
  });
}

