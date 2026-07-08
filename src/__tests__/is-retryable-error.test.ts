import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { isRetryableTransactionError } from "../lib/transactions/is-retryable-transaction-error";

describe("isRetryableTransactionError unit tests", () => {
  const clientVersion = "7.8.0";

  // Helper to create PrismaClientKnownRequestError
  function createPrismaError(code: string, message: string, meta?: Record<string, unknown>) {
    return new Prisma.PrismaClientKnownRequestError(message, {
      code,
      clientVersion,
      meta,
    });
  }

  // 1. P2034 => true
  it("should return true for Prisma P2034 write conflict error", () => {
    const err = createPrismaError("P2034", "Transaction write conflict");
    expect(isRetryableTransactionError(err)).toBe(true);
  });

  // 2. P2010 + nested originalCode 40001 + English message => true
  it("should return true for P2010 raw query failure with underlying 40001 and English message", () => {
    const err = createPrismaError("P2010", "Raw query failed. Code: 40001. Message: could not serialize access due to read/write dependencies", {
      driverAdapterError: {
        cause: {
          originalCode: "40001",
          originalMessage: "could not serialize access due to read/write dependencies",
          kind: "TransactionWriteConflict",
        },
      },
    });
    expect(isRetryableTransactionError(err)).toBe(true);
  });

  // 3. P2010 + nested originalCode 40001 + Portuguese message => true
  it("should return true for P2010 raw query failure with underlying 40001 and Portuguese message", () => {
    const err = createPrismaError("P2010", "Raw query failed. Code: 40001. Message: não foi possível serializar acesso devido a dependências", {
      driverAdapterError: {
        cause: {
          originalCode: "40001",
          originalMessage: "não foi possível serializar acesso devido a dependências",
          kind: "TransactionWriteConflict",
        },
      },
    });
    expect(isRetryableTransactionError(err)).toBe(true);
  });

  // 4. P2010 + nested originalCode 40001 + arbitrary message => true
  it("should return true for P2010 raw query failure with underlying 40001 and arbitrary message", () => {
    const err = createPrismaError("P2010", "Raw query failed", {
      driverAdapterError: {
        cause: {
          originalCode: "40001",
          originalMessage: "some random error message",
        },
      },
    });
    expect(isRetryableTransactionError(err)).toBe(true);
  });

  // 5. P2010 + nested originalCode 40P01 => true
  it("should return true for P2010 raw query failure with underlying 40P01 (deadlock)", () => {
    const err = createPrismaError("P2010", "Raw query failed", {
      driverAdapterError: {
        cause: {
          originalCode: "40P01",
          originalMessage: "deadlock detected",
        },
      },
    });
    expect(isRetryableTransactionError(err)).toBe(true);
  });

  // 6. P2010 + outro SQLSTATE => false
  it("should return false for P2010 with a different SQLSTATE code (e.g., 23505 unique violation)", () => {
    const err = createPrismaError("P2010", "Raw query failed", {
      driverAdapterError: {
        cause: {
          originalCode: "23505",
          originalMessage: "duplicate key value violates unique constraint",
        },
      },
    });
    expect(isRetryableTransactionError(err)).toBe(false);
  });

  // 7. P2010 sem SQLSTATE retryable => false
  it("should return false for P2010 without any retryable SQLSTATE", () => {
    const err = createPrismaError("P2010", "Table not found", {});
    expect(isRetryableTransactionError(err)).toBe(false);
  });

  // 8. Erro direto 40001 => true
  it("should return true for a direct error object with code 40001", () => {
    const err = { code: "40001", message: "Serialization conflict" };
    expect(isRetryableTransactionError(err)).toBe(true);
  });

  // 9. Erro direto 40P01 => true
  it("should return true for a direct error object with code 40P01", () => {
    const err = { originalCode: "40P01", message: "Deadlock conflict" };
    expect(isRetryableTransactionError(err)).toBe(true);
  });

  // 10. driverAdapterError.cause.kind = TransactionWriteConflict => true
  it("should return true when driverAdapterError.cause.kind is TransactionWriteConflict", () => {
    const err = createPrismaError("P2010", "Raw query failed", {
      driverAdapterError: {
        cause: {
          kind: "TransactionWriteConflict",
        },
      },
    });
    expect(isRetryableTransactionError(err)).toBe(true);
  });

  // 11. Erro comum => false
  it("should return false for a common generic error", () => {
    const err = new Error("Connection timed out");
    expect(isRetryableTransactionError(err)).toBe(false);
  });

  // 12. Mensagem contendo palavras parecidas sem código/kind estrutural correto => fallback legado check
  it("should fallback to true on legacy human message strings even without structural properties", () => {
    const err1 = new Error("database deadlock detected");
    expect(isRetryableTransactionError(err1)).toBe(true);

    const err2 = new Error("could not serialize access to database");
    expect(isRetryableTransactionError(err2)).toBe(true);

    // Unrelated words shouldn't trigger it
    const err3 = new Error("serialized data format");
    expect(isRetryableTransactionError(err3)).toBe(false);
  });

  // 13. Objeto malformado => false (não deve explodir)
  it("should return false and not throw when checking malformed objects, null, undefined or numbers", () => {
    expect(isRetryableTransactionError(null)).toBe(false);
    expect(isRetryableTransactionError(undefined)).toBe(false);
    expect(isRetryableTransactionError(42)).toBe(false);
    expect(isRetryableTransactionError("string_only")).toBe(false);
    expect(isRetryableTransactionError({})).toBe(false);
  });

  // 14. meta = null => false (não deve explodir)
  it("should return false when meta is null and no other signals are present", () => {
    const err = createPrismaError("P2010", "Error");
    (err as unknown as { meta: null | undefined }).meta = null;
    expect(isRetryableTransactionError(err)).toBe(false);
  });

  // 15. driverAdapterError = {} => não lançar
  it("should not throw when driverAdapterError is empty object", () => {
    const err = createPrismaError("P2010", "Error", { driverAdapterError: {} });
    expect(isRetryableTransactionError(err)).toBe(false);
  });

  // 16. cause = null => não lançar
  it("should not throw when cause inside driverAdapterError is null", () => {
    const err = createPrismaError("P2010", "Error", {
      driverAdapterError: { cause: null },
    });
    expect(isRetryableTransactionError(err)).toBe(false);
  });

  // 17. Teste específico contra falso positivo
  it("should return false for P2010 with a code '40001' in an unrelated nested path", () => {
    const err = createPrismaError("P2010", "Unrelated query error", {
      someOtherLibrary: {
        nestedConfig: {
          code: "40001", // Should not trigger since it is not in a supported structural path
        },
      },
    });
    expect(isRetryableTransactionError(err)).toBe(false);
  });
});
