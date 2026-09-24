import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

describe("P0 - User Password Change and Verification", () => {
  it("enforces minimum length of 8 characters for new passwords", () => {
    function validatePasswordLength(pwd: string): boolean {
      return !!pwd && typeof pwd === "string" && pwd.length >= 8;
    }

    expect(validatePasswordLength("1234567")).toBe(false);
    expect(validatePasswordLength("")).toBe(false);
    expect(validatePasswordLength("12345678")).toBe(true);
    expect(validatePasswordLength("securepassword123")).toBe(true);
  });

  it("hashes password with bcrypt and verifies comparison correctly", async () => {
    const rawPassword = "StrongPassword@2026";
    const wrongPassword = "WrongPassword@2026";

    const hash = await bcrypt.hash(rawPassword, 10);
    expect(hash).toBeDefined();
    expect(hash).not.toBe(rawPassword);

    const matchCorrect = await bcrypt.compare(rawPassword, hash);
    expect(matchCorrect).toBe(true);

    const matchWrong = await bcrypt.compare(wrongPassword, hash);
    expect(matchWrong).toBe(false);
  });
});
