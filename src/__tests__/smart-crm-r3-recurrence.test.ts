import { describe, expect, it } from "vitest";
import { ExpectedReturnSource } from "@prisma/client";
import {
  getSaoPauloCivilDateString,
  getCivilDaysDifference,
  addCivilDays,
  resolveDominantService,
  resolveFavoriteProfessional,
  calculateStatisticalMedian,
  resolveCustomerRecurrence,
} from "@/lib/clients/reactivation";

describe("Smart CRM R3 — Recurrence Engine Unit Tests", () => {
  it("A/B/C/D/E/F/G: getSaoPauloCivilDateString converts UTC dates to Sao Paulo civil dates", () => {
    // 2026-08-01 01:00:00 UTC -> 2026-07-31 22:00:00 (UTC-3)
    const dt1 = new Date("2026-08-01T01:00:00Z");
    expect(getSaoPauloCivilDateString(dt1)).toBe("2026-07-31");

    // 2026-08-01 14:00:00 UTC -> 2026-08-01 11:00:00 (UTC-3)
    const dt2 = new Date("2026-08-01T14:00:00Z");
    expect(getSaoPauloCivilDateString(dt2)).toBe("2026-08-01");
  });

  it("H: Sao Paulo UTC-midnight boundary calculation", () => {
    const midnightUtc = new Date("2026-08-01T00:00:00Z");
    // 00:00:00 UTC in Sao Paulo (UTC-3) is 21:00:00 on previous day (2026-07-31)
    expect(getSaoPauloCivilDateString(midnightUtc)).toBe("2026-07-31");
  });

  it("calculates civil day difference correctly", () => {
    expect(getCivilDaysDifference("2026-07-15", "2026-08-01")).toBe(17);
    expect(getCivilDaysDifference("2026-08-01", "2026-08-01")).toBe(0);
    expect(addCivilDays("2026-07-15", 17)).toBe("2026-08-01");
  });

  it("K: odd median central value", () => {
    expect(calculateStatisticalMedian([14, 20, 30])).toBe(20);
    expect(calculateStatisticalMedian([10, 15, 20, 25, 30])).toBe(20);
  });

  it("L: even median mean of central pair rounded", () => {
    // (20 + 30) / 2 = 25
    expect(calculateStatisticalMedian([10, 20, 30, 40])).toBe(25);
    // (20 + 25) / 2 = 22.5 -> Math.round -> 23
    expect(calculateStatisticalMedian([10, 20, 25, 40])).toBe(23);
  });

  it("M: max six intervals", () => {
    // 7 intervals provided, slice(-6) should take last 6
    const intervals = [5, 10, 15, 20, 25, 30, 35];
    const res = resolveCustomerRecurrence({ personalIntervals: intervals });
    expect(res.expectedReturnSource).toBe(ExpectedReturnSource.PERSONAL);
    // Last 6 intervals: [10, 15, 20, 25, 30, 35] -> even len 6 -> (20+25)/2 = 22.5 -> 23
    expect(res.expectedReturnDays).toBe(23);
  });

  it("I: 4 visit dates = 3 valid intervals -> personal median", () => {
    const res = resolveCustomerRecurrence({
      personalIntervals: [15, 20, 25],
    });
    expect(res.expectedReturnSource).toBe(ExpectedReturnSource.PERSONAL);
    expect(res.expectedReturnDays).toBe(20);
  });

  it("J: <3 valid intervals -> no personal", () => {
    const res = resolveCustomerRecurrence({
      personalIntervals: [15, 20],
    });
    expect(res.expectedReturnSource).not.toBe(ExpectedReturnSource.PERSONAL);
  });

  it("N: service median 5 intervals / 3 customers boundary", () => {
    // Valid service median
    const resValid = resolveCustomerRecurrence({
      personalIntervals: [15, 20], // insufficient personal
      dominantServiceIntervalData: {
        intervals: [18, 20, 22, 24, 26],
        distinctCustomerCount: 3,
      },
    });
    expect(resValid.expectedReturnSource).toBe(ExpectedReturnSource.SERVICE_MEDIAN);
    expect(resValid.expectedReturnDays).toBe(22);

    // Insufficient customers (<3)
    const resInvalidCust = resolveCustomerRecurrence({
      personalIntervals: [15, 20],
      dominantServiceIntervalData: {
        intervals: [18, 20, 22, 24, 26],
        distinctCustomerCount: 2,
      },
    });
    expect(resInvalidCust.expectedReturnSource).not.toBe(ExpectedReturnSource.SERVICE_MEDIAN);

    // Insufficient intervals (<5)
    const resInvalidInt = resolveCustomerRecurrence({
      personalIntervals: [15, 20],
      dominantServiceIntervalData: {
        intervals: [18, 20, 22, 24],
        distinctCustomerCount: 3,
      },
    });
    expect(resInvalidInt.expectedReturnSource).not.toBe(ExpectedReturnSource.SERVICE_MEDIAN);
  });

  it("O/P: service fallback insufficient -> shop median (>=10 intervals)", () => {
    const resShop = resolveCustomerRecurrence({
      personalIntervals: [],
      dominantServiceIntervalData: null,
      barbershopIntervals: [15, 18, 20, 22, 25, 28, 30, 32, 35, 40], // 10 intervals
    });
    expect(resShop.expectedReturnSource).toBe(ExpectedReturnSource.BARBERSHOP_MEDIAN);
    // (25+28)/2 = 26.5 -> 27
    expect(resShop.expectedReturnDays).toBe(27);
  });

  it("Q: shop insufficient (<10) -> platform fallback 30 days", () => {
    const resPlatform = resolveCustomerRecurrence({
      personalIntervals: [],
      dominantServiceIntervalData: null,
      barbershopIntervals: [15, 18, 20, 22, 25, 28, 30, 32, 35], // 9 intervals
    });
    expect(resPlatform.expectedReturnSource).toBe(ExpectedReturnSource.PLATFORM_FALLBACK);
    expect(resPlatform.expectedReturnDays).toBe(30);
  });

  it("R: dominant service deterministic tie-breaking", () => {
    const occurrences = [
      { serviceId: "svc-b", serviceName: "Barba", timestamp: new Date("2026-08-01T10:00:00Z"), civilDate: "2026-08-01" },
      { serviceId: "svc-a", serviceName: "Corte", timestamp: new Date("2026-08-01T10:00:00Z"), civilDate: "2026-08-01" },
    ];
    // Both have count=1, timestamp=same. Tie broken by serviceId ASC -> "svc-a"
    const dom = resolveDominantService(occurrences);
    expect(dom?.id).toBe("svc-a");
  });

  it("favorite professional deterministic tie-breaking", () => {
    const occurrences = [
      { memberId: "mem-2", memberName: "Barbeiro B", timestamp: new Date("2026-08-01T10:00:00Z") },
      { memberId: "mem-1", memberName: "Barbeiro A", timestamp: new Date("2026-08-01T10:00:00Z") },
    ];
    const fav = resolveFavoriteProfessional(occurrences);
    expect(fav?.id).toBe("mem-1");
  });
});
