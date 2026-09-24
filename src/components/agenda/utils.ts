import {
  Appointment,
  AppointmentLayout,
  AppointmentWhatsappConfirmation,
  ClubBalance,
  DayItem,
  UIStatus,
  WhatsappConfirmationStatus,
} from "./types";
import {
  todayIsoBR,
  nowBR,
  formatHeaderDate,
} from "@/lib/time-utils";

export { nowBR, todayIsoBR, formatHeaderDate };

export const UI_STATUS_LABEL: Record<UIStatus, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmado",
  OPEN_COMANDA: "Atendimento aberto",
  IN_SERVICE: "Em atendimento",
  PENDING_PAYMENT: "Aguardando pagamento",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  NO_SHOW: "Faltou",
};

export const UI_STATUS_BG: Record<UIStatus, string> = {
  PENDING: "bg-amber-500/15 border-amber-500/30 text-amber-200",
  CONFIRMED: "bg-stone-500/20 border-stone-500/40 text-stone-300",
  OPEN_COMANDA: "bg-amber-600/20 border-amber-500/40 text-amber-100",
  IN_SERVICE: "bg-blue-500/20 border-blue-500/40 text-blue-100",
  PENDING_PAYMENT: "bg-orange-500/20 border-orange-500/40 text-orange-200",
  COMPLETED: "bg-emerald-500/15 border-emerald-500/30 text-emerald-100",
  CANCELLED: "bg-red-900/30 border-red-800/40 text-red-300",
  NO_SHOW: "bg-stone-800 border-stone-700 text-stone-400",
};

export const LABEL_INPUT = "text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]";
export const INPUT_CLASS =
  "w-full bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-border)] transition-colors text-sm";

export const WHATSAPP_STATUS_LABEL: Record<WhatsappConfirmationStatus, string> = {
  PENDING: "Pendente WhatsApp",
  CONFIRMED: "WhatsApp confirmado",
  EXPIRED: "WhatsApp expirado",
  CANCELED: "WhatsApp cancelado",
};

export const WHATSAPP_STATUS_BG: Record<WhatsappConfirmationStatus, string> = {
  PENDING: "bg-amber-500/10 border-amber-500/30 text-amber-200",
  CONFIRMED: "bg-emerald-500/10 border-emerald-500/30 text-emerald-200",
  EXPIRED: "bg-stone-800 border-stone-700 text-stone-400",
  CANCELED: "bg-red-900/30 border-red-800/40 text-red-300",
};

export const INACTIVE_CLUB_STATUSES = ["PAST_DUE", "SUSPENDED", "CANCELED", "EXPIRED"];

export const HOUR_START = 7;
export const HOUR_END = 22;
export const SLOT_MIN = 30;
export const ROW_HEIGHT = 48; // px per 30-min slot

export function getUIStatus(app: Appointment): UIStatus {
  if (app.status === "PENDING") return "PENDING";
  if (app.status === "CANCELLED") return "CANCELLED";
  if (app.status === "NO_SHOW") return "NO_SHOW";
  if (app.status === "COMPLETED") return "COMPLETED";

  const comanda = app.comandas?.[0];
  if (!comanda) return "CONFIRMED";
  if (comanda.status === "OPEN") return "OPEN_COMANDA";
  if (comanda.status === "IN_SERVICE") return "IN_SERVICE";
  if (comanda.status === "PENDING_PAYMENT") return "PENDING_PAYMENT";
  if (comanda.status === "CLOSED") return "COMPLETED";
  return "CONFIRMED";
}

export function getWhatsappConfirmedLabel(
  confirmation: AppointmentWhatsappConfirmation | null | undefined
) {
  if (!confirmation || confirmation.status !== "CONFIRMED") return "WhatsApp confirmado";
  if (confirmation.confirmationMethod === "MANUAL_OVERRIDE") return "Confirmado manualmente";
  return "WhatsApp confirmado";
}

export function getPrimaryStatusPresentation(app: Appointment) {
  const whatsapp = app.whatsappConfirmation;
  if (whatsapp?.status === "PENDING") {
    return {
      label: "Pendente WhatsApp",
      bgClass: WHATSAPP_STATUS_BG.PENDING,
      helperText: "Horário reservado",
    };
  }

  if (whatsapp?.status === "CONFIRMED") {
    return {
      label: getWhatsappConfirmedLabel(whatsapp),
      bgClass: WHATSAPP_STATUS_BG.CONFIRMED,
      helperText: null,
    };
  }

  const uiStatus = getUIStatus(app);
  return {
    label: UI_STATUS_LABEL[uiStatus],
    bgClass: UI_STATUS_BG[uiStatus],
    helperText: null,
  };
}

