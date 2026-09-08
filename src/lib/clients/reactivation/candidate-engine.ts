/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrismaClient, CustomerTimingState } from "@prisma/client";
import {
  CandidateQueryOptions,
  CandidateQueryResponse,
  CursorPayload,
  ReactivationCandidateItem,
} from "./types";
import {
  addCivilDays,
  getCivilDaysDifference,
  getSaoPauloCivilDateString,
  resolveDominantService,
  resolveFavoriteProfessional,
} from "./canonical-visit-engine";
import {
  calculateStatisticalMedian,
  resolveCustomerRecurrence,
  ServiceIntervalData,
} from "./recurrence-engine";
import {
  calculateConfidenceScore,
  calculateFatiguePenalty,
  calculateFinalScore,
  calculateReliabilityScore,
  calculateTimingScore,
  calculateValueScore,
  generateScoreReasons,
  getTimingStateLabel,
  resolveCustomerTimingState,
  ValueQuartiles,
} from "./scoring-engine";
import { evaluateSuppressions } from "./suppression-engine";
import {
  SMART_CRM_RECURRENCE_VERSION,
  SMART_CRM_SCORE_VERSION,
  VirtualMarketingConsentStatus,
} from "./constants";

export function encodeCursor(payload: CursorPayload): string {
  const jsonStr = JSON.stringify(payload);
  return Buffer.from(jsonStr, "utf8").toString("base64url");
}

export function decodeCursor(cursorStr: string): CursorPayload {
  try {
    const jsonStr = Buffer.from(cursorStr, "base64url").toString("utf8");
    const payload = JSON.parse(jsonStr) as CursorPayload;
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof payload.v !== "number" ||
      typeof payload.score !== "number" ||
      typeof payload.daysOverdue !== "number" ||
      typeof payload.customerId !== "string"
    ) {
      throw new Error("Invalid payload structure");
    }
    return payload;
  } catch {
    throw new Error("INVALID_CURSOR");
  }
}

interface LightweightCandidate {
  cust: { id: string; name: string; phone: string | null };
  completedVisitCount: number;
  lastVisitLocalDate: string | null;
  expectedReturnLocalDate: string | null;
  expectedReturnDays: number;
  expectedReturnSource: any;
  daysSinceLastVisit: number | null;
  daysOverdue: number | null;
  returnRatio: number | null;
  score: number;
  scoreComponents: {
    timing: number;
    value: number;
    confidence: number;
    reliability: number;
    fatigue: number;
  };
  averageTicket: number;
  potentialRevenue: number;
  noShowRate: number;
  lastContactedAtStr: string | null;
  daysSinceLastContact: number | null;
  consentStatus: VirtualMarketingConsentStatus;
  recommendationEligible: boolean;
  dispatchEligible: boolean;
  recommendationSuppressions: any[];
  dispatchSuppressions: any[];
  defaultSelected: boolean;
  timingState: CustomerTimingState;
  timingLabel: string;
}

/**
 * High-Performance Set-Oriented Candidate Query Engine for Smart CRM (R3)
 */
