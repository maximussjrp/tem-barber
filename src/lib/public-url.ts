import { NextRequest } from "next/server";

const DEFAULT_PRODUCTION_URL = "https://app.tembarber.com.br";

function sanitizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function isLocalhost(url: string): boolean {
  try {
    const parsed = new URL(url.includes("://") ? url : `http://${url}`);
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".local")
    );
  } catch {
    const lower = url.toLowerCase();
    return lower.includes("localhost") || lower.includes("127.0.0.1");
  }
}

/**
 * Returns the public canonical base URL for the application.
 * Blocks localhost when process.env.NODE_ENV === "production".
 */
export function getPublicAppUrl(request?: NextRequest | { nextUrl?: { origin?: string } }): string {
  const isProd = process.env.NODE_ENV === "production";

  // 1. NEXT_PUBLIC_APP_URL
  const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (publicAppUrl && publicAppUrl.trim() !== "") {
    const sanitized = sanitizeUrl(publicAppUrl);
    if (!isLocalhost(sanitized) || !isProd) {
      return sanitized;
    }
  }

  // 2. NEXTAUTH_URL
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (nextAuthUrl && nextAuthUrl.trim() !== "") {
    const sanitized = sanitizeUrl(nextAuthUrl);
    if (!isLocalhost(sanitized) || !isProd) {
      return sanitized;
    }
  }

  // 3. Request origin (only if not localhost in production)
  if (request?.nextUrl?.origin) {
    const sanitized = sanitizeUrl(request.nextUrl.origin);
    if (!isLocalhost(sanitized) || !isProd) {
      return sanitized;
    }
  }

  // 4. Default production fallback
  return DEFAULT_PRODUCTION_URL;
}

/**
 * Returns the public waitlist URL for a given barbershop slug.
 */
export function getWaitlistPublicUrl(
  slug: string,
  request?: NextRequest | { nextUrl?: { origin?: string } }
): string {
  const baseUrl = getPublicAppUrl(request);
  const cleanSlug = slug.replace(/^\/+|\/+$/g, "");
  return `${baseUrl}/${cleanSlug}/fila`;
}
