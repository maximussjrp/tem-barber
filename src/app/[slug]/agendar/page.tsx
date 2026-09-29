/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { formatHeaderDate } from "@/lib/time-utils";
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
  imageUrl?: string | null;
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
    <div className="flex items-center justify-center gap-1 mb-6">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold transition-all ${
                i < current
                  ? "bg-[#c9a84c] text-black shadow-sm shadow-[#c9a84c]/20"
                  : i === current
                  ? "border-2 border-[#c9a84c] text-[#f2d78d] bg-[#c9a84c]/20"
                  : "bg-zinc-800/80 text-zinc-500 border border-white/5"
              }`}
              title={label}
            >
              {i < current ? "✓" : i + 1}
            </div>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`w-7 sm:w-10 h-0.5 mx-1.5 rounded transition-all ${
                i < current ? "bg-[#c9a84c]" : "bg-zinc-800"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function SelectedServiceVisualCard({
  service,
  allSelectedServices,
  serviceQuantities,
  totalDuration,
  totalPrice,
  onAlterar,
}: {
  service: PublicService | undefined;
  allSelectedServices: PublicService[];
  serviceQuantities: Record<string, number>;
  totalDuration: number;
  totalPrice: number;
  onAlterar?: () => void;
}) {
  const serviceName = allSelectedServices
    .map((s) => `${s.name}${serviceQuantities[s.id] > 1 ? ` (${serviceQuantities[s.id]}x)` : ""}`)
    .join(", ");

  return (
    <div className="flex items-center gap-3.5 bg-[#14151a] border border-white/10 rounded-2xl p-3.5 shadow-lg">
      <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-zinc-900 border border-white/10 shrink-0 flex items-center justify-center">
        {service?.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={service.imageUrl} alt={service.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 text-zinc-500">
            <span className="text-xl">✂️</span>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-bold text-zinc-100 truncate leading-tight">
          {serviceName || "Serviço"}
        </h4>
        {service?.description && (
          <p className="text-xs text-zinc-400 truncate mt-0.5">{service.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-xs text-zinc-400 font-medium flex items-center gap-1">
            <span>◷</span> {totalDuration} min
          </span>
          <span className="text-xs font-extrabold text-[#f2d78d]">
            {totalPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          </span>
        </div>
      </div>

      {onAlterar && (
        <button
          type="button"
          onClick={onAlterar}
          className="px-3 py-1.5 rounded-lg border border-white/15 bg-zinc-900 text-xs font-semibold text-zinc-300 hover:text-white hover:border-[#c9a84c]/50 transition-colors shrink-0 cursor-pointer"
        >
          Alterar
        </button>
      )}
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

  // ─── Step 2: Customer login/fill ─────────────────────────────────────────

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

  // ─── Step 3: Confirm + Book ───────────────────────────────────────────────

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
                : "Seu horário está confirmado com sucesso."}
            </p>
          </div>

          <div className="bg-[#14151a] border border-white/10 rounded-2xl p-5 text-left divide-y divide-white/10 shadow-xl">
            {[
              { label: "Data", value: formatHeaderDate(confirmed.dateTime.split("T")[0]) },
              { label: "Horário", value: dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) },
              { label: "Profissional", value: confirmed.barberName },
              { label: "Serviços", value: confirmed.services.join(", ") },
              { label: "Total", value: `R$ ${Number(confirmed.totalPrice).toFixed(2).replace(".", ",")}` },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between py-3 text-sm">
                <span className="text-zinc-400">{label}</span>
                <span className="text-zinc-100 font-medium text-right max-w-[200px]">{value}</span>
              </div>
            ))}
          </div>

          {confirmed.whatsappConfirmation && (
            <div className="bg-amber-950/30 border border-amber-500/30 rounded-2xl p-4 text-left space-y-3">
              <div className="flex items-start gap-3">
                <span className="text-xl">📱</span>
                <div>
                  <p className="text-sm font-semibold text-amber-300">Confirmação via WhatsApp</p>
                  <p className="text-xs text-zinc-400 mt-1">
                    Envie a mensagem pronta com o código para garantir o horário na agenda.
                  </p>
                </div>
              </div>
              <a
                href={confirmed.whatsappConfirmation.link}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba59] text-white font-bold py-3.5 px-4 rounded-xl text-sm transition-all shadow-md"
              >
                <span>Enviar confirmação no WhatsApp</span>
                <span>→</span>
              </a>
            </div>
          )}

          <button
            onClick={() => router.push(`/${slug}`)}
            className="w-full py-3.5 px-4 rounded-xl border border-white/10 text-zinc-300 hover:text-white hover:border-[#c9a84c]/50 text-sm font-semibold transition-all"
          >
            Voltar para a página da barbearia
          </button>
        </div>
      </div>
    );
  }

  // ─── Loading / Suspended / Not Found ──────────────────────────────────────

  if (loadingProfile) {
    return (
      <div className="min-h-screen bg-[#0b0b0d] text-zinc-100 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-[#c9a84c] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-zinc-500 font-medium">Carregando barbearia...</p>
        </div>
      </div>
    );
  }

  if (notFoundError) {
    return (
      <div className="min-h-screen bg-[#0b0b0d] text-zinc-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#14151a] border border-white/10 rounded-2xl p-6 text-center space-y-4">
          <p className="text-2xl">💈</p>
          <h1 className="text-lg font-bold text-zinc-200">Barbearia não encontrada</h1>
          <p className="text-xs text-zinc-400">Verifique o endereço digitado e tente novamente.</p>
        </div>
      </div>
    );
  }

  if (subscriptionSuspended) {
    return (
      <div className="min-h-screen bg-[#0b0b0d] text-zinc-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#14151a] border border-amber-500/20 rounded-2xl p-6 text-center space-y-4">
          <p className="text-2xl">⚠️</p>
          <h1 className="text-lg font-bold text-amber-300">Agendamentos Indisponíveis</h1>
          <p className="text-xs text-zinc-400">
            Esta barbearia está temporariamente indisponível para novos agendamentos online.
          </p>
        </div>
      </div>
    );
  }

  // ─── Main Wizard Layout ───────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-zinc-100 antialiased selection:bg-[#c9a84c] selection:text-black">
      {/* Header Premium */}
      <header className="sticky top-0 z-30 bg-[#0c0c0e]/95 backdrop-blur-md border-b border-white/10 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center justify-between gap-3">
          {/* Voltar button */}
          <button
            type="button"
            onClick={() => {
              if (step > 0) {
                setStep(step - 1);
              } else {
                router.push(`/${slug}`);
              }
            }}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-900 border border-white/10 text-zinc-300 hover:text-white hover:border-[#c9a84c]/50 transition-colors cursor-pointer shrink-0"
            title="Voltar"
            aria-label="Voltar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>

          {/* Central Barbershop Info & Step Title */}
          <div className="flex-1 min-w-0 text-center">
            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest truncate">
              {barbershopName || "Tem Barber"}
            </p>
            <h1 className="text-sm sm:text-base font-extrabold text-[#f2d78d] tracking-tight truncate mt-0.5">
              {step === 0
                ? "Escolha o Serviço"
                : step === 1
                ? "Escolha seu horário"
                : step === 2
                ? "Seus Dados"
                : "Confirme seu agendamento"}
            </h1>
          </div>

          {/* Sair / Cancelar */}
          <div className="flex items-center gap-2 shrink-0">
            {clientSessionActive && (
              <button
                type="button"
                onClick={handleClientLogout}
                disabled={loggingOut}
                className="px-2.5 h-8 rounded-lg bg-zinc-900 border border-white/10 text-[11px] font-semibold text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
              >
                {loggingOut ? "..." : "Sair"}
              </button>
            )}
            <button
              onClick={() => router.push(`/${slug}`)}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              title="Cancelar agendamento"
              aria-label="Cancelar agendamento"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Content Container */}
      <main className="max-w-xl mx-auto px-4 pt-5 pb-32">
        <StepIndicator current={step} />

        {/* ── Step 0: Choose services ────────────────────────────────────── */}
        {step === 0 && (
          <div className="space-y-5">
            <div className="space-y-1">
              <h2 className="text-lg sm:text-xl font-bold text-zinc-100">O que você deseja fazer?</h2>
              <p className="text-xs text-zinc-400">Selecione os serviços desejados para o seu agendamento.</p>
            </div>

            {categories.filter((c) => c.services.length > 0).length === 0 && (
              <div className="py-12 text-center border border-white/10 rounded-2xl bg-[#14151a]">
                <div className="w-14 h-14 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl">
                  ✂️
                </div>
                <p className="font-semibold text-zinc-200 mb-1 text-sm">Nenhum serviço disponível</p>
                <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                  Esta barbearia ainda não possui serviços disponíveis para agendamento online.
                </p>
              </div>
            )}

            {categories.filter((c) => c.services.length > 0).map((cat) => (
              <div key={cat.id} className="space-y-3">
                <p className="text-xs font-bold text-[#c9a84c] uppercase tracking-wider pl-1">
                  {cat.name}
                </p>
                <div className="space-y-3">
                  {cat.services.map((svc) => {
                    const qty = serviceQuantities[svc.id] ?? 0;
                    const checked = qty > 0;
                    return (
                      <label
                        key={svc.id}
                        className={`relative flex items-center gap-3.5 p-3.5 rounded-2xl border transition-all cursor-pointer select-none ${
                          checked
                            ? "border-[#c9a84c] bg-[#14151a] shadow-lg shadow-[#c9a84c]/10"
                            : "border-white/10 bg-[#14151a] hover:border-white/20 hover:bg-[#181920]"
                        }`}
                      >
                        {/* Checkbox input for test compatibility and accessibility */}
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleService(svc.id)}
                          title={svc.name}
                          aria-label={svc.name}
                          className="accent-[#c9a84c] w-4 h-4 cursor-pointer rounded shrink-0 sr-only"
                        />

                        {/* Thumbnail / Foto do serviço (MESMO TAMANHO FIXO w-20 h-20) */}
                        <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-zinc-900 border border-white/10 shrink-0 flex items-center justify-center">
                          {svc.imageUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img src={svc.imageUrl} alt={svc.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 text-zinc-500">
                              <span className="text-2xl">✂️</span>
                            </div>
                          )}
                        </div>

                        {/* Informações centrais */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-sm font-bold text-zinc-100 leading-snug line-clamp-2">
                              {svc.name}
                            </h3>
                            {/* Visual Checkbox Badge */}
                            <div
                              className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                                checked
                                  ? "bg-[#c9a84c] border-[#c9a84c] text-black"
                                  : "border-white/20 bg-zinc-900/80"
                              }`}
                            >
                              {checked && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </div>
                          </div>

                          {svc.description && (
                            <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                              {svc.description}
                            </p>
                          )}

                          <div className="flex items-center justify-between gap-2 mt-2 pt-1 border-t border-white/5">
                            <span className="text-xs text-zinc-400 font-medium flex items-center gap-1">
                              <span>◷</span> {svc.durationMin} min
                            </span>
                            <span className="text-sm font-extrabold text-[#f2d78d]">
                              {Number(svc.price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                            </span>
                          </div>
                        </div>

                        {/* Quantity Controls */}
                        {checked && (
                          <div
                            className="flex items-center bg-black/80 border border-white/20 rounded-lg px-1.5 py-0.5 shrink-0 self-end mb-0.5"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          >
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); decrementService(svc.id); }}
                              className="text-zinc-400 hover:text-white px-1 font-bold text-xs cursor-pointer"
                              aria-label="Diminuir quantidade"
                            >
                              -
                            </button>
                            <span className="text-xs text-zinc-200 font-bold px-1.5 min-w-[14px] text-center">
                              {qty}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); incrementService(svc.id); }}
                              className="text-zinc-400 hover:text-white px-1 font-bold text-xs cursor-pointer"
                              aria-label="Aumentar quantidade"
                            >
                              +
                            </button>
                          </div>
                        )}
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
            {/* Selected Service Visual Card with Thumbnail & Alterar */}
            <SelectedServiceVisualCard
              service={selectedServices[0]}
              allSelectedServices={selectedServices}
              serviceQuantities={serviceQuantities}
              totalDuration={totalDuration}
              totalPrice={totalPrice}
              onAlterar={() => setStep(0)}
            />

            {/* 1. Escolha a data */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-zinc-200">
                  1. Escolha a data
                </h3>
                {selectedDate && (
                  <span className="text-xs text-[#c9a84c] font-semibold">
                    {formatHeaderDate(selectedDate)}
                  </span>
                )}
              </div>

              {/* Horizontal Date Strip (mostra ~6 dias em 390px) */}
              <div className="flex flex-row flex-nowrap overflow-x-auto gap-2 pb-1.5 pt-0.5 scrollbar-none" data-testid="date-strip">
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
                      className={`min-w-[54px] w-[54px] sm:w-[60px] py-2 px-1 rounded-xl border text-center shrink-0 transition-all cursor-pointer ${
                        isSelected
                          ? "border-[#c9a84c] bg-[#c9a84c] text-black shadow-md shadow-[#c9a84c]/20 font-bold"
                          : "border-white/10 bg-[#14151a] text-zinc-300 hover:border-white/20 hover:bg-[#181920]"
                      }`}
                    >
                      <p className={`text-[10px] font-semibold uppercase tracking-wider ${isSelected ? "text-black/80" : "text-zinc-400"}`}>
                        {d.label}
                      </p>
                      <p className="text-base sm:text-lg font-extrabold my-0.5">{d.dayNumber}</p>
                      <p className={`text-[9px] uppercase tracking-wider ${isSelected ? "text-black/70" : "text-zinc-500"}`}>
                        {d.monthStr}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Accessible Native Date Input (hidden to avoid competition with date strip) */}
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

            {/* 2. Escolha o profissional */}
            <div className="space-y-2.5">
              <h3 className="text-sm font-bold text-zinc-200">
                2. Escolha o profissional
              </h3>

              <div
                className="flex flex-row flex-nowrap overflow-x-auto gap-2 pb-2 pt-0.5 scrollbar-none"
                data-testid="professional-strip"
              >
                {/* Qualquer disponível */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMemberId("any");
                    setSelectedSlot(null);
                    resetBookingAttempt();
                  }}
                  className={`w-[76px] p-1.5 pb-2 rounded-2xl border text-center flex flex-col items-center shrink-0 transition-all cursor-pointer ${
                    selectedMemberId === "any"
                      ? "border-[#c9a84c] bg-[#14151a] shadow-lg shadow-[#c9a84c]/10"
                      : "border-white/10 bg-[#14151a] text-zinc-300 hover:border-white/20"
                  }`}
                >
                  <div className="w-full h-16 sm:h-20 rounded-xl bg-gradient-to-b from-zinc-800 to-zinc-900 border border-white/10 flex items-center justify-center text-2xl mb-1.5 shadow-inner">
                    👥
                  </div>
                  <p className="text-[11px] font-bold leading-tight line-clamp-1 w-full text-zinc-100">Qualquer disponível</p>
                  <p className="text-[9px] text-zinc-400 font-medium leading-none mt-0.5">Todos</p>
                  <div className={`w-3.5 h-3.5 rounded-full border mt-1.5 flex items-center justify-center ${
                    selectedMemberId === "any" ? "border-[#c9a84c] bg-[#c9a84c]" : "border-white/20 bg-zinc-900"
                  }`}>
                    {selectedMemberId === "any" && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                  </div>
                </button>

                {/* Eligible Professionals */}
                {eligibleMembers.map((m) => {
                  const isSelected = selectedMemberId === m.id;
                  const initials = m.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setSelectedMemberId(m.id);
                        setSelectedSlot(null);
                        resetBookingAttempt();
                      }}
                      className={`w-[76px] p-1.5 pb-2 rounded-2xl border text-center flex flex-col items-center shrink-0 transition-all cursor-pointer ${
                        isSelected
                          ? "border-[#c9a84c] bg-[#14151a] shadow-lg shadow-[#c9a84c]/10"
                          : "border-white/10 bg-[#14151a] text-zinc-300 hover:border-white/20"
                      }`}
                    >
                      <div className="w-full h-16 sm:h-20 rounded-xl overflow-hidden bg-gradient-to-b from-zinc-800 to-zinc-900 border border-white/10 flex items-center justify-center mb-1.5 shrink-0 shadow-inner">
                        {m.avatarUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-sm font-black text-zinc-400 tracking-wider">
                            {initials}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-bold leading-tight truncate w-full text-zinc-100" title={m.name}>
                        {m.name}
                      </p>
                      {m.ratingAvg > 0 ? (
                        <p className="text-[9px] text-[#f2d78d] font-semibold mt-0.5">★ {m.ratingAvg.toFixed(1)}</p>
                      ) : (
                        <p className="text-[9px] text-zinc-500 font-medium mt-0.5">Barbeiro</p>
                      )}
                      <div className={`w-3.5 h-3.5 rounded-full border mt-1.5 flex items-center justify-center ${
                        isSelected ? "border-[#c9a84c] bg-[#c9a84c]" : "border-white/20 bg-zinc-900"
                      }`}>
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Horários disponíveis */}
            <div className="space-y-3 pt-1">
              <h3 className="text-sm font-bold text-zinc-200">
                3. Horários disponíveis
              </h3>

              {!selectedDate ? (
                <div className="bg-[#14151a] border border-white/10 rounded-2xl p-6 text-center text-zinc-400 text-xs">
                  Selecione uma data acima para visualizar os horários disponíveis.
                </div>
              ) : loadingSlots ? (
                <div className="space-y-2">
                  <div className="h-12 rounded-xl bg-zinc-900/60 animate-pulse" />
                  <div className="h-24 rounded-xl bg-zinc-900/40 animate-pulse" />
                </div>
              ) : displaySlots.length === 0 ? (
                <div className="bg-[#14151a] border border-white/10 rounded-2xl p-6 text-center text-zinc-400">
                  <p className="text-sm font-semibold text-zinc-300">Nenhum horário disponível neste dia.</p>
                  <p className="text-xs text-zinc-500 mt-1">Escolha outra data ou outro profissional para conferir a grade.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Manhã */}
                  {groupedSlots.morning.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span>☀️</span> Manhã
                      </p>
                      <div className="grid grid-cols-4 gap-2">
                        {groupedSlots.morning.map((time) => {
                          const isSelected = selectedSlot?.time === time;
                          return (
                            <button
                              key={time}
                              type="button"
                              onClick={() => handleSelectSlot(time)}
                              className={`py-2.5 px-1 rounded-xl text-xs sm:text-sm font-bold transition-all min-h-[44px] cursor-pointer ${
                                isSelected
                                  ? "bg-[#c9a84c] text-black shadow-md shadow-[#c9a84c]/20"
                                  : "bg-[#14151a] border border-white/10 text-zinc-200 hover:border-[#c9a84c]/50 hover:text-[#f8e4a5]"
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
                      <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span>🌤️</span> Tarde
                      </p>
                      <div className="grid grid-cols-4 gap-2">
                        {groupedSlots.afternoon.map((time) => {
                          const isSelected = selectedSlot?.time === time;
                          return (
                            <button
                              key={time}
                              type="button"
                              onClick={() => handleSelectSlot(time)}
                              className={`py-2.5 px-1 rounded-xl text-xs sm:text-sm font-bold transition-all min-h-[44px] cursor-pointer ${
                                isSelected
                                  ? "bg-[#c9a84c] text-black shadow-md shadow-[#c9a84c]/20"
                                  : "bg-[#14151a] border border-white/10 text-zinc-200 hover:border-[#c9a84c]/50 hover:text-[#f8e4a5]"
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
                      <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span>🌙</span> Noite
                      </p>
                      <div className="grid grid-cols-4 gap-2">
                        {groupedSlots.evening.map((time) => {
                          const isSelected = selectedSlot?.time === time;
                          return (
                            <button
                              key={time}
                              type="button"
                              onClick={() => handleSelectSlot(time)}
                              className={`py-2.5 px-1 rounded-xl text-xs sm:text-sm font-bold transition-all min-h-[44px] cursor-pointer ${
                                isSelected
                                  ? "bg-[#c9a84c] text-black shadow-md shadow-[#c9a84c]/20"
                                  : "bg-[#14151a] border border-white/10 text-zinc-200 hover:border-[#c9a84c]/50 hover:text-[#f8e4a5]"
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
            <div className="space-y-1">
              <h2 className="text-lg sm:text-xl font-bold text-zinc-100">Seus dados</h2>
              <p className="text-xs text-zinc-400">
                Quase lá! Preencha seus dados para confirmar o seu agendamento.
              </p>
            </div>

            {/* Visual Service Card */}
            <SelectedServiceVisualCard
              service={selectedServices[0]}
              allSelectedServices={selectedServices}
              serviceQuantities={serviceQuantities}
              totalDuration={totalDuration}
              totalPrice={totalPrice}
            />

            {/* Quick summary of the booking */}
            <div className="bg-[#14151a] border border-white/10 rounded-2xl p-4 space-y-2.5 text-xs shadow-lg divide-y divide-white/5">
              <div className="flex justify-between items-center text-zinc-400 pt-0.5">
                <span className="flex items-center gap-1.5"><span>📅</span> Data:</span>
                <span className="text-zinc-200 font-semibold">
                  {formatHeaderDate(selectedDate)}
                </span>
              </div>
              <div className="flex justify-between items-center text-zinc-400 pt-2">
                <span className="flex items-center gap-1.5"><span>🕐</span> Horário:</span>
                <span className="text-zinc-200 font-semibold">
                  {selectedSlot?.time}
                </span>
              </div>
              <div className="flex justify-between items-center text-zinc-400 pt-2">
                <span className="flex items-center gap-1.5"><span>👤</span> Profissional:</span>
                <span className="text-zinc-200 font-semibold">
                  {selectedMemberId === "any"
                    ? "Qualquer disponível"
                    : members.find((m) => m.id === selectedMemberId)?.name ?? "Profissional"}
                </span>
              </div>
            </div>

            {clientSessionActive && hasValidSessionPhone ? (
              <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-2xl px-4 py-3.5 shadow-lg">
                <p className="text-sm text-emerald-400 font-medium">
                  ✓ Você está logado como <span className="font-bold">{session?.user?.name}</span>.
                </p>
                <p className="text-xs text-emerald-300/80 mt-1">
                  Usaremos o WhatsApp cadastrado na sua conta{maskedSessionPhone ? ` (${maskedSessionPhone})` : ""}.
                </p>
                <button
                  type="button"
                  onClick={handleClientLogout}
                  disabled={loggingOut}
                  className="mt-2.5 text-xs font-semibold text-emerald-300 underline-offset-4 hover:underline disabled:opacity-50 cursor-pointer"
                >
                  {loggingOut ? "Saindo..." : "Não é você? Sair da conta"}
                </button>
                {logoutError && <p className="text-xs text-red-400 mt-1">{logoutError}</p>}
              </div>
            ) : (
              <div className="space-y-4">
                {clientSessionActive && !hasValidSessionPhone && (
                  <div className="bg-amber-950/40 border border-amber-800/50 rounded-xl px-4 py-3 text-xs text-amber-300">
                    Sua conta precisa de um WhatsApp válido para concluir o agendamento. Informe abaixo:
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Seu nome
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-zinc-400 select-none">
                      👤
                    </span>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Seu nome"
                      title="Seu nome"
                      className="w-full bg-[#14151a] border border-white/10 rounded-xl pl-10 pr-4 py-3 text-zinc-100 placeholder-zinc-500 focus:border-[#c9a84c] focus:outline-none transition-colors text-sm shadow-inner"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    WhatsApp *
                  </label>
                  <div className="relative flex items-center">
                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-xs font-semibold text-[#25D366] select-none">
                      <span>📱</span>
                      <span className="text-[11px] text-zinc-400 font-medium">WhatsApp</span>
                    </div>
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
                      className="w-full bg-[#14151a] border border-white/10 rounded-xl pl-28 pr-4 py-3 text-zinc-100 placeholder-zinc-500 focus:border-[#c9a84c] focus:outline-none transition-colors text-sm shadow-inner"
                    />
                  </div>
                  {bookingError && step === 2 && (
                    <p className="text-xs text-red-400 mt-1 font-medium">{bookingError}</p>
                  )}
                </div>
              </div>
            )}

            {/* Notes input */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label
                  htmlFor="customer-notes"
                  className="text-xs font-bold uppercase tracking-wider text-zinc-400"
                >
                  Observações (opcional)
                </label>
                <span className="text-[11px] text-zinc-500">{customerNotes.length}/500</span>
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-3.5 text-sm text-zinc-400 select-none">
                  💬
                </span>
                <textarea
                  id="customer-notes"
                  rows={3}
                  maxLength={500}
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  placeholder="Preferências, estilo, corte específico..."
                  className="w-full bg-[#14151a] border border-white/10 rounded-xl pl-10 pr-4 py-3 text-zinc-100 placeholder-zinc-500 focus:border-[#c9a84c] focus:outline-none transition-colors text-sm resize-none shadow-inner"
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Review & Confirm ────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="space-y-1">
              <h2 className="text-lg sm:text-xl font-bold text-zinc-100">Confirme seu agendamento</h2>
              <p className="text-xs text-zinc-400">Revise os dados antes de confirmar o agendamento.</p>
            </div>

            {/* Visual Service Card */}
            <SelectedServiceVisualCard
              service={selectedServices[0]}
              allSelectedServices={selectedServices}
              serviceQuantities={serviceQuantities}
              totalDuration={totalDuration}
              totalPrice={totalPrice}
            />

            <div className="bg-[#14151a] border border-white/10 rounded-2xl p-4 text-xs space-y-2.5 divide-y divide-white/5 shadow-lg">
              <div className="flex justify-between items-center py-1">
                <span className="text-zinc-400">Data:</span>
                <span className="text-zinc-100 font-semibold">{formatHeaderDate(selectedDate)}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-zinc-400">Horário:</span>
                <span className="text-zinc-100 font-semibold">{selectedSlot?.time}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-zinc-400">Profissional:</span>
                <span className="text-zinc-100 font-semibold">
                  {selectedMemberId === "any"
                    ? "Qualquer disponível"
                    : members.find((m) => m.id === selectedMemberId)?.name ?? "Profissional"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-zinc-400">Cliente:</span>
                <span className="text-zinc-100 font-semibold">
                  {clientSessionActive && hasValidSessionPhone
                    ? session?.user?.name
                    : customerName || "Cliente"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-zinc-400">WhatsApp:</span>
                <span className="text-zinc-100 font-semibold">
                  {clientSessionActive && hasValidSessionPhone
                    ? maskedSessionPhone || sessionPhone
                    : customerPhone}
                </span>
              </div>
              {customerNotes.trim() && (
                <div className="py-2">
                  <span className="text-zinc-400 block mb-1">Observações:</span>
                  <p className="text-zinc-200 bg-zinc-900/60 p-2.5 rounded-lg text-xs leading-relaxed">
                    {customerNotes.trim()}
                  </p>
                </div>
              )}
            </div>

            {bookingError && (
              <div className="bg-red-950/40 border border-red-500/30 text-red-200 text-xs px-4 py-3 rounded-xl">
                ⚠️ {bookingError}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Sticky Footer ─────────────────────────────────────────────────── */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 bg-[#0c0c0e]/95 backdrop-blur-md border-t border-white/10 px-4 py-3.5">
        <div className="max-w-xl mx-auto flex items-center justify-between gap-4">
          {/* Summary values */}
          <div className="min-w-0">
            <p className="text-[11px] text-zinc-400 font-semibold uppercase tracking-wider">
              {totalDuration > 0 ? `${totalDuration} min` : "Duração"}
            </p>
            <p className="text-base sm:text-lg font-extrabold text-[#f2d78d] leading-tight">
              {totalPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
          </div>

          {/* Action CTA Button */}
          {step === 0 && (
            <button
              type="button"
              aria-label="Continuar"
              disabled={selectedServiceIds.length === 0}
              onClick={() => setStep(1)}
              className="bg-gradient-to-r from-[#d4af37] via-[#e5c158] to-[#d4af37] text-black font-black text-xs sm:text-sm px-6 py-3.5 rounded-xl shadow-lg shadow-[#d4af37]/25 hover:brightness-105 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2 uppercase tracking-wider"
            >
              <span>Continuar</span>
              <span>→</span>
            </button>
          )}

          {step === 1 && (
            <button
              type="button"
              aria-label="Continuar"
              disabled={!selectedSlot}
              onClick={() => setStep(2)}
              className="bg-gradient-to-r from-[#d4af37] via-[#e5c158] to-[#d4af37] text-black font-black text-xs sm:text-sm px-6 py-3.5 rounded-xl shadow-lg shadow-[#d4af37]/25 hover:brightness-105 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2 uppercase tracking-wider"
            >
              <span>Continuar</span>
              <span>→</span>
            </button>
          )}

          {step === 2 && (
            <button
              type="button"
              aria-label="Continuar"
              disabled={loginStep === "logging-in" || (!hasValidSessionPhone && !customerPhone.trim())}
              onClick={handleLoginOrContinue}
              className="bg-gradient-to-r from-[#d4af37] via-[#e5c158] to-[#d4af37] text-black font-black text-xs sm:text-sm px-6 py-3.5 rounded-xl shadow-lg shadow-[#d4af37]/25 hover:brightness-105 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2 uppercase tracking-wider"
            >
              <span>{loginStep === "logging-in" ? "Entrando..." : "Continuar"}</span>
              <span>→</span>
            </button>
          )}

          {step === 3 && (
            <button
              type="button"
              aria-label="Confirmar agendamento"
              disabled={booking}
              onClick={handleBook}
              className="bg-gradient-to-r from-[#d4af37] via-[#e5c158] to-[#d4af37] text-black font-black text-xs sm:text-sm px-6 py-3.5 rounded-xl shadow-lg shadow-[#d4af37]/25 hover:brightness-105 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer flex items-center gap-2 uppercase tracking-wider"
            >
              <span>{booking ? "Agendando..." : "Confirmar agendamento"}</span>
              <span>→</span>
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

export default function AgendasPage() {
  return (
    <Suspense fallback={null}>
      <BookingWizard />
    </Suspense>
  );
}
