import {
  formatTimestampToCivilDateBR,
  localDateToUTCBoundary,
  shiftDateISO,
} from "@/lib/time-utils";

export interface RawWorkingHourInput {
  dayOfWeek?: number;
  startTime: string;
  endTime: string;
  breakStart?: string | null;
  breakEnd?: string | null;
  isActive?: boolean;
}

export interface RawTimeOffInput {
  id?: string;
  startDate: Date | string;
  endDate: Date | string;
  allDay?: boolean;
  reason?: string | null;
}

export interface RawMemberInput {
  id: string;
  user?: {
    name?: string | null;
    avatarUrl?: string | null;
  } | null;
  services?: { serviceId: string }[];
  workingHours?: RawWorkingHourInput[];
  timeOffs?: RawTimeOffInput[];
}

export interface RawAppointmentInput {
  id?: string;
  memberId?: string | null;
  customerId?: string | null;
  dateTime: Date | string;
  durationMin?: number | null;
  status?: string | null;
  totalPrice?: unknown;
  customer?: {
    name?: string | null;
    avatarUrl?: string | null;
  } | null;
  services?: {
    service?: {
      name?: string | null;
      durationMin?: number | null;
    } | null;
  }[];
  comandas?: {
    id?: string;
    status: string;
    total?: unknown;
    discountTotal?: unknown;
    surchargeTotal?: unknown;
  }[];
}

export interface RawStandaloneComandaInput {
  id: string;
  memberId?: string | null;
  appointmentId?: string | null;
  status: string;
  openedAt?: Date | string | null;
  closedAt?: Date | string | null;
  items?: {
    id?: string;
    type?: string;
    status?: string;
    quantity?: unknown;
    executorId?: string | null;
    completedAt?: Date | string | null;
    service?: {
      name?: string | null;
      durationMin?: number | null;
    } | null;
  }[];
}

/**
 * Constrói a cláusula `where` do Prisma para consulta de comandas avulsas.
 * Garante:
 * - barbershopId obrigatório
 * - appointmentId: null (sem vínculo com agendamento para evitar dupla contagem)
 * - status da comanda !== CANCELLED
 * - itens com type === SERVICE e status === DONE
 * - intervalo semiaberto [inicioLocalEmUTC, inicioDoDiaLocalSeguinteEmUTC) em America/Sao_Paulo
 * - sem ramos arbitrários baseados em createdAt, openedAt ou closedAt
 */
export function buildStandaloneComandasWhereClause(
  barbershopId: string,
  todayStr: string
) {
  const gte = localDateToUTCBoundary(todayStr);
  const lt = localDateToUTCBoundary(shiftDateISO(todayStr, 1));
  return {
    barbershopId,
    appointmentId: null,
    status: { not: "CANCELLED" as const },
    items: {
      some: {
        type: "SERVICE" as const,
        status: "DONE" as const,
        completedAt: { gte, lt },
      },
    },
  };
}

/**
 * Constrói o filtro `where` para a seleção de itens de serviços concluídos da comanda.
 */
export function buildStandaloneComandaItemsWhereClause(todayStr: string) {
  const gte = localDateToUTCBoundary(todayStr);
  const lt = localDateToUTCBoundary(shiftDateISO(todayStr, 1));
  return {
    type: "SERVICE" as const,
    status: "DONE" as const,
    completedAt: { gte, lt },
  };
}

export type TodaySlotStatus =
  | "available"
  | "scheduled"
  | "completed"
  | "blocked"
  | "occupied";

export interface TodaySlotProfessionalDetail {
  memberId: string;
  memberName: string;
  status: "available" | "scheduled" | "completed" | "blocked";
}

export interface TodaySlotItem {
  time: string;
  minuteOfDay?: number;
  status: TodaySlotStatus;
  isPast?: boolean;
  totalWorking?: number;
  availableCount?: number;
  scheduledCount?: number;
  completedCount?: number;
  blockedCount?: number;
  professionals?: TodaySlotProfessionalDetail[];
}

