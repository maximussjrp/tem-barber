import { describe, expect, it, vi } from "vitest";
import { validateCommissionConfigId } from "@/lib/operations/commissions";
import {
  isPrismaOrTechnicalError,
  isDomainOperationalError,
  operationErrorResponse,
  SANITIZED_OPERATION_ERROR_MESSAGE,
} from "@/lib/operations/responses";
import { OperationalError } from "@/lib/operations/comandas";
import { CommissionError } from "@/lib/operations/commissions";
import { ClubError } from "@/lib/operations/club";
import { CustomerBlockError } from "@/lib/operations/blocked-customers";

describe("Commission Config Foreign Key Integrity - Unit Tests", () => {
  describe("validateCommissionConfigId helper", () => {
    it("returns null for null, undefined, empty or whitespace strings", async () => {
      const mockTx = {
        commissionConfig: {
          findFirst: vi.fn(),
        },
      } as any;

      expect(await validateCommissionConfigId(mockTx, "shop-1", null)).toBeNull();
      expect(await validateCommissionConfigId(mockTx, "shop-1", undefined)).toBeNull();
      expect(await validateCommissionConfigId(mockTx, "shop-1", "")).toBeNull();
      expect(await validateCommissionConfigId(mockTx, "shop-1", "   ")).toBeNull();
      expect(mockTx.commissionConfig.findFirst).not.toHaveBeenCalled();
    });

    it("returns config.id when matching config exists for the same barbershop", async () => {
      const mockTx = {
        commissionConfig: {
          findFirst: vi.fn().mockResolvedValue({ id: "valid-cfg-1" }),
        },
      } as any;

      const result = await validateCommissionConfigId(mockTx, "shop-1", "valid-cfg-1");
      expect(result).toBe("valid-cfg-1");
      expect(mockTx.commissionConfig.findFirst).toHaveBeenCalledWith({
        where: { id: "valid-cfg-1", barbershopId: "shop-1" },
        select: { id: true },
      });
    });

    it("returns null when candidate config does not exist in the database", async () => {
      const mockTx = {
        commissionConfig: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      } as any;

      const result = await validateCommissionConfigId(
        mockTx,
        "shop-1",
        "e8540155-470e-4b8c-ae3e-7a277dad2a6f"
      );
      expect(result).toBeNull();
      expect(mockTx.commissionConfig.findFirst).toHaveBeenCalledWith({
        where: { id: "e8540155-470e-4b8c-ae3e-7a277dad2a6f", barbershopId: "shop-1" },
        select: { id: true },
      });
    });

    it("returns null when config exists but belongs to a different barbershop (multi-tenant boundary)", async () => {
      const mockTx = {
        // findFirst searches with barbershopId: "shop-A", so it returns null if config belongs to shop-B
        commissionConfig: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      } as any;

      const result = await validateCommissionConfigId(mockTx, "shop-A", "config-belonging-to-shop-B");
      expect(result).toBeNull();
      expect(mockTx.commissionConfig.findFirst).toHaveBeenCalledWith({
        where: { id: "config-belonging-to-shop-B", barbershopId: "shop-A" },
        select: { id: true },
      });
    });
  });

  describe("Error Sanitization - operationErrorResponse (Strict Fail-Closed Policy)", () => {
    it("preserves known OperationalError with custom HTTP status and code (404, 403, 422)", async () => {
      const notFoundErr = new OperationalError("COMANDA_NOT_FOUND", "Comanda não encontrada.", 404);
      const resp404 = operationErrorResponse(notFoundErr);
      expect(resp404.status).toBe(404);
      expect(await resp404.json()).toEqual({
        error: "COMANDA_NOT_FOUND",
        message: "Comanda não encontrada.",
      });

      const forbiddenErr = new OperationalError("FORBIDDEN", "Acesso não autorizado.", 403);
      const resp403 = operationErrorResponse(forbiddenErr);
      expect(resp403.status).toBe(403);
      expect(await resp403.json()).toEqual({
        error: "FORBIDDEN",
        message: "Acesso não autorizado.",
      });

      const unprocErr = new OperationalError("INVALID_TOTAL", "Total inconsistente.", 422);
      const resp422 = operationErrorResponse(unprocErr);
      expect(resp422.status).toBe(422);
      expect(await resp422.json()).toEqual({
        error: "INVALID_TOTAL",
        message: "Total inconsistente.",
      });
    });

    it("preserves known CommissionError with custom HTTP status (e.g. 422)", async () => {
      const commErr = new CommissionError(
        "INVALID_PERCENTAGE",
        "Percentual deve estar entre 0 e 100.",
        422
      );
      const resp = operationErrorResponse(commErr);
      expect(resp.status).toBe(422);
      expect(await resp.json()).toEqual({
        error: "INVALID_PERCENTAGE",
        message: "Percentual deve estar entre 0 e 100.",
      });
    });

    it("preserves known ClubError with custom HTTP status (e.g. 422)", async () => {
      const clubErr = new ClubError("BENEFIT_EXHAUSTED", "Limite de benefícios atingido.", 422);
      const resp = operationErrorResponse(clubErr);
      expect(resp.status).toBe(422);
      expect(await resp.json()).toEqual({
        error: "BENEFIT_EXHAUSTED",
        message: "Limite de benefícios atingido.",
      });
    });

    it("preserves known CustomerBlockError with custom HTTP status (e.g. 403)", async () => {
      const blockErr = new CustomerBlockError(
        "CUSTOMER_BLOCKED",
        "Cliente bloqueado para agendamentos.",
        403
      );
      const resp = operationErrorResponse(blockErr);
      expect(resp.status).toBe(403);
      expect(await resp.json()).toEqual({
        error: "CUSTOMER_BLOCKED",
        message: "Cliente bloqueado para agendamentos.",
      });
    });

    it("masks PrismaClientKnownRequestError (e.g. P2003 FK constraint violation) and returns HTTP 500", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const prismaFkError = new Error(
        "Invalid `prisma.commissionEntry.update()` invocation:\nForeign key constraint violated on the constraint: `commission_entries_config_id_fkey`"
      );
      (prismaFkError as any).name = "PrismaClientKnownRequestError";
      (prismaFkError as any).code = "P2003";

      expect(isPrismaOrTechnicalError(prismaFkError)).toBe(true);
      expect(isDomainOperationalError(prismaFkError)).toBe(false);

      const response = operationErrorResponse(prismaFkError);
      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body.error).toBe("INTERNAL_SERVER_ERROR");
      expect(body.message).toBe(SANITIZED_OPERATION_ERROR_MESSAGE);
      expect(body.message).not.toContain("Foreign key");
      expect(body.message).not.toContain("prisma");

      expect(consoleSpy).toHaveBeenCalledWith(
        "[OPERATION_UNEXPECTED_ERROR]",
        expect.objectContaining({
          name: "PrismaClientKnownRequestError",
          code: "P2003",
        })
      );
      consoleSpy.mockRestore();
    });

    it("masks technical error containing SQL/Prisma details with HTTP 500", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const technicalError = new Error("Unique constraint failed on the fields: (`id`)");
      (technicalError as any).code = "P2002";

      const response = operationErrorResponse(technicalError);
      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body.error).toBe("INTERNAL_SERVER_ERROR");
      expect(body.message).toBe(SANITIZED_OPERATION_ERROR_MESSAGE);
      consoleSpy.mockRestore();
    });

    it("sanitizes new Error('Falha interna de SQL com dados sensíveis') to HTTP 500 without revealing the message", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const sensitiveError = new Error("Falha interna de SQL com dados sensíveis: SELECT * FROM users WHERE pass = '123'");
      const response = operationErrorResponse(sensitiveError);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe("INTERNAL_SERVER_ERROR");
      expect(body.message).toBe(SANITIZED_OPERATION_ERROR_MESSAGE);
      expect(body.message).not.toContain("Falha interna");
      expect(body.message).not.toContain("SQL");
      expect(body.message).not.toContain("users");

      expect(consoleSpy).toHaveBeenCalledWith(
        "[OPERATION_UNEXPECTED_ERROR]",
        expect.objectContaining({
          name: "Error",
          message: expect.stringContaining("Falha interna de SQL"),
        })
      );
      consoleSpy.mockRestore();
    });

    it("prevents unexpected errors with duck-typed properties (code, status, message) from bypassing sanitization", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Objeto forjado que tenta se passar por erro de negócio
      const fakeError = {
        code: "UNAUTHORIZED_LEAK",
        status: 400,
        message: "Dados confidenciais vazados do banco de dados",
      };

      expect(isDomainOperationalError(fakeError)).toBe(false);

      const response = operationErrorResponse(fakeError);
      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body.error).toBe("INTERNAL_SERVER_ERROR");
      expect(body.message).toBe(SANITIZED_OPERATION_ERROR_MESSAGE);
      expect(body.message).not.toContain("confidenciais");
      expect(body.message).not.toContain("UNAUTHORIZED_LEAK");

      consoleSpy.mockRestore();
    });

    it("sanitizes unknown object thrown as exception with safe HTTP 500", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const unknownObject = { foo: "bar", internalSecret: 42 };
      expect(isDomainOperationalError(unknownObject)).toBe(false);

      const response = operationErrorResponse(unknownObject);
      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body.error).toBe("INTERNAL_SERVER_ERROR");
      expect(body.message).toBe(SANITIZED_OPERATION_ERROR_MESSAGE);
      expect(body.message).not.toContain("internalSecret");

      consoleSpy.mockRestore();
    });

    it("sanitizes primitive thrown as exception (string, number, null) with safe HTTP 500", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const strResponse = operationErrorResponse("raw unexpected string error");
      expect(strResponse.status).toBe(500);
      const strBody = await strResponse.json();
      expect(strBody.error).toBe("INTERNAL_SERVER_ERROR");
      expect(strBody.message).toBe(SANITIZED_OPERATION_ERROR_MESSAGE);
      expect(strBody.message).not.toContain("raw unexpected");

      const nullResponse = operationErrorResponse(null);
      expect(nullResponse.status).toBe(500);

      consoleSpy.mockRestore();
    });
  });
});
