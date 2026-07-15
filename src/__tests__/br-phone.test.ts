import { describe, it, expect } from "vitest";
import {
  onlyDigits,
  isLikelyFakeBrazilianPhone,
  normalizeBrazilianMobilePhone,
  validateBrazilianMobilePhone,
  formatBrazilianMobilePhone,
  getBrazilianPhoneVariants
} from "../lib/phone/br-phone";

describe("br-phone helper", () => {
  describe("onlyDigits", () => {
    it("should remove non-digit characters", () => {
      expect(onlyDigits("(17) 99108-9190")).toBe("17991089190");
      expect(onlyDigits("+55 17 99108-9190")).toBe("5517991089190");
      expect(onlyDigits(null)).toBe("");
      expect(onlyDigits(undefined)).toBe("");
    });
  });

  describe("isLikelyFakeBrazilianPhone", () => {
    it("should return true for repeating digits", () => {
      expect(isLikelyFakeBrazilianPhone("11111111111")).toBe(true);
      expect(isLikelyFakeBrazilianPhone("5517999999999")).toBe(true);
      expect(isLikelyFakeBrazilianPhone("999999999")).toBe(true);
    });

    it("should return true for simple sequential numbers", () => {
      expect(isLikelyFakeBrazilianPhone("5517912345678")).toBe(true);
      expect(isLikelyFakeBrazilianPhone("5517998765432")).toBe(true);
      expect(isLikelyFakeBrazilianPhone("123456789")).toBe(true);
    });

    it("should return true for excess of zeros", () => {
      expect(isLikelyFakeBrazilianPhone("5517900000000")).toBe(true);
      expect(isLikelyFakeBrazilianPhone("5517900000123")).toBe(true);
    });

    it("should return false for valid-looking patterns", () => {
      expect(isLikelyFakeBrazilianPhone("5517991089190")).toBe(false);
      expect(isLikelyFakeBrazilianPhone("17991089190")).toBe(false);
      expect(isLikelyFakeBrazilianPhone("991089190")).toBe(false);
    });
  });

  describe("normalizeBrazilianMobilePhone", () => {
    it("should normalize valid formats to E.164", () => {
      expect(normalizeBrazilianMobilePhone("17991089190")).toBe("5517991089190");
      expect(normalizeBrazilianMobilePhone("(17) 99108-9190")).toBe("5517991089190");
      expect(normalizeBrazilianMobilePhone("+55 17 99108-9190")).toBe("5517991089190");
      expect(normalizeBrazilianMobilePhone("55 17 99108-9190")).toBe("5517991089190");
      expect(normalizeBrazilianMobilePhone("5517991089190")).toBe("5517991089190");
    });

    it("should auto-inject 9 if 10 or 12 digits provided", () => {
      expect(normalizeBrazilianMobilePhone("1791089190")).toBe("5517991089190"); // 10 digits
      expect(normalizeBrazilianMobilePhone("551791089190")).toBe("5517991089190"); // 12 digits starting with 55
    });

    it("should return raw digits if other lengths", () => {
      expect(normalizeBrazilianMobilePhone("123")).toBe("123");
      expect(normalizeBrazilianMobilePhone("")).toBe(null);
    });
  });

  describe("validateBrazilianMobilePhone", () => {
    it("should validate correct Brazilian mobile phone", () => {
      expect(validateBrazilianMobilePhone("17991089190")).toBe(true);
      expect(validateBrazilianMobilePhone("+55 (17) 99108-9190")).toBe(true);
    });

    it("should reject fixed lines", () => {
      expect(validateBrazilianMobilePhone("1732242222")).toBe(false); // starts with 3, not 9
    });

    it("should reject invalid DDDs", () => {
      expect(validateBrazilianMobilePhone("00991089190")).toBe(false);
      expect(validateBrazilianMobilePhone("90991089190")).toBe(false); // 90 is invalid DDD
    });

    it("should reject fake patterns", () => {
      expect(validateBrazilianMobilePhone("17999999999")).toBe(false);
      expect(validateBrazilianMobilePhone("17912345678")).toBe(false);
    });
  });

  describe("formatBrazilianMobilePhone", () => {
    it("should format valid mobile phone", () => {
      expect(formatBrazilianMobilePhone("5517991089190")).toBe("(17) 99108-9190");
      expect(formatBrazilianMobilePhone("17991089190")).toBe("(17) 99108-9190");
    });

    it("should format fixed phone as fallback", () => {
      expect(formatBrazilianMobilePhone("1732242222")).toBe("(17) 3224-2222");
    });
  });

  describe("getBrazilianPhoneVariants", () => {
    it("should return canonical and local variants", () => {
      expect(getBrazilianPhoneVariants("17991089190")).toEqual(["5517991089190", "17991089190"]);
      expect(getBrazilianPhoneVariants("5517991089190")).toEqual(["5517991089190", "17991089190"]);
    });

    it("should fallback to raw digits if invalid", () => {
      expect(getBrazilianPhoneVariants("123")).toEqual(["123"]);
    });
  });
});
