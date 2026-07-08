import { Prisma } from "@prisma/client";

/**
 * Checks if an error is a serializable transaction conflict or deadlock error
 * and should trigger a transaction retry.
 */
export function isRetryableTransactionError(error: unknown): boolean {
  if (!error) return false;

  // 1. Caso A: Prisma P2034 (conflito de escrita serializado nativo do Prisma)
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") {
      return true;
    }

    // 2. Caso B: Prisma P2010 (erro de query crua) com SQLSTATE 40001 (serialization) ou 40P01 (deadlock)
    if (error.code === "P2010") {
      const meta = error.meta as Record<string, unknown> | undefined;
      const driverError = meta?.driverAdapterError as Record<string, unknown> | undefined;
      const cause = driverError?.cause as Record<string, unknown> | undefined;
      const originalCode = driverError?.originalCode || cause?.originalCode;
      if (originalCode === "40001" || originalCode === "40P01") {
        return true;
      }
    }
  }

  // 3. Caso C e D: Erro direto ou encapsulado com código estrutural 40001 ou 40P01 ou TransactionWriteConflict
  if (typeof error === "object" && error !== null) {
    const errObj = error as Record<string, unknown>;
    const cause = errObj.cause as Record<string, unknown> | undefined;
    const meta = errObj.meta as Record<string, unknown> | undefined;
    const driverAdapterError = meta?.driverAdapterError as Record<string, unknown> | undefined;
    const driverCause = driverAdapterError?.cause as Record<string, unknown> | undefined;

    const structuralCode =
      errObj.code ||
      errObj.originalCode ||
      cause?.originalCode ||
      meta?.originalCode ||
      driverAdapterError?.originalCode ||
      driverCause?.originalCode;

    if (structuralCode === "40001" || structuralCode === "40P01" || structuralCode === 40001) {
      return true;
    }

    const driverAdapterKind = driverAdapterError?.kind || driverCause?.kind;
    if (driverAdapterKind === "TransactionWriteConflict") {
      return true;
    }

    // 5. Fallback legado de mensagem
    const msg = String(errObj.message ?? "");
    if (
      msg.includes("TransactionWriteConflict") ||
      msg.includes("could not serialize access") ||
      msg.includes("write conflict") ||
      msg.includes("deadlock")
    ) {
      return true;
    }
  }

  // 5. Fallback legado (apenas strings em inglês)
  const errStr = String(error);
  if (
    errStr.includes("TransactionWriteConflict") ||
    errStr.includes("WriteConflict") ||
    errStr.includes("could not serialize access") ||
    errStr.includes("write conflict") ||
    errStr.includes("deadlock")
  ) {
    return true;
  }

  return false;
}
