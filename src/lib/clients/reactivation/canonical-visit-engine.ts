/* eslint-disable @typescript-eslint/no-explicit-any */
import { DominantService, FavoriteProfessional } from "./types";

/**
 * Returns YYYY-MM-DD civil date string in America/Sao_Paulo timezone.
 */
export function getSaoPauloCivilDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Fast integer Julian Day calculation for YYYY-MM-DD strings.
 * Zero Date allocations, zero string splits.
 */
function ymdToJulianDays(y: number, m: number, d: number): number {
  return (
    367 * y -
    Math.floor((7 * (y + Math.floor((m + 9) / 12))) / 4) +
    Math.floor((275 * m) / 9) +
    d
  );
}

/**
 * Calculates civil day difference between two YYYY-MM-DD strings.
 * Returns (date2 - date1) in integer days.
 */
export function getCivilDaysDifference(dateStr1: string, dateStr2: string): number {
  const y1 = Number(dateStr1.slice(0, 4));
  const m1 = Number(dateStr1.slice(5, 7));
  const d1 = Number(dateStr1.slice(8, 10));

  const y2 = Number(dateStr2.slice(0, 4));
  const m2 = Number(dateStr2.slice(5, 7));
  const d2 = Number(dateStr2.slice(8, 10));

  return ymdToJulianDays(y2, m2, d2) - ymdToJulianDays(y1, m1, d1);
}

/**
 * Adds integer days to a YYYY-MM-DD string in America/Sao_Paulo civil date calendar.
 */
