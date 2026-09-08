/**
 * Meta WhatsApp Cloud API Error Handling & Redaction
 * Phase R6.1A - Connection Security Foundation
 */

export interface MetaApiErrorPayload {
  message: string;
  type?: string;
  code?: number | string;
  error_subcode?: number | string;
  fbtrace_id?: string;
  error_data?: Record<string, unknown>;
}

export class MetaApiError extends Error {
  public readonly code?: number | string;
  public readonly subcode?: number | string;
  public readonly fbtrace_id?: string;
  public readonly errorType?: string;
  public readonly httpStatus?: number;
  public readonly isTransient: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options?: {
      code?: number | string;
      subcode?: number | string;
      fbtrace_id?: string;
      errorType?: string;
      httpStatus?: number;
      isTransient?: boolean;
      details?: Record<string, unknown>;
    }
  ) {
    const sanitizedMessage = redactSensitiveString(message);
    super(sanitizedMessage);
    this.name = "MetaApiError";
    this.code = options?.code;
    this.subcode = options?.subcode;
    this.fbtrace_id = options?.fbtrace_id;
    this.errorType = options?.errorType;
    this.httpStatus = options?.httpStatus;
    this.details = options?.details;

    // Determine transient / retryable status from standard Meta error codes
    // e.g. 1 (Unknown), 2 (Service temporarily unavailable), 4 (Too many calls), 17 (User request limit reached)
    const codeNum = Number(options?.code);
    this.isTransient =
      options?.isTransient ??
      ([1, 2, 4, 17, 80007, 131056].includes(codeNum) ||
        (options?.httpStatus !== undefined &&
          [429, 500, 502, 503, 504].includes(options.httpStatus)));
  }
}

/**
 * Redacts tokens, proofs, and secrets from arbitrary strings and URLs.
 */
export function redactSensitiveString(input: string): string {
  if (!input || typeof input !== "string") return input;

  return input
    // Redact access_token query param
    .replace(/(access_token=)([^&"'\s]+)/gi, "$1[REDACTED]")
    // Redact appsecret_proof query param
    .replace(/(appsecret_proof=)([^&"'\s]+)/gi, "$1[REDACTED]")
    // Redact Authorization headers (preserving Bearer prefix if present)
    .replace(/(Authorization:\s*(?:Bearer\s+)?)([^\r\n]+)/gi, "$1[REDACTED]")
    // Redact standalone Bearer tokens
    .replace(/(Bearer\s+)([a-zA-Z0-9_\-\.]+)/gi, "$1[REDACTED]")
    // Redact pin in payloads
    .replace(/("pin"\s*:\s*")([^"]+)(")/gi, '$1[REDACTED]$3')
    .replace(/("registration_pin"\s*:\s*")([^"]+)(")/gi, '$1[REDACTED]$3');
}
