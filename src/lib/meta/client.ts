/**
 * Meta WhatsApp Cloud API Client Foundation
 * Phase R6.1B - Pre-Live Client Hardening
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
  timeoutMs?: number;
  maxRetries?: number;
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
  const version = options.version || config.graphApiVersion;

  if (!version || version.trim() === "") {
    throw new MetaApiError(
      "Meta Graph API version is not configured. Please configure META_GRAPH_API_VERSION in environment.",
      { isTransient: false }
    );
  }

  const accessToken = options.accessToken || config.systemUserAccessToken;
  const appSecret = options.appSecret || config.appSecret;
  const method = options.method || "GET";
  const timeoutMs = options.timeoutMs ?? 15000;

  // Retry policy:
  // Idempotent GET: up to maxRetries (default: 2) on transient network error / 429 / 5xx
  // Mutations (POST, DELETE, PATCH): strictly 0 retries (no generic automatic retry)
  const isIdempotentGet = method === "GET";
  const maxRetries = isIdempotentGet ? (options.maxRetries ?? 2) : 0;

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

  let attempt = 0;
  while (true) {
    attempt++;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let abortListener: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
        return;
      }
      abortListener = () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      };
      controller.signal.addEventListener("abort", abortListener);
    });

    let response: Response;
    try {
      response = await Promise.race([
        fetcher(url.toString(), {
          method,
          headers,
          body: requestBody,
          signal: controller.signal,
        }),
        abortPromise,
      ]);
    } catch (err: unknown) {
      clearTimeout(timeoutTimer);
      if (abortListener) {
        controller.signal.removeEventListener("abort", abortListener);
      }
      const errorObj = err as Error | undefined;
      const isAbort = errorObj?.name === "AbortError" || controller.signal.aborted;
      const rawMsg = isAbort
        ? `Meta API request timed out after ${timeoutMs}ms`
        : errorObj?.message || "Network error calling Meta API";
      const safeErrorMsg = redactSensitiveString(rawMsg);

      const isTransient = true;
      if (isIdempotentGet && attempt <= maxRetries && isTransient) {
        // Limited retry with backoff for GET
        await new Promise((resolve) => setTimeout(resolve, attempt * 100));
        continue;
      }

      throw new MetaApiError(safeErrorMsg, {
        isTransient: true,
        details: { originalName: errorObj?.name, attempt, isTimeout: isAbort },
      });
    } finally {
      clearTimeout(timeoutTimer);
      if (abortListener) {
        controller.signal.removeEventListener("abort", abortListener);
      }
    }

    let json: Record<string, unknown> | null = null;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      const isServerError = response.status >= 500;
      if (isIdempotentGet && attempt <= maxRetries && isServerError) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 100));
        continue;
      }
      throw new MetaApiError(
        `Failed to parse Meta API response (${response.status})`,
        {
          httpStatus: response.status,
          isTransient: isServerError,
          details: { attempt },
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

      const codeNum = Number(errorPayload.code);
      const isTransient =
        response.status === 429 ||
        response.status >= 500 ||
        [1, 2, 4, 17, 80007, 131056].includes(codeNum);

      if (isIdempotentGet && attempt <= maxRetries && isTransient) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 100));
        continue;
      }

      throw new MetaApiError(safeMsg, {
        code: errorPayload.code as number | string | undefined,
        subcode: errorPayload.error_subcode as number | string | undefined,
        fbtrace_id: errorPayload.fbtrace_id as string | undefined,
        errorType: errorPayload.type as string | undefined,
        httpStatus: response.status,
        isTransient,
        details: errorPayload.error_data as Record<string, unknown> | undefined,
      });
    }

    return json as unknown as T;
  }
}
