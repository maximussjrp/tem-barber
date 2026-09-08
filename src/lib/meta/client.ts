/**
 * Meta WhatsApp Cloud API Client Foundation
 * Phase R6.1A - Connection Security Foundation
 */

import { getMetaConfig } from "./config";
import { generateAppSecretProof } from "./crypto";
import { MetaApiError, redactSensitiveString } from "./errors";

export interface MetaRequestOptions {
  method?: "GET" | "POST" | "DELETE" | "PATCH";
  endpoint: string;
  accessToken?: string;
  appSecret?: string;
  version?: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  includeAppSecretProof?: boolean;
}

export type FetchFunction = typeof fetch;

let customFetchHandler: FetchFunction | null = null;

/**
 * Allows injecting a custom fetch handler for testing / mocking without external network calls.
 */
export function setMetaFetchHandler(handler: FetchFunction | null) {
  customFetchHandler = handler;
}

/**
 * Core Graph API request dispatcher.
 */
export async function metaGraphFetch<T = unknown>(
  options: MetaRequestOptions
): Promise<T> {
  const config = getMetaConfig();
  const version = options.version || config.graphApiVersion || "v21.0";
  const accessToken = options.accessToken || config.systemUserAccessToken;
  const appSecret = options.appSecret || config.appSecret;
  const method = options.method || "GET";

  const cleanEndpoint = options.endpoint.startsWith("/")
    ? options.endpoint.slice(1)
    : options.endpoint;

  const url = new URL(`https://graph.facebook.com/${version}/${cleanEndpoint}`);

  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  // Include appsecret_proof if enabled (default: true if accessToken and appSecret are available)
  const shouldIncludeProof = options.includeAppSecretProof !== false;
  if (shouldIncludeProof && accessToken && appSecret) {
    const proof = generateAppSecretProof(accessToken, appSecret);
    url.searchParams.set("appsecret_proof", proof);
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };

  if (accessToken && !headers["Authorization"]) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  let requestBody: string | undefined;
  if (options.body && method !== "GET") {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(options.body);
  }

  const fetcher = customFetchHandler || fetch;

  let response: Response;
  try {
    response = await fetcher(url.toString(), {
      method,
      headers,
      body: requestBody,
    });
  } catch (err: unknown) {
    const errorObj = err as Error | undefined;
    const safeErrorMsg = redactSensitiveString(
      errorObj?.message || "Network error calling Meta API"
    );
    throw new MetaApiError(safeErrorMsg, {
      isTransient: true,
      details: { originalName: errorObj?.name },
    });
  }

  let json: Record<string, unknown> | null = null;
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new MetaApiError(
      `Failed to parse Meta API response (${response.status})`,
      {
        httpStatus: response.status,
        isTransient: response.status >= 500,
      }
    );
  }

  if (!response.ok || (json && json.error)) {
    const errorPayload = (json?.error || {}) as Record<string, unknown>;
    const rawMsg =
      typeof errorPayload.message === "string"
        ? errorPayload.message
        : `Meta API request failed with status ${response.status}`;
    const safeMsg = redactSensitiveString(rawMsg);

    throw new MetaApiError(safeMsg, {
      code: errorPayload.code as number | string | undefined,
      subcode: errorPayload.error_subcode as number | string | undefined,
      fbtrace_id: errorPayload.fbtrace_id as string | undefined,
      errorType: errorPayload.type as string | undefined,
      httpStatus: response.status,
      details: errorPayload.error_data as Record<string, unknown> | undefined,
    });
  }

  return json as unknown as T;
}
