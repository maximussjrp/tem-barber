import { describe, it, expect } from "vitest";
import {
  formatWhatsAppPhone,
  generateWhatsAppMessage,
  generateWhatsAppLink,
} from "../lib/whatsapp";
import { formatAppointmentDateTimeForMessage } from "../lib/time-utils";

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
    it("should generate standard reminder message without 'hoje' and containing full date and time", () => {
      const msg = generateWhatsAppMessage("Felipe", "Tem Barber", "18/07/2026", "14:30", "Corte de Cabelo");
      expect(msg).not.toContain("hoje");
      expect(msg).toContain("18/07/2026");
      expect(msg).toContain("14:30");
      expect(msg).toContain("Felipe");
      expect(msg).toContain("Tem Barber");
      expect(msg).toContain("Corte de Cabelo");
    });

    it("should include Profissional line when barberName is provided", () => {
      const msg = generateWhatsAppMessage("Felipe", "Tem Barber", "18/07/2026", "14:30", "Corte de Cabelo", "Carlos");
      expect(msg).toContain("Profissional: Carlos");
    });

    it("should omit Profissional line when barberName is not provided", () => {
      const msg = generateWhatsAppMessage("Felipe", "Tem Barber", "18/07/2026", "14:30", "Corte de Cabelo");
      expect(msg).not.toContain("Profissional:");
    });
  });

  describe("formatAppointmentDateTimeForMessage", () => {
    it("should correctly format date/time and not shift the UTC components (regression test for 18/07/2026 10:30)", () => {
      const dbDateTime = "2026-07-18T10:30:00.000Z";
      const { date, time } = formatAppointmentDateTimeForMessage(dbDateTime, "America/Sao_Paulo");
      expect(date).toBe("18/07/2026");
      expect(time).toBe("10:30");
    });

    it("should correctly construct a message for tomorrow's appointment (18/07/2026) when simulated current time is 17/07/2026", () => {
      const dbDateTime = "2026-07-18T10:30:00.000Z";
      const { date, time } = formatAppointmentDateTimeForMessage(dbDateTime, "America/Sao_Paulo");
      const msg = generateWhatsAppMessage("Mayk", "Dom Brio Barbearia", date, time, "Corte + Barba", "Danilo");

      expect(msg).not.toContain("hoje");
      expect(msg).not.toContain("amanhã");
      expect(msg).toContain("18/07/2026");
      expect(msg).toContain("10:30");
      expect(msg).toContain("Mayk");
      expect(msg).toContain("Dom Brio Barbearia");
      expect(msg).toContain("Corte + Barba");
      expect(msg).toContain("Profissional: Danilo");
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
