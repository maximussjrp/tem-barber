import type { Prisma, PrismaClient } from "@prisma/client";

type WaitlistDb = PrismaClient | Prisma.TransactionClient;

export async function getNextQueueNumber(
  db: WaitlistDb,
  sessionId: string
): Promise<number> {
  const maxEntry = await db.onlineWaitlistEntry.findFirst({
    where: { sessionId },
    orderBy: { queueNumber: "desc" },
    select: { queueNumber: true },
  });

  return (maxEntry?.queueNumber ?? 0) + 1;
}

export async function calculateEntryPosition(
  db: WaitlistDb,
  sessionId: string,
  positionWeight: number,
  createdAt: Date
): Promise<number> {
  const aheadCount = await db.onlineWaitlistEntry.count({
    where: {
      sessionId,
      status: "WAITING",
      OR: [
        { positionWeight: { lt: positionWeight } },
        {
          positionWeight,
          createdAt: { lt: createdAt },
        },
      ],
    },
  });

  return aheadCount + 1;
}

export async function moveEntryDownOnePosition(
  db: WaitlistDb,
  entryId: string
): Promise<{ success: boolean; skipCount: number }> {
  const current = await db.onlineWaitlistEntry.findUnique({
    where: { id: entryId },
  });

  if (!current || current.status !== "WAITING") {
    return { success: false, skipCount: current?.skipCount ?? 0 };
  }

  const nextEntry = await db.onlineWaitlistEntry.findFirst({
    where: {
      sessionId: current.sessionId,
      status: "WAITING",
      id: { not: current.id },
      OR: [
        { positionWeight: { gt: current.positionWeight } },
        {
          positionWeight: current.positionWeight,
          createdAt: { gt: current.createdAt },
        },
      ],
    },
    orderBy: [
      { positionWeight: "asc" },
      { createdAt: "asc" },
    ],
  });

  const updatedSkipCount = current.skipCount + 1;

  if (!nextEntry) {
    await db.onlineWaitlistEntry.update({
      where: { id: current.id },
      data: { skipCount: updatedSkipCount },
    });
    return { success: true, skipCount: updatedSkipCount };
  }

  const tempWeight = current.positionWeight;
  const targetWeight = nextEntry.positionWeight === tempWeight ? tempWeight + 10 : nextEntry.positionWeight;

  await db.onlineWaitlistEntry.update({
    where: { id: current.id },
    data: {
      positionWeight: targetWeight,
      skipCount: updatedSkipCount,
      status: updatedSkipCount >= 3 ? "SKIPPED" : "WAITING",
    },
  });

  await db.onlineWaitlistEntry.update({
    where: { id: nextEntry.id },
    data: { positionWeight: tempWeight },
  });

  return { success: true, skipCount: updatedSkipCount };
}

export async function moveEntryToEnd(
  db: WaitlistDb,
  entryId: string
): Promise<{ success: boolean }> {
  const current = await db.onlineWaitlistEntry.findUnique({
    where: { id: entryId },
  });

  if (!current || (current.status !== "WAITING" && current.status !== "CALLED")) {
    return { success: false };
  }

  const maxEntry = await db.onlineWaitlistEntry.findFirst({
    where: { sessionId: current.sessionId },
    orderBy: { positionWeight: "desc" },
    select: { positionWeight: true },
  });

  const newWeight = (maxEntry?.positionWeight ?? current.positionWeight) + 10;

  await db.onlineWaitlistEntry.update({
    where: { id: current.id },
    data: {
      positionWeight: newWeight,
      status: "MOVED_TO_END",
      noShowCount: current.noShowCount + 1,
    },
  });

  return { success: true };
}

export async function passCalledWaitlistEntry(
  db: WaitlistDb,
  entryId: string
) {
  const current = await db.onlineWaitlistEntry.findUnique({ where: { id: entryId } });
  if (!current || current.status !== "CALLED") return null;

  const waitingEntries = await db.onlineWaitlistEntry.findMany({
    where: { sessionId: current.sessionId, status: "WAITING" },
    orderBy: [{ positionWeight: "asc" }, { createdAt: "asc" }],
  });
  const nextIndex = waitingEntries.findIndex(
    (entry) =>
      entry.positionWeight > current.positionWeight ||
      (entry.positionWeight === current.positionWeight && entry.createdAt > current.createdAt)
  );
  const nextEntry = nextIndex >= 0 ? waitingEntries[nextIndex] : null;

  if (!nextEntry) {
    return db.onlineWaitlistEntry.update({
      where: { id: current.id },
      data: {
        status: "WAITING",
        skipCount: { increment: 1 },
        calledByMemberId: null,
        calledAt: null,
        updatedAt: new Date(),
      },
    });
  }

  const hasWeightCollision = waitingEntries.filter(
    (entry) => entry.positionWeight === nextEntry.positionWeight
  ).length > 1 || current.positionWeight === nextEntry.positionWeight;

  if (hasWeightCollision) {
    const desiredOrder = [
      ...waitingEntries.slice(0, nextIndex + 1),
      current,
      ...waitingEntries.slice(nextIndex + 1),
    ];

    for (const [index, entry] of desiredOrder.entries()) {
      if (entry.id === current.id) continue;
      await db.onlineWaitlistEntry.update({
        where: { id: entry.id },
        data: { positionWeight: (index + 1) * 10 },
      });
    }

    return db.onlineWaitlistEntry.update({
      where: { id: current.id },
      data: {
        status: "WAITING",
        positionWeight: (desiredOrder.findIndex((entry) => entry.id === current.id) + 1) * 10,
        skipCount: { increment: 1 },
        calledByMemberId: null,
        calledAt: null,
        updatedAt: new Date(),
      },
    });
  }

  await db.onlineWaitlistEntry.update({
    where: { id: nextEntry.id },
    data: { positionWeight: current.positionWeight },
  });

  return db.onlineWaitlistEntry.update({
    where: { id: current.id },
    data: {
      status: "WAITING",
      positionWeight: nextEntry.positionWeight,
      skipCount: { increment: 1 },
      calledByMemberId: null,
      calledAt: null,
      updatedAt: new Date(),
    },
  });
}