export interface OccupancyBreakdown {
  capacityMinutes: number;
  completedMinutes: number;
  scheduledMinutes: number;
  totalDemandMinutes: number;
  overloadMinutes: number;
  workloadPct: number | null;
  workloadPctDisplay: number;
  workloadBarPct: number;
  overloadPct: number;
  workloadFormatted: string;
  overloadFormatted: string | null;
  hasCapacity: boolean;
  capacityAvailable: boolean;
  physicallyOccupiedMinutes: number;
  physicalOccupancyPct: number;
  equivalentCapacity30: number;
  equivalentDemand30: number;
  equivalentOverload30: number;
  completedCount: number;
  scheduledCount: number;
}

export interface AttendanceSummaryStats {
  periodLabel: string;
  total: number;
  completed: number;
  pending: number;
  confirmed: number;
  cancelled: number;
  noShow: number;
}

export interface ComputedProfessionalMetrics {
  memberId: string;
  memberName: string;
  avatarUrl: string | null;
  weeklyRevenue: number;
  dailyRevenue: number;
  working: boolean;
  onTimeOff: boolean;
  startTime: string;
  endTime: string;
  totalSlots: number;
  bookedSlots: number;
  completedSlots: number;
  blockedSlots: number[];
  freeSlots: number[];
  capacityMinutes: number;
  completedMinutes: number;
  scheduledMinutes: number;
  totalDemandMinutes: number;
  overloadMinutes: number;
  completedCount: number;
  scheduledCount: number;
  equivalentCapacity30: number;
  equivalentDemand30: number;
  equivalentOverload30: number;
  workloadPct: number | null;
  physicallyOccupiedMinutes: number;
  physicalOccupancyPct: number;
}

const SLOT_MIN = 30;