export async function getReactivationCandidates(
  prisma: PrismaClient | any,
  options: CandidateQueryOptions
): Promise<CandidateQueryResponse> {
  const queryStartTime = Date.now();
  let dbQueryCount = 0;

  const barbershopId = options.barbershopId;
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const now = options.now ?? new Date();
  const todayStr = getSaoPauloCivilDateString(now);

  // Decode cursor if provided
  let cursorPayload: CursorPayload | null = null;
  if (options.cursor) {
    cursorPayload = decodeCursor(options.cursor);
  }

  let tMark = Date.now();

  // --------------------------------------------------------------------------
  // QUERY 1: Tenant Value Quartiles & Average Ticket per Customer
  // --------------------------------------------------------------------------
  dbQueryCount++;
  const paidComandas: any[] = await prisma.$queryRaw`
    SELECT
      customer_id AS "customerId",
      SUM(paid_total)::float AS "totalPaid",
      COUNT(*)::int AS "paidCount"
    FROM comandas
    WHERE barbershop_id = ${barbershopId}
      AND customer_id IS NOT NULL
      AND status != 'CANCELLED'
      AND paid_total > 0
    GROUP BY customer_id
  `;

  const avgTicketMap = new Map<string, { averageTicket: number; count: number }>();
  const positiveTickets: number[] = [];

  for (const row of paidComandas) {
    const avg = row.totalPaid / row.paidCount;
    avgTicketMap.set(row.customerId, {
      averageTicket: avg,
      count: row.paidCount,
    });
    if (avg > 0) {
      positiveTickets.push(avg);
    }
  }

  // Compute tenant quartiles on positive tickets
  let valueQuartiles: ValueQuartiles = { p25: 0, p50: 0, p75: 0, countPaid: 0 };
  if (positiveTickets.length >= 4) {
    dbQueryCount++;
    const [qRow]: any = await prisma.$queryRaw`
      WITH positive_tickets AS (
        SELECT (SUM(paid_total)::numeric / COUNT(*)::numeric) AS avg_ticket
        FROM comandas
        WHERE barbershop_id = ${barbershopId}
          AND customer_id IS NOT NULL
          AND status != 'CANCELLED'
          AND paid_total > 0
        GROUP BY customer_id
        HAVING SUM(paid_total) > 0
      )
      SELECT
        percentile_cont(0.25) WITHIN GROUP (ORDER BY avg_ticket)::float AS p25,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY avg_ticket)::float AS p50,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY avg_ticket)::float AS p75,
        COUNT(*)::int AS count_paid
      FROM positive_tickets;
    `;
    if (qRow) {
      valueQuartiles = {
        p25: qRow.p25 ?? 0,
        p50: qRow.p50 ?? 0,
        p75: qRow.p75 ?? 0,
        countPaid: qRow.count_paid ?? 0,
      };
    }
  } else {
    valueQuartiles = { p25: 0, p50: 0, p75: 0, countPaid: positiveTickets.length };
  }

  console.log(`[PROFILE] Q1 & Quartiles: ${Date.now() - tMark} ms`);
  tMark = Date.now();

  // --------------------------------------------------------------------------
  // QUERY 2: Canonical Service Visit Extraction for the Tenant (Optimized CTEs)
  // --------------------------------------------------------------------------
  dbQueryCount++;
  const rawCanonicalVisits: any[] = await prisma.$queryRaw`
    WITH valid_comanda_services AS (
      SELECT
        comanda_id,
        MAX(completed_at) AS max_completed_at
      FROM comanda_items
      WHERE barbershop_id = ${barbershopId}
        AND type = 'SERVICE'
        AND status = 'DONE'
      GROUP BY comanda_id
    ),
    valid_comandas AS (
      SELECT
        c.id AS comanda_id,
        c.barbershop_id,
        c.appointment_id,
        c.customer_id,
        c.closed_at,
        vcs.max_completed_at
      FROM comandas c
      JOIN valid_comanda_services vcs ON vcs.comanda_id = c.id
      WHERE c.barbershop_id = ${barbershopId}
        AND c.customer_id IS NOT NULL
        AND c.status != 'CANCELLED'
    ),
    completed_appointments AS (
      SELECT
        id,
        barbershop_id,
        customer_id,
        date_time
      FROM appointments
      WHERE barbershop_id = ${barbershopId}
        AND customer_id IS NOT NULL
        AND status = 'COMPLETED'
    )
    SELECT
      COALESCE(a.barbershop_id, vc.barbershop_id) AS "barbershop_id",
      COALESCE(a.customer_id, vc.customer_id) AS "customer_id",
      CASE WHEN vc.comanda_id IS NOT NULL THEN vc.comanda_id ELSE a.id END AS "visit_id",
      CASE WHEN vc.comanda_id IS NOT NULL THEN 'COMANDA' ELSE 'APPOINTMENT' END AS "source",
      COALESCE(vc.max_completed_at, a.date_time, vc.closed_at) AS "visit_timestamp",
      ((COALESCE(vc.max_completed_at, a.date_time, vc.closed_at) AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date::text AS "civil_date"
    FROM completed_appointments a
    FULL OUTER JOIN valid_comandas vc ON vc.appointment_id = a.id
    WHERE COALESCE(a.customer_id, vc.customer_id) IS NOT NULL
    ORDER BY "customer_id", "civil_date" ASC, "visit_timestamp" ASC;
  `;

  // Process canonical visits per customer with Set lookups
  const customerVisitsMap = new Map<
    string,
    { visitDates: string[]; visitDateSet: Set<string>; latestVisitTimestamp: Date }
  >();

  for (const row of rawCanonicalVisits) {
    const custId = row.customer_id;
    const civilDate = row.civil_date;
    const ts = row.visit_timestamp instanceof Date ? row.visit_timestamp : new Date(row.visit_timestamp);

    const existing = customerVisitsMap.get(custId);
    if (!existing) {
      customerVisitsMap.set(custId, {
        visitDates: [civilDate],
        visitDateSet: new Set([civilDate]),
        latestVisitTimestamp: ts,
      });
    } else {
      if (!existing.visitDateSet.has(civilDate)) {
        existing.visitDateSet.add(civilDate);
        existing.visitDates.push(civilDate);
      }
      if (ts > existing.latestVisitTimestamp) {
        existing.latestVisitTimestamp = ts;
      }
    }
  }

  // Compute intervals per customer and build tenant-wide intervals
  const customerPersonalIntervalsMap = new Map<string, number[]>();
  const shopAllIntervals: number[] = [];

  for (const [custId, data] of customerVisitsMap.entries()) {
    const dates = data.visitDates; // sorted ASC
    const intervals: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const diff = getCivilDaysDifference(dates[i - 1], dates[i]);
      if (diff > 0) {
        intervals.push(diff);
      }
    }
    if (intervals.length > 0) {
      customerPersonalIntervalsMap.set(custId, intervals);
      shopAllIntervals.push(...intervals.slice(-6));
    }
  }

  console.log(`[PROFILE] Q2 Visits & Interval Prep: ${Date.now() - tMark} ms`);
  tMark = Date.now();

  // --------------------------------------------------------------------------
  // QUERY 3: Extract Service & Member Occurrences for Dominant Service & Favorite Member
  // --------------------------------------------------------------------------
  dbQueryCount++;
  const rawOccurrences: any[] = await prisma.$queryRaw`
    WITH valid_comanda_services AS (
      SELECT
        comanda_id
      FROM comanda_items
      WHERE barbershop_id = ${barbershopId}
        AND type = 'SERVICE'
        AND status = 'DONE'
      GROUP BY comanda_id
    ),
    valid_comandas AS (
      SELECT
        c.id AS comanda_id,
        c.appointment_id
      FROM comandas c
      JOIN valid_comanda_services vcs ON vcs.comanda_id = c.id
      WHERE c.barbershop_id = ${barbershopId}
        AND c.customer_id IS NOT NULL
        AND c.status != 'CANCELLED'
        AND c.appointment_id IS NOT NULL
    )
    SELECT
      c.customer_id AS "customerId",
      ci.service_id AS "serviceId",
      s.name AS "serviceName",
      ci.executor_id AS "executorId",
      m_user.name AS "executorName",
      COALESCE(ci.completed_at, c.closed_at) AS "timestamp",
      ((COALESCE(ci.completed_at, c.closed_at) AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date::text AS "civilDate"
    FROM comanda_items ci
    JOIN comandas c ON c.id = ci.comanda_id
    JOIN services s ON s.id = ci.service_id
    LEFT JOIN barbershop_members m ON m.id = ci.executor_id
    LEFT JOIN users m_user ON m_user.id = m.user_id
    WHERE ci.barbershop_id = ${barbershopId}
      AND c.customer_id IS NOT NULL
      AND c.status != 'CANCELLED'
      AND ci.type = 'SERVICE'
      AND ci.status = 'DONE'

    UNION ALL

    SELECT
      a.customer_id AS "customerId",
      aps.service_id AS "serviceId",
      s.name AS "serviceName",
      a.member_id AS "executorId",
      m_user.name AS "executorName",
      a.date_time AS "timestamp",
      ((a.date_time AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date::text AS "civilDate"
    FROM appointment_services aps
    JOIN appointments a ON a.id = aps.appointment_id
    JOIN services s ON s.id = aps.service_id
    LEFT JOIN barbershop_members m ON m.id = a.member_id
    LEFT JOIN users m_user ON m_user.id = m.user_id
    LEFT JOIN valid_comandas vc ON vc.appointment_id = a.id
    WHERE a.barbershop_id = ${barbershopId}
      AND a.customer_id IS NOT NULL
      AND a.status = 'COMPLETED'
      AND vc.comanda_id IS NULL;
  `;

  // Map occurrences per customer and inverted map for service intervals
  const customerServiceOccurrences = new Map<string, any[]>();
  const customerMemberOccurrences = new Map<string, any[]>();
  const serviceCustomerDatesMap = new Map<string, Map<string, Set<string>>>();

  for (const row of rawOccurrences) {
    const custId = row.customerId;
    const ts = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);

    if (!customerServiceOccurrences.has(custId)) {
      customerServiceOccurrences.set(custId, []);
    }
    customerServiceOccurrences.get(custId)!.push({
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      timestamp: ts,
      civilDate: row.civilDate,
    });

    let custSvcMap = serviceCustomerDatesMap.get(row.serviceId);
    if (!custSvcMap) {
      custSvcMap = new Map<string, Set<string>>();
      serviceCustomerDatesMap.set(row.serviceId, custSvcMap);
    }
    let dateSet = custSvcMap.get(custId);
    if (!dateSet) {
      dateSet = new Set<string>();
      custSvcMap.set(custId, dateSet);
    }
    dateSet.add(row.civilDate);

    if (row.executorId && row.executorName) {
      if (!customerMemberOccurrences.has(custId)) {
        customerMemberOccurrences.set(custId, []);
      }
      customerMemberOccurrences.get(custId)!.push({
        memberId: row.executorId,
        memberName: row.executorName,
        timestamp: ts,
      });
    }
  }

  // Memoized lazy service interval calculation
  const serviceIntervalsMemo = new Map<string, ServiceIntervalData>();
  function getServiceIntervalDataOnDemand(svcId: string): ServiceIntervalData {
    const existing = serviceIntervalsMemo.get(svcId);
    if (existing) return existing;

    const intervals: number[] = [];
    const custSvcMap = serviceCustomerDatesMap.get(svcId);
    let distinctCustomerCount = 0;

    if (custSvcMap) {
      for (const [, dateSet] of custSvcMap.entries()) {
        if (dateSet.size >= 2) {
          distinctCustomerCount++;
          const uniqueDates = Array.from(dateSet).sort();
          for (let i = 1; i < uniqueDates.length; i++) {
            const diff = getCivilDaysDifference(uniqueDates[i - 1], uniqueDates[i]);
            if (diff > 0) intervals.push(diff);
          }
        }
      }
    }

    const medianDays = intervals.length >= 5 ? calculateStatisticalMedian(intervals) : undefined;
    const data = { intervals, distinctCustomerCount, medianDays };
    serviceIntervalsMemo.set(svcId, data);
    return data;
  }

  console.log(`[PROFILE] Q3 Occurrences & Occur Map: ${Date.now() - tMark} ms`);
  tMark = Date.now();

  // --------------------------------------------------------------------------
  // QUERY 4: Fetch Context Data (No-Shows, Upcoming Appts, Blocked, Contact Logs, Consents, Users)
  // --------------------------------------------------------------------------
  dbQueryCount++;

  const noShowRows: any[] = await prisma.$queryRaw`
    SELECT customer_id AS "customerId", COUNT(*)::int AS "count"
    FROM appointments
    WHERE barbershop_id = ${barbershopId}
      AND customer_id IS NOT NULL
      AND status = 'NO_SHOW'
    GROUP BY customer_id
  `;
  const noShowMap = new Map<string, number>();
  for (const r of noShowRows) {
    noShowMap.set(r.customerId, r.count);
  }

  const upcomingRows: any[] = await prisma.$queryRaw`
    SELECT DISTINCT customer_id AS "customerId"
    FROM appointments
    WHERE barbershop_id = ${barbershopId}
      AND customer_id IS NOT NULL
      AND date_time > ${now}
      AND status IN ('PENDING', 'CONFIRMED')
  `;
  const upcomingSet = new Set<string>(upcomingRows.map((r) => r.customerId));

  const blockedRows: any[] = await prisma.barbershopBlockedCustomer.findMany({
    where: { barbershopId, active: true },
    select: { userId: true, phoneNormalized: true },
  });
  const blockedUserIds = new Set<string>(
    blockedRows.map((b) => b.userId).filter(Boolean) as string[]
  );
  const blockedPhones = new Set<string>(
    blockedRows.map((b) => b.phoneNormalized).filter(Boolean)
  );

  const contactLogRows: any[] = await prisma.$queryRaw`
    SELECT
      customer_id AS "customerId",
      MAX(contacted_at) AS "latestContactedAt",
      ((MAX(contacted_at) AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date::text AS "contactCivilDate"
    FROM customer_contact_logs
    WHERE barbershop_id = ${barbershopId}
      AND customer_id IS NOT NULL
    GROUP BY customer_id
  `;
  const contactLogMap = new Map<
    string,
    { latestContactedAt: Date; contactCivilDate: string }
  >();
  for (const r of contactLogRows) {
    const d = r.latestContactedAt instanceof Date ? r.latestContactedAt : new Date(r.latestContactedAt);
    contactLogMap.set(r.customerId, { latestContactedAt: d, contactCivilDate: r.contactCivilDate });
  }

  const consentRows: any[] = await prisma.customerMarketingConsent.findMany({
    where: { barbershopId, channel: "WHATSAPP", purpose: "MARKETING" },
    select: { customerId: true, status: true },
  });
  const consentMap = new Map<string, VirtualMarketingConsentStatus>();
  for (const c of consentRows) {
    consentMap.set(c.customerId, c.status as VirtualMarketingConsentStatus);
  }

  const tenantCustomers: any[] = await prisma.$queryRaw`
    WITH tenant_customer_ids AS (
      SELECT customer_id AS id FROM customer_barbershop_links WHERE barbershop_id = ${barbershopId} AND customer_id IS NOT NULL
      UNION
      SELECT customer_id AS id FROM appointments WHERE barbershop_id = ${barbershopId} AND customer_id IS NOT NULL
      UNION
      SELECT customer_id AS id FROM comandas WHERE barbershop_id = ${barbershopId} AND customer_id IS NOT NULL
    )
    SELECT u.id, u.name, u.phone
    FROM tenant_customer_ids tci
    JOIN users u ON u.id = tci.id
    ORDER BY u.id ASC;
  `;

  console.log(`[PROFILE] Q4 Context & Customers: ${Date.now() - tMark} ms`);
  tMark = Date.now();

  // Pre-calculate tenant barbershop median once for all fallback customers
  const barbershopMedianDays = shopAllIntervals.length >= 10 ? calculateStatisticalMedian(shopAllIntervals) : null;

  // --------------------------------------------------------------------------
  // LIGHTWEIGHT PASS FOR ALL CUSTOMERS
  // --------------------------------------------------------------------------
  const allLightweightCandidates: LightweightCandidate[] = [];

  let recommendedCount = 0;
  let dueSoonCount = 0;
  let dueCount = 0;
  let overdueCount = 0;
  let inactiveCount = 0;
  let summaryPotentialRevenue = 0;

  for (const cust of tenantCustomers) {
    const custId = cust.id;
    const phone = cust.phone ?? null;

    const visitData = customerVisitsMap.get(custId);
    const completedVisitCount = visitData ? visitData.visitDates.length : 0;
    const lastVisitLocalDate = visitData
      ? visitData.visitDates[visitData.visitDates.length - 1]
      : null;

    const personalIntervals = customerPersonalIntervalsMap.get(custId) ?? [];
    let dominantServiceIntervalData: ServiceIntervalData | null = null;

    if (personalIntervals.length < 3) {
      const svcOccurrences = customerServiceOccurrences.get(custId) ?? [];
      const domSvc = resolveDominantService(svcOccurrences);
      if (domSvc) {
        dominantServiceIntervalData = getServiceIntervalDataOnDemand(domSvc.id);
      }
    }

    const { expectedReturnDays, expectedReturnSource } = resolveCustomerRecurrence(
      {
        personalIntervals,
        dominantServiceIntervalData,
        barbershopIntervals: shopAllIntervals,
        barbershopMedianDays,
      }
    );

    let daysSinceLastVisit: number | null = null;
    let daysOverdue: number | null = null;
    let returnRatio: number | null = null;

    if (lastVisitLocalDate) {
      daysSinceLastVisit = getCivilDaysDifference(lastVisitLocalDate, todayStr);
      daysOverdue = daysSinceLastVisit - expectedReturnDays;
      returnRatio = daysSinceLastVisit / expectedReturnDays;
    }

    const timingState = resolveCustomerTimingState(
      completedVisitCount,
      returnRatio
    );
    const timingLabel = getTimingStateLabel(timingState);

    const ticketInfo = avgTicketMap.get(custId);
    const averageTicket = ticketInfo ? ticketInfo.averageTicket : 0;
    const potentialRevenue = averageTicket;

    const noShowCount = noShowMap.get(custId) ?? 0;
    const totalVisitsAndNoShows = completedVisitCount + noShowCount;
    const noShowRate =
      totalVisitsAndNoShows > 0 ? noShowCount / totalVisitsAndNoShows : 0;

    const contactInfo = contactLogMap.get(custId);
    let daysSinceLastContact: number | null = null;
    let lastContactedAtStr: string | null = null;

    if (contactInfo) {
      lastContactedAtStr = contactInfo.latestContactedAt.toISOString();
      daysSinceLastContact = getCivilDaysDifference(
        contactInfo.contactCivilDate,
        todayStr
      );
    }

    const consentStatus = consentMap.get(custId) ?? "UNKNOWN";

    const hasUpcomingAppointment = upcomingSet.has(custId);
    const isBlocked =
      blockedUserIds.has(custId) ||
      (phone ? blockedPhones.has(phone) : false);

    const suppressionResult = evaluateSuppressions({
      phone,
      completedVisitCount,
      hasUpcomingAppointment,
      isBlocked,
      daysSinceLastContact,
      consentStatus,
      timingState,
    });

    const timingScore = calculateTimingScore(returnRatio);
    const valueScore = calculateValueScore(averageTicket, valueQuartiles);
    const confidenceScore = calculateConfidenceScore(completedVisitCount);
    const reliabilityScore = calculateReliabilityScore(
      completedVisitCount,
      noShowCount
    );
    const fatiguePenalty = calculateFatiguePenalty(daysSinceLastContact);

    const scoreComponents = {
      timing: timingScore,
      value: valueScore,
      confidence: confidenceScore,
      reliability: reliabilityScore,
      fatigue: fatiguePenalty,
    };

    const finalScore = calculateFinalScore(scoreComponents);

    // Accumulate summary counters
    if (suppressionResult.recommendationEligible) {
      if (timingState === CustomerTimingState.DUE_SOON) {
        dueSoonCount++;
      } else if (timingState === CustomerTimingState.DUE) {
        dueCount++;
        recommendedCount++;
        summaryPotentialRevenue += potentialRevenue;
      } else if (timingState === CustomerTimingState.OVERDUE) {
        overdueCount++;
        recommendedCount++;
        summaryPotentialRevenue += potentialRevenue;
      } else if (timingState === CustomerTimingState.INACTIVE) {
        inactiveCount++;
        recommendedCount++;
        summaryPotentialRevenue += potentialRevenue;
      }
    }

    allLightweightCandidates.push({
      cust: { id: custId, name: cust.name, phone: cust.phone ?? null },
      completedVisitCount,
      lastVisitLocalDate,
      expectedReturnLocalDate: null, // Computed lazily during page hydration
      expectedReturnDays,
      expectedReturnSource,
      daysSinceLastVisit,
      daysOverdue,
      returnRatio,
      score: finalScore,
      scoreComponents,
      averageTicket,
      potentialRevenue,
      noShowRate,
      lastContactedAtStr,
      daysSinceLastContact,
      consentStatus,
      recommendationEligible: suppressionResult.recommendationEligible,
      dispatchEligible: suppressionResult.dispatchEligible,
      recommendationSuppressions: suppressionResult.recommendationSuppressions,
      dispatchSuppressions: suppressionResult.dispatchSuppressions,
      defaultSelected: suppressionResult.defaultSelected,
      timingState,
      timingLabel,
    });
  }

  console.log(`[PROFILE] Lightweight Pass Loop (10k items): ${Date.now() - tMark} ms`);
  tMark = Date.now();

  // --------------------------------------------------------------------------
  // FILTER & PAGINATE CANDIDATES
  // --------------------------------------------------------------------------
  let filtered = allLightweightCandidates;

  if (!options.includeSuppressed) {
    filtered = filtered.filter((item) => item.recommendationEligible);
  }

  if (options.timingState) {
    filtered = filtered.filter(
      (item) => item.timingState === options.timingState
    );
  } else if (!options.includeSuppressed) {
    filtered = filtered.filter(
      (item) =>
        item.timingState === CustomerTimingState.DUE_SOON ||
        item.timingState === CustomerTimingState.DUE ||
        item.timingState === CustomerTimingState.OVERDUE ||
        item.timingState === CustomerTimingState.INACTIVE
    );
  }

  // Sort by stable keyset order: score DESC, daysOverdue DESC, customerId ASC
  filtered.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const daysA = a.daysOverdue ?? -999999;
    const daysB = b.daysOverdue ?? -999999;
    if (daysB !== daysA) {
      return daysB - daysA;
    }
    return a.cust.id < b.cust.id ? -1 : a.cust.id > b.cust.id ? 1 : 0;
  });

  // Apply cursor pagination
  if (cursorPayload) {
    const cp = cursorPayload;
    filtered = filtered.filter((item) => {
      const itemDays = item.daysOverdue ?? -999999;
      if (item.score < cp.score) return true;
      if (item.score === cp.score && itemDays < cp.daysOverdue) return true;
      if (
        item.score === cp.score &&
        itemDays === cp.daysOverdue &&
        item.cust.id > cp.customerId
      )
        return true;
      return false;
    });
  }

  // Slice page items
  const pageLightweight = filtered.slice(0, limit);
  let nextCursor: string | null = null;
  if (filtered.length > limit) {
    const lastItem = pageLightweight[pageLightweight.length - 1];
    nextCursor = encodeCursor({
      v: 1,
      score: lastItem.score,
      daysOverdue: lastItem.daysOverdue ?? -999999,
      customerId: lastItem.cust.id,
    });
  }

  // --------------------------------------------------------------------------
  // HYDRATE FULL OBJECTS ONLY FOR PAGINATED ITEMS
  // --------------------------------------------------------------------------
  const items: ReactivationCandidateItem[] = pageLightweight.map((item) => {
    const custId = item.cust.id;
    const svcOccurrences = customerServiceOccurrences.get(custId) ?? [];
    const dominantService = resolveDominantService(svcOccurrences);
    const memberOccurrences = customerMemberOccurrences.get(custId) ?? [];
    const favoriteProfessional = resolveFavoriteProfessional(memberOccurrences);

    const expectedReturnLocalDate = item.lastVisitLocalDate
      ? addCivilDays(item.lastVisitLocalDate, item.expectedReturnDays)
      : null;

    const scoreReasons = generateScoreReasons({
      timingState: item.timingState,
      daysOverdue: item.daysOverdue,
      expectedReturnDays: item.expectedReturnDays,
      expectedReturnSource: item.expectedReturnSource,
      completedVisitCount: item.completedVisitCount,
      averageTicket: item.averageTicket,
      scoreComponents: item.scoreComponents,
      noShowRate: item.noShowRate,
      daysSinceLastContact: item.daysSinceLastContact,
    });

    return {
      customer: {
        id: item.cust.id,
        name: item.cust.name,
        phone: item.cust.phone,
      },
      timingState: item.timingState,
      timingLabel: item.timingLabel,
      lastVisitLocalDate: item.lastVisitLocalDate,
      expectedReturnLocalDate,
      expectedReturnDays: item.expectedReturnDays,
      expectedReturnSource: item.expectedReturnSource,
      daysSinceLastVisit: item.daysSinceLastVisit,
      daysOverdue: item.daysOverdue,
      returnRatio: item.returnRatio,
      score: item.score,
      scoreComponents: item.scoreComponents,
      scoreReasons,
      completedVisitCount: item.completedVisitCount,
      averageTicket: item.averageTicket,
      potentialRevenue: item.potentialRevenue,
      noShowRate: item.noShowRate,
      favoriteProfessional,
      dominantService,
      lastContactedAt: item.lastContactedAtStr,
      consentStatus: item.consentStatus,
      recommendationEligible: item.recommendationEligible,
      dispatchEligible: item.dispatchEligible,
      recommendationSuppressions: item.recommendationSuppressions,
      dispatchSuppressions: item.dispatchSuppressions,
      defaultSelected: item.defaultSelected,
    };
  });

  console.log(`[PROFILE] Sort & Page Hydration: ${Date.now() - tMark} ms`);

  const queryEndTime = Date.now();

  return {
    generatedAt: now.toISOString(),
    scoreVersion: SMART_CRM_SCORE_VERSION,
    recurrenceVersion: SMART_CRM_RECURRENCE_VERSION,
    items,
    page: {
      limit,
      nextCursor,
    },
    summary: {
      recommendedCount,
      dueSoonCount,
      dueCount,
      overdueCount,
      inactiveCount,
      potentialRevenue: Math.round(summaryPotentialRevenue * 100) / 100,
    },
    meta: {
      queryCount: dbQueryCount,
      latencyMs: queryEndTime - queryStartTime,
    },
  };
}
