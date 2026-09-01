export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Robustly validates that a VAPID subject is a valid URI starting with 'https://' or 'mailto:'
 * with non-empty host/recipient.
 */
export function validateVapidSubject(subject: string | undefined | null): boolean {
  if (!subject || typeof subject !== "string") return false;
  const trimmed = subject.trim();
  if (!trimmed) return false;

  // Handle mailto: scheme
  if (trimmed.startsWith("mailto:")) {
    const recipient = trimmed.slice(7).trim();
    return recipient.length > 0 && recipient.includes("@") && !recipient.startsWith("@") && !recipient.endsWith("@");
  }

  // Handle https:// scheme
  if (trimmed.startsWith("https://")) {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === "https:" && parsed.hostname.length > 0;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Validates raw configuration values.
 * Throws a descriptive Error if any required value is missing or invalid.
 */
export function parseVapidConfig(input: {
  publicKey?: string | null;
  privateKey?: string | null;
  subject?: string | null;
}): VapidConfig {
  const publicKey = input.publicKey?.trim();
  const privateKey = input.privateKey?.trim();
  const subject = input.subject?.trim();

  if (!publicKey) {
    throw new Error("VAPID_PUBLIC_KEY configuration is missing.");
  }
  if (!privateKey) {
    throw new Error("VAPID_PRIVATE_KEY configuration is missing.");
  }
  if (!subject) {
    throw new Error("VAPID_SUBJECT configuration is missing.");
  }
  if (!validateVapidSubject(subject)) {
    throw new Error("VAPID_SUBJECT must be a valid URL starting with 'https://' or 'mailto:'.");
  }

  return { publicKey, privateKey, subject };
}