export function parseHHMM(hhmm: string | null | undefined): number | null {
  if (!hhmm || typeof hhmm !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (
    !Number.isFinite(h) ||
    !Number.isFinite(m) ||
    h < 0 ||
    h > 24 ||
    m < 0 ||
    m >= 60
  ) {
    return null;
  }
  return h * 60 + m;
}

export function formatMinutesToHHMM(totalMinutes: number): string {
  const normalized = Math.max(0, Math.floor(totalMinutes));
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatOccupancyPercent(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return "0%";
  }
  const rounded = Math.round(pct * 100) / 100;
  if (Number.isInteger(rounded)) {
    return `${rounded}%`;
  }
  return `${rounded.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })}%`;
}

export function formatEquivalentUnits(units: number): string {
  if (!Number.isFinite(units)) return "0";
  const rounded = Math.round(units * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
}

export function mergeIntervals(
  intervals: [number, number][]
): [number, number][] {
  const valid = intervals
    .filter(
      ([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s
    )
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  if (valid.length === 0) return [];

  const merged: [number, number][] = [[valid[0][0], valid[0][1]]];
  for (let i = 1; i < valid.length; i++) {
    const [curStart, curEnd] = valid[i];
    const last = merged[merged.length - 1];
    if (curStart <= last[1]) {
      last[1] = Math.max(last[1], curEnd);
    } else {
      merged.push([curStart, curEnd]);
    }
  }
  return merged;
}

export function subtractIntervals(
  baseStart: number,
  baseEnd: number,
  exclusions: [number, number][]
): [number, number][] {
  if (
    !Number.isFinite(baseStart) ||
    !Number.isFinite(baseEnd) ||
    baseEnd <= baseStart
  ) {
    return [];
  }
  const clamped = exclusions
    .map(([s, e]): [number, number] => [
      Math.max(baseStart, s),
      Math.min(baseEnd, e),
    ])
    .filter(([s, e]) => e > s);

  const mergedExclusions = mergeIntervals(clamped);
  if (mergedExclusions.length === 0) {
    return [[baseStart, baseEnd]];
  }

  const available: [number, number][] = [];
  let cursor = baseStart;
  for (const [exStart, exEnd] of mergedExclusions) {
    if (exStart > cursor) {
      available.push([cursor, exStart]);
    }
    cursor = Math.max(cursor, exEnd);
  }
  if (cursor < baseEnd) {
    available.push([cursor, baseEnd]);
  }
  return available;
}

export function resolveReliableDurationMin(
  appt: Pick<RawAppointmentInput, "durationMin" | "services">
): number {
  if (
    typeof appt.durationMin === "number" &&
    Number.isFinite(appt.durationMin) &&
    appt.durationMin > 0
  ) {
    return Math.round(appt.durationMin);
  }

  if (Array.isArray(appt.services) && appt.services.length > 0) {
    let sum = 0;
    let hasValid = false;
    for (const item of appt.services) {
      const d = item?.service?.durationMin;
      if (typeof d === "number" && Number.isFinite(d) && d > 0) {
        sum += Math.round(d);
        hasValid = true;
      }
    }
    if (hasValid && sum > 0) {
      return sum;
    }
  }

  // Never invent 30 minutes when duration information is missing or invalid
  return 0;
}

export function deduplicateTodayAppointments(
  primaryList: RawAppointmentInput[],
  secondaryList: RawAppointmentInput[] = []
): RawAppointmentInput[] {
  const result: RawAppointmentInput[] = [];
  const seenIds = new Set<string>();
  const seenOperationFingerprints = new Set<string>();

  const addRecord = (appt: RawAppointmentInput, isSecondary: boolean) => {
    if (!appt || !appt.dateTime) return;
    const dt = new Date(appt.dateTime);
    if (Number.isNaN(dt.getTime())) return;

    const status = (appt.status ?? "CONFIRMED").toUpperCase();
    const memberKey = appt.memberId ?? "";
    const timeKey = dt.getTime();
    const durKey = resolveReliableDurationMin(appt);

    if (appt.id) {
      if (seenIds.has(appt.id)) return;
    }

    const fallbackComposite = `${memberKey}|${timeKey}|${durKey}`;
    if (
      isSecondary &&
      !appt.id &&
      seenOperationFingerprints.has(fallbackComposite)
    ) {
      return;
    }

    if (appt.customerId && memberKey) {
      const techRepeatKey = `TECH:${memberKey}|${appt.customerId}|${timeKey}|${status}|${durKey}`;
      if (seenOperationFingerprints.has(techRepeatKey)) {
        return;
      }
      seenOperationFingerprints.add(techRepeatKey);
    }

    if (appt.id) {
      seenIds.add(appt.id);
    }
    seenOperationFingerprints.add(fallbackComposite);
    result.push({
      ...appt,
      status,
    });
  };

  for (const a of primaryList) {
    addRecord(a, false);
  }
  for (const b of secondaryList) {
    addRecord(b, true);
  }

  return result;
}

export function computeAttendanceSummary(
  appointments: { status?: string | null }[],
  periodLabel = "Hoje"
): AttendanceSummaryStats {
  let completed = 0;
  let pending = 0;
  let confirmed = 0;
  let cancelled = 0;
  let noShow = 0;

  for (const appt of appointments) {
    const st = (appt.status ?? "").toUpperCase();
    if (st === "COMPLETED") {
      completed += 1;
    } else if (st === "PENDING") {
      pending += 1;
    } else if (
      st === "CONFIRMED" ||
      st === "IN_PROGRESS" ||
      st === "SCHEDULED"
    ) {
      confirmed += 1;
    } else if (st === "CANCELLED") {
      cancelled += 1;
    } else if (st === "NO_SHOW") {
      noShow += 1;
    }
  }

  const total = completed + pending + confirmed + cancelled + noShow;

  return {
    periodLabel,
    total,
    completed,
    pending,
    confirmed,
    cancelled,
    noShow,
  };
}

export function computeDashboardOperationalMetrics(params: {
  todayStr: string;
  currentMinutesBR: number;
  activeMembers: RawMemberInput[];
  todayAppointments: RawAppointmentInput[];
  standaloneComandas?: RawStandaloneComandaInput[];
  memberWeeklyRev?: Record<string, number>;
  memberDailyRev?: Record<string, number>;
}): {
  professionals: ComputedProfessionalMetrics[];
  occupancyBreakdown: OccupancyBreakdown;
  todaySlots: TodaySlotItem[];
  attendanceSummary: AttendanceSummaryStats;
  occupancyData: { occupied: number; available: number; blocked: number };
  totalOccupiedSlots: number;
  totalFreeSlots: number;
  totalBlockedSlots: number;
} {
  const {
    todayStr,
    currentMinutesBR,
    activeMembers,
    todayAppointments,
    standaloneComandas = [],
    memberWeeklyRev = {},
    memberDailyRev = {},
  } = params;

  const [y, mMonth, d] = todayStr.split("-").map(Number);
  const dayStartMs = Date.UTC(y, mMonth - 1, d, 0, 0, 0, 0);
  const dayEndMs = Date.UTC(y, mMonth - 1, d, 24, 0, 0, 0);

  const deduplicatedAppts = deduplicateTodayAppointments(todayAppointments);

  // Process standalone comandas (ONLY those WITHOUT appointmentId so linked comandas never duplicate workload)
  // Considers ONLY items with status === "DONE" (real enum) completed today (in America/Sao_Paulo)
  const seenComandaIds = new Set<string>();
  const standaloneByMember = new Map<
    string,
    { completedMinutes: number; completedCount: number }
  >();
  let unassignedStandaloneMinutes = 0;
  let unassignedStandaloneCount = 0;

  for (const comanda of standaloneComandas) {
    if (!comanda || !comanda.id) continue;
    if (seenComandaIds.has(comanda.id)) continue;
    seenComandaIds.add(comanda.id);

    // Never duplicate workload when comanda is linked to an appointment
    if (comanda.appointmentId) continue;
    // Comanda status must be active or closed, never cancelled
    if ((comanda.status ?? "").toUpperCase() === "CANCELLED") continue;

    const seenItemIds = new Set<string>();
    const memberMinutesInComanda = new Map<string, number>();
    let unassignedInComanda = 0;

    for (const item of comanda.items ?? []) {
      if (!item) continue;
      if (item.id) {
        if (seenItemIds.has(item.id)) continue;
        seenItemIds.add(item.id);
      }
      if (item.type && item.type.toUpperCase() !== "SERVICE") continue;

      // Contabiliza APENAS itens efetivamente concluídos (DONE). Itens PENDING ou CANCELLED ficam de fora.
      const itemStatus = (item.status ?? "").toUpperCase();
      if (itemStatus !== "DONE") continue;

      // Exigir item.completedAt válido para atribuir o atendimento ao dia civil em America/Sao_Paulo.
      // NÃO utilizar comanda.closedAt, comanda.openedAt ou item.createdAt como substitutos.
      // Itens históricos ou avulsos com completedAt === null/undefined ou data inválida são descartados (fail-closed).
      if (!item.completedAt) continue;
      const completedDate =
        item.completedAt instanceof Date
          ? item.completedAt
          : new Date(item.completedAt);
      if (isNaN(completedDate.getTime())) continue;

      const itemCivilDate = formatTimestampToCivilDateBR(completedDate);
      if (itemCivilDate !== todayStr) {
        // Concluído em outra data civil (ex: ontem) -> não entra na carga de hoje
        continue;
      }

      const rawDur = item.service?.durationMin;
      if (
        typeof rawDur !== "number" ||
        !Number.isFinite(rawDur) ||
        rawDur <= 0
      ) {
        continue;
      }

      const rawQty = Number(item.quantity ?? 1);
      const qty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
      const itemMinutes = Math.round(rawDur * qty);

      const targetMemberId = item.executorId ?? comanda.memberId ?? null;
      if (targetMemberId) {
        memberMinutesInComanda.set(
          targetMemberId,
          (memberMinutesInComanda.get(targetMemberId) ?? 0) + itemMinutes
        );
      } else {
        unassignedInComanda += itemMinutes;
      }
    }

    for (const [execId, mins] of memberMinutesInComanda.entries()) {
      const prev = standaloneByMember.get(execId) ?? {
        completedMinutes: 0,
        completedCount: 0,
      };
      prev.completedMinutes += mins;
      prev.completedCount += 1;
      standaloneByMember.set(execId, prev);
    }

    if (unassignedInComanda > 0) {
      unassignedStandaloneMinutes += unassignedInComanda;
      unassignedStandaloneCount += 1;
    }
  }

  const slotProfessionalsMap = new Map<number, TodaySlotProfessionalDetail[]>();

  const registerMemberSlot = (
    minuteOfDay: number,
    detail: TodaySlotProfessionalDetail
  ) => {
    const list = slotProfessionalsMap.get(minuteOfDay) ?? [];
    const existingIdx = list.findIndex((p) => p.memberId === detail.memberId);
    if (existingIdx >= 0) {
      list[existingIdx] = detail;
    } else {
      list.push(detail);
    }
    slotProfessionalsMap.set(minuteOfDay, list);
  };

  const professionals: ComputedProfessionalMetrics[] = activeMembers.map((m) => {
    const memberName = m.user?.name ?? "Colaborador";
    const avatarUrl = m.user?.avatarUrl ?? null;
    const wh = (m.workingHours ?? []).find((w) => w.isActive !== false);
    const timeOffs = m.timeOffs ?? [];
    const onTimeOff = timeOffs.some((to) => Boolean(to.allDay));

    const memberAppts = deduplicatedAppts.filter((a) => a.memberId === m.id);
    const standalone = standaloneByMember.get(m.id) ?? {
      completedMinutes: 0,
      completedCount: 0,
    };

    let completedMinutes = standalone.completedMinutes;
    let scheduledMinutes = 0;
    let completedCount = standalone.completedCount;
    let scheduledCount = 0;

    const activeApptIntervals: {
      startMin: number;
      endMin: number;
      status: "COMPLETED" | "SCHEDULED";
    }[] = [];

    for (const appt of memberAppts) {
      const st = (appt.status ?? "").toUpperCase();
      if (st === "CANCELLED" || st === "NO_SHOW") {
        continue;
      }

      const dur = resolveReliableDurationMin(appt);
      const dt = new Date(appt.dateTime);
      const startMin = dt.getUTCHours() * 60 + dt.getUTCMinutes();

      if (st === "COMPLETED") {
        completedCount += 1;
        completedMinutes += dur;
        if (dur > 0) {
          activeApptIntervals.push({
            startMin,
            endMin: startMin + dur,
            status: "COMPLETED",
          });
        }
      } else if (
        st === "PENDING" ||
        st === "CONFIRMED" ||
        st === "IN_PROGRESS" ||
        st === "SCHEDULED"
      ) {
        scheduledCount += 1;
        scheduledMinutes += dur;
        if (dur > 0) {
          activeApptIntervals.push({
            startMin,
            endMin: startMin + dur,
            status: "SCHEDULED",
          });
        }
      }
    }

    const totalDemandMinutes = completedMinutes + scheduledMinutes;

    const workStart = wh ? parseHHMM(wh.startTime) : null;
    const workEnd = wh ? parseHHMM(wh.endTime) : null;

    if (
      !wh ||
      onTimeOff ||
      workStart === null ||
      workEnd === null ||
      workEnd <= workStart
    ) {
      for (const iv of activeApptIntervals) {
        const firstSlot = Math.floor(iv.startMin / SLOT_MIN) * SLOT_MIN;
        for (let t = firstSlot; t < iv.endMin; t += SLOT_MIN) {
          registerMemberSlot(t, {
            memberId: m.id,
            memberName,
            status: iv.status === "SCHEDULED" ? "scheduled" : "completed",
          });
        }
      }

      return {
        memberId: m.id,
        memberName,
        avatarUrl,
        weeklyRevenue: memberWeeklyRev[m.id] ?? 0,
        dailyRevenue: memberDailyRev[m.id] ?? 0,
        working: false,
        onTimeOff,
        startTime: wh?.startTime ?? "--:--",
        endTime: wh?.endTime ?? "--:--",
        totalSlots: 0,
        bookedSlots: 0,
        completedSlots: 0,
        blockedSlots: [],
        freeSlots: [],
        capacityMinutes: 0,
        completedMinutes,
        scheduledMinutes,
        totalDemandMinutes,
        overloadMinutes: totalDemandMinutes,
        completedCount,
        scheduledCount,
        equivalentCapacity30: 0,
        equivalentDemand30: Math.round((totalDemandMinutes / 30) * 100) / 100,
        equivalentOverload30: Math.round((totalDemandMinutes / 30) * 100) / 100,
        workloadPct: null,
        physicallyOccupiedMinutes: 0,
        physicalOccupancyPct: 0,
      };
    }

    // Build exclusions within [workStart, workEnd]: break + partial timeOffs
    const exclusions: [number, number][] = [];
    const breakStart = parseHHMM(wh.breakStart);
    const breakEnd = parseHHMM(wh.breakEnd);
    if (
      breakStart !== null &&
      breakEnd !== null &&
      breakEnd > breakStart
    ) {
      exclusions.push([breakStart, breakEnd]);
    }

    const partialTimeOffRanges: [number, number][] = [];
    for (const to of timeOffs) {
      if (to.allDay) continue;
      const toStartMs = new Date(to.startDate).getTime();
      const toEndMs = new Date(to.endDate).getTime();
      if (
        Number.isNaN(toStartMs) ||
        Number.isNaN(toEndMs) ||
        toEndMs <= toStartMs
      ) {
        continue;
      }
      if (toEndMs <= dayStartMs || toStartMs >= dayEndMs) {
        continue;
      }
      const startMin = Math.max(
        0,
        Math.floor((toStartMs - dayStartMs) / 60000)
      );
      const endMin = Math.min(
        1440,
        Math.ceil((toEndMs - dayStartMs) / 60000)
      );
      if (endMin > startMin) {
        exclusions.push([startMin, endMin]);
        partialTimeOffRanges.push([startMin, endMin]);
      }
    }

    const availableShiftIntervals = subtractIntervals(
      workStart,
      workEnd,
      exclusions
    );
    const capacityMinutes = availableShiftIntervals.reduce(
      (sum, [s, e]) => sum + (e - s),
      0
    );

    // Physical occupancy: union of appointment intervals clamped to availableShiftIntervals
    const physicalFragments: [number, number][] = [];
    for (const apptIv of activeApptIntervals) {
      for (const [availStart, availEnd] of availableShiftIntervals) {
        const s = Math.max(availStart, apptIv.startMin);
        const e = Math.min(availEnd, apptIv.endMin);
        if (e > s) {
          physicalFragments.push([s, e]);
        }
      }
    }
    const mergedPhysical = mergeIntervals(physicalFragments);
    const physicallyOccupiedMinutes = mergedPhysical.reduce(
      (sum, [s, e]) => sum + (e - s),
      0
    );
    const physicalOccupancyPct =
      capacityMinutes > 0
        ? Math.min(
            100,
            Math.round((physicallyOccupiedMinutes / capacityMinutes) * 100)
          )
        : 0;

    // 30-minute slot grid across [workStart, workEnd]
    const allSlots: number[] = [];
    const blockedSlots: number[] = [];
    const freeSlots: number[] = [];
    let bookedSlotsCount = 0;
    let completedSlotsCount = 0;

    for (let t = workStart; t + SLOT_MIN <= workEnd; t += SLOT_MIN) {
      const slotEnd = t + SLOT_MIN;
      const isBreakOverlap =
        breakStart !== null &&
        breakEnd !== null &&
        breakEnd > breakStart &&
        breakStart < slotEnd &&
        breakEnd > t;

      const isPartialTimeOffOverlap = partialTimeOffRanges.some(
        ([toS, toE]) => toS < slotEnd && toE > t
      );

      const overlappingAppts = activeApptIntervals.filter(
        (iv) => iv.startMin < slotEnd && iv.endMin > t
      );
      const hasScheduled = overlappingAppts.some(
        (iv) => iv.status === "SCHEDULED"
      );
      const hasCompleted = overlappingAppts.some(
        (iv) => iv.status === "COMPLETED"
      );

      if (!isBreakOverlap) {
        allSlots.push(t);
      }

      let slotStatus: "available" | "scheduled" | "completed" | "blocked";
      if (hasScheduled) {
        slotStatus = "scheduled";
        bookedSlotsCount += 1;
      } else if (hasCompleted) {
        slotStatus = "completed";
        bookedSlotsCount += 1;
        completedSlotsCount += 1;
      } else if (isBreakOverlap || isPartialTimeOffOverlap) {
        slotStatus = "blocked";
        if (!isBreakOverlap) {
          blockedSlots.push(t);
        }
      } else if (t < currentMinutesBR) {
        slotStatus = "blocked";
        blockedSlots.push(t);
      } else {
        slotStatus = "available";
        freeSlots.push(t);
      }

      registerMemberSlot(t, {
        memberId: m.id,
        memberName,
        status: slotStatus,
      });
    }

    for (const iv of activeApptIntervals) {
      const firstSlot = Math.floor(iv.startMin / SLOT_MIN) * SLOT_MIN;
      for (let t = firstSlot; t < iv.endMin; t += SLOT_MIN) {
        if (t < workStart || t + SLOT_MIN > workEnd) {
          registerMemberSlot(t, {
            memberId: m.id,
            memberName,
            status: iv.status === "SCHEDULED" ? "scheduled" : "completed",
          });
        }
      }
    }

    const overloadMinutes = Math.max(0, totalDemandMinutes - capacityMinutes);
    const workloadPct =
      capacityMinutes > 0
        ? Math.round((totalDemandMinutes / capacityMinutes) * 10000) / 100
        : null;

    return {
      memberId: m.id,
      memberName,
      avatarUrl,
      weeklyRevenue: memberWeeklyRev[m.id] ?? 0,
      dailyRevenue: memberDailyRev[m.id] ?? 0,
      working: capacityMinutes > 0,
      onTimeOff: false,
      startTime: wh.startTime,
      endTime: wh.endTime,
      totalSlots: allSlots.length,
      bookedSlots: bookedSlotsCount,
      completedSlots: completedSlotsCount,
      blockedSlots,
      freeSlots,
      capacityMinutes,
      completedMinutes,
      scheduledMinutes,
      totalDemandMinutes,
      overloadMinutes,
      completedCount,
      scheduledCount,
      equivalentCapacity30: Math.round((capacityMinutes / 30) * 100) / 100,
      equivalentDemand30: Math.round((totalDemandMinutes / 30) * 100) / 100,
      equivalentOverload30: Math.round((overloadMinutes / 30) * 100) / 100,
      workloadPct,
      physicallyOccupiedMinutes,
      physicalOccupancyPct,
    };
  });

  const activeMemberIds = new Set(activeMembers.map((m) => m.id));
  let extraCompletedMinutes = unassignedStandaloneMinutes;
  let extraScheduledMinutes = 0;
  let extraCompletedCount = unassignedStandaloneCount;
  let extraScheduledCount = 0;

  for (const appt of deduplicatedAppts) {
    if (appt.memberId && activeMemberIds.has(appt.memberId)) continue;
    const st = (appt.status ?? "").toUpperCase();
    if (st === "CANCELLED" || st === "NO_SHOW") continue;
    const dur = resolveReliableDurationMin(appt);
    if (st === "COMPLETED") {
      extraCompletedMinutes += dur;
      extraCompletedCount += 1;
    } else if (
      st === "PENDING" ||
      st === "CONFIRMED" ||
      st === "IN_PROGRESS" ||
      st === "SCHEDULED"
    ) {
      extraScheduledMinutes += dur;
      extraScheduledCount += 1;
    }
  }

  const totalCapacityMinutes = professionals.reduce(
    (sum, p) => sum + p.capacityMinutes,
    0
  );
  const totalCompletedMinutes =
    professionals.reduce((sum, p) => sum + p.completedMinutes, 0) +
    extraCompletedMinutes;
  const totalScheduledMinutes =
    professionals.reduce((sum, p) => sum + p.scheduledMinutes, 0) +
    extraScheduledMinutes;
  const totalDemandMinutes = totalCompletedMinutes + totalScheduledMinutes;
  const totalOverloadMinutes = Math.max(
    0,
    totalDemandMinutes - totalCapacityMinutes
  );

  const hasCapacity = totalCapacityMinutes > 0;
  const workloadPct = hasCapacity
    ? Math.round((totalDemandMinutes / totalCapacityMinutes) * 10000) / 100
    : null;
  const workloadPctDisplay = workloadPct ?? 0;
  const workloadBarPct = Math.min(100, Math.max(0, workloadPctDisplay));
  const overloadPct =
    hasCapacity && workloadPct !== null && workloadPct > 100
      ? Math.round((workloadPct - 100) * 100) / 100
      : 0;
  const workloadFormatted = hasCapacity
    ? formatOccupancyPercent(workloadPct)
    : "Indisponível";
  const overloadFormatted =
    overloadPct > 0 ? `+${formatOccupancyPercent(overloadPct)}` : null;

  const totalPhysicallyOccupiedMinutes = professionals.reduce(
    (sum, p) => sum + p.physicallyOccupiedMinutes,
    0
  );
  const physicalOccupancyPct = hasCapacity
    ? Math.min(
        100,
        Math.round(
          (totalPhysicallyOccupiedMinutes / totalCapacityMinutes) * 100
        )
      )
    : 0;

  const totalCompletedCount =
    professionals.reduce((sum, p) => sum + p.completedCount, 0) +
    extraCompletedCount;
  const totalScheduledCount =
    professionals.reduce((sum, p) => sum + p.scheduledCount, 0) +
    extraScheduledCount;

  const occupancyBreakdown: OccupancyBreakdown = {
    capacityMinutes: totalCapacityMinutes,
    completedMinutes: totalCompletedMinutes,
    scheduledMinutes: totalScheduledMinutes,
    totalDemandMinutes,
    overloadMinutes: totalOverloadMinutes,
    workloadPct,
    workloadPctDisplay,
    workloadBarPct,
    overloadPct,
    workloadFormatted,
    overloadFormatted,
    hasCapacity,
    capacityAvailable: hasCapacity,
    physicallyOccupiedMinutes: totalPhysicallyOccupiedMinutes,
    physicalOccupancyPct,
    equivalentCapacity30: Math.round((totalCapacityMinutes / 30) * 100) / 100,
    equivalentDemand30: Math.round((totalDemandMinutes / 30) * 100) / 100,
    equivalentOverload30: Math.round((totalOverloadMinutes / 30) * 100) / 100,
    completedCount: totalCompletedCount,
    scheduledCount: totalScheduledCount,
  };

  const sortedMinutes = Array.from(slotProfessionalsMap.keys()).sort(
    (a, b) => a - b
  );

  const todaySlots: TodaySlotItem[] = sortedMinutes.map((minuteOfDay) => {
    const profDetails = slotProfessionalsMap.get(minuteOfDay) ?? [];
    const totalWorking = profDetails.length;
    const availableCount = profDetails.filter(
      (p) => p.status === "available"
    ).length;
    const scheduledCount = profDetails.filter(
      (p) => p.status === "scheduled"
    ).length;
    const completedCount = profDetails.filter(
      (p) => p.status === "completed"
    ).length;
    const blockedCount = profDetails.filter(
      (p) => p.status === "blocked"
    ).length;
    const isPast = minuteOfDay < currentMinutesBR;

    let status: TodaySlotStatus;
    if (scheduledCount > 0) {
      status = "scheduled";
    } else if (completedCount > 0) {
      status = "completed";
    } else if (availableCount > 0) {
      status = "available";
    } else {
      status = "blocked";
    }

    return {
      time: formatMinutesToHHMM(minuteOfDay),
      minuteOfDay,
      status,
      isPast,
      totalWorking,
      availableCount,
      scheduledCount,
      completedCount,
      blockedCount,
      professionals: profDetails,
    };
  });

  const totalOccupiedSlots = professionals.reduce(
    (sum, p) => sum + p.bookedSlots,
    0
  );
  const totalFreeSlots = professionals.reduce(
    (sum, p) => sum + p.freeSlots.length,
    0
  );
  const totalBlockedSlots = professionals.reduce(
    (sum, p) => sum + p.blockedSlots.length,
    0
  );

  const attendanceSummary = computeAttendanceSummary(deduplicatedAppts, "Hoje");

  return {
    professionals,
    occupancyBreakdown,
    todaySlots,
    attendanceSummary,
    occupancyData: {
      occupied: totalOccupiedSlots,
      available: totalFreeSlots,
      blocked: totalBlockedSlots,
    },
    totalOccupiedSlots,
    totalFreeSlots,
    totalBlockedSlots,
  };
}
