"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import WhatsAppShareSlots from "@/components/admin/WhatsAppShareSlots";
import { formatWhatsAppPhone, generateWhatsAppMessage, generateWhatsAppLink } from "@/lib/whatsapp";
import { extractServiceQuantities, stripMetadataFromNotes } from "@/lib/appointments/notes-metadata";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
type BookingMode = "NORMAL" | "FIT_IN";
type WhatsappConfirmationStatus = "PENDING" | "CONFIRMED" | "EXPIRED" | "CANCELED";
type WhatsappConfirmationMethod = "TOKEN" | "MANUAL_OVERRIDE";

interface AppointmentWhatsappConfirmation {
  status: WhatsappConfirmationStatus;
  tokenHint?: string | null;
  expiresAt?: string | null;
  confirmedAt?: string | null;
  confirmedById?: string | null;
  confirmationMethod?: WhatsappConfirmationMethod | null;
  manualConfirmationReason?: string | null;
}

interface AppService {
  serviceId?: string;
  service: { id: string; name: string; durationMin: number };
  priceApplied: string;
}

interface Appointment {
  id: string;
  dateTime: string;
  totalPrice: string;
  durationMin: number;
  status: AppStatus;
  bookingMode?: BookingMode;
  fitInReason?: string | null;
  fitInCreatedAt?: string | null;
  conflictSnapshot?: unknown;
  notes: string | null;
  customer: { id: string; name: string; phone: string };
  barber: { id: string; user: { name: string; avatarUrl: string | null } };
  services: AppService[];
  comandas?: {
    id: string;
    status: string;
    total: string;
    paidTotal: string;
    items?: { id: string; type: string; status: string; quantity: string }[];
  }[];
  whatsappConfirmation?: AppointmentWhatsappConfirmation | null;
}

interface FitInConflictPreview {
  id: string;
  customerName: string;
  start: string;
  end: string;
}

interface Member {
  id: string;
  user: { name: string };
  startTime?: string;
  endTime?: string;
  freeSlots?: number[];
}

interface Service {
  id: string;
  name: string;
  price: string;
  durationMin: number;
}

interface NewAppointmentInitialState {
  memberId?: string;
  dateTime?: string;
  serviceIds?: string[];
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
}

interface CustomerSearchResult {
  id: string;
  name: string;
  phone: string;
  lastAppointmentAt?: string;
}

interface ClubBenefit {
  serviceId: string;
  benefitType: "INCLUDED_SERVICE" | "SERVICE_DISCOUNT";
  isUnlimited?: boolean;
  availableQty?: number;
  includedQty?: number;
  canUse?: boolean;
  discountPercent?: number;
}

interface ClubBalance {
  status?: string;
  clubPlan?: { id?: string; name: string };
  benefits?: ClubBenefit[];
}

