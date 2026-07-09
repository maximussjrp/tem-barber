import { Prisma, AppointmentStatus, AppointmentBookingMode, ComandaStatus } from "@prisma/client";

// ============================================================================
// PRODUCT HEURISTICS & CONSTANTS (CENTRALIZED)
// ============================================================================
export const RETURN_STATUS_THRESHOLDS = {
  IN_CYCLE_LIMIT: 0.8,
  DUE_SOON_LIMIT: 1.1,
  LATE_LIMIT: 1.5,
} as const;

export const NO_SHOW_THRESHOLDS = {
  HIGH_RELIABILITY_LIMIT: 5.0,
  WARNING_LIMIT: 15.0,
  MIN_EVENTS_FOR_RELIABILITY: 3,
} as const;

export const RETURN_MIN_DATES_FOR_STATUS = 3;
export const RETURN_MIN_DATES_FOR_AVERAGE = 2;

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export type ReturnStatus = "INSUFFICIENT_DATA" | "IN_CYCLE" | "DUE_SOON" | "LATE" | "AT_RISK";
export type ReliabilityLabel = "INSUFFICIENT_DATA" | "HIGH" | "WARNING" | "RISK";

export interface ClientMetrics {
  totalAppointments: number;
  completedVisits: number;
  cancelledCount: number;
  noShowCount: number;
  upcomingAppointments: number;
  totalSpent: number;
  averageTicket: number;
  firstCompletedVisitAt: Date | null;
  lastCompletedVisitAt: Date | null;
  nextAppointmentAt: Date | null;
  customerSinceAt: Date | null;
  averageReturnDays: number | null;
  favoriteProfessional: { id: string; name: string } | null;
  favoriteService: { id: string; name: string } | null;
  averageRatingGiven: number | null;
  noShowRate: number;
  returnStatus: ReturnStatus;
  reliabilityLabel: ReliabilityLabel;
}

/**
 * Converte um objeto Date para uma string "YYYY-MM-DD" baseada no fuso horário local ("America/Sao_Paulo").
 */
