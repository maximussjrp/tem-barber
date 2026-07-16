import { describe, expect, it } from "vitest";
import {
  buildWhatsappConfirmationLink,
  generateWhatsappConfirmationToken,
  getWhatsappConfirmationTokenHint,
  hashWhatsappConfirmationToken,
  normalizeWhatsappConfirmationToken,
  verifyWhatsappConfirmationToken,
} from "@/lib/appointments/whatsapp-confirmation";

describe("whatsapp confirmation helpers", () => {
  it("gera token no formato TB-000000 e hint sem expor codigo completo", () => {
    const token = generateWhatsappConfirmationToken();

    expect(token).toMatch(/^TB-\d{6}$/);
    expect(getWhatsappConfirmationTokenHint("TB-123456")).toBe("TB-****56");
  });

  it("normaliza token digitado e valida usando hash", () => {
    const hash = hashWhatsappConfirmationToken("TB-123456");

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("123456");
    expect(normalizeWhatsappConfirmationToken(" 123456 ")).toBe("TB-123456");
    expect(verifyWhatsappConfirmationToken("123456", hash)).toBe(true);
    expect(verifyWhatsappConfirmationToken("654321", hash)).toBe(false);
  });

  it("monta link wa.me para WhatsApp valido da barbearia", () => {
    const result = buildWhatsappConfirmationLink({
      barbershopPhone: "(17) 98127-5471",
      barbershopName: "Zovisk Cortes",
      customerName: "Cliente A",
      services: ["Corte"],
      dateTime: new Date("2026-07-20T13:00:00.000Z"),
      token: "TB-123456",
    });

    expect(result?.phone).toBe("5517981275471");
    expect(result?.message).toContain("TB-123456");
    expect(result?.link).toMatch(/^https:\/\/wa\.me\/5517981275471\?text=/);
  });

  it("nao monta link quando o WhatsApp da barbearia e invalido", () => {
    expect(
      buildWhatsappConfirmationLink({
        barbershopPhone: "1732223333",
        barbershopName: "Barbearia",
        customerName: "Cliente",
        services: ["Corte"],
        dateTime: new Date("2026-07-20T13:00:00.000Z"),
        token: "TB-123456",
      })
    ).toBeNull();
  });
});