declare global {
  interface Window {
    __clubBalanceCache?: Record<string, ClubBalance | null>;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

type UIStatus = "PENDING" | "CONFIRMED" | "OPEN_COMANDA" | "IN_SERVICE" | "PENDING_PAYMENT" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

function getUIStatus(app: Appointment): UIStatus {
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

const UI_STATUS_LABEL: Record<UIStatus, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmado",
  OPEN_COMANDA: "Atendimento aberto",
  IN_SERVICE: "Em atendimento",
  PENDING_PAYMENT: "Aguardando pagamento",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  NO_SHOW: "Faltou",
};

const UI_STATUS_BG: Record<UIStatus, string> = {
  PENDING: "bg-amber-500/15 border-amber-500/30 text-amber-200",
  CONFIRMED: "bg-stone-500/20 border-stone-500/40 text-stone-300", // neutro/dourado discreto
  OPEN_COMANDA: "bg-amber-600/20 border-amber-500/40 text-amber-100", // intermediario
  IN_SERVICE: "bg-blue-500/20 border-blue-500/40 text-blue-100", // destaque ativo coerente
  PENDING_PAYMENT: "bg-orange-500/20 border-orange-500/40 text-orange-200", // laranja/amarelo
  COMPLETED: "bg-emerald-500/15 border-emerald-500/30 text-emerald-100",
  CANCELLED: "bg-red-900/30 border-red-800/40 text-red-300", // vermelho discreto
  NO_SHOW: "bg-stone-800 border-stone-700 text-stone-400", // cinza crítico
};

const LABEL_INPUT = "text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]";
const INPUT_CLASS =
  "w-full bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-border)] transition-colors text-sm";

const WHATSAPP_STATUS_LABEL: Record<WhatsappConfirmationStatus, string> = {
  PENDING: "Pendente WhatsApp",
  CONFIRMED: "WhatsApp confirmado",
  EXPIRED: "WhatsApp expirado",
  CANCELED: "WhatsApp cancelado",
};

const WHATSAPP_STATUS_BG: Record<WhatsappConfirmationStatus, string> = {
  PENDING: "bg-amber-500/10 border-amber-500/30 text-amber-200",
  CONFIRMED: "bg-emerald-500/10 border-emerald-500/30 text-emerald-200",
  EXPIRED: "bg-stone-800 border-stone-700 text-stone-400",
  CANCELED: "bg-red-900/30 border-red-800/40 text-red-300",
};

function getWhatsappConfirmedLabel(
  confirmation: AppointmentWhatsappConfirmation | null | undefined
) {
  if (!confirmation || confirmation.status !== "CONFIRMED") return "WhatsApp confirmado";
  if (confirmation.confirmationMethod === "MANUAL_OVERRIDE") return "Confirmado manualmente";
  return "WhatsApp confirmado";
}

function getPrimaryStatusPresentation(app: Appointment) {
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

const INACTIVE_CLUB_STATUSES = ["PAST_DUE", "SUSPENDED", "CANCELED", "EXPIRED"];

// Calendar config
const HOUR_START = 7;
const HOUR_END = 22;
const SLOT_MIN = 30;
const ROW_HEIGHT = 48; // px per 30-min slot

// ─── Helpers ─────────────────────────────────────────────────────────────────

import { todayIsoBR, nowBR, formatHeaderDate, formatAppointmentDateTimeForMessage } from "@/lib/time-utils";

function getTodayStr() {
  return todayIsoBR();
}

function shiftDate(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatDateFull(dateStr: string) {
  return formatHeaderDate(dateStr);
}

export function getWeekDays(currentDateStr: string) {
  const [y, m, d] = currentDateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(y, m - 1, d + diffToMonday));

  const days = [];
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

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function formatDateTime(iso?: string | null) {
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

function isoToMinutes(iso: string) {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function minutesToTop(minutes: number) {
  return ((minutes - HOUR_START * 60) / SLOT_MIN) * ROW_HEIGHT;
}

function minutesToHeight(durationMin: number) {
  return (durationMin / SLOT_MIN) * ROW_HEIGHT;
}

function minutesToLocalInput(dateStr: string, minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export interface AppointmentLayout {
  appointment: Appointment;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
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
  window.__clubBalanceCache = clubBalanceCache;
}

async function fetchClubBalance(customerId: string) {
  if (!customerId) return null;
  if (clubBalanceCache[customerId]) {
    return clubBalanceCache[customerId];
  }
  try {
    const res = await fetch(`/api/admin/clube/subscriptions/customer/${customerId}/balance`);
    if (!res.ok) return null;
    const data = await res.json();
    clubBalanceCache[customerId] = data;
    return data;
  } catch {
    return null;
  }
}

// ─── Appointment Modal ────────────────────────────────────────────────────────

export function AppointmentModal({
  appointment,
  members,
  barbershopServices,
  appointments = [],
  currentDate,
  initialState,
  initialBookingMode,
  onClose,
  onSaved,
}: {
  appointment: Appointment | null;
  members: Member[];
  barbershopServices: Service[];
  appointments?: Appointment[];
  currentDate: string;
  initialState?: NewAppointmentInitialState | null;
  initialBookingMode?: BookingMode;
  onClose: () => void;
  onSaved: (a: Appointment) => void;
}) {
  const isEdit = !!appointment;
  const [bookingMode, setBookingMode] = useState<BookingMode>(
    appointment?.bookingMode ?? initialBookingMode ?? "NORMAL"
  );
  const [memberId, setMemberId] = useState(appointment?.barber.id ?? initialState?.memberId ?? "");
  const [serviceQuantities, setServiceQuantities] = useState<Record<string, number>>(() => {
    if (appointment) {
      const qMap = extractServiceQuantities(appointment.notes);
      const initialQtys: Record<string, number> = {};
      appointment.services.forEach((s) => {
        const match = barbershopServices.find((bs) => bs.name === s.service.name);
        if (match) {
          initialQtys[match.id] = qMap[s.serviceId ?? match.id] ?? 1;
        }
      });
      return initialQtys;
    }
    if (initialState?.serviceIds) {
      const initialQtys: Record<string, number> = {};
      initialState.serviceIds.forEach((id) => {
        if (id) initialQtys[id] = 1;
      });
      return initialQtys;
    }
    return {};
  });
  const [dateTime, setDateTime] = useState(() => {
    if (appointment) {
      const d = new Date(appointment.dateTime);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }
    return initialState?.dateTime ?? `${currentDate}T09:00`;
  });
  const [customerName, setCustomerName] = useState(appointment?.customer.name ?? initialState?.customerName ?? "");
  const [customerPhone, setCustomerPhone] = useState(appointment?.customer.phone ?? initialState?.customerPhone ?? "");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(
    appointment
      ? appointment.customer
      : initialState?.customerId
        ? {
            id: initialState.customerId,
            name: initialState.customerName ?? "",
            phone: initialState.customerPhone ?? "",
          }
        : null
  );
  const [customerLookupQuery, setCustomerLookupQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerSearchResult[]>([]);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [phoneSuggestion, setPhoneSuggestion] = useState<CustomerSearchResult | null>(null);
  const [notes, setNotes] = useState(stripMetadataFromNotes(appointment?.notes) ?? "");
  const [fitInReason, setFitInReason] = useState(appointment?.fitInReason ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [customerClubBalance, setCustomerClubBalance] = useState<ClubBalance | null>(null);
  const [loadingClub, setLoadingClub] = useState(false);

  useEffect(() => {
    if (!selectedCustomer?.id) {
      return;
    }
    let active = true;
    fetchClubBalance(selectedCustomer.id).then((data) => {
      if (active) {
        setCustomerClubBalance(data);
        setLoadingClub(false);
      }
    });
    return () => {
      active = false;
    };
  }, [selectedCustomer?.id]);

  useEffect(() => {
    if (isEdit) return;
    const query = customerLookupQuery.trim();
    if (!query) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchingCustomers(true);
      try {
        const res = await fetch(`/api/admin/clients/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Erro ao buscar clientes.");
        const data = await res.json();
        setCustomerResults(data.clients ?? []);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setCustomerResults([]);
        }
      } finally {
        setSearchingCustomers(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [customerLookupQuery, isEdit]);

  useEffect(() => {
    if (isEdit || selectedCustomer) {
      return;
    }
    const phoneDigits = customerPhone.replace(/\D/g, "");
    if (phoneDigits.length < 5) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/clients/search?q=${encodeURIComponent(phoneDigits)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        setPhoneSuggestion(data.clients?.[0] ?? null);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setPhoneSuggestion(null);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [customerPhone, isEdit, selectedCustomer]);

  const chooseCustomer = (customer: CustomerSearchResult) => {
    setSelectedCustomer(customer);
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone);
    setCustomerLookupQuery("");
    setCustomerResults([]);
    setPhoneSuggestion(null);
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerLookupQuery("");
    setCustomerResults([]);
    setPhoneSuggestion(null);
    setCustomerClubBalance(null);
  };

  const canShowPhoneSuggestion = customerPhone.replace(/\D/g, "").length >= 5;
  const canShowCustomerResults = customerLookupQuery.trim().length > 0 && !selectedCustomer;

  const selectedDurationMin = Object.entries(serviceQuantities).reduce((sum, [serviceId, qty]) => {
    const service = barbershopServices.find((item) => item.id === serviceId);
    return sum + (service?.durationMin ?? 0) * qty;
  }, 0);

  const fitInConflicts: FitInConflictPreview[] =
    !isEdit && bookingMode === "FIT_IN" && memberId && dateTime && selectedDurationMin > 0
      ? appointments
          .filter((candidate) => {
            if (candidate.barber.id !== memberId) return false;
            if (!["PENDING", "CONFIRMED"].includes(candidate.status)) return false;

            const targetStart = new Date(dateTime.endsWith("Z") ? dateTime : `${dateTime}:00Z`);
            if (Number.isNaN(targetStart.getTime())) return false;
            const targetEnd = new Date(targetStart.getTime() + selectedDurationMin * 60_000);

            const candidateStart = new Date(candidate.dateTime);
            const candidateEnd = new Date(candidateStart.getTime() + candidate.durationMin * 60_000);

            return targetStart < candidateEnd && targetEnd > candidateStart;
          })
          .map((candidate) => {
            const start = new Date(candidate.dateTime);
            const end = new Date(start.getTime() + candidate.durationMin * 60_000);
            return {
              id: candidate.id,
              customerName: candidate.customer.name,
              start: start.toISOString(),
              end: end.toISOString(),
            };
          })
      : [];

  const selectedServiceIds = Object.keys(serviceQuantities);

  const toggleService = (id: string) => {
    setServiceQuantities((prev) => {
      const current = prev[id] ?? 0;
      if (current > 0) {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      } else {
        return { ...prev, [id]: 1 };
      }
    });
  };

  const incrementService = (id: string) => {
    setServiceQuantities((prev) => {
      const current = prev[id] ?? 0;
      if (current < 5) {
        return { ...prev, [id]: current + 1 };
      }
      return prev;
    });
  };

  const decrementService = (id: string) => {
    setServiceQuantities((prev) => {
      const current = prev[id] ?? 0;
      if (current <= 1) {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      } else {
        return { ...prev, [id]: current - 1 };
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!memberId) { setError("Selecione um barbeiro."); return; }
    if (selectedServiceIds.length === 0) { setError("Selecione ao menos um serviço."); return; }
    if (!dateTime) { setError("Informe data e hora."); return; }
    if (!isEdit) {
      if (!customerPhone.trim()) {
        setError("Informe o telefone do cliente.");
        return;
      }
      if (!selectedCustomer) {
        let clean = customerPhone.replace(/\D/g, "");
        if (clean.startsWith("55") && (clean.length === 12 || clean.length === 13)) {
          clean = clean.substring(2);
        }
        const isMobile = clean.length === 11 && clean[2] === "9";
        const isAllSame = /^(\d)\1+$/.test(clean);
        if (!isMobile || isAllSame) {
          setError("Informe um WhatsApp válido com DDD.");
          return;
        }
      }
    }

    const servicesPayload = Object.entries(serviceQuantities).map(([serviceId, quantity]) => ({
      serviceId,
      quantity,
    }));

    setSaving(true);
    try {
      let res: Response;
      if (isEdit) {
        res = await fetch(`/api/admin/appointments/${appointment!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId, services: servicesPayload, dateTime, notes }),
        });
      } else {
        res = await fetch("/api/admin/appointments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            memberId,
            services: servicesPayload,
            dateTime,
            customerId: selectedCustomer?.id,
            customerName: customerName.trim() || undefined,
            customerPhone: customerPhone.trim(),
            bookingMode,
            fitInReason: bookingMode === "FIT_IN" ? fitInReason.trim() : undefined,
            notes: notes || undefined,
          }),
        });
      }
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? data.error ?? "Erro ao salvar.");
      }
      onSaved(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };


  const getSelectedServicesPreview = () => {
    const selectedServices: Service[] = [];
    Object.entries(serviceQuantities).forEach(([id, qty]) => {
      const svc = barbershopServices.find(s => s.id === id);
      if (svc && qty > 0) {
        for (let i = 0; i < qty; i++) {
          selectedServices.push(svc);
        }
      }
    });

    let totalOriginal = 0;
    let totalToday = 0;

    const benefits = customerClubBalance?.benefits ? customerClubBalance.benefits.map((b) => ({ ...b })) : [];
    const isInactive = !!customerClubBalance?.status && INACTIVE_CLUB_STATUSES.includes(customerClubBalance.status);

    const processed = selectedServices.map(s => {
      const originalPrice = parseFloat(s.price);
      totalOriginal += originalPrice;

      let todayPrice = originalPrice;
      let isCovered = false;
      let isDiscounted = false;
      let discountPercent = 0;
      let limitExhausted = false;

      if (customerClubBalance && !isInactive) {
        const match = benefits.find((b) => b.serviceId === s.id);
        if (match) {
          if (match.benefitType === "INCLUDED_SERVICE") {
            if (match.isUnlimited || (match.availableQty && match.availableQty > 0)) {
              isCovered = true;
              todayPrice = 0;
              if (!match.isUnlimited && match.availableQty) {
                match.availableQty -= 1;
              }
            } else {
              limitExhausted = true;
            }
          } else if (match.benefitType === "SERVICE_DISCOUNT") {
            isDiscounted = true;
            discountPercent = match.discountPercent ?? 0;
            todayPrice = originalPrice * (1 - discountPercent / 100);
          }
        }
      }

      totalToday += todayPrice;

      return {
        id: s.id,
        name: s.name,
        originalPrice,
        todayPrice,
        isCovered,
        isDiscounted,
        discountPercent,
        limitExhausted
      };
    });

    return {
      totalOriginal,
      totalToday,
      services: processed,
      isInactive
    };
  };

  const preview = getSelectedServicesPreview();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[var(--surface-2)] border border-[var(--border-medium)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-[var(--surface-2)] border-b border-[var(--border-subtle)] px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-base font-bold text-[var(--text-primary)]">
            {isEdit
              ? "Editar Agendamento"
              : bookingMode === "FIT_IN"
                ? "Novo Encaixe"
                : "Novo Agendamento"}
          </h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {!isEdit && (
            <div className="space-y-1.5">
              <label className={LABEL_INPUT}>Tipo de Reserva</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBookingMode("NORMAL")}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${bookingMode === "NORMAL" ? "border-amber-400/70 bg-amber-500/10 text-amber-300" : "border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)]"}`}
                >
                  Agendamento normal
                </button>
                <button
                  type="button"
                  onClick={() => setBookingMode("FIT_IN")}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${bookingMode === "FIT_IN" ? "border-orange-400/70 bg-orange-500/10 text-orange-300" : "border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)]"}`}
                >
                  Encaixe operacional
                </button>
              </div>
            </div>
          )}

          {!isEdit && bookingMode === "FIT_IN" && (
            <div className="space-y-2 rounded-xl border border-orange-500/30 bg-orange-500/5 p-3">
              <label className={LABEL_INPUT}>Motivo do Encaixe (opcional)</label>
              <textarea
                value={fitInReason}
                onChange={(e) => setFitInReason(e.target.value)}
                placeholder="Explique por que este encaixe esta sendo feito (opcional)..."
                className={`${INPUT_CLASS} min-h-[80px]`}
              />
              <p className="text-xs text-orange-200/80">
                O encaixe ignora bloqueio de sobreposicao e registra o conflito para auditoria.
              </p>
              {fitInConflicts.length > 0 ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2">
                  <p className="text-xs font-bold text-red-300 mb-1">Conflitos detectados:</p>
                  <ul className="space-y-1">
                    {fitInConflicts.map((conflict) => (
                      <li key={conflict.id} className="text-xs text-red-200/90">
                        {conflict.customerName} · {formatTime(conflict.start)}-{formatTime(conflict.end)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-emerald-300/80">Nenhum conflito detectado para este encaixe.</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label className={LABEL_INPUT}>Barbeiro</label>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} title="Barbeiro" className={INPUT_CLASS}>
              <option value="">Selecione...</option>
              {members.map((m) => (<option key={m.id} value={m.id}>{m.user.name}</option>))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={LABEL_INPUT}>Serviços</label>
            {loadingClub && (
              <p className="text-xs text-stone-500 italic">Consultando benefícios do Clube...</p>
            )}
            {customerClubBalance && (
              <div className="mb-2">
                {customerClubBalance.status && !["ACTIVE", "GRACE_PERIOD"].includes(customerClubBalance.status) ? (
                  <div className="px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-xs font-bold flex items-center gap-2 max-w-fit">
                    <span>⚠️ Cliente possui plano sem cobertura ativa ({customerClubBalance.status})</span>
                  </div>
                ) : (
                  customerClubBalance.clubPlan && (
                    <div className="px-3 py-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-emerald-400 text-xs font-bold flex items-center gap-2 max-w-fit">
                      <span>👑 Cliente Clube: {customerClubBalance.clubPlan.name}</span>
                    </div>
                  )
                )}
              </div>
            )}
            <div className="border border-stone-800 rounded-lg divide-y divide-stone-800 max-h-40 overflow-y-auto">
              {barbershopServices.length === 0 ? (
                <p className="px-4 py-3 text-sm text-stone-500">Nenhum serviço cadastrado.</p>
              ) : (
                barbershopServices.map((s) => {
                  const checked = selectedServiceIds.includes(s.id);
                  const originalPrice = Number(s.price);

                  // Match service to benefits
                  const benefit = customerClubBalance?.benefits?.find((b) => b.serviceId === s.id);
                  const isInactive = !!customerClubBalance?.status && INACTIVE_CLUB_STATUSES.includes(customerClubBalance.status);

                  let priceText = originalPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                  let strikethroughPriceText = "";
                  let clubBadge = null;

                  if (customerClubBalance && !isInactive && benefit) {
                    if (benefit.benefitType === "INCLUDED_SERVICE") {
                      const canUse = benefit.canUse !== undefined ? benefit.canUse : (benefit.isUnlimited || (benefit.availableQty && benefit.availableQty > 0));
                      if (canUse) {
                        priceText = (0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                        strikethroughPriceText = originalPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                        clubBadge = (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                            Coberto ({benefit.isUnlimited ? "Uso ilimitado" : `${benefit.availableQty} disp.`})
                          </span>
                        );
                      } else {
                        clubBadge = (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-stone-800 border border-stone-700 text-stone-400">
                            Limite Esgotado
                          </span>
                        );
                      }
                    } else if (benefit.benefitType === "SERVICE_DISCOUNT") {
                      const pct = benefit.discountPercent ?? 0;
                      const discounted = originalPrice * (1 - pct / 100);
                      priceText = discounted.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                      strikethroughPriceText = originalPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                      clubBadge = (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-sky-400">
                          -{pct}% Clube
                        </span>
                      );
                    }
                  }

                  const qty = serviceQuantities[s.id] ?? 0;

                  return (
                    <label key={s.id} className={`flex items-center justify-between gap-3 px-4 py-2.5 cursor-pointer transition-colors ${checked ? "bg-amber-500/5" : "hover:bg-stone-800/40"}`}>
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleService(s.id)}
                          title={s.name}
                          className="accent-amber-500 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-stone-300 truncate">{s.name}</span>
                            {clubBadge}
                          </div>
                        </div>
                        <span className="text-xs text-stone-500 shrink-0">{s.durationMin}min</span>
                      </div>

                      <div className="flex items-center gap-4 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {checked && (
                          <div className="flex items-center bg-stone-900 border border-stone-800 rounded-lg px-1.5 py-0.5" onClick={(e) => e.preventDefault()}>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); decrementService(s.id); }}
                              className="text-stone-400 hover:text-white px-1.5 py-0.5 font-bold"
                            >
                              -
                            </button>
                            <span className="text-xs text-stone-200 font-semibold px-1 min-w-[12px] text-center">
                              {qty}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); incrementService(s.id); }}
                              className="text-stone-400 hover:text-white px-1.5 py-0.5 font-bold"
                            >
                              +
                            </button>
                          </div>
                        )}
                        <div className="text-right min-w-[70px]">
                          {strikethroughPriceText && (
                            <span className="text-xs text-stone-500 line-through block tabular-nums">
                              {strikethroughPriceText}
                            </span>
                          )}
                          <span className="text-xs text-amber-400 font-semibold tabular-nums">
                            {priceText}
                          </span>
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={LABEL_INPUT}>Data e hora</label>
            <input type="datetime-local" value={dateTime} onChange={(e) => setDateTime(e.target.value)} title="Data e hora" className={INPUT_CLASS} />
          </div>
          {!isEdit && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className={LABEL_INPUT}>Cliente</label>
                  <input
                    type="search"
                    value={customerName}
                    onChange={(e) => {
                      const value = e.target.value;
                      setCustomerName(value);
                      setCustomerLookupQuery(value);
                      if (!value.trim()) setCustomerResults([]);
                      if (selectedCustomer) {
                        setSelectedCustomer(null);
                        setCustomerClubBalance(null);
                      }
                    }}
                    placeholder="Digite nome ou telefone"
                    title="Cliente"
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className={LABEL_INPUT}>Telefone</label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => {
                      let value = e.target.value.replace(/\D/g, "");
                      if (value.startsWith("55") && (value.length === 12 || value.length === 13)) {
                        value = value.substring(2);
                      }
                      if (value.length > 11) value = value.substring(0, 11);

                      if (value.length > 6) {
                        value = `(${value.substring(0, 2)}) ${value.substring(2, 7)}-${value.substring(7)}`;
                      } else if (value.length > 2) {
                        value = `(${value.substring(0, 2)}) ${value.substring(2)}`;
                      } else if (value.length > 0) {
                        value = `(${value}`;
                      }
                      setCustomerPhone(value);
                      if (value.replace(/\D/g, "").length < 5) setPhoneSuggestion(null);
                      if (selectedCustomer) {
                        setSelectedCustomer(null);
                        setCustomerClubBalance(null);
                      }
                    }}
                    placeholder="(11) 99999-9999"
                    title="Telefone do cliente"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              {canShowCustomerResults && (
                <div className="rounded-lg border border-stone-800 bg-[var(--surface-1)] overflow-hidden">
                  <div className="px-4 py-2 border-b border-stone-800 bg-stone-950/50">
                    <p className="text-xs font-bold uppercase tracking-widest text-stone-400">Clientes encontrados</p>
                  </div>
                  <div>
                    {searchingCustomers ? (
                      <p className="px-4 py-3 text-sm text-stone-500">Buscando...</p>
                    ) : customerResults.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-stone-500">Nenhum cliente encontrado. Continue preenchendo para criar um novo cliente.</p>
                    ) : (
                      customerResults.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => chooseCustomer(customer)}
                          className="w-full px-4 py-3 text-left hover:bg-stone-800/60 border-b last:border-b-0 border-stone-800 transition-colors"
                        >
                          <span className="block text-sm font-semibold text-stone-200">{customer.name}</span>
                          <span className="block text-xs text-stone-500">{customer.phone}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {selectedCustomer && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                  <p className="text-sm font-semibold text-amber-100">Cliente selecionado:</p>
                  <p className="text-xs text-amber-200/80">{selectedCustomer.name} - {selectedCustomer.phone}</p>
                  <button type="button" onClick={clearCustomer} className="mt-2 text-xs font-bold text-amber-300 hover:text-amber-200">
                    Limpar seleção
                  </button>
                </div>
              )}

              {phoneSuggestion && canShowPhoneSuggestion && !selectedCustomer && (
                <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3">
                  <p className="text-sm font-semibold text-sky-100">Já existe um cliente com este telefone:</p>
                  <p className="text-xs text-sky-200/80">{phoneSuggestion.name} - {phoneSuggestion.phone}</p>
                  <button type="button" onClick={() => chooseCustomer(phoneSuggestion)} className="mt-2 text-xs font-bold text-sky-300 hover:text-sky-200">
                    Usar este cliente
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <label className={LABEL_INPUT}>Observações</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Observações opcionais..." title="Observações" className={`${INPUT_CLASS} resize-none`} />
          </div>
          {selectedServiceIds.length > 0 && (
            <div className="p-3.5 rounded-xl bg-stone-900/60 border border-stone-800 text-sm flex flex-col gap-1">
              <div className="flex justify-between items-center text-stone-400 text-xs">
                <span>Valor original total:</span>
                <span className="tabular-nums">
                  {preview.totalOriginal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </span>
              </div>
              <div className="flex justify-between items-center text-stone-200 font-semibold">
                <span>Valor previsto hoje:</span>
                <span className="text-amber-400 font-bold tabular-nums">
                  {preview.totalToday.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </span>
              </div>
            </div>
          )}
          {error && <div className="bg-red-950/40 border border-red-800/50 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors text-sm font-semibold">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-gold flex-1 py-3">{saving ? "Salvando..." : isEdit ? "Salvar" : "Criar agendamento"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Cancel Modal ─────────────────────────────────────────────────────────────

function CancelModal({
  appointment,
  onClose,
  onCancelled,
}: {
  appointment: Appointment;
  onClose: () => void;
  onCancelled: (a: Appointment) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleCancel = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED", notes: reason || null }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? data.error ?? "Erro.");
      }
      onCancelled(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao cancelar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[var(--surface-2)] border border-[var(--border-medium)] rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
        <h2 className="text-base font-bold text-[var(--text-primary)]">Cancelar agendamento</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--text-primary)]">{appointment.customer.name}</span>
          {" · "}{formatTime(appointment.dateTime)}
        </p>
        <div className="space-y-1.5">
          <label className={LABEL_INPUT}>Motivo (opcional)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Ex: cliente solicitou..." title="Motivo do cancelamento" className={`${INPUT_CLASS} resize-none`} />
        </div>
        {error && <div className="bg-red-950/40 border border-red-800/50 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors text-sm font-semibold">Voltar</button>
          <button onClick={handleCancel} disabled={saving} className="flex-1 py-3 rounded-lg bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-bold transition-colors text-sm">
            {saving ? "Cancelando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface ScheduleBlock {
  id: string;
  memberId: string;
  startDate: string;
  endDate: string;
  reason: string;
  allDay?: boolean;
}

// ─── Modal Opções da Agenda ───────────────────────────────────────────────────

function OperationOptionsModal({
  onClose,
  onSelectFitIn,
  onSelectBlock,
}: {
  onClose: () => void;
  onSelectFitIn: () => void;
  onSelectBlock: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-[var(--text-primary)]">Opções da agenda</h3>
          <button onClick={onClose} className="p-1 rounded-lg text-stone-400 hover:bg-stone-800 transition-colors">✕</button>
        </div>

        <p className="text-xs text-[var(--text-secondary)]">Selecione a operação que deseja realizar na agenda:</p>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => { onClose(); onSelectFitIn(); }}
            className="w-full text-left p-4 rounded-xl border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 transition-all flex flex-col gap-1 group"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-orange-200 group-hover:text-orange-100">+ NOVO ENCAIXE</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-orange-500/20 text-orange-300">Encaixe</span>
            </div>
            <p className="text-xs text-stone-300">
              Criar um atendimento mesmo quando houver outro agendamento no horário.
            </p>
          </button>

          <button
            type="button"
            onClick={() => { onClose(); onSelectBlock(); }}
            className="w-full text-left p-4 rounded-xl border border-stone-700 bg-stone-900/80 hover:bg-stone-800 transition-all flex flex-col gap-1 group"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-stone-200 group-hover:text-stone-100">🔒 BLOQUEAR AGENDA</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-stone-800 text-stone-400">Bloqueio</span>
            </div>
            <p className="text-xs text-stone-400">
              Indisponibilizar um período para saída, compromisso, intervalo ou ausência do profissional.
            </p>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─── Modal Excluir Agendamento ────────────────────────────────────────────────

function DeleteAppointmentModal({
  appointment,
  onClose,
  onDeleted,
}: {
  appointment: Appointment;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDelete = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/appointments/${appointment.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        onDeleted(appointment.id);
      } else {
        setErrorMsg(data.message ?? data.error ?? "Erro ao excluir agendamento.");
      }
    } catch {
      setErrorMsg("Erro de conexão ao excluir agendamento.");
    } finally {
      setLoading(false);
    }
  };

  const quantitiesMap = extractServiceQuantities(appointment.notes);
  const serviceNames = appointment.services.map((s) => {
    const qty = quantitiesMap[s.serviceId ?? s.service?.id] ?? 1;
    return qty > 1 ? `${s.service.name} x${qty}` : s.service.name;
  }).join(", ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[var(--surface-1)] border border-red-500/30 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-red-400">Excluir agendamento?</h3>
          <button onClick={onClose} disabled={loading} className="p-1 rounded-lg text-stone-400 hover:bg-stone-800 transition-colors">✕</button>
        </div>

        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          Esta ação remove definitivamente o agendamento da agenda e do histórico. Use Cancelar quando desejar manter o registro do cancelamento.
        </p>

        <div className="bg-[var(--surface-2)] border border-[var(--border-subtle)] rounded-xl p-4 space-y-2 text-xs">
          <div>
            <span className="text-[var(--text-muted)] font-semibold">Cliente: </span>
            <span className="text-[var(--text-primary)] font-bold">{appointment.customer.name}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)] font-semibold">Profissional: </span>
            <span className="text-[var(--text-primary)]">{appointment.barber.user.name}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)] font-semibold">Data/Hora: </span>
            <span className="text-[var(--text-primary)]">{formatDateTime(appointment.dateTime)}</span>
          </div>
          {serviceNames && (
            <div>
              <span className="text-[var(--text-muted)] font-semibold">Serviços: </span>
              <span className="text-[var(--text-primary)]">{serviceNames}</span>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-red-300 text-xs font-medium">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="py-3 px-4 rounded-xl border border-[var(--border-subtle)] text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center justify-center"
          >
            {loading ? "Excluindo..." : "Excluir definitivamente"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Criar Bloqueio de Agenda ───────────────────────────────────────────

function ScheduleBlockModal({
  members,
  currentDate,
  initialMemberId,
  initialStartTime,
  onClose,
  onCreated,
}: {
  members: Member[];
  currentDate: string;
  initialMemberId?: string;
  initialStartTime?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [memberId, setMemberId] = useState(initialMemberId ?? members[0]?.id ?? "");
  const [date, setDate] = useState(currentDate);
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState(initialStartTime ?? "10:00");
  const [endTime, setEndTime] = useState(() => {
    if (!initialStartTime) return "11:00";
    const [h, m] = initialStartTime.split(":").map(Number);
    const endH = (h + 1) % 24;
    return `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Array<{ appointmentId: string; start: string; end: string; customerName: string }> | null>(null);

  const REASON_SUGGESTIONS = [
    "Compromisso pessoal",
    "Consulta médica",
    "Saída externa",
    "Intervalo",
    "Reunião",
    "Outro",
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setConflicts(null);

    if (!memberId) {
      setErrorMsg("Selecione o profissional.");
      return;
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      setErrorMsg("Informe o motivo do bloqueio (mínimo 3 caracteres).");
      return;
    }

    let startDateIso: string;
    let endDateIso: string;

    if (allDay) {
      startDateIso = `${date}T00:00:00.000Z`;
      endDateIso = `${date}T23:59:59.999Z`;
    } else {
      if (!startTime || !endTime) {
        setErrorMsg("Horários de início e fim são obrigatórios.");
        return;
      }
      if (endTime <= startTime) {
        setErrorMsg("Horário final deve ser maior que o inicial.");
        return;
      }
      startDateIso = `${date}T${startTime}:00.000Z`;
      endDateIso = `${date}T${endTime}:00.000Z`;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/schedule-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId,
          startDate: startDateIso,
          endDate: endDateIso,
          reason: trimmedReason,
          allDay,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        onCreated();
        onClose();
      } else {
        if (data.conflicts && Array.isArray(data.conflicts)) {
          setConflicts(data.conflicts);
        }
        setErrorMsg(data.message ?? data.error ?? "Erro ao criar bloqueio de agenda.");
      }
    } catch {
      setErrorMsg("Erro de conexão ao criar bloqueio.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
            <span>🔒</span> Bloquear Agenda
          </h3>
          <button onClick={onClose} disabled={loading} className="p-1 rounded-lg text-stone-400 hover:bg-stone-800 transition-colors">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={LABEL_INPUT}>Profissional *</label>
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className={INPUT_CLASS}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.user.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_INPUT}>Data *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={INPUT_CLASS}
              required
            />
          </div>

          <div className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              id="allDayCheck"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
            />
            <label htmlFor="allDayCheck" className="text-xs font-semibold text-[var(--text-primary)] cursor-pointer">
              Dia inteiro
            </label>
          </div>

          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_INPUT}>Início *</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={INPUT_CLASS}
                  required={!allDay}
                />
              </div>
              <div>
                <label className={LABEL_INPUT}>Fim *</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={INPUT_CLASS}
                  required={!allDay}
                />
              </div>
            </div>
          )}

          <div>
            <label className={LABEL_INPUT}>Motivo do bloqueio *</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Consulta médica, Almoço..."
              className={INPUT_CLASS}
              required
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {REASON_SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setReason(sug)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:border-[var(--gold)] hover:text-[var(--gold)] transition-colors"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-red-300 text-xs font-medium space-y-2">
              <p>{errorMsg}</p>
              {conflicts && conflicts.length > 0 && (
                <div className="border-t border-red-800/40 pt-2 space-y-1">
                  <p className="font-bold text-[11px] text-red-200">Agendamentos conflitantes:</p>
                  {conflicts.map((c) => (
                    <div key={c.appointmentId} className="text-[11px] text-red-300">
                      • {c.customerName} ({formatTime(c.start)} - {formatTime(c.end)})
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="py-3 px-4 rounded-xl border border-[var(--border-subtle)] text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-bold transition-colors disabled:opacity-50"
            >
              {loading ? "Bloqueando..." : "Bloquear agenda"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal Detalhes do Bloqueio de Agenda ─────────────────────────────────────

function ScheduleBlockDetailsModal({
  block,
  memberName,
  onClose,
  onDeleted,
}: {
  block: ScheduleBlock;
  memberName: string;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDelete = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/schedule-blocks/${block.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        onDeleted(block.id);
        onClose();
      } else {
        setErrorMsg(data.message ?? data.error ?? "Erro ao excluir bloqueio.");
      }
    } catch {
      setErrorMsg("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  };

  const periodStr = block.allDay
    ? "Dia inteiro"
    : `${formatTime(block.startDate)} - ${formatTime(block.endDate)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <h3 className="text-base font-bold text-stone-200 flex items-center gap-2">
            <span>🔒</span> Agenda bloqueada
          </h3>
          <button onClick={onClose} disabled={loading} className="p-1 rounded-lg text-stone-400 hover:bg-stone-800 transition-colors">✕</button>
        </div>

        <div className="bg-stone-900/90 border border-stone-800 rounded-xl p-4 space-y-2 text-xs">
          <div>
            <span className="text-stone-400 font-semibold">Profissional: </span>
            <span className="text-stone-200 font-bold">{memberName}</span>
          </div>
          <div>
            <span className="text-stone-400 font-semibold">Período: </span>
            <span className="text-amber-400 font-bold">{periodStr}</span>
          </div>
          <div>
            <span className="text-stone-400 font-semibold">Motivo: </span>
            <span className="text-stone-200">{block.reason || "Sem motivo especificado"}</span>
          </div>
        </div>

        {errorMsg && (
          <p className="text-xs font-semibold text-red-400">{errorMsg}</p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="py-3 px-4 rounded-xl border border-stone-800 text-xs font-bold text-stone-300 hover:bg-stone-800 transition-colors disabled:opacity-50"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="py-3 px-4 rounded-xl bg-red-950/60 hover:bg-red-900/80 text-red-200 border border-red-800/60 text-xs font-bold transition-colors disabled:opacity-50"
          >
            {loading ? "Excluindo..." : "Excluir bloqueio"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Appointment Block (calendar cell) ───────────────────────────────────────

export function AppointmentBlock({
  appointment,
  onEdit,
  onCancel,
  onDelete,
  onStatusChange,
  onAppointmentUpdated,
  onOpenComanda,
  isOpen,
  onToggleOpen,
  barbershopName,
  style,
}: {
  appointment: Appointment;
  onEdit: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
  onDelete?: (a: Appointment) => void;
  onStatusChange: (id: string, status: AppStatus) => void;
  onAppointmentUpdated: (a: Appointment) => void;
  onOpenComanda: (a: Appointment) => void;
  isOpen: boolean;
  onToggleOpen: (open: boolean) => void;
  barbershopName: string;
  style?: React.CSSProperties;
}) {
  const [loadingStatus, setLoadingStatus] = useState(false);
  const router = useRouter();
  const { data: session } = useSession();
  const [clubBalance, setClubBalance] = useState<ClubBalance | null>(null);
  const [loadingClub, setLoadingClub] = useState(false);
  const [whatsappConfirmationOverride, setWhatsappConfirmationOverride] =
    useState<AppointmentWhatsappConfirmation | null | undefined>(undefined);
  const [whatsappToken, setWhatsappToken] = useState("");
  const [whatsappError, setWhatsappError] = useState("");
  const [whatsappSuccess, setWhatsappSuccess] = useState("");
  const [confirmingWhatsapp, setConfirmingWhatsapp] = useState(false);
  const [showManualConfirmDialog, setShowManualConfirmDialog] = useState(false);

  useEffect(() => {
    if (!isOpen || !appointment.customer.id) {
      return;
    }
    let active = true;
    fetchClubBalance(appointment.customer.id).then((data) => {
      if (active) {
        setClubBalance(data);
        setLoadingClub(false);
      }
    });
    return () => {
      active = false;
    };
  }, [isOpen, appointment.customer.id]);

  const getAppointmentPreview = () => {
    let totalOriginal = 0;
    let totalToday = 0;

    const benefits = clubBalance?.benefits ? clubBalance.benefits.map((b) => ({ ...b })) : [];
    const isInactive = !!clubBalance?.status && INACTIVE_CLUB_STATUSES.includes(clubBalance.status);

    const quantitiesMap = extractServiceQuantities(appointment.notes);
    const expandedServices: typeof appointment.services = [];
    appointment.services.forEach((s) => {
      const qty = quantitiesMap[s.service.id] ?? 1;
      for (let i = 0; i < qty; i++) {
        expandedServices.push(s);
      }
    });

    const processed = expandedServices.map(s => {
      const originalPrice = parseFloat(s.priceApplied);
      totalOriginal += originalPrice;

      let todayPrice = originalPrice;
      let isCovered = false;
      let isDiscounted = false;
      let discountPercent = 0;
      let limitExhausted = false;

      if (clubBalance && !isInactive) {
        const match = benefits.find((b) => b.serviceId === s.service.id);
        if (match) {
          if (match.benefitType === "INCLUDED_SERVICE") {
            if (match.isUnlimited || (match.availableQty && match.availableQty > 0)) {
              isCovered = true;
              todayPrice = 0;
              if (!match.isUnlimited && match.availableQty) {
                match.availableQty -= 1;
              }
            } else {
              limitExhausted = true;
            }
          } else if (match.benefitType === "SERVICE_DISCOUNT") {
            isDiscounted = true;
            discountPercent = match.discountPercent ?? 0;
            todayPrice = originalPrice * (1 - discountPercent / 100);
          }
        }
      }

      totalToday += todayPrice;

      return {
        ...s,
        originalPrice,
        todayPrice,
        isCovered,
        isDiscounted,
        discountPercent,
        limitExhausted
      };
    });

    return {
      totalOriginal,
      totalToday,
      services: processed,
      isInactive
    };
  };

  const preview = getAppointmentPreview();

  const startMin = isoToMinutes(appointment.dateTime);
  const top = minutesToTop(startMin);
  const height = Math.max(minutesToHeight(appointment.durationMin), ROW_HEIGHT);

  const currentRole = (session?.user as { role?: string } | undefined)?.role;
  const effectiveWhatsappConfirmation =
    whatsappConfirmationOverride ?? appointment.whatsappConfirmation ?? null;
  const appointmentWithEffectiveWhatsapp: Appointment = {
    ...appointment,
    whatsappConfirmation: effectiveWhatsappConfirmation,
  };
  const uiStatus = getUIStatus(appointmentWithEffectiveWhatsapp);
  const primaryStatus = getPrimaryStatusPresentation(appointmentWithEffectiveWhatsapp);
  const isTerminal = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(uiStatus);
  const canConfirmWhatsapp = currentRole === "OWNER" || currentRole === "MANAGER";
  const quantitiesMap = extractServiceQuantities(appointment.notes);
  const serviceNames = appointment.services.map((s) => {
    const qty = quantitiesMap[s.serviceId ?? s.service?.id] ?? 1;
    return qty > 1 ? `${s.service.name} x${qty}` : s.service.name;
  }).join(", ");
  // Lógica de Lembrete WhatsApp
  const formattedPhone = formatWhatsAppPhone(appointment.customer.phone);
  const { date: waDate, time: waTime } = formatAppointmentDateTimeForMessage(appointment.dateTime);
  const message = generateWhatsAppMessage(
    appointment.customer.name,
    barbershopName || "Barbearia",
    waDate,
    waTime,
    serviceNames,
    appointment.barber.user.name
  );
  const waLink = formattedPhone ? generateWhatsAppLink(appointment.customer.phone, message) : null;
  const showWhatsAppAction = !isTerminal;

  const applyUpdatedWhatsappConfirmation = (
    updatedConfirmation: AppointmentWhatsappConfirmation
  ) => {
    setWhatsappConfirmationOverride(updatedConfirmation);
    const updatedAppointment: Appointment = {
      ...appointment,
      whatsappConfirmation: updatedConfirmation,
    };
    onAppointmentUpdated(updatedAppointment);
  };

  const handleConfirmWhatsapp = async (mode: "TOKEN" | "MANUAL_OVERRIDE") => {
    setWhatsappError("");
    setWhatsappSuccess("");

    if (effectiveWhatsappConfirmation?.status !== "PENDING") {
      setWhatsappError("Este agendamento não possui confirmação WhatsApp pendente.");
      return;
    }

    if (!canConfirmWhatsapp) {
      setWhatsappError("Você não tem permissão para confirmar este agendamento.");
      return;
    }

    const token = whatsappToken.trim();
    if (mode === "TOKEN" && !token) {
      setWhatsappError("Informe o codigo recebido no WhatsApp.");
      return;
    }

    setConfirmingWhatsapp(true);
    try {
      const payload =
        mode === "TOKEN"
          ? { mode: "TOKEN", token }
          : {
              mode: "MANUAL_OVERRIDE",
              reason: "Cliente validado pelo telefone/WhatsApp",
            };

      const res = await fetch(`/api/admin/appointments/${appointment.id}/confirm-whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 422 || data.error === "INVALID_WHATSAPP_CONFIRMATION_TOKEN") {
          setWhatsappError("Código inválido. Confira a mensagem recebida no WhatsApp.");
          return;
        }
        setWhatsappError(data.message ?? data.error ?? "Erro ao confirmar WhatsApp.");
        return;
      }

      const updated = data.whatsappConfirmation as AppointmentWhatsappConfirmation;
      applyUpdatedWhatsappConfirmation(updated);
      setWhatsappToken("");
      setShowManualConfirmDialog(false);
      setWhatsappSuccess(
        mode === "MANUAL_OVERRIDE"
          ? "Agendamento confirmado manualmente."
          : "WhatsApp confirmado"
      );
    } catch {
      setWhatsappError("Erro ao confirmar WhatsApp.");
    } finally {
      setConfirmingWhatsapp(false);
    }
  };

  const changeStatus = async (status: AppStatus) => {
    setLoadingStatus(true);
    try {
      const res = await fetch(`/api/admin/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated: Appointment = await res.json();
        onStatusChange(updated.id, updated.status);
        onToggleOpen(false);
      }
    } finally {
      setLoadingStatus(false);
    }
  };

  const computedTop = style?.top ?? top;
  const computedHeight = style?.height ?? height;
  const hasCustomLeft = style?.left !== undefined;

  return (
    <div
      className={`absolute ${hasCustomLeft ? "" : "left-1 right-1"} ${isOpen ? "z-50" : "z-10"}`}
      style={{ top: computedTop, height: computedHeight, ...style }}
    >
      {/* Block */}
      <button
        onClick={() => onToggleOpen(!isOpen)}
        className={`w-full h-full rounded-lg border px-2 py-1 text-left overflow-hidden transition-all shadow-sm ${primaryStatus.bgClass} ${isTerminal ? "opacity-50" : "hover:brightness-110 cursor-pointer"}`}
      >
        <p className="text-[11px] font-bold tabular-nums leading-tight">
          {formatTime(appointment.dateTime)}
        </p>
        {appointment.bookingMode === "FIT_IN" && (
          <p className="text-[9px] font-black tracking-wide text-orange-200">ENCAIXE</p>
        )}
        {effectiveWhatsappConfirmation?.status && (
          <p className="text-[9px] font-black tracking-wide opacity-90">
            {effectiveWhatsappConfirmation.status === "CONFIRMED"
              ? getWhatsappConfirmedLabel(effectiveWhatsappConfirmation)
              : WHATSAPP_STATUS_LABEL[effectiveWhatsappConfirmation.status]}
          </p>
        )}
        <p className="text-[11px] font-semibold leading-tight truncate">{appointment.customer.name}</p>
        {height >= 56 && (
          <p className="text-[10px] opacity-70 leading-tight truncate">{serviceNames}</p>
        )}
      </button>

      {/* Detail Popup (Fixed Modal/Bottom Sheet) */}
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 sm:p-0">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => onToggleOpen(false)} />
          <div className="relative w-full max-w-sm bg-[var(--surface-2)] border border-[var(--border-medium)] rounded-2xl shadow-2xl p-5 space-y-4 animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:fade-in sm:zoom-in-95">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-base font-bold text-[var(--text-primary)]">{appointment.customer.name}</p>
                <p className="text-sm text-[var(--text-muted)]">{appointment.customer.phone}</p>
                {appointment.bookingMode === "FIT_IN" && (
                  <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold border border-orange-500/30 bg-orange-500/10 text-orange-300">
                    ENCAIXE OPERACIONAL
                  </span>
                )}
                {effectiveWhatsappConfirmation?.status && (
                  <span className={`inline-block mt-1 ml-1 px-2 py-0.5 rounded text-[10px] font-bold border ${WHATSAPP_STATUS_BG[effectiveWhatsappConfirmation.status]}`}>
                    {effectiveWhatsappConfirmation.status === "CONFIRMED"
                      ? getWhatsappConfirmedLabel(effectiveWhatsappConfirmation)
                      : WHATSAPP_STATUS_LABEL[effectiveWhatsappConfirmation.status]}
                  </span>
                )}
                {loadingClub && (
                  <p className="text-xs text-stone-500 italic mt-1">Consultando benefícios do Clube...</p>
                )}
                {clubBalance && (
                  <div className="mt-1.5">
                    {clubBalance.status && !["ACTIVE", "GRACE_PERIOD"].includes(clubBalance.status) ? (
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold border border-red-500/20 bg-red-500/5 text-red-400">
                        ⚠️ Plano sem cobertura ativa ({clubBalance.status})
                      </span>
                    ) : (
                      clubBalance.clubPlan && (
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold border border-emerald-500/20 bg-emerald-500/5 text-emerald-400">
                          👑 Assinante: {clubBalance.clubPlan.name}
                        </span>
                      )
                    )}
                  </div>
                )}
              </div>
              <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-full border ${primaryStatus.bgClass}`}>
                {primaryStatus.label}
              </span>
            </div>
            {primaryStatus.helperText && (
              <p className="text-[10px] text-[var(--text-muted)] text-right">{primaryStatus.helperText}</p>
            )}
            
            <div className="text-sm text-[var(--text-secondary)] space-y-3">
              <p className="flex items-center gap-2 text-stone-300">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {formatTime(appointment.dateTime)} · {appointment.durationMin}min
              </p>

              {/* Serviços e Valores */}
              <div className="space-y-2 rounded-xl bg-stone-900/40 border border-stone-800/80 p-3">
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1 flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  Serviços
                </p>
                <div className="space-y-1.5 text-xs divide-y divide-stone-800/50">
                  {preview.services.map((s, idx) => {
                    let info = null;
                    if (s.isCovered) {
                      info = <span className="text-emerald-400 font-semibold">Coberto pelo Clube</span>;
                    } else if (s.isDiscounted) {
                      info = <span className="text-sky-400 font-semibold">Desconto Clube {s.discountPercent}%</span>;
                    } else if (s.limitExhausted) {
                      info = <span className="text-stone-500">Limite do Clube esgotado</span>;
                    }
                    return (
                      <div key={idx} className="flex justify-between items-start pt-1.5 first:pt-0 text-stone-300">
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="truncate">{s.service.name}</span>
                          {info && <span className="text-[10px] text-stone-400 mt-0.5">{info}</span>}
                        </div>
                        <div className="tabular-nums shrink-0">
                          {s.isCovered || s.isDiscounted ? (
                            <div className="flex flex-col items-end">
                              <span className="line-through text-stone-500 text-[10px]">
                                {s.originalPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                              </span>
                              <span className="font-semibold text-stone-200">
                                {s.todayPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                              </span>
                            </div>
                          ) : (
                            <span>
                              {s.originalPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2 mt-2 border-t border-stone-800 flex justify-between items-center text-xs">
                  <span className="font-semibold text-stone-400">Total previsto hoje:</span>
                  <div className="text-right">
                    {preview.totalToday !== preview.totalOriginal ? (
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] text-stone-500 line-through tabular-nums">
                          {preview.totalOriginal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </span>
                        <span className="font-bold text-[var(--gold)] text-sm tabular-nums">
                          {preview.totalToday.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </span>
                      </div>
                    ) : (
                      <span className="font-bold text-[var(--gold)] text-sm tabular-nums">
                        {preview.totalOriginal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {stripMetadataFromNotes(appointment.notes) && (
              <p className="text-sm text-[var(--text-muted)] italic border-l-2 border-[var(--gold-border)] pl-3">
                {stripMetadataFromNotes(appointment.notes)}
              </p>
            )}

            {appointment.bookingMode === "FIT_IN" && appointment.fitInReason && (
              <p className="text-sm text-orange-200/90 border-l-2 border-orange-500/40 pl-3">
                Motivo do encaixe: {appointment.fitInReason}
              </p>
            )}

            {/* WhatsApp Reminder Section */}
            {showWhatsAppAction && (
              <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                {!formattedPhone ? (
                  <p className="text-xs text-[var(--text-muted)] italic text-center">
                    Cliente sem telefone cadastrado
                  </p>
                ) : (
                  <a
                    href={waLink || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full text-center text-sm font-bold px-4 py-3 rounded-xl flex items-center justify-center gap-2 transition-all bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-3)] border border-[var(--border-subtle)]"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.706 1.459h.008c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    Enviar Lembrete por WhatsApp
                  </a>
                )}
              </div>
            )}

            {effectiveWhatsappConfirmation?.status === "PENDING" && (
              <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-[var(--text-primary)]">Confirmação WhatsApp</p>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full border ${WHATSAPP_STATUS_BG.PENDING}`}>
                    Pendente WhatsApp
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-[var(--text-secondary)]">
                  <div>
                    <p className={LABEL_INPUT}>Telefone</p>
                    <p className="mt-1 text-sm text-[var(--text-primary)]">{appointment.customer.phone}</p>
                  </div>
                  <div>
                    <p className={LABEL_INPUT}>Código</p>
                    <p className="mt-1 text-sm text-[var(--text-primary)]">{effectiveWhatsappConfirmation.tokenHint ?? "-"}</p>
                  </div>
                </div>

                {canConfirmWhatsapp ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={whatsappToken}
                      onChange={(e) => setWhatsappToken(e.target.value)}
                      placeholder="TB-000000"
                      title="Código de confirmação WhatsApp"
                      className={INPUT_CLASS}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleConfirmWhatsapp("TOKEN")}
                        disabled={confirmingWhatsapp}
                        className="btn-gold px-4 py-3 text-sm whitespace-nowrap disabled:opacity-50"
                      >
                        {confirmingWhatsapp ? "Confirmando..." : "Confirmar com código"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowManualConfirmDialog(true)}
                        disabled={confirmingWhatsapp}
                        className="px-4 py-3 text-sm rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
                      >
                        Confirmar sem código
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">
                    Você não tem permissão para confirmar este agendamento.
                  </p>
                )}

                {whatsappSuccess && (
                  <p className="text-xs font-semibold text-emerald-300">{whatsappSuccess}</p>
                )}
                {whatsappError && (
                  <p className="text-xs font-semibold text-red-300">{whatsappError}</p>
                )}
              </div>
            )}

            {effectiveWhatsappConfirmation?.status === "CONFIRMED" && (
              <div className="space-y-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-emerald-200">{getWhatsappConfirmedLabel(effectiveWhatsappConfirmation)}</p>
                  <span className="text-xs font-bold px-2 py-1 rounded-full border border-emerald-500/30 text-emerald-200">
                    {getWhatsappConfirmedLabel(effectiveWhatsappConfirmation)}
                  </span>
                </div>
                {effectiveWhatsappConfirmation.confirmedAt && (
                  <p className="text-xs text-emerald-200/80">
                    Em {formatDateTime(effectiveWhatsappConfirmation.confirmedAt)}
                  </p>
                )}
                {effectiveWhatsappConfirmation.confirmedById && (
                  <p className="text-xs text-emerald-200/80">
                    Por {effectiveWhatsappConfirmation.confirmedById}
                  </p>
                )}
                {effectiveWhatsappConfirmation.confirmationMethod === "MANUAL_OVERRIDE" &&
                  effectiveWhatsappConfirmation.manualConfirmationReason && (
                    <p className="text-xs text-emerald-200/80">
                      Motivo: {effectiveWhatsappConfirmation.manualConfirmationReason}
                    </p>
                  )}
              </div>
            )}

            <div className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
              
              {/* Matriz de Botões */}
              {uiStatus === "PENDING" && (
                <button onClick={() => changeStatus("CONFIRMED")} disabled={loadingStatus} className="w-full text-sm font-bold px-4 py-3 rounded-xl bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 border border-sky-500/20 transition-colors disabled:opacity-50">
                  Confirmar Agendamento
                </button>
              )}

              {uiStatus === "CONFIRMED" && (
                <button onClick={() => { onToggleOpen(false); onOpenComanda(appointment); }} className="w-full text-sm font-bold px-4 py-3 rounded-xl bg-[var(--gold)] hover:bg-[#c99833] text-stone-900 transition-colors disabled:opacity-50">
                  Abrir Atendimento
                </button>
              )}

              {(uiStatus === "OPEN_COMANDA" || uiStatus === "IN_SERVICE" || uiStatus === "PENDING_PAYMENT") && (
                <button onClick={() => router.push(`/admin/comandas/${appointment.comandas![0].id}`)} className="w-full text-sm font-bold px-4 py-3 rounded-xl bg-[var(--gold)] hover:bg-[#c99833] text-stone-900 transition-colors">
                  Ver/Finalizar Comanda
                </button>
              )}

              {isTerminal && appointment.comandas?.[0] && (
                <button onClick={() => router.push(`/admin/comandas/${appointment.comandas![0].id}`)} className="w-full text-sm font-bold px-4 py-3 rounded-xl bg-[var(--surface-3)] hover:bg-[var(--surface-4)] text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors">
                  Ver Comanda
                </button>
              )}

              {/* Botões secundários (apenas para não-terminais e sem comanda avançada) */}
              {!isTerminal && uiStatus !== "IN_SERVICE" && uiStatus !== "PENDING_PAYMENT" && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button onClick={() => { onToggleOpen(false); onEdit(appointment); }} className="text-sm font-bold px-3 py-2 rounded-xl bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-3)] border border-[var(--border-subtle)] transition-colors">
                    Editar
                  </button>
                  <button onClick={() => { onToggleOpen(false); onCancel(appointment); }} disabled={loadingStatus} className="text-sm font-bold px-3 py-2 rounded-xl bg-transparent text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors disabled:opacity-50">
                    Cancelar
                  </button>
                </div>
              )}

              {/* Botão de Excluir agendamento (permitido para PENDING, CONFIRMED, CANCELLED quando sem comanda avançada) */}
              {["PENDING", "CONFIRMED", "CANCELLED"].includes(appointment.status) &&
                uiStatus !== "IN_SERVICE" &&
                uiStatus !== "PENDING_PAYMENT" && (
                  <button
                    type="button"
                    onClick={() => {
                      onToggleOpen(false);
                      onDelete?.(appointment);
                    }}
                    className="w-full text-sm font-bold px-3 py-2 mt-2 rounded-xl bg-transparent text-red-500 hover:bg-red-500/10 border border-red-500/30 transition-colors"
                  >
                    Excluir agendamento
                  </button>
                )}

              {/* Falta só permitida antes do início do atendimento (sem comanda ou comanda aberta) */}
              {(uiStatus === "PENDING" || uiStatus === "CONFIRMED" || uiStatus === "OPEN_COMANDA") && (
                <button onClick={() => changeStatus("NO_SHOW")} disabled={loadingStatus} className="w-full text-sm font-bold px-3 py-2 mt-2 rounded-xl bg-transparent text-[var(--text-muted)] hover:bg-[var(--surface-3)] border border-[var(--border-subtle)] transition-colors disabled:opacity-50">
                  Marcar como Falta
                </button>
              )}

              <button onClick={() => onToggleOpen(false)} className="w-full text-sm font-semibold px-3 py-2 mt-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                Fechar
              </button>
            </div>

            {showManualConfirmDialog && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
                <p className="text-sm font-bold text-amber-200">Confirmar sem código?</p>
                <p className="text-xs text-amber-100/80">
                  Use esta opção apenas se você verificou manualmente que o telefone/cliente é real. Esta ação ficará registrada.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setShowManualConfirmDialog(false)}
                    className="px-3 py-2 text-sm rounded-xl border border-amber-500/30 text-amber-100 hover:bg-amber-500/10 transition-colors"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfirmWhatsapp("MANUAL_OVERRIDE")}
                    disabled={confirmingWhatsapp}
                    className="px-3 py-2 text-sm rounded-xl bg-amber-400 text-stone-900 font-bold hover:bg-amber-300 transition-colors disabled:opacity-50"
                  >
                    Confirmar manualmente
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Calendar Grid ────────────────────────────────────────────────────────────

function CalendarGrid({
  appointments,
  scheduleBlocks,
  members,
  filterMember,
  onEdit,
  onCancel,
  onDelete,
  onSelectScheduleBlock,
  onStatusChange,
  onAppointmentUpdated,
  onOpenComanda,
  currentDate,
  onEmptySlotClick,
  barbershopName,
}: {
  appointments: Appointment[];
  scheduleBlocks: ScheduleBlock[];
  members: Member[];
  filterMember: string;
  onEdit: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
  onDelete: (a: Appointment) => void;
  onSelectScheduleBlock: (b: ScheduleBlock, memberName: string) => void;
  onStatusChange: (id: string, status: AppStatus) => void;
  onAppointmentUpdated: (a: Appointment) => void;
  onOpenComanda: (a: Appointment) => void;
  currentDate: string;
  onEmptySlotClick: (initialState: NewAppointmentInitialState) => void;
  barbershopName: string;
}) {
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const hours: number[] = [];
  for (let h = HOUR_START; h < HOUR_END; h++) hours.push(h);
  const slotMinutes: number[] = [];
  for (let minutes = HOUR_START * 60; minutes < HOUR_END * 60; minutes += SLOT_MIN) {
    slotMinutes.push(minutes);
  }
  const totalHeight = ((HOUR_END - HOUR_START) * 60 / SLOT_MIN) * ROW_HEIGHT;

  const visibleMembers = filterMember
    ? members.filter((m) => m.id === filterMember)
    : members;

  const byMember: Record<string, Appointment[]> = {};
  for (const a of appointments) {
    if (!byMember[a.barber.id]) byMember[a.barber.id] = [];
    byMember[a.barber.id].push(a);
  }

  const nowBRVal = nowBR();
  const showNowLine = currentDate === getTodayStr();
  const nowMinutes = nowBRVal.getUTCHours() * 60 + nowBRVal.getUTCMinutes();
  const nowTop = minutesToTop(nowMinutes);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--background)]">
      {/* Header with barber names */}
      <div className="shrink-0 flex border-b border-[var(--border-subtle)] bg-[var(--surface-1)]">
        <div className="shrink-0 w-14 border-r border-[var(--border-subtle)]" />
        <div className="flex flex-1 border-l border-[var(--border-subtle)]">
          {visibleMembers.map((m) => (
            <div
              key={m.id}
              className="flex-1 min-w-[280px] lg:min-w-[320px] px-3 py-2.5 border-r border-[var(--border-subtle)] text-center"
            >
              <p className="text-sm font-bold text-[var(--text-primary)] truncate">
                {m.user.name}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {m.startTime && m.endTime ? `${m.startTime} - ${m.endTime}` : "Sem horário"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Grid container */}
      <div className="flex-1 overflow-auto flex">
        {/* Time gutter */}
        <div className="shrink-0 w-14 relative select-none border-r border-[var(--border-subtle)] bg-[var(--background)]" style={{ height: totalHeight }}>
          {hours.map((h) => (
            <div
              key={h}
              className="absolute left-0 right-0 flex items-start justify-end pr-2"
              style={{ top: minutesToTop(h * 60), height: ROW_HEIGHT * 2 }}
            >
              <span className="text-[10px] text-[var(--text-muted)] tabular-nums -mt-1.5">
                {String(h).padStart(2, "0")}:00
              </span>
            </div>
          ))}
        </div>

        {/* Member columns */}
        <div className="flex flex-1 border-l border-[var(--border-subtle)]">
          {visibleMembers.map((m) => {
            const hasActiveBlock = activeBlockId && (byMember[m.id] ?? []).some((a) => a.id === activeBlockId);
            return (
              <div
                key={m.id}
                className={`flex-1 min-w-[280px] lg:min-w-[320px] relative border-r border-[var(--border-subtle)] ${hasActiveBlock ? "z-30" : "z-10"}`}
              >
                {/* Grid lines */}
                <div className="absolute inset-0 pointer-events-none">
                  {hours.map((h) => (
                    <div key={h}>
                      <div className="absolute left-0 right-0 border-t border-[var(--border-subtle)]" style={{ top: minutesToTop(h * 60) }} />
                      <div className="absolute left-0 right-0" style={{ top: minutesToTop(h * 60 + 30), borderTop: "1px solid rgba(255,255,255,0.03)" }} />
                    </div>
                  ))}
                  <div className="absolute left-0 right-0 border-t border-[var(--border-subtle)]" style={{ top: totalHeight }} />
                </div>

                {/* Now line */}
                {showNowLine && (
                  <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: nowTop }}>
                    <div className="h-0.5 bg-red-500/70" />
                    <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500" />
                  </div>
                )}

                {/* Appointments and Schedule Blocks */}
                <div className="relative" style={{ height: totalHeight }}>
                  {slotMinutes.map((minutes) => {
                    const startMinutes = m.startTime ? (() => {
                      const [h, min] = m.startTime.split(":").map(Number);
                      return h * 60 + min;
                    })() : null;

                    const endMinutes = m.endTime ? (() => {
                      const [h, min] = m.endTime.split(":").map(Number);
                      return h * 60 + min;
                    })() : null;

                    const isOutOfWorkHours = startMinutes === null || endMinutes === null || minutes < startMinutes || minutes >= endMinutes;

                    if (isOutOfWorkHours) {
                      return (
                        <div
                          key={`${m.id}-${minutes}`}
                          className="absolute left-0 right-0 z-0 bg-stone-950/40 cursor-not-allowed bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.1),rgba(0,0,0,0.1)_6px,transparent_6px,transparent_12px)] flex items-center justify-center"
                          style={{ top: minutesToTop(minutes), height: ROW_HEIGHT }}
                          title="Fora do expediente"
                        >
                          <span className="text-[9px] font-semibold text-stone-600 uppercase tracking-wider select-none">
                            Fora de expediente
                          </span>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={`${m.id}-${minutes}`}
                        type="button"
                        onClick={() =>
                          onEmptySlotClick({
                            memberId: m.id,
                            dateTime: minutesToLocalInput(currentDate, minutes),
                          })
                        }
                        className="absolute left-0 right-0 z-0 text-left hover:bg-amber-500/5 focus:bg-amber-500/10 focus:outline-none focus:ring-1 focus:ring-amber-500/50 transition-colors"
                        style={{ top: minutesToTop(minutes), height: ROW_HEIGHT }}
                        title={`Novo agendamento ${m.user.name} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`}
                        aria-label={`Novo agendamento ${m.user.name} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`}
                      />
                    );
                  })}

                  {/* Schedule Blocks */}
                  {(scheduleBlocks.filter((b) => b.memberId === m.id)).map((b) => {
                    const startMin = isoToMinutes(b.startDate);
                    const endMin = b.allDay ? HOUR_END * 60 : isoToMinutes(b.endDate);
                    const top = minutesToTop(Math.max(HOUR_START * 60, startMin));
                    const height = Math.max(ROW_HEIGHT, minutesToTop(Math.min(HOUR_END * 60, endMin)) - top);
                    const periodStr = b.allDay
                      ? "Dia inteiro"
                      : `${formatTime(b.startDate)} - ${formatTime(b.endDate)}`;

                    return (
                      <div
                        key={b.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectScheduleBlock(b, m.user.name);
                        }}
                        className="absolute left-1 right-1 z-20 rounded-xl p-2.5 cursor-pointer border border-stone-700/60 bg-[repeating-linear-gradient(45deg,rgba(41,37,36,0.9),rgba(41,37,36,0.9)_10px,rgba(28,25,23,0.95)_10px,rgba(28,25,23,0.95)_20px)] shadow-md hover:border-amber-500/50 transition-all flex flex-col justify-between select-none"
                        style={{ top, height }}
                        title={`Bloqueio: ${b.reason || "Agenda bloqueada"}`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-bold text-stone-300 flex items-center gap-1">
                            <span>🔒</span> Agenda bloqueada
                          </span>
                          <span className="text-[10px] font-mono text-amber-400 font-bold">
                            {periodStr}
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-400 truncate mt-0.5">{b.reason || "Sem motivo especificado"}</p>
                      </div>
                    );
                  })}

                  {computeAppointmentLayouts(byMember[m.id] ?? []).map(({ appointment: a, top, height, leftPct, widthPct }) => (
                    <AppointmentBlock
                      key={a.id}
                      appointment={a}
                      onEdit={onEdit}
                      onCancel={onCancel}
                      onDelete={onDelete}
                      onStatusChange={onStatusChange}
                      onAppointmentUpdated={onAppointmentUpdated}
                      onOpenComanda={onOpenComanda}
                      isOpen={activeBlockId === a.id}
                      onToggleOpen={(open) => setActiveBlockId(open ? a.id : null)}
                      barbershopName={barbershopName}
                      style={{
                        top,
                        height,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Content ─────────────────────────────────────────────────────────────

function AgendamentosContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateParam = searchParams.get("date");
  const today = getTodayStr();
  const currentDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [barbershopServices, setBarbershopServices] = useState<Service[]>([]);
  const [barbershopName, setBarbershopName] = useState("");
  const [barbershopSlug, setBarbershopSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [filterMember, setFilterMember] = useState("");

  const [editTarget, setEditTarget] = useState<Appointment | null | "new">(null);
  const [newAppointmentInitial, setNewAppointmentInitial] =
    useState<NewAppointmentInitialState | null>(null);
  const [newAppointmentMode, setNewAppointmentMode] = useState<BookingMode>("NORMAL");
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Appointment | null>(null);

  const [operationOptionsOpen, setOperationOptionsOpen] = useState(false);
  const [scheduleBlockOpen, setScheduleBlockOpen] = useState(false);
  const [scheduleBlockInitial, setScheduleBlockInitial] = useState<{
    memberId?: string;
    startTime?: string;
  } | null>(null);
  const [selectedScheduleBlock, setSelectedScheduleBlock] = useState<{
    block: ScheduleBlock;
    memberName: string;
  } | null>(null);

  useEffect(() => {
    const customerId = searchParams.get("customerId");
    const sourceAppointmentId = searchParams.get("sourceAppointmentId");
    const memberIdParam = searchParams.get("memberId");
    const serviceIdsParam = searchParams.get("serviceIds");

    if (!customerId || loading) return;
    const requestedCustomerId = customerId;

    async function setupPreFilledBooking() {
      // Clear query params to prevent repeating modal trigger
      const newParams = new URLSearchParams(window.location.search);
      newParams.delete("customerId");
      newParams.delete("sourceAppointmentId");
      newParams.delete("memberId");
      newParams.delete("serviceIds");
      router.replace(`${window.location.pathname}?${newParams.toString()}`);

      let prefilledMemberId = memberIdParam ?? "";
      let prefilledServices: string[] = [];

      if (sourceAppointmentId) {
        try {
          const res = await fetch(`/api/admin/appointments/${sourceAppointmentId}`);
          if (res.ok) {
            const appt = await res.json();
            prefilledMemberId = appt.barber?.id ?? "";
            prefilledServices = (appt.services ?? [])
              .map((s: { service?: { name?: string } }) => {
                const match = barbershopServices.find((bs) => bs.name === s.service?.name);
                return match?.id ?? "";
              })
              .filter(Boolean);
          }
        } catch (e) {
          console.error("Erro ao carregar agendamento de origem para rebook:", e);
        }
      } else if (serviceIdsParam) {
        prefilledServices = serviceIdsParam.split(",").filter(Boolean);
      }

      // Fetch customer details
      let clientDetails = null;
      try {
        const clientRes = await fetch(`/api/admin/clients/${requestedCustomerId}`);
        if (clientRes.ok) {
          const clientData = await clientRes.json();
          clientDetails = {
            id: clientData.id,
            name: clientData.name,
            phone: clientData.phone,
          };
        }
      } catch (e) {
        console.error("Erro ao buscar detalhes do cliente para prefill:", e);
      }

      setNewAppointmentInitial({
        memberId: prefilledMemberId || undefined,
        dateTime: `${currentDate}T09:00`,
        customerId: requestedCustomerId,
        customerName: clientDetails?.name ?? "",
        customerPhone: clientDetails?.phone ?? "",
        serviceIds: prefilledServices,
      });
      setNewAppointmentMode("NORMAL");
      setEditTarget("new");
    }

    setupPreFilledBooking();
  }, [searchParams, loading, barbershopServices, router, currentDate]);

  const fetchData = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date });
      if (filterMember) params.set("memberId", filterMember);
      const [apptRes, svcRes] = await Promise.all([
        fetch(`/api/admin/appointments?${params}`),
        fetch("/api/admin/services?activeOnly=true"),
      ]);
      const apptData = await apptRes.json();
      const svcData = await svcRes.json();
      setAppointments(apptData.appointments ?? []);
      setScheduleBlocks(apptData.scheduleBlocks ?? []);
      setMembers(apptData.members ?? []);
      setBarbershopName(apptData.barbershopName ?? "");
      setBarbershopSlug(apptData.barbershopSlug ?? "");
      setBarbershopServices(Array.isArray(svcData) ? svcData : (svcData.services ?? []));
    } finally {
      setLoading(false);
    }
  }, [filterMember]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData(currentDate);
  }, [currentDate, fetchData]);

  const navigate = (days: number) => {
    router.push(`/admin/agendamentos?date=${shiftDate(currentDate, days)}`);
  };

  const handleSaved = (a: Appointment) => {
    setAppointments((prev) => {
      const idx = prev.findIndex((x) => x.id === a.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = a; return next; }
      return [...prev, a];
    });
    setEditTarget(null);
    setNewAppointmentInitial(null);
    setNewAppointmentMode("NORMAL");
  };

  const handleUpdated = (a: Appointment) => {
    setAppointments((prev) => prev.map((x) => (x.id === a.id ? a : x)));
    setEditTarget((current) => (current && current !== "new" && current.id === a.id ? a : current));
  };

  const handleCancelled = (a: Appointment) => {
    setAppointments((prev) => prev.map((x) => (x.id === a.id ? a : x)));
    setCancelTarget(null);
  };

  const handleDeleted = (id: string) => {
    setAppointments((prev) => prev.filter((x) => x.id !== id));
    setDeleteTarget(null);
  };

  const handleBlockChanged = () => {
    fetchData(currentDate);
  };

  const handleStatusChange = (id: string, status: AppStatus) => {
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
  };

  const handleOpenComanda = async (appointment: Appointment) => {
    const res = await fetch("/api/admin/comandas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId: appointment.id }),
    });
    const data = await res.json();
    if (res.ok) {
      router.push(`/admin/comandas/${data.id}`);
    } else {
      alert(data.message ?? data.error ?? "Erro ao abrir atendimento.");
    }
  };

  const openNewAppointment = (
    initialState: NewAppointmentInitialState | null = null,
    mode: BookingMode = "NORMAL"
  ) => {
    setNewAppointmentInitial(initialState);
    setNewAppointmentMode(mode);
    setEditTarget("new");
  };

  const confirmed = appointments.filter((a) => a.status === "CONFIRMED").length;
  const pending = appointments.filter((a) => a.status === "PENDING").length;

  let totalServices = 0;
  let revenue = 0;

  for (const a of appointments) {
    if (a.status === "CANCELLED") {
      continue;
    }
    const comanda = a.comandas?.[0];
    if (comanda) {
      if (comanda.status !== "CANCELLED") {
        revenue += parseFloat(comanda.total || "0");
        const activeItems = comanda.items?.filter(
          (item) =>
            (item.type === "SERVICE" || item.type === "PRODUCT") &&
            item.status !== "CANCELLED"
        ) ?? [];
        totalServices += activeItems.reduce(
          (sum, item) => sum + parseFloat(item.quantity || "0"),
          0
        );
      }
    } else {
      revenue += parseFloat(a.totalPrice || "0");
      totalServices += a.services?.length ?? 0;
    }
  }

  const shareMembersData = members.map((m) => ({
    memberName: m.user.name,
    startTime: m.startTime || "",
    endTime: m.endTime || "",
    freeSlots: m.freeSlots || [],
  }));

  return (
    <>
      {editTarget !== null && (
        <AppointmentModal
          appointment={editTarget === "new" ? null : editTarget}
          members={members}
          barbershopServices={barbershopServices}
          appointments={appointments}
          currentDate={currentDate}
          initialState={editTarget === "new" ? newAppointmentInitial : null}
          initialBookingMode={editTarget === "new" ? newAppointmentMode : undefined}
          onClose={() => {
            setEditTarget(null);
            setNewAppointmentInitial(null);
            setNewAppointmentMode("NORMAL");
          }}
          onSaved={handleSaved}
        />
      )}
      {cancelTarget && (
        <CancelModal
          appointment={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={handleCancelled}
        />
      )}
      {deleteTarget && (
        <DeleteAppointmentModal
          appointment={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      )}
      {operationOptionsOpen && (
        <OperationOptionsModal
          onClose={() => setOperationOptionsOpen(false)}
          onSelectFitIn={() => openNewAppointment(null, "FIT_IN")}
          onSelectBlock={() => setScheduleBlockOpen(true)}
        />
      )}
      {scheduleBlockOpen && (
        <ScheduleBlockModal
          members={members}
          currentDate={currentDate}
          initialMemberId={scheduleBlockInitial?.memberId || filterMember || undefined}
          initialStartTime={scheduleBlockInitial?.startTime}
          onClose={() => {
            setScheduleBlockOpen(false);
            setScheduleBlockInitial(null);
          }}
          onCreated={handleBlockChanged}
        />
      )}
      {selectedScheduleBlock && (
        <ScheduleBlockDetailsModal
          block={selectedScheduleBlock.block}
          memberName={selectedScheduleBlock.memberName}
          onClose={() => setSelectedScheduleBlock(null)}
          onDeleted={handleBlockChanged}
        />
      )}

      <div className="flex flex-col h-[calc(100dvh-57px)] lg:h-[calc(100dvh-64px)]">
        {/* ── Top bar ─────────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-stone-800 bg-stone-950 px-4 md:px-6 py-3 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Row 1 on mobile: Date Nav & Hoje */}
            <div className="flex items-center justify-between md:justify-start gap-3 w-full md:w-auto">
              <div className="flex items-center gap-1">
                <button onClick={() => navigate(-1)} className="p-2 rounded-lg text-stone-400 hover:bg-stone-800 hover:text-stone-100 transition-colors" title="Dia anterior">←</button>
                <div className="relative text-center min-w-[140px] xs:min-w-[180px] md:min-w-[200px]">
                  <input
                    type="date"
                    value={currentDate}
                    onChange={(e) => e.target.value && router.push(`/admin/agendamentos?date=${e.target.value}`)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                    title="Selecionar data no calendário"
                  />
                  <p className="text-sm font-semibold text-stone-100 capitalize truncate hover:text-amber-400 transition-colors cursor-pointer flex items-center justify-center gap-1">
                    <span>{formatDateFull(currentDate)}</span>
                    <span className="text-xs text-stone-500">📅</span>
                  </p>
                </div>
                <button onClick={() => navigate(1)} className="p-2 rounded-lg text-stone-400 hover:bg-stone-800 hover:text-stone-100 transition-colors" title="Próximo dia">→</button>
              </div>

              {currentDate !== today && (
                <button onClick={() => router.push("/admin/agendamentos")} className="text-xs text-amber-500 hover:text-amber-400 font-semibold transition-colors px-2 py-1.5 rounded border border-amber-800/50 hover:border-amber-600/50 shrink-0">
                  Hoje
                </button>
              )}
            </div>

            {/* Row 2 on mobile: Barber select */}
            <div className="w-full md:w-auto">
              <select
                value={filterMember}
                onChange={(e) => setFilterMember(e.target.value)}
                title="Filtrar por barbeiro"
                className="w-full md:w-auto bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-sm text-stone-300 focus:border-amber-500/80 focus:outline-none transition-colors"
              >
                <option value="">Todos os barbeiros</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}
              </select>
            </div>

            {/* Row 3 on mobile: Stats & Actions */}
            <div className="flex items-center justify-between md:justify-start gap-3 w-full md:w-auto md:ml-auto flex-wrap">
              <div className="flex items-center gap-2 text-stone-500 text-xs">
                <span>{totalServices} tot.</span>
                {confirmed > 0 && <span className="text-sky-400">{confirmed} conf.</span>}
                {pending > 0 && <span className="text-amber-400">{pending} pend.</span>}
                <span className="text-emerald-400 font-semibold">
                  {revenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </span>
              </div>
              <div className="flex items-center gap-2 ml-auto md:ml-0">
                <WhatsAppShareSlots
                  members={shareMembersData}
                  barbershopName={barbershopName}
                  barbershopSlug={barbershopSlug}
                  todayStr={currentDate}
                />
                <button
                  onClick={() => openNewAppointment(null, "NORMAL")}
                  className="bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-sm px-3.5 py-2 rounded-lg transition-colors shrink-0"
                >
                  + Novo
                </button>
                <button
                  onClick={() => setOperationOptionsOpen(true)}
                  className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-200 border border-orange-500/30 font-bold text-sm px-3.5 py-2 rounded-lg transition-colors shrink-0"
                >
                  + Opções
                </button>
              </div>
            </div>
          </div>

          {/* Faixa Horizontal de Navegação por Dias da Semana */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
            {getWeekDays(currentDate).map((day) => {
              const isSelected = day.iso === currentDate;
              const isToday = day.iso === today;
              return (
                <button
                  key={day.iso}
                  type="button"
                  onClick={() => router.push(`/admin/agendamentos?date=${day.iso}`)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                    isSelected
                      ? "bg-amber-500/20 border-amber-500/60 text-amber-200 shadow-sm"
                      : "bg-stone-900/60 border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800"
                  }`}
                  title={`${day.weekday}, ${day.dayNum}`}
                >
                  <span>{day.label}</span>
                  {isToday && (
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-amber-400" : "bg-amber-500/70"}`} title="Hoje" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Calendar body ──────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-stone-600 text-sm">
              Carregando agenda...
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <p className="text-stone-500">Nenhum barbeiro ativo encontrado.</p>
            </div>
          ) : (
            <CalendarGrid
              appointments={appointments}
              scheduleBlocks={scheduleBlocks}
              members={members}
              filterMember={filterMember}
              onEdit={(a) => setEditTarget(a)}
              onCancel={(a) => setCancelTarget(a)}
              onDelete={(a) => setDeleteTarget(a)}
              onSelectScheduleBlock={(b, memberName) => setSelectedScheduleBlock({ block: b, memberName })}
              onStatusChange={handleStatusChange}
              onAppointmentUpdated={handleUpdated}
              onOpenComanda={handleOpenComanda}
              currentDate={currentDate}
              onEmptySlotClick={openNewAppointment}
              barbershopName={barbershopName}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgendamentosPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full py-20 text-stone-600 text-sm">
          Carregando...
        </div>
      }
    >
      <AgendamentosContent />
    </Suspense>
  );
}
