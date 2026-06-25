import { describe, it, expect } from "vitest";
import {
  formatWhatsAppPhone,
  generateWhatsAppMessage,
  generateWhatsAppLink,
} from "../lib/whatsapp";

describe("WhatsApp integration helpers", () => {
  describe("formatWhatsAppPhone", () => {
    it("should return null for empty/invalid phones", () => {
      expect(formatWhatsAppPhone(null)).toBeNull();
      expect(formatWhatsAppPhone(undefined)).toBeNull();
      expect(formatWhatsAppPhone("")).toBeNull();
      expect(formatWhatsAppPhone("123")).toBeNull();
    });

    it("should normalize 10 and 11 digit phones by adding DDI 55", () => {
      expect(formatWhatsAppPhone("17991234567")).toBe("5517991234567");
      expect(formatWhatsAppPhone("(17) 99123-4567")).toBe("5517991234567");
      expect(formatWhatsAppPhone("1732223333")).toBe("551732223333");
      expect(formatWhatsAppPhone("  17 99123 - 4567 ")).toBe("5517991234567");
    });

    it("should keep DDI 55 if already present in 12 or 13 digits", () => {
      expect(formatWhatsAppPhone("5517991234567")).toBe("5517991234567");
      expect(formatWhatsAppPhone("+55 (17) 99123-4567")).toBe("5517991234567");
    });

    it("should return null if length is 12 or 13 but does not start with 55", () => {
      expect(formatWhatsAppPhone("6617991234567")).toBeNull();
    });
  });

  describe("generateWhatsAppMessage", () => {
    it("should generate standard reminder message", () => {
      const msg = generateWhatsAppMessage("Felipe", "Tem Barber", "14:30", "Corte de Cabelo");
      expect(msg).toBe(
        "Olá, Felipe! Passando para lembrar do seu agendamento na Tem Barber hoje às 14:30 para Corte de Cabelo. Te esperamos no horário combinado. ✂️"
      );
    });
  });

  describe("generateWhatsAppLink", () => {
    it("should generate a proper encoded wa.me link for valid phone", () => {
      const link = generateWhatsAppLink("17991234567", "Olá!");
      expect(link).toBe("https://wa.me/5517991234567?text=Ol%C3%A1!");
    });

    it("should return null for invalid phone", () => {
      const link = generateWhatsAppLink("invalid-phone", "Olá!");
      expect(link).toBeNull();
    });
  });
});