export function getTodayStr() {
  return todayIsoBR();
}

export function shiftDate(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function formatDateFull(dateStr: string) {
  return formatHeaderDate(dateStr);
}

export function getWeekDays(currentDateStr: string): DayItem[] {
  const [y, m, d] = currentDateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(y, m - 1, d + diffToMonday));

  const days: DayItem[] = [];
  const weekdaysShort = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + i));
    const iso = `${dayDate.getUTCFullYear()}-${String(dayDate.getUTCMonth() + 1).padStart(2, "0")}-${String(dayDate.getUTCDate()).padStart(2, "0")}`;
    const dayNum = String(dayDate.getUTCDate()).padStart(2, "0");
    days.push({
      iso,
      weekday: weekdaysShort[i],
      dayNum,
      label: `${weekdaysShort[i]} ${dayNum}`,
    });
  }

  return days;
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function formatDateTime(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function isoToMinutes(iso: string) {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function minutesToTop(minutes: number) {
  return ((minutes - HOUR_START * 60) / SLOT_MIN) * ROW_HEIGHT;
}

export function minutesToHeight(durationMin: number) {
  return (durationMin / SLOT_MIN) * ROW_HEIGHT;
}

export function minutesToLocalInput(dateStr: string, minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function computeAppointmentLayouts(appointments: Appointment[]): AppointmentLayout[] {
  if (!appointments || appointments.length === 0) return [];

  const sorted = [...appointments].sort((a, b) => {
    const startA = isoToMinutes(a.dateTime);
    const startB = isoToMinutes(b.dateTime);
    if (startA !== startB) return startA - startB;
    if (a.durationMin !== b.durationMin) return b.durationMin - a.durationMin;
    return a.id.localeCompare(b.id);
  });

  const clusters: Appointment[][] = [];
  let currentCluster: Appointment[] = [];
  let clusterMaxEnd = -1;

  for (const app of sorted) {
    const startMin = isoToMinutes(app.dateTime);
    const endMin = startMin + app.durationMin;

    if (currentCluster.length === 0) {
      currentCluster.push(app);
      clusterMaxEnd = endMin;
    } else if (startMin < clusterMaxEnd) {
      currentCluster.push(app);
      clusterMaxEnd = Math.max(clusterMaxEnd, endMin);
    } else {
      clusters.push(currentCluster);
      currentCluster = [app];
      clusterMaxEnd = endMin;
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  const results: AppointmentLayout[] = [];

  for (const cluster of clusters) {
    const colEnds: number[] = [];
    const clusterPlacements: { app: Appointment; colIndex: number }[] = [];

    for (const app of cluster) {
      const startMin = isoToMinutes(app.dateTime);
      const endMin = startMin + app.durationMin;

      let placedCol = -1;
      for (let i = 0; i < colEnds.length; i++) {
        if (colEnds[i] <= startMin) {
          placedCol = i;
          colEnds[i] = endMin;
          break;
        }
      }
      if (placedCol === -1) {
        placedCol = colEnds.length;
        colEnds.push(endMin);
      }
      clusterPlacements.push({ app, colIndex: placedCol });
    }

    const totalCols = Math.max(1, colEnds.length);
    const widthPct = 100 / totalCols;

    for (const { app, colIndex } of clusterPlacements) {
      const startMin = isoToMinutes(app.dateTime);
      const top = minutesToTop(startMin);
      const height = Math.max(minutesToHeight(app.durationMin), ROW_HEIGHT);
      const leftPct = colIndex * widthPct;

      results.push({
        appointment: app,
        top,
        height,
        leftPct,
        widthPct,
      });
    }
  }

  return results;
}

const clubBalanceCache: Record<string, ClubBalance | null> = {};
if (typeof window !== "undefined") {
  (window as unknown as { __clubBalanceCache: Record<string, ClubBalance | null> }).__clubBalanceCache =
    clubBalanceCache;
}

export async function fetchClubBalance(customerId: string) {
  if (!customerId) return null;
  if (clubBalanceCache[customerId]) {
    return clubBalanceCache[customerId];
  }
  try {
    const res = await fetch(`/api/admin/clubs/members/${customerId}/balance`);
    if (!res.ok) {
      clubBalanceCache[customerId] = null;
      return null;
    }
    const data = await res.json();
    clubBalanceCache[customerId] = data;
    return data;
  } catch {
    clubBalanceCache[customerId] = null;
    return null;
  }
}
