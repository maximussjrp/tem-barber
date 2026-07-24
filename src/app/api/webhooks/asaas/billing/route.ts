import { NextRequest, NextResponse } from "next/server";
import { processAsaasWebhookPayload } from "@/lib/asaas/webhooks";

export async function POST(request: NextRequest) {
  const tokenConfigured = process.env.ASAAS_WEBHOOK_TOKEN;

  // 1. Validar se o token do webhook está configurado no ambiente do servidor
  if (!tokenConfigured || tokenConfigured.trim().length === 0) {
    return NextResponse.json(
      { error: "WEBHOOK_TOKEN_NOT_CONFIGURED", message: "ASAAS_WEBHOOK_TOKEN não configurado no servidor." },
      { status: 401 }
    );
  }

  // 2. Validar o header asaas-access-token enviado pelo Asaas
  const requestToken = request.headers.get("asaas-access-token");
  if (!requestToken || requestToken !== tokenConfigured) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Token de acesso do webhook inválido ou ausente." },
      { status: 401 }
    );
  }

  // 3. Ler e validar payload JSON
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON", message: "Corpo da requisição não é um JSON válido." },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "INVALID_PAYLOAD", message: "Payload do webhook inválido." },
      { status: 400 }
    );
  }

  // 4. Processar evento de forma idempotente
  try {
    const result = await processAsaasWebhookPayload(body);
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    console.error("[asaas/webhook] Erro inesperado no webhook:", err);
    // Tolera exceções para responder HTTP 200 e não interromper a fila de webhooks do Asaas
    return NextResponse.json(
      { ok: true, ignored: true, error: "UNHANDLED_WEBHOOK_ERROR" },
      { status: 200 }
    );
  }
}
