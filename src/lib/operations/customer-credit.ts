import { CreditSourceKind, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { fromCents, MoneyValue, positiveCents, toCents } from "./money";
import { OperationalError } from "./comandas";

export async function getCustomerCreditAccount(
  barbershopId: string,
  customerId: string,
  tx?: Prisma.TransactionClient
) {
  const client = tx || prisma;

  let link = await client.customerBarbershopLink.findUnique({
    where: { barbershopId_customerId: { barbershopId, customerId } },
  });

  if (!link) {
    const user = await client.user.findUnique({ where: { id: customerId } });
    if (!user) {
      throw new OperationalError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404);
    }
    try {
      link = await client.customerBarbershopLink.create({
        data: { barbershopId, customerId },
      });
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e?.code === "P2002" || e?.message?.includes("Unique constraint")) {
        link = await client.customerBarbershopLink.findUnique({
          where: { barbershopId_customerId: { barbershopId, customerId } },
        });
      } else {
        throw err;
      }
    }
  }

  let account = await client.customerCreditAccount.findUnique({
    where: { barbershopId_customerId: { barbershopId, customerId } },
  });

  if (!account) {
    try {
      account = await client.customerCreditAccount.create({
        data: {
          barbershopId,
          customerId,
          balance: 0,
        },
      });
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e?.code === "P2002" || e?.message?.includes("Unique constraint")) {
        account = await client.customerCreditAccount.findUnique({
          where: { barbershopId_customerId: { barbershopId, customerId } },
        });
      } else {
        throw err;
      }
    }
  }

  if (!account) {
    throw new OperationalError("CREDIT_ACCOUNT_NOT_FOUND", "Conta de crédito não encontrada.", 404);
  }

  return account;
}

export async function lockCustomerCreditAccount(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  customerId: string
) {
  await getCustomerCreditAccount(barbershopId, customerId, tx);

  const rows = await tx.$queryRaw<Array<{ id: string; balance: string }>>`
    SELECT id, balance
    FROM customer_credit_accounts
    WHERE barbershop_id = ${barbershopId} AND customer_id = ${customerId}
    FOR UPDATE;
  `;

  if (!rows || rows.length === 0) {
    throw new OperationalError("CREDIT_ACCOUNT_NOT_FOUND", "Conta de crédito não encontrada.", 404);
  }

  return rows[0];
}

export async function grantCustomerCredit(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    customerId: string;
    amount: MoneyValue;
    description: string;
    sourceKind?: CreditSourceKind;
    createdByUserId: string;
    idempotencyKey?: string | null;
  }
) {
  const amountCents = positiveCents(input.amount, "Concessão de crédito");
  const sourceKind = input.sourceKind || "MANUAL_GRANT";

  if (input.idempotencyKey) {
    const existing = await tx.customerCreditEntry.findFirst({
      where: { barbershopId: input.barbershopId, idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (toCents(existing.amount) !== amountCents) {
        throw new OperationalError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "A chave de idempotência já foi utilizada com parâmetros diferentes.",
          409
        );
      }
      return tx.customerCreditAccount.findUnique({
        where: { id: existing.accountId },
      });
    }
  }

  await lockCustomerCreditAccount(tx, input.barbershopId, input.customerId);

  if (input.idempotencyKey) {
    const existingUnderLock = await tx.customerCreditEntry.findFirst({
      where: { barbershopId: input.barbershopId, idempotencyKey: input.idempotencyKey },
    });
    if (existingUnderLock) {
      if (toCents(existingUnderLock.amount) !== amountCents) {
        throw new OperationalError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "A chave de idempotência já foi utilizada com parâmetros diferentes.",
          409
        );
      }
      return tx.customerCreditAccount.findUnique({
        where: { id: existingUnderLock.accountId },
      });
    }
  }

  const account = await tx.customerCreditAccount.findUnique({
    where: { barbershopId_customerId: { barbershopId: input.barbershopId, customerId: input.customerId } },
  });
  if (!account) throw new OperationalError("CREDIT_ACCOUNT_NOT_FOUND", "Conta de crédito não encontrada.", 404);

  const newBalanceCents = toCents(account.balance) + amountCents;

  const updatedAccount = await tx.customerCreditAccount.update({
    where: { id: account.id },
    data: { balance: fromCents(newBalanceCents) },
  });

  await tx.customerCreditEntry.create({
    data: {
      accountId: account.id,
      barbershopId: input.barbershopId,
      type: "CREDIT",
      sourceKind,
      amount: fromCents(amountCents),
      balanceAfter: fromCents(newBalanceCents),
      description: input.description || "Concessão manual de crédito",
      createdByUserId: input.createdByUserId,
      idempotencyKey: input.idempotencyKey || null,
    },
  });

  return updatedAccount;
}

