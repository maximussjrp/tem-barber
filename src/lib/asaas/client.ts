/**
 * Cliente Server-Side Asaas para faturamento SaaS do Tem Barber.
 * IMPORTANTE: Executar apenas no servidor (Node.js). Nunca expor ASAAS_API_KEY no cliente.
 */

export interface AsaasConfig {
  apiKey: string | null;
  environment: "sandbox" | "production";
  baseUrl: string;
  isConfigured: boolean;
  webhookTokenConfigured: boolean;
}

export function getAsaasConfig(): AsaasConfig {
  const apiKey = process.env.ASAAS_API_KEY || null;
  const rawEnv = (process.env.ASAAS_ENV || "sandbox").toLowerCase();
  const environment: "sandbox" | "production" = rawEnv === "production" ? "production" : "sandbox";

  const baseUrl =
    environment === "production"
      ? "https://www.asaas.com/api/v3"
      : "https://sandbox.asaas.com/api/v3";

  return {
    apiKey,
    environment,
    baseUrl,
    isConfigured: Boolean(apiKey && apiKey.trim().length > 0),
    webhookTokenConfigured: Boolean(
      process.env.ASAAS_WEBHOOK_TOKEN && process.env.ASAAS_WEBHOOK_TOKEN.trim().length > 0
    ),
  };
}

export interface AsaasRequestOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export class AsaasApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public rawErrors?: unknown
  ) {
    super(message);
    this.name = "AsaasApiError";
  }
}

/**
 * Utilitário de requisição HTTP autenticada para a API do Asaas (Server-Side)
 */
export async function asaasFetch<T = unknown>(
  endpoint: string,
  options: AsaasRequestOptions = {}
): Promise<T> {
  const config = getAsaasConfig();

  if (!config.isConfigured || !config.apiKey) {
    throw new AsaasApiError(
      500,
      "ASAAS_NOT_CONFIGURED",
      "Integração Asaas não configurada no servidor (ASAAS_API_KEY ausente)."
    );
  }

  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${config.baseUrl}${path}`;

  const { timeoutMs = 15000, headers = {}, ...restOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...restOptions,
      headers: {
        "Content-Type": "application/json",
        access_token: config.apiKey,
        ...headers,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const firstError = data?.errors?.[0];
      const errorMessage = firstError?.description || data?.message || `Erro Asaas HTTP ${res.status}`;
      const errorCode = firstError?.code || `HTTP_${res.status}`;
      throw new AsaasApiError(res.status, errorCode, errorMessage, data?.errors);
    }

    return data as T;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof AsaasApiError) {
      throw err;
    }

    if (err instanceof Error && err.name === "AbortError") {
      throw new AsaasApiError(408, "TIMEOUT", "Requisição para o Asaas expirou.");
    }

    const message = err instanceof Error ? err.message : "Erro desconhecido na comunicação com Asaas.";
    throw new AsaasApiError(500, "NETWORK_ERROR", message);
  }
}
