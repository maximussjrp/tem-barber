import { ExpectedReturnSource } from "@prisma/client";
import { PLATFORM_FALLBACK_RECURRENCE_DAYS } from "./constants";

/**
 * Calculates statistical median according to exact R3 rules:
 * - Sort ascending
 * - If odd: central element
 * - If even: mean of central pair then Math.round(...)
 */
export function calculateStatisticalMedian(intervals: number[]): number {
  if (intervals.length === 0) return PLATFORM_FALLBACK_RECURRENCE_DAYS;

  const sorted = [...intervals].sort((a, b) => a - b);
  const len = sorted.length;

  if (len % 2 === 1) {
    return sorted[Math.floor(len / 2)];
  }

  const mid1 = sorted[len / 2 - 1];
  const mid2 = sorted[len / 2];
  return Math.round((mid1 + mid2) / 2.0);
}

export interface RecurrenceResult {
  expectedReturnDays: number;
  expectedReturnSource: ExpectedReturnSource;
}

export interface ServiceIntervalData {
  intervals: number[];
  distinctCustomerCount: number;
  medianDays?: number;
}

/**
 * Resolves recurrence days and source according to frozen hierarchy:
 * 1. PERSONAL (>= 3 valid intervals = >= 4 visit dates, max 6 recent intervals)
 * 2. SERVICE_MEDIAN (>= 5 total intervals across >= 3 customers, max 6 intervals/customer)
 * 3. BARBERSHOP_MEDIAN (>= 10 total intervals across tenant customers, max 6 intervals/customer)
 * 4. PLATFORM_FALLBACK (30 days)
 */
export function resolveCustomerRecurrence(params: {
  personalIntervals: number[];
  dominantServiceIntervalData?: ServiceIntervalData | null;
  barbershopIntervals?: number[] | null;
  barbershopMedianDays?: number | null;
}): RecurrenceResult {
  // 1. Personal Recurrence
  // Take up to 6 most recent intervals
  const recentPersonal = params.personalIntervals.slice(-6);
  if (recentPersonal.length >= 3) {
    return {
      expectedReturnDays: calculateStatisticalMedian(recentPersonal),
      expectedReturnSource: ExpectedReturnSource.PERSONAL,
    };
  }

  // 2. Service Empirical Median
  if (params.dominantServiceIntervalData) {
    const { intervals, distinctCustomerCount, medianDays } = params.dominantServiceIntervalData;
    if (intervals.length >= 5 && distinctCustomerCount >= 3) {
      const days = medianDays ?? calculateStatisticalMedian(intervals);
      return {
        expectedReturnDays: days,
        expectedReturnSource: ExpectedReturnSource.SERVICE_MEDIAN,
      };
    }
  }

  // 3. Barbershop Empirical Median
  if (params.barbershopMedianDays !== undefined && params.barbershopMedianDays !== null) {
    return {
      expectedReturnDays: params.barbershopMedianDays,
      expectedReturnSource: ExpectedReturnSource.BARBERSHOP_MEDIAN,
    };
  }
  if (params.barbershopIntervals && params.barbershopIntervals.length >= 10) {
    return {
      expectedReturnDays: calculateStatisticalMedian(params.barbershopIntervals),
      expectedReturnSource: ExpectedReturnSource.BARBERSHOP_MEDIAN,
    };
  }

  // 4. Platform Fallback
  return {
    expectedReturnDays: PLATFORM_FALLBACK_RECURRENCE_DAYS,
    expectedReturnSource: ExpectedReturnSource.PLATFORM_FALLBACK,
  };
}
