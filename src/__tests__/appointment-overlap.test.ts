import { describe, expect, it } from "vitest";
import { blocksAppointment, getIntervalEnd, intervalsOverlap } from "@/lib/appointments/overlap";

describe("regras de sobreposicao de agenda", () => {
  const existingStart = new Date("2026-07-20T13:00:00.000Z");
  const existingDuration = 60;
  const base = {
    barbershopId: "shop-a",
    memberId: "member-a",
    start: existingStart,
    durationMin: existingDuration,
    status: "CONFIRMED",
  };

  it("detecta sobreposicao total", () => {
    expect(intervalsOverlap(existingStart, existingDuration, existingStart, existingDuration)).toBe(true);
  });

  it("detecta sobreposicao parcial pela esquerda", () => {
    expect(
      intervalsOverlap(
        existingStart,
        existingDuration,
        new Date("2026-07-20T12:30:00.000Z"),
        60
      )
    ).toBe(true);
  });

  it("detecta sobreposicao parcial pela direita", () => {
    expect(
      intervalsOverlap(
        existingStart,
        existingDuration,
        new Date("2026-07-20T13:30:00.000Z"),
        60
      )
    ).toBe(true);
  });

  it("detecta novo intervalo contendo o existente", () => {
    expect(
      intervalsOverlap(
        existingStart,
        existingDuration,
        new Date("2026-07-20T12:30:00.000Z"),
        120
      )
    ).toBe(true);
  });

  it("detecta existente contendo o novo intervalo", () => {
    expect(
      intervalsOverlap(
        existingStart,
        existingDuration,
        new Date("2026-07-20T13:15:00.000Z"),
        30
      )
    ).toBe(true);
  });

  it("permite horarios adjacentes sem sobreposicao", () => {
    expect(
      intervalsOverlap(existingStart, existingDuration, new Date("2026-07-20T14:00:00.000Z"), 30)
    ).toBe(false);
  });

  it("bloqueia apenas status ativos", () => {
    expect(blocksAppointment({ ...base, status: "PENDING" }, { ...base })).toBe(true);
    expect(blocksAppointment({ ...base, status: "CONFIRMED" }, { ...base })).toBe(true);
    expect(blocksAppointment({ ...base, status: "CANCELLED" }, { ...base })).toBe(false);
    expect(blocksAppointment({ ...base, status: "COMPLETED" }, { ...base })).toBe(false);
  });

  it("permite profissional, tenant ou proprio id diferentes", () => {
    expect(blocksAppointment(base, { ...base, memberId: "member-b" })).toBe(false);
    expect(blocksAppointment(base, { ...base, barbershopId: "shop-b" })).toBe(false);
    expect(blocksAppointment({ ...base, id: "appointment-a" }, { ...base, id: "appointment-a" })).toBe(false);
  });

  it("calcula fim do intervalo pela duracao em minutos", () => {
    expect(getIntervalEnd(existingStart, 75).toISOString()).toBe("2026-07-20T14:15:00.000Z");
  });
});
