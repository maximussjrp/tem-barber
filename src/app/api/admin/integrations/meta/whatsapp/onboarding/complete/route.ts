import { NextRequest, NextResponse } from "next/server";
import { requireOperationalSession } from "@/lib/api-auth";
import { completeCoexistenceOnboarding } from "@/lib/meta/whatsapp/connections";
import { MetaApiError, redactSensitiveString } from "@/lib/meta/errors";

export async function POST(req: NextRequest) {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { barbershopId, userId, role } = data;

  // Strict RBAC: only OWNER can complete onboarding
  if (role !== "OWNER") {
    return NextResponse.json(
      { error: "Apenas proprietários podem concluir a conexão com o WhatsApp." },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Corpo da requisição JSON inválido." },
      { status: 400 }
    );
  }

  const {
    sessionId,
    nonce,
    code,
    wabaIdHint,
    phoneNumberIdHint,
    completionMetadata,
  } = body;

  if (
    !sessionId ||
    typeof sessionId !== "string" ||
    !nonce ||
    typeof nonce !== "string" ||
    !code ||
    typeof code !== "string"
  ) {
    return NextResponse.json(
      {
        error:
          "Parâmetros obrigatórios ausentes (sessionId, nonce e code são requeridos).",
      },
      { status: 400 }
    );
  }

  try {
    const result = await completeCoexistenceOnboarding({
      barbershopId,
      userId,
      sessionId,
      nonce,
      code,
      wabaIdHint: typeof wabaIdHint === "string" ? wabaIdHint : undefined,
      phoneNumberIdHint:
        typeof phoneNumberIdHint === "string" ? phoneNumberIdHint : undefined,
      completionMetadata:
        completionMetadata && typeof completionMetadata === "object"
          ? (completionMetadata as Record<string, unknown>)
          : undefined,
    });

    return NextResponse.json({
      success: true,
      connection: result,
    });
  } catch (err: unknown) {
    const errorObj = err as Error | MetaApiError;
    const isMetaApiErr = errorObj instanceof MetaApiError;
    const httpStatus = isMetaApiErr && errorObj.httpStatus ? errorObj.httpStatus : 500;
    const safeMsg = redactSensitiveString(
      errorObj?.message || "Erro interno ao concluir conexão Meta WhatsApp."
    );

    return NextResponse.json(
      {
        error: safeMsg,
        code: isMetaApiErr ? errorObj.code : undefined,
      },
      { status: httpStatus }
    );
  }
}
