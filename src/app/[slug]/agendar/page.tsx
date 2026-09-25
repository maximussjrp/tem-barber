/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { formatHeaderDate } from "@/lib/time-utils";
import { Avatar } from "@/components/ui/Avatar";
import { sanitizeBarbershopSlug } from "@/lib/public-barbershops";
import { isValidBrazilMobilePhone } from "@/lib/phone-utils";
import { cleanupCurrentPushSubscriptionBeforeLogout } from "@/lib/push/logout-cleanup";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PublicService {
  id: string;
  name: string;
  description?: string | null;
  price: string;
  durationMin: number;
}

interface PublicCategory {
  id: string;
  name: string;
  services: PublicService[];
}

interface PublicMember {
  id: string;
  name: string;
  avatarUrl: string | null;
  bio: string | null;
  ratingAvg: number;
  serviceIds: string[];
  workingHours: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[];
}

interface AvailabilityResult {
  memberId: string;
  memberName: string;
  slots: string[];
}

interface BookingErrorResponse {
  error?: string;
  message?: string;
}

type PublicSessionUser = {
  authLevel?: string;
  phone?: string;
};

function isPublicClientAuthLevel(authLevel: string | undefined) {
  return (
    authLevel === "phone_lookup" ||
    authLevel === "verified_link" ||
    authLevel === "verified_otp"
  );
}

function generateNextDays(count = 14) {
  const days: { dateStr: string; dayOfWeek: string; dayNumber: string; monthStr: string; label: string }[] = [];
  const now = new Date();
  const dayNamesShort = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const monthNamesShort = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;

    let label = "";
    if (i === 0) label = "Hoje";
    else if (i === 1) label = "Amanhã";
    else label = dayNamesShort[d.getDay()];

    days.push({
      dateStr,
      dayOfWeek: dayNamesShort[d.getDay()],
      dayNumber: dd,
      monthStr: monthNamesShort[d.getMonth()],
      label,
    });
  }
  return days;
}

