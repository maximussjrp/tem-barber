import { NextResponse } from "next/server";
import { OperationalError } from "./comandas";
import { CommissionError } from "./commissions";
import { ClubError } from "./club";
import { CustomerBlockError } from "./blocked-customers";

export const SANITIZED_OPERATION_ERROR_MESSAGE =
  "Não foi possível finalizar o atendimento. Nenhuma nova tentativa de cobrança é necessária. Verifique o status da comanda e tente novamente ou contate o suporte.";

export function isPrismaOrTechnicalError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyErr = error as any;
  if (typeof anyErr.name === "string" && anyErr.name.startsWith("Prisma")) {
    return true;
  }
  if (typeof anyErr.code === "string" && /^P\d{4}$/.test(anyErr.code)) {
    return true;
  }
  if (typeof anyErr.message === "string") {
    const msg = anyErr.message.toLowerCase();
    if (
      msg.includes("prisma.") ||
      msg.includes("foreign key") ||
      msg.includes("unique constraint") ||
      msg.includes("invocation:")
    ) {
      return true;
    }
  }
  return false;
}

export type KnownDomainError =
  | OperationalError
  | CommissionError
  | ClubError
  | CustomerBlockError;

/**
 * Reconhece exclusivamente instâncias de classes de erro de domínio operacional
 * expressamente autorizadas. Objetos arbitrários ou desconhecidos NÃO são confiados.
 */
export function isDomainOperationalError(error: unknown): error is KnownDomainError {
  if (isPrismaOrTechnicalError(error)) return false;
  if (
    error instanceof OperationalError ||
    error instanceof CommissionError ||
    error instanceof ClubError ||
    error instanceof CustomerBlockError
  ) {
    return true;
  }

  // Suporte estrito a instâncias legítimas que possam ter tido o protótipo modificado por compilação/transpilação,
  // mas que pertencem comprovadamente às classes de erro de domínio reconhecidas.
  if (error instanceof Error) {
    const validNames = new Set([
      "OperationalError",
      "CommissionError",
      "ClubError",
      "CustomerBlockError",
    ]);
    if (
      (validNames.has(error.name) || validNames.has(error.constructor?.name)) &&
      typeof (error as any).code === "string" &&
      typeof (error as any).status === "number" &&
      typeof (error as any).message === "string"
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Manipulador com política estrita fail-closed:
 * 1. Erros de domínio operacional explicitamente reconhecidos retornam seu código e status HTTP legítimos.
 * 2. Qualquer outra exceção (Prisma, erros genéricos do JavaScript, mensagens com SQL/dados sensíveis,
 *    ou objetos desconhecidos) é considerada inesperada e sanitizada para HTTP 500 com mensagem segura,
 *    registrando diagnóstico detalhado apenas no log do servidor.
 */
export function operationErrorResponse(error: unknown) {
  if (isDomainOperationalError(error)) {
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.status }
    );
  }

  // Diagnóstico seguro no servidor para auditoria/suporte
  if (error instanceof Error) {
    console.error("[OPERATION_UNEXPECTED_ERROR]", {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as any)?.code,
    });
  } else {
    console.error("[OPERATION_UNEXPECTED_ERROR]", {
      type: typeof error,
      raw: String(error),
    });
  }

  return NextResponse.json(
    {
      error: "INTERNAL_SERVER_ERROR",
      message: SANITIZED_OPERATION_ERROR_MESSAGE,
    },
    { status: 500 }
  );
}
