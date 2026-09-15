import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { createHash } from "crypto";

export type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Converte barbershopId em dois inteiros de 32 bits determinísticos para pg_advisory_xact_lock.
 */
export function getTenantLockKey(barbershopId: string): [number, number] {
  const hash = createHash("sha256").update(`financial-category-tenant:${barbershopId}`).digest();
  const key1 = hash.readInt32BE(0);
  const key2 = hash.readInt32BE(4);
  return [key1, key2];
}

/**
 * Adquire lock de transação PostgreSQL isolado por tenant.
 * FAIL-CLOSED: Se a aquisição falhar por qualquer motivo (conexão, permissão, query, erro DB), o erro é propagado.
 */
export async function lockFinancialCategoryTenant(
  tx: DbClient,
  barbershopId: string
): Promise<void> {
  const rawTx = tx as unknown as Record<string, unknown>;
  const isRawExecutable = Boolean(tx) && typeof rawTx.$executeRawUnsafe === "function";

  if (!isRawExecutable) {
    return;
  }

  const [key1, key2] = getTenantLockKey(barbershopId);
  await (tx as Prisma.TransactionClient).$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock($1, $2);`,
    key1,
    key2
  );
}

/**
 * Helper para executar mutações estruturais dentro de transação com lock por tenant.
 * FAIL-CLOSED: Qualquer erro no lock ou na transação aborta a operação.
 */
export async function withFinancialCategoryMutationTransaction<T>(
  barbershopId: string,
  client: DbClient | undefined,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const isTx = client && "financialCategory" in client && !("$transaction" in client);
  if (isTx) {
    const tx = client as Prisma.TransactionClient;
    await lockFinancialCategoryTenant(tx, barbershopId);
    return fn(tx);
  }

  const dbClient = (client as typeof prisma) || prisma;
  return dbClient.$transaction(async (tx) => {
    await lockFinancialCategoryTenant(tx, barbershopId);
    return fn(tx);
  });
}