export async function adjustCustomerCredit(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    customerId: string;
    type: "CREDIT" | "DEBIT";
    amount: MoneyValue;
    description: string;
    createdByUserId: string;
    idempotencyKey?: string | null;
  }
) {
  const amountCents = positiveCents(input.amount, "Ajuste de crédito");

  if (input.idempotencyKey) {
    const existing = await tx.customerCreditEntry.findFirst({
      where: { barbershopId: input.barbershopId, idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (toCents(existing.amount) !== amountCents || existing.type !== input.type) {
        throw new OperationalError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "A chave de idempotência já foi utilizada com parâmetros diferentes.",
          409
        );
      }
      return tx.customerCreditAccount.findUnique({
        where: { id: existing.accountId },
      });
    }
  }

  await lockCustomerCreditAccount(tx, input.barbershopId, input.customerId);

  if (input.idempotencyKey) {
    const existingUnderLock = await tx.customerCreditEntry.findFirst({
      where: { barbershopId: input.barbershopId, idempotencyKey: input.idempotencyKey },
    });
    if (existingUnderLock) {
      if (toCents(existingUnderLock.amount) !== amountCents || existingUnderLock.type !== input.type) {
        throw new OperationalError(
          "IDEMPOTENCY_KEY_CONFLICT",
          "A chave de idempotência já foi utilizada com parâmetros diferentes.",
          409
        );
      }
      return tx.customerCreditAccount.findUnique({
        where: { id: existingUnderLock.accountId },
      });
    }
  }

  const account = await tx.customerCreditAccount.findUnique({
    where: { barbershopId_customerId: { barbershopId: input.barbershopId, customerId: input.customerId } },
  });
  if (!account) throw new OperationalError("CREDIT_ACCOUNT_NOT_FOUND", "Conta de crédito não encontrada.", 404);

  const currentBalanceCents = toCents(account.balance);
  let newBalanceCents: number;

  if (input.type === "DEBIT") {
    if (currentBalanceCents < amountCents) {
      throw new OperationalError(
        "INSUFFICIENT_CREDIT_BALANCE",
        "Saldo de crédito insuficiente para realizar o ajuste de débito.",
        422
      );
    }
    newBalanceCents = currentBalanceCents - amountCents;
  } else {
    newBalanceCents = currentBalanceCents + amountCents;
  }

  const updatedAccount = await tx.customerCreditAccount.update({
    where: { id: account.id },
    data: { balance: fromCents(newBalanceCents) },
  });

  await tx.customerCreditEntry.create({
    data: {
      accountId: account.id,
      barbershopId: input.barbershopId,
      type: input.type,
      sourceKind: "ADJUSTMENT",
      amount: fromCents(amountCents),
      balanceAfter: fromCents(newBalanceCents),
      description: input.description || `Ajuste administrativo (${input.type === "CREDIT" ? "crédito" : "débito"})`,
      createdByUserId: input.createdByUserId,
      idempotencyKey: input.idempotencyKey || null,
    },
  });

  return updatedAccount;
}

export async function consumeCustomerCredit(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    customerId: string;
    amount: MoneyValue;
    comandaId: string;
    paymentId: string;
    createdByUserId: string;
    idempotencyKey?: string | null;
  }
) {
  const amountCents = positiveCents(input.amount, "Consumo de crédito");

  if (input.idempotencyKey) {
    const existing = await tx.customerCreditEntry.findFirst({
      where: { barbershopId: input.barbershopId, idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return tx.customerCreditAccount.findUnique({
        where: { id: existing.accountId },
      });
    }
  }

  await lockCustomerCreditAccount(tx, input.barbershopId, input.customerId);

  if (input.idempotencyKey) {
    const existingUnderLock = await tx.customerCreditEntry.findFirst({
      where: { barbershopId: input.barbershopId, idempotencyKey: input.idempotencyKey },
    });
    if (existingUnderLock) {
      return tx.customerCreditAccount.findUnique({
        where: { id: existingUnderLock.accountId },
      });
    }
  }

  const account = await tx.customerCreditAccount.findUnique({
    where: { barbershopId_customerId: { barbershopId: input.barbershopId, customerId: input.customerId } },
  });
  if (!account) throw new OperationalError("CREDIT_ACCOUNT_NOT_FOUND", "Conta de crédito não encontrada.", 404);

  const currentBalanceCents = toCents(account.balance);
  if (currentBalanceCents < amountCents) {
    throw new OperationalError(
      "INSUFFICIENT_CREDIT_BALANCE",
      "Saldo de crédito insuficiente para realizar o pagamento.",
      422
    );
  }

  const newBalanceCents = currentBalanceCents - amountCents;

  const updatedAccount = await tx.customerCreditAccount.update({
    where: { id: account.id },
    data: { balance: fromCents(newBalanceCents) },
  });

  await tx.customerCreditEntry.create({
    data: {
      accountId: account.id,
      barbershopId: input.barbershopId,
      type: "DEBIT",
      sourceKind: "COMANDA_PAYMENT",
      amount: fromCents(amountCents),
      balanceAfter: fromCents(newBalanceCents),
      description: `Pagamento da comanda ${input.comandaId.split("-")[0]}`,
      comandaId: input.comandaId,
      paymentId: input.paymentId,
      createdByUserId: input.createdByUserId,
      idempotencyKey: input.idempotencyKey || null,
    },
  });

  return updatedAccount;
}

export async function refundToCustomerCredit(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    customerId: string;
    amount: MoneyValue;
    comandaId?: string;
    paymentId: string;
    createdByUserId: string;
    idempotencyKey?: string | null;
  }
) {
  const amountCents = positiveCents(input.amount, "Estorno para crédito");

  if (input.idempotencyKey) {
    const existing = await tx.customerCreditEntry.findFirst({
      where: { barbershopId: input.barbershopId, idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return tx.customerCreditAccount.findUnique({
        where: { id: existing.accountId },
      });
    }
  }

  await lockCustomerCreditAccount(tx, input.barbershopId, input.customerId);

  if (input.idempotencyKey) {
    const existingUnderLock = await tx.customerCreditEntry.findFirst({
      where: { barbershopId: input.barbershopId, idempotencyKey: input.idempotencyKey },
    });
    if (existingUnderLock) {
      return tx.customerCreditAccount.findUnique({
        where: { id: existingUnderLock.accountId },
      });
    }
  }

  const account = await tx.customerCreditAccount.findUnique({
    where: { barbershopId_customerId: { barbershopId: input.barbershopId, customerId: input.customerId } },
  });
  if (!account) throw new OperationalError("CREDIT_ACCOUNT_NOT_FOUND", "Conta de crédito não encontrada.", 404);

  const newBalanceCents = toCents(account.balance) + amountCents;

  const updatedAccount = await tx.customerCreditAccount.update({
    where: { id: account.id },
    data: { balance: fromCents(newBalanceCents) },
  });

  await tx.customerCreditEntry.create({
    data: {
      accountId: account.id,
      barbershopId: input.barbershopId,
      type: "CREDIT",
      sourceKind: "REFUND_TO_CREDIT",
      amount: fromCents(amountCents),
      balanceAfter: fromCents(newBalanceCents),
      description: `Estorno convertido em crédito (Pagamento ${input.paymentId.split("-")[0]})`,
      comandaId: input.comandaId || null,
      paymentId: input.paymentId,
      createdByUserId: input.createdByUserId,
      idempotencyKey: input.idempotencyKey || null,
    },
  });

  return updatedAccount;
}

export async function reconcileCustomerCreditBalance(
  barbershopId: string,
  customerId: string,
  tx?: Prisma.TransactionClient
) {
  const client = tx || prisma;
  const account = await client.customerCreditAccount.findUnique({
    where: { barbershopId_customerId: { barbershopId, customerId } },
    include: { entries: true },
  });

  if (!account) {
    return { isBalanced: true, accountBalance: 0, ledgerBalance: 0, drift: 0 };
  }

  let ledgerCents = 0;
  for (const entry of account.entries) {
    const cents = toCents(entry.amount);
    if (entry.type === "CREDIT") ledgerCents += cents;
    else if (entry.type === "DEBIT") ledgerCents -= cents;
  }

  const accountCents = toCents(account.balance);
  const driftCents = accountCents - ledgerCents;

  return {
    isBalanced: driftCents === 0,
    accountBalance: Number((accountCents / 100).toFixed(2)),
    ledgerBalance: Number((ledgerCents / 100).toFixed(2)),
    drift: Number((driftCents / 100).toFixed(2)),
  };
}