export function getLocalDateString(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

/**
 * Calcula a diferença em dias entre duas datas locais (ignora o fuso UTC e compara as datas calendário).
 */
export function diffInDaysLocal(d1: Date, d2: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const dateStr1 = getLocalDateString(d1, timeZone);
  const dateStr2 = getLocalDateString(d2, timeZone);
  const [y1, m1, day1] = dateStr1.split("-").map(Number);
  const [y2, m2, day2] = dateStr2.split("-").map(Number);

  const utc1 = Date.UTC(y1, m1 - 1, day1);
  const utc2 = Date.UTC(y2, m2 - 1, day2);

  return Math.round((utc2 - utc1) / (1000 * 60 * 60 * 24));
}

/**
 * Computa as métricas 360 do cliente baseado nos seus dados brutos de agendamentos e comandas.
 */
export function computeClientMetrics(params: {
  barbershopId: string;
  customerId: string;
  appointments: Array<{
    id: string;
    dateTime: Date;
    status: AppointmentStatus;
    bookingMode: AppointmentBookingMode;
    createdAt: Date;
    totalPrice: Prisma.Decimal | number;
    barber: { id: string; user: { name: string } };
    services: Array<{ service: { id: string; name: string } }>;
  }>;
  comandas: Array<{
    id: string;
    status: ComandaStatus;
    paidTotal: Prisma.Decimal | number;
  }>;
  reviews: Array<{
    rating: number;
  }>;
  now?: Date;
}): ClientMetrics {
  const referenceNow = params.now || new Date();

  // --- 1. totalAppointments ---
  const totalAppointments = params.appointments.length;

  // --- 2. completedVisits ---
  const completedAppointments = params.appointments.filter(
    (a) => a.status === AppointmentStatus.COMPLETED
  );
  const completedVisits = completedAppointments.length;

  // --- 3. cancelledCount ---
  const cancelledCount = params.appointments.filter(
    (a) => a.status === AppointmentStatus.CANCELLED
  ).length;

  // --- 4. noShowCount ---
  const noShowCount = params.appointments.filter(
    (a) => a.status === AppointmentStatus.NO_SHOW
  ).length;

  // --- 5. upcomingAppointments & nextAppointmentAt ---
  const futureActive = params.appointments
    .filter(
      (a) =>
        a.dateTime.getTime() > referenceNow.getTime() &&
        (a.status === AppointmentStatus.CONFIRMED || a.status === AppointmentStatus.PENDING)
    )
    .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());

  const upcomingAppointments = futureActive.length;
  const nextAppointmentAt = futureActive.length > 0 ? futureActive[0].dateTime : null;

  // --- 6. totalSpent ---
  // SUM(Comanda.paidTotal)
  // - status != CANCELLED
  // - paidTotal > 0
  const validComandas = params.comandas.filter(
    (c) => c.status !== ComandaStatus.CANCELLED && Number(c.paidTotal) > 0
  );
  const totalSpent = validComandas.reduce((sum, c) => sum + Number(c.paidTotal), 0);

  // --- 7. averageTicket ---
  const paidCommandasCount = validComandas.length;
  const averageTicket = paidCommandasCount > 0 ? totalSpent / paidCommandasCount : 0;

  // --- 8. firstCompletedVisitAt & lastCompletedVisitAt ---
  const completedSorted = [...completedAppointments].sort(
    (a, b) => a.dateTime.getTime() - b.dateTime.getTime()
  );
  const firstCompletedVisitAt = completedSorted.length > 0 ? completedSorted[0].dateTime : null;
  const lastCompletedVisitAt =
    completedSorted.length > 0 ? completedSorted[completedSorted.length - 1].dateTime : null;

  // --- 9. customerSinceAt ---
  // MIN(Appointment.createdAt)
  const appointmentsByCreatedAt = [...params.appointments].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );
  const customerSinceAt =
    appointmentsByCreatedAt.length > 0 ? appointmentsByCreatedAt[0].createdAt : null;

  // --- 10. averageReturnDays & returnStatus ---
  // Extrair as datas locais únicas do timezone America/Sao_Paulo
  const distinctLocalDates = Array.from(
    new Set(completedSorted.map((a) => getLocalDateString(a.dateTime, DEFAULT_TIMEZONE)))
  )
    .map((str) => {
      const [y, m, d] = str.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d)); // Objeto UTC normalizado para a data local
    })
    .sort((a, b) => a.getTime() - b.getTime());

  const completedDistinctDaysCount = distinctLocalDates.length;

  let averageReturnDays: number | null = null;
  if (completedDistinctDaysCount >= RETURN_MIN_DATES_FOR_AVERAGE) {
    let totalDiff = 0;
    for (let i = 0; i < completedDistinctDaysCount - 1; i++) {
      const diffTime = distinctLocalDates[i + 1].getTime() - distinctLocalDates[i].getTime();
      totalDiff += Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
    averageReturnDays = Math.round(totalDiff / (completedDistinctDaysCount - 1));
  }

  let returnStatus: ReturnStatus = "INSUFFICIENT_DATA";
  if (nextAppointmentAt) {
    // Regra 6: se existe agendamento futuro ativo, o status é IN_CYCLE
    returnStatus = "IN_CYCLE";
  } else if (completedDistinctDaysCount < RETURN_MIN_DATES_FOR_STATUS) {
    // Regra 5: com menos de 3 datas COMPLETED distintas, status é INSUFFICIENT_DATA
    returnStatus = "INSUFFICIENT_DATA";
  } else if (averageReturnDays !== null && lastCompletedVisitAt !== null) {
    // Diferença em dias locais desde a última visita em relação ao referenceNow
    const D = diffInDaysLocal(lastCompletedVisitAt, referenceNow, DEFAULT_TIMEZONE);
    const F = averageReturnDays;

    if (D <= RETURN_STATUS_THRESHOLDS.IN_CYCLE_LIMIT * F) {
      returnStatus = "IN_CYCLE";
    } else if (D <= RETURN_STATUS_THRESHOLDS.DUE_SOON_LIMIT * F) {
      returnStatus = "DUE_SOON";
    } else if (D <= RETURN_STATUS_THRESHOLDS.LATE_LIMIT * F) {
      returnStatus = "LATE";
    } else {
      returnStatus = "AT_RISK";
    }
  }

  // --- 11. favoriteProfessional (desempate determinístico) ---
  const professionalCounts: Record<string, { count: number; name: string; lastDateTime: number }> = {};
  for (const appt of completedAppointments) {
    const pid = appt.barber.id;
    if (!professionalCounts[pid]) {
      professionalCounts[pid] = { count: 0, name: appt.barber.user.name, lastDateTime: 0 };
    }
    professionalCounts[pid].count += 1;
    if (appt.dateTime.getTime() > professionalCounts[pid].lastDateTime) {
      professionalCounts[pid].lastDateTime = appt.dateTime.getTime();
    }
  }
  let favoriteProfessional: { id: string; name: string } | null = null;
  let maxProfCount = -1;
  let maxProfLastTime = -1;
  for (const [pid, data] of Object.entries(professionalCounts)) {
    if (
      data.count > maxProfCount ||
      (data.count === maxProfCount && data.lastDateTime > maxProfLastTime)
    ) {
      maxProfCount = data.count;
      maxProfLastTime = data.lastDateTime;
      favoriteProfessional = { id: pid, name: data.name };
    }
  }

  // --- 12. favoriteService (desempate determinístico) ---
  const serviceCounts: Record<string, { count: number; name: string; lastDateTime: number }> = {};
  for (const appt of completedAppointments) {
    for (const s of appt.services) {
      const sid = s.service.id;
      if (!serviceCounts[sid]) {
        serviceCounts[sid] = { count: 0, name: s.service.name, lastDateTime: 0 };
      }
      serviceCounts[sid].count += 1;
      if (appt.dateTime.getTime() > serviceCounts[sid].lastDateTime) {
        serviceCounts[sid].lastDateTime = appt.dateTime.getTime();
      }
    }
  }
  let favoriteService: { id: string; name: string } | null = null;
  let maxSvcCount = -1;
  let maxSvcLastTime = -1;
  for (const [sid, data] of Object.entries(serviceCounts)) {
    if (
      data.count > maxSvcCount ||
      (data.count === maxSvcCount && data.lastDateTime > maxSvcLastTime)
    ) {
      maxSvcCount = data.count;
      maxSvcLastTime = data.lastDateTime;
      favoriteService = { id: sid, name: data.name };
    }
  }

  // --- 13. averageRatingGiven ---
  const ratings = params.reviews.map((r) => r.rating);
  const averageRatingGiven =
    ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null;

  // --- 14. noShowRate & reliabilityLabel ---
  const reliabilityDenominator = completedVisits + noShowCount;
  const noShowRate =
    reliabilityDenominator > 0 ? (noShowCount / reliabilityDenominator) * 100 : 0;

  let reliabilityLabel: ReliabilityLabel = "INSUFFICIENT_DATA";
  if (reliabilityDenominator >= NO_SHOW_THRESHOLDS.MIN_EVENTS_FOR_RELIABILITY) {
    if (noShowRate < NO_SHOW_THRESHOLDS.HIGH_RELIABILITY_LIMIT) {
      reliabilityLabel = "HIGH";
    } else if (noShowRate < NO_SHOW_THRESHOLDS.WARNING_LIMIT) {
      reliabilityLabel = "WARNING";
    } else {
      reliabilityLabel = "RISK";
    }
  }

  return {
    totalAppointments,
    completedVisits,
    cancelledCount,
    noShowCount,
    upcomingAppointments,
    totalSpent,
    averageTicket,
    firstCompletedVisitAt,
    lastCompletedVisitAt,
    nextAppointmentAt,
    customerSinceAt,
    averageReturnDays,
    favoriteProfessional,
    favoriteService,
    averageRatingGiven,
    noShowRate,
    returnStatus,
    reliabilityLabel,
  };
}
