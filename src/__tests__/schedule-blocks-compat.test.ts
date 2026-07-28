import { describe, expect, it } from "vitest";
import { normalizeStoredTimeOffInterval, parseScheduleBlockInterval } from "@/lib/schedule-blocks";

describe("Schedule blocks - compatibilidade legada e timezone", () => {
  it("legado startDate === endDate bloqueia um dia", () => {
    const block = normalizeStoredTimeOffInterval({
      startDate: new Date("2026-07-28T00:00:00.000Z"),
      endDate: new Date("2026-07-28T23:59:59.999Z"),
    });

    expect(block.allDay).toBe(true);
    expect(block.startDate.toISOString()).toBe("2026-07-28T00:00:00.000Z");
    expect(block.endDate.toISOString()).toBe("2026-07-29T00:00:00.000Z");
  });

  it("legado 28->30 bloqueia 28, 29 e 30", () => {
    const block = normalizeStoredTimeOffInterval({
      startDate: new Date("2026-07-28T00:00:00.000Z"),
      endDate: new Date("2026-07-30T23:59:59.999Z"),
    });

    expect(block.endDate.toISOString()).toBe("2026-07-31T00:00:00.000Z");
  });

  it("novo allDay de um dia usa fim exclusivo", () => {
    const parsed = parseScheduleBlockInterval("2026-07-28", "2026-07-28", true);
    expect(parsed.start.toISOString()).toBe("2026-07-28T00:00:00.000Z");
    expect(parsed.end.toISOString()).toBe("2026-07-29T00:00:00.000Z");
  });

  it("novo allDay de varios dias usa fim exclusivo do dia seguinte", () => {
    const parsed = parseScheduleBlockInterval("2026-07-28", "2026-07-30", true);
    expect(parsed.end.toISOString()).toBe("2026-07-31T00:00:00.000Z");
  });

  it("bloqueio parcial preserva intervalo", () => {
    const parsed = parseScheduleBlockInterval("2026-07-28T13:00:00.000Z", "2026-07-28T14:30:00.000Z", false);
    expect(parsed.start.toISOString()).toBe("2026-07-28T13:00:00.000Z");
    expect(parsed.end.toISOString()).toBe("2026-07-28T14:30:00.000Z");
  });

  it("parcial a meia-noite nao vira allDay", () => {
    const block = normalizeStoredTimeOffInterval({
      startDate: new Date("2026-07-28T00:00:00.000Z"),
      endDate: new Date("2026-07-28T01:00:00.000Z"),
      allDay: false,
    });

    expect(block.allDay).toBe(false);
    expect(block.endDate.toISOString()).toBe("2026-07-28T01:00:00.000Z");
  });

  it("horario 10:00 permanece 10:00", () => {
    const parsed = parseScheduleBlockInterval("2026-07-28T10:00:00.000Z", "2026-07-28T11:00:00.000Z", false);
    expect(parsed.start.getUTCHours()).toBe(10);
  });

  it("data nao retrocede", () => {
    const parsed = parseScheduleBlockInterval("2026-07-28", "2026-07-28", true);
    expect(parsed.start.getUTCDate()).toBe(28);
    expect(parsed.end.getUTCDate()).toBe(29);
  });
});
