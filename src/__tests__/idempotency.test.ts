import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  getIdempotencyKeyFromRequest,
  hashPublicBookingPayload,
} from "@/lib/appointments/idempotency";

describe("idempotencia do agendamento publico", () => {
  const payload = {
    memberId: "member-a",
    serviceIds: ["svc-a", "svc-b"],
    dateTime: "2026-07-20T13:00:00.000Z",
    customerName: "Cliente A",
    customerPhone: "(11) 99999-9999",
  };

  it("gera hash deterministico para o mesmo payload normalizado", () => {
    expect(hashPublicBookingPayload(payload)).toBe(hashPublicBookingPayload({ ...payload }));
  });

  it("normaliza ordem de serviceIds no hash", () => {
    const reversed = { ...payload, serviceIds: ["svc-b", "svc-a"] };

    expect(hashPublicBookingPayload(payload)).toBe(hashPublicBookingPayload(reversed));
  });

  it("altera hash quando a intencao muda", () => {
    const changed = { ...payload, dateTime: "2026-07-20T13:30:00.000Z" };

    expect(hashPublicBookingPayload(payload)).not.toBe(hashPublicBookingPayload(changed));
  });

  it("aceita chave UUID pelo header", () => {
    const request = new NextRequest("http://localhost/book", {
      headers: { "Idempotency-Key": "44444444-4444-4444-8444-444444444444" },
    });

    expect(getIdempotencyKeyFromRequest(request, {})).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("rejeita chave ausente ou invalida", () => {
    expect(() => getIdempotencyKeyFromRequest(new NextRequest("http://localhost/book"), {})).toThrow(
      "Envie o header Idempotency-Key para confirmar o agendamento."
    );

    expect(() =>
      getIdempotencyKeyFromRequest(new NextRequest("http://localhost/book"), {
        idempotencyKey: "nao-e-uuid",
      })
    ).toThrow("A chave de idempotencia deve ser um UUID valido.");
  });
});