export function addCivilDays(dateStr: string, days: number): string {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  const d = Number(dateStr.slice(8, 10));

  const utc = Date.UTC(y, m - 1, d + days);
  const dt = new Date(utc);
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface RawServiceOccurrence {
  serviceId: string;
  serviceName: string;
  timestamp: Date;
  civilDate: string;
}

export interface RawMemberOccurrence {
  memberId: string;
  memberName: string;
  timestamp: Date;
}

export interface CanonicalVisitInput {
  visitId: string;
  source: "APPOINTMENT" | "COMANDA";
  timestamp: Date;
  civilDate: string;
  serviceOccurrences: { serviceId: string; serviceName: string }[];
  executor?: { memberId: string; memberName: string } | null;
}

/**
 * Resolves dominant service for a customer using exact frozen tie-break:
 * 1. completed canonical-visit occurrence count DESC
 * 2. latest occurrence timestamp DESC
 * 3. serviceId ASC
 */
export function resolveDominantService(
  occurrences: RawServiceOccurrence[]
): DominantService | null {
  const len = occurrences.length;
  if (len === 0) return null;
  if (len === 1) {
    return {
      id: occurrences[0].serviceId,
      name: occurrences[0].serviceName,
      occurrenceCount: 1,
    };
  }

  // Fast path for small occurrence count (<= 10)
  if (len <= 10) {
    const services: {
      id: string;
      name: string;
      dates: string[];
      latestTs: number;
    }[] = [];

    for (let i = 0; i < len; i++) {
      const occ = occurrences[i];
      const ts = occ.timestamp.getTime();
      let found = false;
      for (let j = 0; j < services.length; j++) {
        if (services[j].id === occ.serviceId) {
          found = true;
          if (!services[j].dates.includes(occ.civilDate)) {
            services[j].dates.push(occ.civilDate);
          }
          if (ts > services[j].latestTs) {
            services[j].latestTs = ts;
          }
          break;
        }
      }
      if (!found) {
        services.push({
          id: occ.serviceId,
          name: occ.serviceName,
          dates: [occ.civilDate],
          latestTs: ts,
        });
      }
    }

    let best = services[0];
    for (let i = 1; i < services.length; i++) {
      const cur = services[i];
      if (cur.dates.length > best.dates.length) {
        best = cur;
      } else if (cur.dates.length === best.dates.length) {
        if (cur.latestTs > best.latestTs) {
          best = cur;
        } else if (cur.latestTs === best.latestTs && cur.id < best.id) {
          best = cur;
        }
      }
    }

    return {
      id: best.id,
      name: best.name,
      occurrenceCount: best.dates.length,
    };
  }

  const map = new Map<
    string,
    {
      serviceId: string;
      serviceName: string;
      visitDates: Set<string>;
      latestTimestamp: Date;
    }
  >();

  for (let i = 0; i < len; i++) {
    const occ = occurrences[i];
    const existing = map.get(occ.serviceId);
    if (!existing) {
      map.set(occ.serviceId, {
        serviceId: occ.serviceId,
        serviceName: occ.serviceName,
        visitDates: new Set([occ.civilDate]),
        latestTimestamp: occ.timestamp,
      });
    } else {
      existing.visitDates.add(occ.civilDate);
      if (occ.timestamp > existing.latestTimestamp) {
        existing.latestTimestamp = occ.timestamp;
      }
    }
  }

  let best: { serviceId: string; serviceName: string; count: number; latestTs: Date } | null = null;

  for (const item of map.values()) {
    const count = item.visitDates.size;
    if (!best) {
      best = { serviceId: item.serviceId, serviceName: item.serviceName, count, latestTs: item.latestTimestamp };
      continue;
    }
    if (count > best.count) {
      best = { serviceId: item.serviceId, serviceName: item.serviceName, count, latestTs: item.latestTimestamp };
    } else if (count === best.count) {
      const tsDiff = item.latestTimestamp.getTime() - best.latestTs.getTime();
      if (tsDiff > 0) {
        best = { serviceId: item.serviceId, serviceName: item.serviceName, count, latestTs: item.latestTimestamp };
      } else if (tsDiff === 0) {
        if (item.serviceId < best.serviceId) {
          best = { serviceId: item.serviceId, serviceName: item.serviceName, count, latestTs: item.latestTimestamp };
        }
      }
    }
  }

  if (!best) return null;
  return {
    id: best.serviceId,
    name: best.serviceName,
    occurrenceCount: best.count,
  };
}

/**
 * Resolves favorite professional for a customer using exact tie-break:
 * 1. occurrence count DESC
 * 2. most recent actual occurrence DESC
 * 3. memberId ASC
 */
export function resolveFavoriteProfessional(
  occurrences: RawMemberOccurrence[]
): FavoriteProfessional | null {
  if (occurrences.length === 0) return null;

  const map = new Map<
    string,
    {
      memberId: string;
      memberName: string;
      count: number;
      latestTimestamp: Date;
    }
  >();

  for (const occ of occurrences) {
    const existing = map.get(occ.memberId);
    if (!existing) {
      map.set(occ.memberId, {
        memberId: occ.memberId,
        memberName: occ.memberName,
        count: 1,
        latestTimestamp: occ.timestamp,
      });
    } else {
      existing.count++;
      if (occ.timestamp > existing.latestTimestamp) {
        existing.latestTimestamp = occ.timestamp;
      }
    }
  }

  let best: { memberId: string; memberName: string; count: number; latestTs: Date } | null = null;

  for (const item of map.values()) {
    if (!best) {
      best = { memberId: item.memberId, memberName: item.memberName, count: item.count, latestTs: item.latestTimestamp };
      continue;
    }
    if (item.count > best.count) {
      best = { memberId: item.memberId, memberName: item.memberName, count: item.count, latestTs: item.latestTimestamp };
    } else if (item.count === best.count) {
      const tsDiff = item.latestTimestamp.getTime() - best.latestTs.getTime();
      if (tsDiff > 0) {
        best = { memberId: item.memberId, memberName: item.memberName, count: item.count, latestTs: item.latestTimestamp };
      } else if (tsDiff === 0) {
        if (item.memberId < best.memberId) {
          best = { memberId: item.memberId, memberName: item.memberName, count: item.count, latestTs: item.latestTimestamp };
        }
      }
    }
  }

  if (!best) return null;
  return {
    id: best.memberId,
    name: best.memberName,
    occurrenceCount: best.count,
  };
}

export interface CanonicalCustomerVisit {
  source: "APPOINTMENT" | "COMANDA";
  appointmentId: string | null;
  comandaId: string | null;
  timestamp: Date;
  civilDate: string;
  paidTotal: number;
  comandas: any[];
  isCompletedService: boolean;
}

/**
 * Extracts canonical customer visits from appointments and comandas
 * strictly applying the frozen timestamp priority:
 * 1. ComandaItem SERVICE DONE completedAt
 * 2. Appointment.dateTime
 * 3. Comanda.closedAt fallback
 * with America/Sao_Paulo civil date and deduplication.
 */
export function extractCanonicalVisitsForCustomer(
  appointments: any[],
  comandas: any[]
): CanonicalCustomerVisit[] {
  const candidateVisits: CanonicalCustomerVisit[] = [];

  // From appointments
  for (const appt of appointments) {
    let maxCompletedAt: Date | null = null;
    const validComandas: any[] = [];
    let paidTotalSum = 0;

    for (const c of appt.comandas || []) {
      validComandas.push(c);
      if (Number(c.paidTotal) > 0) {
        paidTotalSum += Number(c.paidTotal);
      }
      for (const it of c.items || []) {
        if (it.completedAt) {
          const itDate = new Date(it.completedAt);
          if (!maxCompletedAt || itDate > maxCompletedAt) {
            maxCompletedAt = itDate;
          }
        }
      }
    }

    const visitTs = maxCompletedAt || new Date(appt.dateTime);
    const isCompleted =
      appt.status === "COMPLETED" ||
      (appt.comandas && appt.comandas.some((c: any) => c.items && c.items.length > 0));

    candidateVisits.push({
      source: "APPOINTMENT",
      appointmentId: appt.id,
      comandaId: validComandas[0]?.id || null,
      timestamp: visitTs,
      civilDate: getSaoPauloCivilDateString(visitTs),
      paidTotal: paidTotalSum,
      comandas: validComandas,
      isCompletedService: isCompleted,
    });
  }

  // From standalone comandas (walk-ins without appointment)
  for (const comanda of comandas) {
    if (comanda.appointmentId) continue; // Already handled via appointment

    let maxCompletedAt: Date | null = null;
    for (const it of comanda.items || []) {
      if (it.completedAt) {
        const itDate = new Date(it.completedAt);
        if (!maxCompletedAt || itDate > maxCompletedAt) {
          maxCompletedAt = itDate;
        }
      }
    }

    const hasDoneService = (comanda.items || []).length > 0;
    if (!hasDoneService) continue;

    const visitTs =
      maxCompletedAt ||
      (comanda.closedAt ? new Date(comanda.closedAt) : new Date(comanda.createdAt));
    const paid = Number(comanda.paidTotal) || 0;

    candidateVisits.push({
      source: "COMANDA",
      appointmentId: null,
      comandaId: comanda.id,
      timestamp: visitTs,
      civilDate: getSaoPauloCivilDateString(visitTs),
      paidTotal: paid,
      comandas: [comanda],
      isCompletedService: true,
    });
  }

  // Sort candidate visits by timestamp ASC
  candidateVisits.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return candidateVisits;
}
