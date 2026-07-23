import crypto from "crypto";

export function generateWaitlistPublicToken(): string {
  const randomHex = crypto.randomBytes(12).toString("hex");
  return `OWL-${randomHex}`;
}

export function hashWaitlistPublicToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function verifyWaitlistPublicToken(token: string, tokenHash: string): boolean {
  if (!token || !tokenHash) return false;
  const hash = hashWaitlistPublicToken(token);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(tokenHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function buildWaitlistTokenHint(token: string): string {
  if (!token || token.length < 8) return "OWL-****";
  const suffix = token.slice(-4);
  return `OWL-****${suffix}`;
}
