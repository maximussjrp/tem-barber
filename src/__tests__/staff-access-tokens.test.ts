import { describe, expect, it } from "vitest";
import {
  generateRawToken,
  hashToken,
  INVITE_EXPIRATION_HOURS,
  RESET_EXPIRATION_HOURS,
  validateStaffAccessToken,
  consumeStaffAccessToken,
} from "@/lib/auth/staff-tokens";

describe("P0 - Staff Access Tokens", () => {
  it("generates a random 64-character hex raw token", () => {
    const raw1 = generateRawToken();
    const raw2 = generateRawToken();
    expect(raw1).toHaveLength(64);
    expect(raw2).toHaveLength(64);
    expect(raw1).not.toBe(raw2);
  });

  it("produces deterministic sha256 hash from raw token", () => {
    const raw = "abc123token";
    const hash1 = hashToken(raw);
    const hash2 = hashToken(raw);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("enforces expiration duration constants: 48h for invite, 24h for reset", () => {
    expect(INVITE_EXPIRATION_HOURS).toBe(48);
    expect(RESET_EXPIRATION_HOURS).toBe(24);
  });

  it("rejects empty or whitespace-only token string in validateStaffAccessToken", async () => {
    const resEmpty = await validateStaffAccessToken("");
    expect(resEmpty.valid).toBe(false);
    if (!resEmpty.valid) {
      expect(resEmpty.error).toBe("TOKEN_NOT_FOUND");
    }

    const resWhitespace = await validateStaffAccessToken("   ");
    expect(resWhitespace.valid).toBe(false);
    if (!resWhitespace.valid) {
      expect(resWhitespace.error).toBe("TOKEN_NOT_FOUND");
    }
  });

  it("rejects non-existent token with TOKEN_NOT_FOUND", async () => {
    const fakeRawToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const res = await validateStaffAccessToken(fakeRawToken);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.error).toBe("TOKEN_NOT_FOUND");
    }
  });

  it("consumeStaffAccessToken rejects passwords shorter than 8 characters", async () => {
    await expect(consumeStaffAccessToken("some-token", "1234567")).rejects.toThrow(
      "A senha deve ter no mínimo 8 caracteres."
    );
  });
});