function groupSlotsByPeriod(slots: string[]) {
  const morning: string[] = [];
  const afternoon: string[] = [];
  const evening: string[] = [];

  for (const s of slots) {
    const [h] = s.split(":").map(Number);
    if (h < 12) {
      morning.push(s);
    } else if (h < 18) {
      afternoon.push(s);
    } else {
      evening.push(s);
    }
  }

  return { morning, afternoon, evening };
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ["Serviço", "Disponibilidade", "Dados", "Confirmar"];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0.5 mb-8">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-all ${
                i < current
                  ? "bg-[#c9a84c] text-[#111113]"
                  : i === current
                  ? "border-2 border-[#c9a84c] text-[#f2d78d] bg-[#c9a84c]/20"
                  : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {i < current ? "✓" : i + 1}
            </div>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`w-8 h-px mx-1 transition-all ${
                i < current ? "bg-[#c9a84c]" : "bg-zinc-800"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

function BookingWizard() {
  const params = useParams();
  const slug = params.slug as string;
  const safeSlug = sanitizeBarbershopSlug(slug);
  const router = useRouter();
  const { data: session, update: updateSession } = useSession();

  const [step, setStep] = useState(0);

  // Data
  const [barbershopName, setBarbershopName] = useState("");
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [members, setMembers] = useState<PublicMember[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(Boolean(safeSlug));

  // Selections
  const [serviceQuantities, setServiceQuantities] = useState<Record<string, number>>({});
  const selectedServiceIds = useMemo(
    () => Object.keys(serviceQuantities),
    [serviceQuantities]
  );
  const [selectedMemberId, setSelectedMemberId] = useState<string>("any");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [availabilityResults, setAvailabilityResults] = useState<AvailabilityResult[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<{ memberId: string; time: string } | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Customer data
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [loginStep, setLoginStep] = useState<"fill" | "logging-in">("fill");
  const [clientLoggedOut, setClientLoggedOut] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  // Booking
  const [booking, setBooking] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [bookingAttemptKey, setBookingAttemptKey] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{
    id: string;
    barberName: string;
    dateTime: string;
    services: string[];
    totalPrice: string;
    whatsappConfirmation?: {
      status: string;
      token: string;
      tokenHint: string;
      expiresAt: string;
      message: string;
      link: string;
    } | null;
  } | null>(null);

  const [subscriptionSuspended, setSubscriptionSuspended] = useState(false);
  const [notFoundError, setNotFoundError] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef<number>(0);

  useEffect(() => {
    if (!safeSlug) return;
    localStorage.setItem("lastBarbershopSlug", safeSlug);
    document.cookie = `lastBarbershopSlug=${safeSlug}; Path=/; Max-Age=2592000; SameSite=Lax`;
  }, [safeSlug]);

  // ─── Load profile ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!safeSlug) return;

    fetch(`/api/public/barbershop/${safeSlug}`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json();
          if (d.error === "SUBSCRIPTION_SUSPENDED") {
            setSubscriptionSuspended(true);
          } else {
            setNotFoundError(true);
          }
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        setBarbershopName(d.barbershop?.name ?? "");
        setCategories(d.categories ?? []);
        setMembers(d.members ?? []);
      })
      .catch(() => {
        setNotFoundError(true);
      })
      .finally(() => setLoadingProfile(false));
  }, [safeSlug]);

  // Handle deep-link ?service=<id>
  useEffect(() => {
    if (typeof window === "undefined" || categories.length === 0) return;
    try {
      const sp = new URLSearchParams(window.location.search);
      const preselectedServiceId = sp.get("service");
      if (preselectedServiceId) {
        const exists = categories.some((c) =>
          c.services.some((s) => s.id === preselectedServiceId)
        );
        if (exists) {
          setServiceQuantities((prev) => {
            if (Object.keys(prev).length === 0) {
              return { [preselectedServiceId]: 1 };
            }
            return prev;
          });
        }
      }
    } catch {
      // Ignore if URLSearchParams is not available
    }
  }, [categories]);

  // ─── Computed ────────────────────────────────────────────────────────────

  const allServices: PublicService[] = categories.flatMap((c) => c.services);
  const sessionUser = session?.user as PublicSessionUser | undefined;
  const clientSessionActive =
    !clientLoggedOut && isPublicClientAuthLevel(sessionUser?.authLevel);

  const sessionPhone = clientSessionActive ? sessionUser?.phone ?? "" : "";
  const hasValidSessionPhone = Boolean(
    sessionPhone && isValidBrazilMobilePhone(sessionPhone)
  );

  const effectiveCustomerPhone =
    customerPhone.replace(/\D/g, "") || sessionPhone.replace(/\D/g, "");

  const maskedSessionPhone = useMemo(() => {
    if (!sessionPhone) return "";
    const digits = sessionPhone.replace(/\D/g, "");
    const core = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
    if (core.length >= 11) {
      return `(${core.slice(0, 2)}) *****-${core.slice(-4)}`;
    }
    return "";
  }, [sessionPhone]);

  const selectedServices = allServices.filter((s) => selectedServiceIds.includes(s.id));
  const totalPrice = selectedServices.reduce(
    (s, svc) => s + Number(svc.price) * (serviceQuantities[svc.id] ?? 1),
    0
  );
  const totalDuration = selectedServices.reduce(
    (s, svc) => s + svc.durationMin * (serviceQuantities[svc.id] ?? 1),
    0
  );

  // Eligible members: execute ALL selected services
  const eligibleMembers = members.filter(
    (m) =>
      selectedServiceIds.length === 0 ||
      selectedServiceIds.every((id) => (m.serviceIds ?? []).includes(id))
  );

  const nextDays = useMemo(() => generateNextDays(14), []);
  const activeDate = selectedDate || (nextDays[0]?.dateStr ?? "");

  // ─── Availability ─────────────────────────────────────────────────────────

  const fetchAvailability = useCallback(
    async (date: string) => {
      if (!date || selectedServiceIds.length === 0) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const currentSeq = ++requestSeqRef.current;

      setLoadingSlots(true);
      setAvailabilityResults([]);
      setSelectedSlot(null);

      const memberId = selectedMemberId !== "any" ? selectedMemberId : undefined;
      const servicesParam = Object.entries(serviceQuantities)
        .map(([serviceId, qty]) => `${serviceId}:${qty}`)
        .join(",");

      const qParams = new URLSearchParams({ date, services: servicesParam });
      if (memberId) qParams.set("memberId", memberId);

      try {
        const res = await fetch(`/api/public/barbershop/${slug}/availability?${qParams}`, {
          signal: controller.signal,
        });
        if (currentSeq !== requestSeqRef.current) return;
        const data = await res.json();
        if (currentSeq !== requestSeqRef.current) return;
        setAvailabilityResults(data.results ?? []);
      } catch (err: unknown) {
        if ((err as { name?: string }).name === "AbortError") return;
      } finally {
        if (currentSeq === requestSeqRef.current) {
          setLoadingSlots(false);
        }
      }
    },
    [slug, selectedServiceIds, serviceQuantities, selectedMemberId]
  );

  useEffect(() => {
    if (step === 1 && selectedDate) {
      fetchAvailability(selectedDate);
    }
  }, [step, selectedDate, fetchAvailability]);

  const resetBookingAttempt = () => {
    setBookingAttemptKey(null);
    setBookingError("");
  };

  const handleSelectSlot = (time: string) => {
    const memberId = selectedMemberId === "any" ? "any" : selectedMemberId;
    setSelectedSlot({ memberId, time });
    resetBookingAttempt();
  };

  // Compute slots to show
  const displaySlots = useMemo(() => {
    if (selectedMemberId === "any") {
      return Array.from(new Set(availabilityResults.flatMap((r) => r.slots))).sort((a, b) =>
        a.localeCompare(b)
      );
    }
    return availabilityResults.find((r) => r.memberId === selectedMemberId)?.slots ?? [];
  }, [availabilityResults, selectedMemberId]);

  const groupedSlots = useMemo(() => groupSlotsByPeriod(displaySlots), [displaySlots]);

  // ─── Step 0: Services ─────────────────────────────────────────────────────

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
    setSelectedMemberId("any");
    setSelectedSlot(null);
    setAvailabilityResults([]);
    resetBookingAttempt();
  };

  const incrementService = (id: string) => {
    setServiceQuantities((prev) => {
      const current = prev[id] ?? 0;
      if (current < 5) {
        return { ...prev, [id]: current + 1 };
      }
      return prev;
    });
    setSelectedMemberId("any");
    setSelectedSlot(null);
    setAvailabilityResults([]);
    resetBookingAttempt();
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
    setSelectedMemberId("any");
    setSelectedSlot(null);
    setAvailabilityResults([]);
    resetBookingAttempt();
  };

  const minDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // ─── Step 3: Customer login/fill ─────────────────────────────────────────

  const handleLoginOrContinue = async () => {
    if (clientSessionActive && hasValidSessionPhone) {
      setStep(3);
      return;
    }
    if (!customerPhone.trim()) return;

    let clean = customerPhone.replace(/\D/g, "");
    if (clean.startsWith("55") && (clean.length === 12 || clean.length === 13)) {
      clean = clean.substring(2);
    }
    const isMobile = clean.length === 11 && clean[2] === "9";
    const isAllSame = /^(\d)\1+$/.test(clean);
    if (!isMobile || isAllSame) {
      setBookingError("Informe um WhatsApp válido com DDD.");
      return;
    }
    setBookingError("");

    setLoginStep("logging-in");
    const cleanPhone = customerPhone.replace(/\D/g, "");
    const res = await signIn("credentials", {
      redirect: false,
      loginType: "client",
      name: customerName.trim() || "Cliente",
      phone: cleanPhone,
    });
    setLoginStep("fill");
    if (res?.ok) {
      setClientLoggedOut(false);
      setStep(3);
    } else {
      setStep(3);
    }
  };

  const handleClientLogout = async () => {
    setLogoutError("");
    setLoggingOut(true);

    try {
      await cleanupCurrentPushSubscriptionBeforeLogout();
      const res = await fetch("/api/client/logout", { method: "POST" });
      if (!res.ok) {
        throw new Error("logout failed");
      }

      setClientLoggedOut(true);
      setCustomerName("");
      setCustomerPhone("");
      await updateSession?.();
      router.refresh();
    } catch {
      setLogoutError("Não foi possível sair agora. Tente novamente.");
    } finally {
      setLoggingOut(false);
    }
  };

  // ─── Step 4: Confirm + Book ───────────────────────────────────────────────

  const handleBook = async () => {
    if (!selectedSlot || booking) return;
    setBooking(true);
    setBookingError("");
    const idempotencyKey = bookingAttemptKey ?? crypto.randomUUID();
    setBookingAttemptKey(idempotencyKey);

    const targetDate = selectedDate || activeDate;
    const [year, month, day] = targetDate.split("-").map(Number);
    const [hours, minutes] = selectedSlot.time.split(":").map(Number);
    const dt = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));

    try {
      const res = await fetch(`/api/public/barbershop/${slug}/book`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          memberId: selectedMemberId === "any" ? "any" : selectedSlot.memberId,
          professionalPreference: selectedMemberId === "any" ? "ANY" : "SPECIFIC",
          services: Object.entries(serviceQuantities).map(([serviceId, quantity]) => ({
            serviceId,
            quantity,
          })),
          dateTime: dt.toISOString(),
          customerName: customerName.trim() || undefined,
          customerPhone: effectiveCustomerPhone || undefined,
          notes: customerNotes.trim() ? customerNotes.trim().slice(0, 500) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errorData = data as BookingErrorResponse;
        if (errorData.error === "SLOT_UNAVAILABLE" || errorData.error === "APPOINTMENT_CONFLICT") {
          setSelectedSlot(null);
          setBookingAttemptKey(null);
          await fetchAvailability(selectedDate);
        }
        if (errorData.error === "IDEMPOTENCY_KEY_REUSED") {
          setBookingAttemptKey(null);
        }
        throw new Error(errorData.message ?? errorData.error ?? "Erro ao agendar.");
      }
      setConfirmed({
        id: data.appointment.id,
        barberName: data.appointment.barberName,
        dateTime: data.appointment.dateTime,
        services: data.appointment.services,
        totalPrice: data.appointment.totalPrice,
        whatsappConfirmation: data.whatsappConfirmation ?? null,
      });
    } catch (error: unknown) {
      setBookingError(error instanceof Error ? error.message : "Erro ao agendar.");
    } finally {
      setBooking(false);
    }
  };

  // ─── Success screen ───────────────────────────────────────────────────────

  if (confirmed) {
    const dt = new Date(confirmed.dateTime);
    return (
      <div className="min-h-screen bg-[#0b0b0d] text-zinc-100 flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="relative mx-auto w-20 h-20">
            <div className="absolute inset-0 rounded-full bg-[#c9a84c]/20 animate-ping opacity-30" />
            <div className="relative w-20 h-20 rounded-full border-2 border-[#c9a84c] bg-zinc-900 flex items-center justify-center shadow-[0_0_24px_rgba(201,168,76,0.3)]">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>

          <div>
            <h1 className="text-3xl font-bold text-zinc-100">Agendado!</h1>
            <p className="text-zinc-400 text-sm mt-2">
              {confirmed.whatsappConfirmation
                ? "Envie o código pelo WhatsApp para finalizar a confirmação."
                : "Seu horário está confirmado."}
            </p>
          </div>

          <div className="bg-[#121317] border border-white/10 rounded-2xl p-5 text-left divide-y divide-white/10">
            {[
              { label: "Data", value: formatHeaderDate(confirmed.dateTime.split("T")[0]) },
              { label: "Horário", value: dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) },
              { label: "Profissional", value: confirmed.barberName },
              { label: "Serviços", value: confirmed.services.join(", ") },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between py-3 text-sm">
                <span className="text-zinc-400">{label}</span>
                <span className="text-zinc-100 font-medium text-right max-w-[200px]">{value}</span>
              </div>
            ))}
            <div className="flex justify-between pt-4 pb-1">
              <span className="text-zinc-400 text-sm">Total</span>
              <span className="text-[#f2d78d] font-bold text-lg">
                {Number(confirmed.totalPrice).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </span>
            </div>
          </div>

          {confirmed.whatsappConfirmation ? (
            <div className="bg-emerald-950/30 border border-emerald-800/60 rounded-2xl p-5 text-left space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  Confirmação WhatsApp
                </p>
                <p className="text-sm text-zinc-300 mt-1">
                  Código:{" "}
                  <span className="font-mono text-lg font-bold text-zinc-100">
                    {confirmed.whatsappConfirmation.token}
                  </span>
                </p>
                <p className="text-xs text-zinc-400 mt-2">
                  Envie esta mensagem para a barbearia confirmar que este número é seu.
                </p>
              </div>
              <a
                href={confirmed.whatsappConfirmation.link}
                target="_blank"
                rel="noreferrer"
                className="block w-full text-center rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3.5 transition-colors text-sm"
              >
                Enviar código para a barbearia
              </a>
            </div>
          ) : (
            <div className="bg-[#121317] border border-white/10 rounded-2xl p-4 text-center space-y-1">
              <p className="text-sm font-semibold text-emerald-400">✓ WhatsApp já verificado</p>
              <p className="text-xs text-zinc-400">
                Você pode acompanhar seus agendamentos em Meus agendamentos.
              </p>
            </div>
          )}

          {clientSessionActive && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleClientLogout}
                disabled={loggingOut}
                className="w-full rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-50"
              >
                {loggingOut ? "Saindo..." : "Não é você? Sair"}
              </button>
              {logoutError && <p className="text-xs text-red-400">{logoutError}</p>}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => router.push(`/${slug}`)}
              className="flex-1 py-3.5 rounded-xl border border-white/15 text-zinc-300 hover:bg-white/5 transition-colors text-sm font-semibold"
            >
              Voltar
            </button>
            <button
              onClick={() => router.push(`/minha-conta?barbershop=${slug}`)}
              className="flex-1 py-3.5 rounded-xl bg-[#c9a84c] text-black font-semibold hover:bg-[#d8b760] transition-colors text-sm"
            >
              Meus agendamentos
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Loading / Errors ─────────────────────────────────────────────────────

  if (loadingProfile) {
    return (
      <div className="min-h-screen bg-[#0b0b0d] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[#c9a84c] border-t-transparent animate-spin" />
          <p className="text-zinc-400 text-sm">Carregando...</p>
        </div>
      </div>
    );
  }

  if (notFoundError || !safeSlug) {
    return (
      <div className="min-h-screen bg-[#0b0b0d] flex items-center justify-center p-6 text-zinc-100">
        <div className="max-w-md w-full bg-[#121317] border border-white/10 rounded-3xl p-8 text-center shadow-2xl">
          <h1 className="text-2xl font-bold tracking-tight mb-4 text-zinc-100">
            Barbearia Não Encontrada
          </h1>
          <p className="text-zinc-400 text-sm leading-relaxed mb-6">
            Esta barbearia não foi encontrada ou não está disponível para agendamento online.
          </p>
          <button
            onClick={() => router.push("/")}
            className="w-full px-5 py-3 rounded-xl bg-zinc-800 text-zinc-200 text-sm font-semibold hover:bg-zinc-700 transition-colors border border-white/10"
          >
            Voltar para o Início
          </button>
        </div>
      </div>
    );
  }

  if (subscriptionSuspended) {
    return (
      <div className="min-h-screen bg-[#0b0b0d] flex items-center justify-center p-6 text-zinc-100">
        <div className="max-w-md w-full bg-[#121317] border border-white/10 rounded-3xl p-8 text-center shadow-2xl">
          <h1 className="text-2xl font-bold tracking-tight mb-4 text-zinc-100">
            Agendamentos Indisponíveis
          </h1>
          <p className="text-zinc-400 text-sm leading-relaxed mb-6">
            Esta barbearia está temporariamente indisponível para agendamentos.
          </p>
          <button
            onClick={() => router.push(`/${slug}`)}
            className="w-full px-5 py-3 rounded-xl bg-zinc-800 text-zinc-200 text-sm font-semibold hover:bg-zinc-700 transition-colors border border-white/10"
          >
            Voltar para a Barbearia
          </button>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-zinc-100">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-[#0b0b0d]/90 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center gap-3">
        {step > 0 ? (
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-900 border border-white/10 text-zinc-300 hover:text-white transition-colors"
            title="Voltar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        ) : (
          <div className="w-9 h-9 rounded-xl bg-[#c9a84c]/15 border border-[#c9a84c]/40 flex items-center justify-center">
            <span className="font-bold text-[#c9a84c] text-xs">TB</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-zinc-400 font-medium uppercase tracking-widest truncate">
            {barbershopName || "Tem Barber"}
          </p>
          <p className="text-xs text-[#c9a84c] font-semibold">
            {step === 0 ? "Escolha o Serviço" : step === 1 ? "Data, Profissional & Horário" : step === 2 ? "Seus Dados" : "Confirmar"}
          </p>
        </div>
        {clientSessionActive && (
          <button
            type="button"
            onClick={handleClientLogout}
            disabled={loggingOut}
            className="px-3 h-8 rounded-lg bg-zinc-900 border border-white/10 text-xs font-semibold text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
          >
            {loggingOut ? "Saindo..." : "Sair"}
          </button>
        )}
        <button
          onClick={() => router.push(`/${slug}`)}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors"
          title="Cancelar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="max-w-xl mx-auto px-4 pt-6 pb-28">
        <StepIndicator current={step} />

        {/* ── Step 0: Choose services ────────────────────────────────────── */}
        {step === 0 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-zinc-100">O que você deseja fazer?</h2>
              <p className="text-xs text-zinc-400 mt-1">Selecione os serviços desejados para o seu agendamento.</p>
            </div>

            {categories.filter((c) => c.services.length > 0).length === 0 && (
              <div className="py-12 text-center border border-white/10 rounded-2xl bg-[#121317]">
                <div className="w-14 h-14 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl">
                  ✂️
                </div>
                <p className="font-semibold text-zinc-200 mb-1">Nenhum serviço disponível</p>
                <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                  Esta barbearia ainda não possui serviços disponíveis para agendamento online.
                </p>
              </div>
            )}

            {categories.filter((c) => c.services.length > 0).map((cat) => (
              <div key={cat.id} className="space-y-2">
                <p className="text-xs font-semibold text-[#c9a84c] uppercase tracking-wider">
                  {cat.name}
                </p>
                <div className="bg-[#121317] border border-white/10 rounded-2xl divide-y divide-white/5 overflow-hidden">
                  {cat.services.map((svc) => {
                    const qty = serviceQuantities[svc.id] ?? 0;
                    const checked = qty > 0;
                    return (
                      <label
                        key={svc.id}
                        className={`flex items-center justify-between gap-4 px-4 py-3.5 cursor-pointer transition-colors ${
                          checked ? "bg-[#c9a84c]/10" : "hover:bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-center gap-3.5 min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleService(svc.id)}
                            title={svc.name}
                            aria-label={svc.name}
                            className="accent-[#c9a84c] w-4 h-4 cursor-pointer rounded"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-zinc-200 truncate">{svc.name}</p>
                            {svc.description && (
                              <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{svc.description}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {checked && (
                            <div className="flex items-center bg-black/60 border border-white/15 rounded-lg px-1.5 py-0.5" onClick={(e) => e.preventDefault()}>
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); decrementService(svc.id); }}
                                className="text-zinc-400 hover:text-white px-1.5 py-0.5 font-bold text-xs"
                                aria-label="Diminuir quantidade"
                              >
                                -
                              </button>
                              <span className="text-xs text-zinc-200 font-semibold px-1 min-w-[14px] text-center">
                                {qty}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); incrementService(svc.id); }}
                                className="text-zinc-400 hover:text-white px-1.5 py-0.5 font-bold text-xs"
                                aria-label="Aumentar quantidade"
                              >
                                +
                              </button>
                            </div>
                          )}
                          <div className="text-right min-w-[76px]">
                            <p className="text-sm font-semibold text-[#f2d78d]">
                              {Number(svc.price).toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </p>
                            <p className="text-[11px] text-zinc-400">{svc.durationMin} min</p>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Step 1: Single Screen for Date + Professional + Slots ──── */}
        {step === 1 && (
          <div className="space-y-6">
            {/* Selected Service Compact Banner */}
            <div className="flex items-center justify-between bg-[#121317] border border-white/10 rounded-2xl px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-zinc-400">Serviço selecionado:</p>
                <p className="text-sm font-medium text-zinc-100 truncate">
                  {selectedServices.map((s) => `${s.name}${serviceQuantities[s.id] > 1 ? ` (${serviceQuantities[s.id]}x)` : ""}`).join(", ")}
                </p>
                <p className="text-xs text-[#c9a84c] font-semibold mt-0.5">
                  {totalPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · {totalDuration} min
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStep(0)}
                className="ml-3 px-3 py-1.5 rounded-lg border border-white/15 text-xs text-zinc-300 hover:text-white hover:border-[#c9a84c]/50 transition-colors"
              >
                Alterar
              </button>
            </div>

            {/* Date Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Data do atendimento
                </label>
                {selectedDate && (
                  <span className="text-xs text-[#c9a84c] font-medium">
                    {formatHeaderDate(selectedDate)}
                  </span>
                )}
              </div>

              {/* Horizontal Date Strip */}
              <div className="flex flex-row flex-nowrap overflow-x-auto gap-2.5 pb-2 pt-1 scrollbar-none" data-testid="date-strip">
                {nextDays.map((d) => {
                  const isSelected = selectedDate === d.dateStr;
                  return (
                    <button
                      key={d.dateStr}
                      type="button"
                      onClick={() => {
                        setSelectedDate(d.dateStr);
                        setSelectedSlot(null);
                        resetBookingAttempt();
                      }}
                      className={`min-w-[70px] py-2.5 px-2 rounded-2xl border text-center shrink-0 transition-all ${
                        isSelected
                          ? "border-[#c9a84c] bg-[#c9a84c]/15 text-[#f2d78d] shadow-sm shadow-[#c9a84c]/10"
                          : "border-white/10 bg-[#121317] text-zinc-300 hover:border-white/20 hover:bg-[#15161c]"
                      }`}
                    >
                      <p className="text-[11px] font-medium uppercase tracking-wider opacity-80">{d.label}</p>
                      <p className="text-lg font-bold my-0.5">{d.dayNumber}</p>
                      <p className="text-[10px] uppercase tracking-wider opacity-70">{d.monthStr}</p>
                    </button>
                  );
                })}
              </div>

              {/* Accessible Native Date Input (visually hidden to avoid visual competition with date strip) */}
              <input
                type="date"
                value={selectedDate}
                min={minDate()}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setSelectedSlot(null);
                  resetBookingAttempt();
                }}
                title="Data do agendamento"
                aria-label="Data do agendamento"
                data-testid="hidden-native-date-input"
                className="sr-only"
              />
            </div>

            {/* Professional Horizontal Strip */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Profissional
              </label>

              <div className="flex flex-row flex-nowrap overflow-x-auto gap-3 pb-2 pt-1 scrollbar-none" data-testid="professional-strip">
                {/* Option 1: Qualquer disponível */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMemberId("any");
                    setSelectedSlot(null);
                    resetBookingAttempt();
                  }}
                  className={`min-w-[96px] max-w-[110px] p-3 rounded-2xl border text-center flex flex-col items-center justify-center shrink-0 transition-all cursor-pointer ${
                    selectedMemberId === "any"
                      ? "border-[#c9a84c] bg-[#c9a84c]/15 text-[#f2d78d] shadow-sm shadow-[#c9a84c]/10"
                      : "border-white/10 bg-[#121317] text-zinc-300 hover:border-white/20 hover:bg-[#15161c]"
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center text-lg mb-1.5">
                    👥
                  </div>
                  <p className="text-xs font-semibold leading-tight line-clamp-2">Qualquer disponível</p>
                  <p className="text-[10px] text-zinc-400 mt-1">Todos horários</p>
                </button>

                {/* Eligible Professionals */}
                {eligibleMembers.map((m) => {
                  const isSelected = selectedMemberId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setSelectedMemberId(m.id);
                        setSelectedSlot(null);
                        resetBookingAttempt();
                      }}
                      className={`min-w-[96px] max-w-[110px] p-3 rounded-2xl border text-center flex flex-col items-center justify-center shrink-0 transition-all cursor-pointer ${
                        isSelected
                          ? "border-[#c9a84c] bg-[#c9a84c]/15 text-[#f2d78d] shadow-sm shadow-[#c9a84c]/10"
                          : "border-white/10 bg-[#121317] text-zinc-300 hover:border-white/20 hover:bg-[#15161c]"
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shrink-0 relative mb-1.5 border border-white/10">
                        <Avatar src={m.avatarUrl} alt={m.name} size="md" fallbackText={m.name} />
                      </div>
                      <p className="text-xs font-semibold leading-tight line-clamp-2">{m.name}</p>
                      {m.ratingAvg > 0 ? (
                        <p className="text-[10px] text-[#f2d78d] mt-1">★ {m.ratingAvg.toFixed(1)}</p>
                      ) : (
                        <p className="text-[10px] text-zinc-500 mt-1">Barbeiro</p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time Slots */}
            <div className="space-y-3 pt-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Horários disponíveis
              </label>

              {!selectedDate ? (
                <div className="bg-[#121317] border border-white/10 rounded-2xl p-6 text-center text-zinc-400 text-xs">
                  Selecione uma data acima para visualizar os horários.
                </div>
              ) : loadingSlots ? (
                <div className="space-y-2">
                  <div className="h-10 rounded-xl bg-zinc-900/60 animate-pulse" />
                  <div className="h-20 rounded-xl bg-zinc-900/40 animate-pulse" />
                </div>
              ) : displaySlots.length === 0 ? (
                <div className="bg-[#121317] border border-white/10 rounded-2xl p-6 text-center text-zinc-400">
                  <p className="text-sm font-medium text-zinc-300">Nenhum horário disponível neste dia.</p>
                  <p className="text-xs text-zinc-500 mt-1">Escolha outra data ou outro profissional para conferir horários.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Manhã */}
                  {groupedSlots.morning.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span>☀️</span> Manhã
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {groupedSlots.morning.map((time) => {
                          const isSelected = selectedSlot?.time === time;
                          return (
                            <button
                              key={time}
                              type="button"
                              onClick={() => handleSelectSlot(time)}
                              className={`py-3 rounded-xl text-sm font-semibold transition-all min-h-[48px] ${
                                isSelected
                                  ? "bg-[#c9a84c] text-black font-bold shadow-md shadow-[#c9a84c]/20"
                                  : "bg-[#121317] border border-white/10 text-zinc-200 hover:border-[#c9a84c]/50 hover:text-[#f8e4a5]"
                              }`}
                            >
                              {time}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Tarde */}
                  {groupedSlots.afternoon.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span>🌤️</span> Tarde
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {groupedSlots.afternoon.map((time) => {
                          const isSelected = selectedSlot?.time === time;
                          return (
                            <button
                              key={time}
                              type="button"
                              onClick={() => handleSelectSlot(time)}
                              className={`py-3 rounded-xl text-sm font-semibold transition-all min-h-[48px] ${
                                isSelected
                                  ? "bg-[#c9a84c] text-black font-bold shadow-md shadow-[#c9a84c]/20"
                                  : "bg-[#121317] border border-white/10 text-zinc-200 hover:border-[#c9a84c]/50 hover:text-[#f8e4a5]"
                              }`}
                            >
                              {time}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Noite */}
                  {groupedSlots.evening.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span>🌙</span> Noite
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {groupedSlots.evening.map((time) => {
                          const isSelected = selectedSlot?.time === time;
                          return (
                            <button
                              key={time}
                              type="button"
                              onClick={() => handleSelectSlot(time)}
                              className={`py-3 rounded-xl text-sm font-semibold transition-all min-h-[48px] ${
                                isSelected
                                  ? "bg-[#c9a84c] text-black font-bold shadow-md shadow-[#c9a84c]/20"
                                  : "bg-[#121317] border border-white/10 text-zinc-200 hover:border-[#c9a84c]/50 hover:text-[#f8e4a5]"
                              }`}
                            >
                              {time}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Customer data + Notes + Summary ────────────────────── */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-xl font-semibold text-zinc-100">Seus dados</h2>

            {/* Quick summary of the booking */}
            <div className="bg-[#121317] border border-white/10 rounded-2xl p-4 space-y-2 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>Data & Horário:</span>
                <span className="text-zinc-200 font-medium">
                  {formatHeaderDate(selectedDate)} às {selectedSlot?.time}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Profissional:</span>
                <span className="text-zinc-200 font-medium">
                  {selectedMemberId === "any"
                    ? "Qualquer disponível"
                    : members.find((m) => m.id === selectedMemberId)?.name ?? "Profissional"}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Total:</span>
                <span className="text-[#f2d78d] font-bold">
                  {totalPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} ({totalDuration} min)
                </span>
              </div>
            </div>

            {clientSessionActive && hasValidSessionPhone ? (
              <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-2xl px-4 py-3.5">
                <p className="text-sm text-emerald-400">
                  ✓ Você está logado como <span className="font-semibold">{session?.user?.name}</span>.
                </p>
                <p className="text-xs text-emerald-300/80 mt-1">
                  Usaremos o WhatsApp cadastrado na sua conta{maskedSessionPhone ? ` (${maskedSessionPhone})` : ""}.
                </p>
                <button
                  type="button"
                  onClick={handleClientLogout}
                  disabled={loggingOut}
                  className="mt-3 text-xs font-semibold text-emerald-200 underline-offset-4 hover:underline disabled:opacity-50"
                >
                  {loggingOut ? "Saindo..." : "Não é você? Sair"}
                </button>
                {logoutError && <p className="text-xs text-red-400">{logoutError}</p>}
              </div>
            ) : (
              <div className="space-y-4">
                {clientSessionActive && !hasValidSessionPhone && (
                  <div className="bg-amber-950/40 border border-amber-800/50 rounded-xl px-4 py-3 text-xs text-amber-300">
                    Sua conta precisa de um WhatsApp válido para concluir o agendamento. Informe abaixo:
                  </div>
                )}
                <p className="text-xs text-zinc-400">
                  Informe seus dados para confirmar. Se você não tiver conta, criamos automaticamente.
                </p>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Nome
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Seu nome completo"
                    title="Seu nome"
                    className="w-full bg-[#121317] border border-white/10 rounded-xl px-4 py-3.5 text-zinc-100 placeholder-zinc-500 focus:border-[#c9a84c] focus:outline-none transition-colors text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Telefone (WhatsApp) *
                  </label>
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
                      setBookingError("");
                    }}
                    placeholder="(11) 99999-9999"
                    title="Seu telefone"
                    className="w-full bg-[#121317] border border-white/10 rounded-xl px-4 py-3.5 text-zinc-100 placeholder-zinc-500 focus:border-[#c9a84c] focus:outline-none transition-colors text-sm"
                  />
                  {bookingError && step === 2 && (
                    <p className="text-xs text-red-400 mt-1">{bookingError}</p>
                  )}
                </div>
              </div>
            )}

            {/* Notes input */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label
                  htmlFor="customer-notes"
                  className="text-xs font-semibold uppercase tracking-wider text-zinc-400"
                >
                  Observações (opcional)
                </label>
                <span className="text-[11px] text-zinc-500">{customerNotes.length}/500</span>
              </div>
              <textarea
                id="customer-notes"
                value={customerNotes}
                onChange={(e) => setCustomerNotes(e.target.value.slice(0, 500))}
                maxLength={500}
                placeholder="Ex: Prefiro acabamento na navalha, corte baixo nas laterais..."
                className="w-full bg-[#121317] border border-white/10 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:border-[#c9a84c] focus:outline-none transition-colors text-sm min-h-[72px] resize-none"
              />
            </div>
          </div>
        )}

        {/* ── Step 3: Summary + Confirm ─────────────────────────────────── */}
        {step === 3 && selectedSlot && (
          <div className="space-y-5">
            <h2 className="text-xl font-semibold text-zinc-100">Confirmar agendamento</h2>

            <div className="bg-[#121317] border border-white/10 rounded-2xl divide-y divide-white/10 overflow-hidden">
              {[
                { label: "Data", value: formatHeaderDate(selectedDate) },
                { label: "Horário", value: selectedSlot.time },
                {
                  label: "Barbeiro",
                  value:
                    selectedMemberId === "any"
                      ? "Qualquer disponível"
                      : members.find((m) => m.id === selectedSlot.memberId)?.name ??
                        availabilityResults.find((r) => r.memberId === selectedSlot.memberId)?.memberName ?? "—",
                },
                {
                  label: "Serviços",
                  value: selectedServices.map((s) => `${s.name}${serviceQuantities[s.id] > 1 ? ` (${serviceQuantities[s.id]}x)` : ""}`).join(", "),
                },
                { label: "Duração", value: `${totalDuration} min` },
                ...(customerNotes.trim() ? [{ label: "Observações", value: customerNotes.trim() }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between px-4 py-3.5 text-sm">
                  <span className="text-zinc-400">{label}</span>
                  <span className="text-zinc-100 font-medium text-right max-w-[220px]">{value}</span>
                </div>
              ))}
              <div className="flex justify-between px-4 py-3.5 text-sm">
                <span className="text-zinc-400">Total</span>
                <span className="text-[#f2d78d] font-bold text-base">
                  {totalPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </span>
              </div>
            </div>

            {bookingError && (
              <div className="bg-red-950/40 border border-red-800/50 rounded-xl px-4 py-3 text-sm text-red-400">
                {bookingError}
              </div>
            )}

            <button
              onClick={handleBook}
              disabled={booking}
              className="w-full bg-[#c9a84c] hover:bg-[#d8b760] disabled:opacity-50 text-black font-bold py-4 rounded-xl transition-colors text-base uppercase tracking-wider"
            >
              {booking ? "Confirmando..." : "Confirmar agendamento"}
            </button>
          </div>
        )}

        {/* ── Bottom navigation ─────────────────────────────────────────── */}
        <div className="fixed bottom-0 left-0 right-0 bg-[#0b0b0d]/95 backdrop-blur border-t border-white/10 px-4 py-3.5 z-40">
          <div className="max-w-xl mx-auto">
            {selectedServiceIds.length > 0 && step < 3 && (
              <div className="flex items-center justify-between mb-2.5 text-xs">
                <span className="text-zinc-400">{totalDuration} min</span>
                <span className="text-[#f2d78d] font-bold text-sm">
                  {totalPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </span>
              </div>
            )}

            {step === 0 && (
              <button
                onClick={() => setStep(1)}
                disabled={selectedServiceIds.length === 0}
                className="w-full bg-[#c9a84c] hover:bg-[#d8b760] disabled:opacity-40 text-black font-bold py-3.5 rounded-xl transition-colors uppercase tracking-wider text-sm"
              >
                Continuar
              </button>
            )}
            {step === 1 && (
              <button
                onClick={() => setStep(2)}
                disabled={!selectedSlot}
                className="w-full bg-[#c9a84c] hover:bg-[#d8b760] disabled:opacity-40 text-black font-bold py-3.5 rounded-xl transition-colors uppercase tracking-wider text-sm"
              >
                Continuar
              </button>
            )}
            {step === 2 && (
              <button
                onClick={handleLoginOrContinue}
                disabled={!(clientSessionActive && hasValidSessionPhone) && !customerPhone.trim()}
                className="w-full bg-[#c9a84c] hover:bg-[#d8b760] disabled:opacity-40 text-black font-bold py-3.5 rounded-xl transition-colors uppercase tracking-wider text-sm"
              >
                {loginStep === "logging-in" ? "Entrando..." : "Continuar"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page export ─────────────────────────────────────────────────────────────

export default function AgendasPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0b0b0d] flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-[#c9a84c] border-t-transparent animate-spin" />
        </div>
      }
    >
      <BookingWizard />
    </Suspense>
  );
}
