import "server-only";
import webpush from "web-push";
import { VapidConfig, parseVapidConfig, validateVapidSubject } from "./vapid-config";

export type { VapidConfig };
export { validateVapidSubject };

let isWebPushConfigured = false;

/**
 * Checks if all required VAPID environment variables are present and valid
 * without throwing errors (safe for non-throwing runtime checks).
 */
export function isVapidConfigured(): boolean {
  try {
    getVapidConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * Lazily resolves and validates VAPID configuration from process.env.
 * Throws a descriptive Error ONLY when called if configuration is missing or invalid.
 * Never throws at import-time.
 */
export function getVapidConfig(): VapidConfig {
  return parseVapidConfig({
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
  });
}

/**
 * Lazily configures the underlying web-push library with VAPID details.
 * Caches configuration for the process lifetime once successfully set.
 */
export function configureWebPush(): typeof webpush {
  if (isWebPushConfigured) {
    return webpush;
  }

  const { publicKey, privateKey, subject } = getVapidConfig();
  webpush.setVapidDetails(subject, publicKey, privateKey);
  isWebPushConfigured = true;

  return webpush;
}
