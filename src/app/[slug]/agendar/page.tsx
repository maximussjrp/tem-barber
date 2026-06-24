"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { formatHeaderDate } from "@/lib/time-utils";
import { Avatar } from "@/components/ui/Avatar";

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

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ["Serviço", "Barbeiro", "Horário", "Dados", "Confirmar"];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0.5 mb-8">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-all ${
                i < current
                  ? "bg-[var(--gold)] text-[#111113]"
                  : i === current
                  ? "border-2 border-[var(--gold)] text-[var(--gold)] bg-[var(--gold-surface)]"
                  : "bg-[var(--surface-2)] text-[var(--text-muted)]"
              }`}
            >
              {i < current ? "✓" : i + 1}
            </div>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`w-8 h-px mx-1 transition-all ${
                i < current
                  ? "bg-[var(--gold)]"
                  : "bg-[var(--border-subtle)]"
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
  const router = useRouter();
  const { data: session } = useSession();

  const [step, setStep] = useState(0);

  // Data
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [members, setMembers] = useState<PublicMember[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);

  // Selections
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>("any");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [availabilityResults, setAvailabilityResults] = useState<AvailabilityResult[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<{ memberId: string; time: string } | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Customer data (if not logged in)
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [loginStep, setLoginStep] = useState<"fill" | "logging-in">("fill");

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
  } | null>(null);

  const [subscriptionSuspended, setSubscriptionSuspended] = useState(false);

  // ─── Load profile ────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/public/barbershop/${slug}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error === "SUBSCRIPTION_SUSPENDED") {
          setSubscriptionSuspended(true);
        } else {
          setCategories(d.categories ?? []);
          setMembers(d.members ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingProfile(false));
  }, [slug]);

  // ─── Computed ────────────────────────────────────────────────────────────

  const allServices: PublicService[] = categories.flatMap((c) => c.services);

  const selectedServices = allServices.filter((s) => selectedServiceIds.includes(s.id));
  const totalPrice = selectedServices.reduce((s, svc) => s + Number(svc.price), 0);
  const totalDuration = selectedServices.reduce((s, svc) => s + svc.durationMin, 0);

  // Eligible members: perform ALL selected services
  // If member has no services linked (not configured), show them anyway
  const eligibleMembers = members.filter(
    (m) =>
      m.serviceIds.length === 0 ||
      selectedServiceIds.length === 0 ||
      selectedServiceIds.every((id) => m.serviceIds.includes(id))
  );

  // ─── Availability ─────────────────────────────────────────────────────────

  const fetchAvailability = useCallback(
    async (date: string) => {
      if (!date || selectedServiceIds.length === 0) return;
      setLoadingSlots(true);
      setAvailabilityResults([]);
      setSelectedSlot(null);

      const memberId = selectedMemberId !== "any" ? selectedMemberId : undefined;
      const params = new URLSearchParams({ date, serviceIds: selectedServiceIds.join(",") });
      if (memberId) params.set("memberId", memberId);

      try {
        const res = await fetch(`/api/public/barbershop/${slug}/availability?${params}`);
        const data = await res.json();
        setAvailabilityResults(data.results ?? []);
      } finally {
        setLoadingSlots(false);
      }
    },
    [slug, selectedServiceIds, selectedMemberId]
  );

  useEffect(() => {
    if (step === 2 && selectedDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchAvailability(selectedDate);
    }
  }, [step, selectedDate, fetchAvailability]);

  const resetBookingAttempt = () => {
    setBookingAttemptKey(null);
    setBookingError("");
  };

  // ─── Step 0: Services ─────────────────────────────────────────────────────

  const toggleService = (id: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
    setSelectedMemberId("any");
    setSelectedDate("");
    setSelectedSlot(null);
    setAvailabilityResults([]);
    resetBookingAttempt();
  };

  // ─── Step 1: Barber ───────────────────────────────────────────────────────

  // ─── Step 2: Date + Slot ─────────────────────────────────────────────────

  const minDate = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // ─── Step 3: Customer login/fill ─────────────────────────────────────────

  const handleLoginOrContinue = async () => {
    if (session?.user) {
      setStep(4);
      return;
    }
    if (!customerPhone.trim()) return;
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
      setStep(4);
    }
    // Even if sign-in fails (shouldn't), proceed — book API will handle session-less
    else {
      setStep(4);
    }
  };

  // ─── Step 4: Confirm + Book ───────────────────────────────────────────────

  const handleBook = async () => {
    if (!selectedSlot || booking) return;
    setBooking(true);
    setBookingError("");
    const idempotencyKey = bookingAttemptKey ?? crypto.randomUUID();
    setBookingAttemptKey(idempotencyKey);

    // Build dateTime from selectedDate + selectedSlot.time
    const [year, month, day] = selectedDate.split("-").map(Number);
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
          memberId: selectedSlot.memberId,
          serviceIds: selectedServiceIds,
          dateTime: dt.toISOString(),
          customerName: customerName.trim() || undefined,
          customerPhone: customerPhone.replace(/\D/g, "") || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errorData = data as BookingErrorResponse;
        if (errorData.error === "SLOT_UNAVAILABLE") {
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
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-6">
          {/* Check circle */}
          <div className="relative mx-auto w-24 h-24">
            <div className="absolute inset-0 rounded-full bg-[var(--gold-surface)] animate-ping opacity-30" />
            <div className="relative w-24 h-24 rounded-full border-2 border-[var(--gold)] bg-[var(--surface-1)] flex items-center justify-center glow-gold">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
          </div>

          <div>
            <h1 className="font-serif text-3xl font-bold text-[var(--text-primary)]">Agendado!</h1>
            <p className="text-[var(--text-secondary)] text-sm mt-2">Seu horário está confirmado.</p>
          </div>

          <div className="bg-[var(--surface-1)] border border-[var(--gold-border)] rounded-2xl p-5 text-left space-y-0 divide-y divide-[var(--border-subtle)]">
            {[
              { label: "Data", value: formatHeaderDate(confirmed.dateTime.split("T")[0]) },
              { label: "Horário", value: dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) },
              { label: "Barbeiro", value: confirmed.barberName },
              { label: "Serviços", value: confirmed.services.join(", ") },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between py-3 text-sm">
                <span className="text-[var(--text-muted)]">{label}</span>
                <span className="text-[var(--text-primary)] font-medium text-right max-w-[180px]">{value}</span>
              </div>
            ))}
            <div className="flex justify-between pt-4 pb-1">
              <span className="text-[var(--text-muted)] text-sm">Total</span>
              <span className="text-[var(--gold)] font-bold text-lg font-serif">
                {Number(confirmed.totalPrice).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              </span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => router.push(`/${slug}`)}
              className="flex-1 py-3.5 rounded-xl border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)] transition-colors text-sm font-semibold"
            >
              Voltar
            </button>
            <button
              onClick={() => router.push("/minha-conta")}
              className="btn-gold flex-1"
            >
              Meus agendamentos
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (loadingProfile) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--gold)] border-t-transparent animate-spin" />
          <p className="text-[var(--text-muted)] text-sm">Carregando...</p>
        </div>
      </div>
    );
  }

  if (subscriptionSuspended) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center p-6 text-stone-100 relative overflow-hidden">
        <div className="absolute w-[500px] h-[500px] rounded-full bg-amber-500/5 blur-[120px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <div className="relative max-w-md w-full bg-stone-900/60 backdrop-blur-xl border border-stone-800 rounded-3xl p-8 md:p-10 text-center shadow-2xl">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-500 mx-auto mb-6">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-8 h-8"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-4 bg-gradient-to-r from-stone-100 to-stone-300 bg-clip-text text-transparent">
            Agendamentos Indisponíveis
          </h1>
          <p className="text-stone-400 text-sm leading-relaxed mb-6">
            Esta barbearia está temporariamente indisponível para agendamentos.
          </p>
          <button
            onClick={() => router.push(`/${slug}`)}
            className="w-full px-5 py-3 rounded-xl bg-stone-800 text-stone-300 text-sm font-semibold hover:bg-stone-750 transition-colors border border-stone-700/50"
          >
            Voltar para o Perfil
          </button>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--bg)]/90 backdrop-blur border-b border-[var(--border-subtle)] px-4 py-3 flex items-center gap-3">
        {step > 0 ? (
          <button
            onClick={() => setStep((s) => s - 1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="Voltar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        ) : (
          <div className="w-9 h-9 rounded-xl bg-[var(--gold-surface)] border border-[var(--gold-border)] flex items-center justify-center">
            <span className="font-serif font-bold text-[var(--gold)] text-sm">MB</span>
          </div>
        )}
        <div className="flex-1">
          <p className="text-xs text-[var(--text-muted)] font-medium uppercase tracking-widest">{STEPS[step]}</p>
        </div>
        <button
          onClick={() => router.push(`/${slug}`)}
          className="w-9 h-9 flex items-center justify-center rounded-xl bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          title="Cancelar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-8 pb-24">
        <StepIndicator current={step} />

        {/* ── Step 0: Choose services ────────────────────────────────────── */}
        {step === 0 && (
          <div className="space-y-5">
            <h2 className="text-xl font-serif font-bold text-stone-100">Escolha o serviço</h2>
            {categories.filter((c) => c.services.length > 0).length === 0 && (
              <div className="py-12 text-center border border-[var(--border-subtle)] rounded-xl bg-[var(--surface-1)]">
                <div className="w-16 h-16 bg-[var(--surface-3)] rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl leading-none">✂️</span>
                </div>
                <p className="font-bold text-[var(--text-primary)] mb-1">Nenhum serviço disponível</p>
                <p className="text-sm text-[var(--text-muted)] max-w-sm mx-auto">
                  Esta barbearia ainda não possui serviços disponíveis para agendamento online.
                </p>
              </div>
            )}
            {categories.filter((c) => c.services.length > 0).map((cat) => (
              <div key={cat.id}>
                <p className="text-xs font-semibold text-amber-500/80 uppercase tracking-wider mb-2">
                  {cat.name}
                </p>
                <div className="bg-stone-900 border border-stone-800 rounded-xl divide-y divide-stone-800">
                  {cat.services.map((svc) => {
                    const checked = selectedServiceIds.includes(svc.id);
                    return (
                      <label
                        key={svc.id}
                        className={`flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors ${
                          checked ? "bg-amber-500/5" : "hover:bg-stone-800/40"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleService(svc.id)}
                          title={svc.name}
                          className="accent-amber-500 w-4 h-4"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-stone-200">{svc.name}</p>
                          {svc.description && (
                            <p className="text-xs text-stone-500 mt-0.5">{svc.description}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-amber-400">
                            {Number(svc.price).toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })}
                          </p>
                          <p className="text-xs text-stone-600">{svc.durationMin}min</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Step 1: Choose barber ──────────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-xl font-serif font-bold text-stone-100">Escolha o barbeiro</h2>
            <div className="space-y-3">
              {/* Any available */}
              <label
                className={`flex items-center gap-4 bg-stone-900 border rounded-xl px-4 py-3 cursor-pointer transition-colors ${
                  selectedMemberId === "any"
                    ? "border-amber-500/60 bg-amber-500/5"
                    : "border-stone-800 hover:bg-stone-800/40"
                }`}
              >
                <input
                  type="radio"
                  name="member"
                  value="any"
                  checked={selectedMemberId === "any"}
                  onChange={() => {
                    setSelectedMemberId("any");
                    setSelectedSlot(null);
                    resetBookingAttempt();
                  }}
                  title="Qualquer barbeiro disponível"
                  className="accent-amber-500"
                />
                <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center text-stone-400">
                  ✂️
                </div>
                <div>
                  <p className="text-sm font-semibold text-stone-200">Qualquer disponível</p>
                  <p className="text-xs text-stone-500">Mostrar todos os horários</p>
                </div>
              </label>

              {eligibleMembers.map((m) => (
                <label
                  key={m.id}
                  className={`flex items-center gap-4 bg-stone-900 border rounded-xl px-4 py-3 cursor-pointer transition-colors ${
                    selectedMemberId === m.id
                      ? "border-amber-500/60 bg-amber-500/5"
                      : "border-stone-800 hover:bg-stone-800/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="member"
                    value={m.id}
                    checked={selectedMemberId === m.id}
                    onChange={() => {
                      setSelectedMemberId(m.id);
                      setSelectedSlot(null);
                      resetBookingAttempt();
                    }}
                    title={m.name}
                    className="accent-amber-500"
                  />
                  <div className="w-10 h-10 rounded-full border border-[var(--border-subtle)] overflow-hidden flex items-center justify-center shrink-0 relative">
                    <Avatar src={m.avatarUrl} alt={m.name} size="md" fallbackText={m.name} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-stone-200">{m.name}</p>
                    {m.ratingAvg > 0 && (
                      <p className="text-xs text-amber-400">★ {m.ratingAvg.toFixed(1)}</p>
                    )}
                    {m.bio && <p className="text-xs text-stone-500 mt-0.5 line-clamp-1">{m.bio}</p>}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ── Step 2: Date + Time ────────────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-xl font-serif font-bold text-stone-100">Escolha o horário</h2>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                Data
              </label>
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
                className="w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 focus:border-amber-500/80 focus:outline-none transition-colors"
              />
            </div>

            {selectedDate && (
              <div className="space-y-3">
                {loadingSlots ? (
                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-16 rounded-xl bg-stone-900/40 animate-pulse" />
                    ))}
                  </div>
                ) : availabilityResults.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-stone-400">Nenhum horário disponível neste dia.</p>
                    <p className="text-stone-600 text-sm mt-1">Tente outra data.</p>
                  </div>
                ) : (
                  availabilityResults.map((result) => (
                    <div key={result.memberId}>
                      {availabilityResults.length > 1 && (
                        <p className="text-xs text-stone-500 font-semibold uppercase tracking-wider mb-2">
                          {result.memberName}
                        </p>
                      )}
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {result.slots.map((time) => {
                          const isSelected =
                            selectedSlot?.memberId === result.memberId &&
                            selectedSlot?.time === time;
                          return (
                            <button
                              key={time}
                              onClick={() => {
                                setSelectedSlot({ memberId: result.memberId, time });
                                resetBookingAttempt();
                              }}
                              className={`py-3 rounded-xl text-sm font-semibold transition-colors min-h-[48px] ${
                                isSelected
                                  ? "bg-amber-500 text-stone-950"
                                  : "bg-stone-900 border border-stone-800 text-stone-300 hover:border-amber-500/50 hover:text-amber-400"
                              }`}
                            >
                              {time}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Customer data ─────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-5">
            <h2 className="text-xl font-serif font-bold text-stone-100">Seus dados</h2>

            {session?.user ? (
              <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-xl px-4 py-3">
                <p className="text-sm text-emerald-400">
                  ✓ Você está logado como <span className="font-semibold">{session.user.name}</span>.
                </p>
                <p className="text-xs text-emerald-600 mt-0.5">
                  O agendamento será feito com sua conta.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-stone-400">
                  Informe seu telefone para confirmar. Se você não tiver conta, criamos automaticamente.
                </p>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                    Nome
                  </label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Seu nome"
                    title="Seu nome"
                    className="w-full bg-stone-950/70 border border-stone-800 rounded-xl px-4 py-3.5 text-stone-100 focus:border-amber-500/80 focus:outline-none transition-colors text-base"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-stone-400">
                    Telefone (WhatsApp) *
                  </label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="(11) 99999-9999"
                    title="Seu telefone"
                    className="w-full bg-stone-950/70 border border-stone-800 rounded-xl px-4 py-3.5 text-stone-100 focus:border-amber-500/80 focus:outline-none transition-colors text-base"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Summary + Confirm ─────────────────────────────────── */}
        {step === 4 && selectedSlot && (
          <div className="space-y-5">
            <h2 className="text-xl font-serif font-bold text-stone-100">Confirmar agendamento</h2>

            <div className="bg-stone-900 border border-stone-800 rounded-2xl divide-y divide-stone-800">
              {[
                {
                  label: "Data",
                  value: formatHeaderDate(selectedDate),
                },
                { label: "Horário", value: selectedSlot.time },
                {
                  label: "Barbeiro",
                  value:
                    availabilityResults.find((r) => r.memberId === selectedSlot.memberId)
                      ?.memberName ?? "—",
                },
                {
                  label: "Serviços",
                  value: selectedServices.map((s) => s.name).join(", "),
                },
                { label: "Duração", value: `${totalDuration} min` },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between px-4 py-3 text-sm">
                  <span className="text-stone-500">{label}</span>
                  <span className="text-stone-200 font-medium text-right max-w-[200px]">
                    {value}
                  </span>
                </div>
              ))}
              <div className="flex justify-between px-4 py-3 text-sm">
                <span className="text-stone-500">Total</span>
                <span className="text-amber-400 font-bold text-base">
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
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-950 font-bold py-4 rounded-xl transition-colors text-base"
            >
              {booking ? "Confirmando..." : "Confirmar agendamento"}
            </button>
          </div>
        )}

        {/* ── Bottom navigation ─────────────────────────────────────────── */}
        <div className="fixed bottom-0 left-0 right-0 bg-stone-950/90 backdrop-blur border-t border-stone-800 px-4 py-4">
          <div className="max-w-lg mx-auto">
            {/* Summary bar */}
            {selectedServiceIds.length > 0 && (
              <div className="flex items-center justify-between mb-3 text-sm">
                <span className="text-stone-500">{totalDuration}min</span>
                <span className="text-amber-400 font-bold">
                  {totalPrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </span>
              </div>
            )}

            {step === 0 && (
              <button
                onClick={() => setStep(1)}
                disabled={selectedServiceIds.length === 0}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-stone-950 font-bold py-4 rounded-xl transition-colors"
              >
                Continuar
              </button>
            )}
            {step === 1 && (
              <button
                onClick={() => setStep(2)}
                className="w-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold py-4 rounded-xl transition-colors"
              >
                Continuar
              </button>
            )}
            {step === 2 && (
              <button
                onClick={() => setStep(3)}
                disabled={!selectedSlot}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-stone-950 font-bold py-4 rounded-xl transition-colors"
              >
                Continuar
              </button>
            )}
            {step === 3 && (
              <button
                onClick={handleLoginOrContinue}
                disabled={!session?.user && !customerPhone.trim()}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-stone-950 font-bold py-4 rounded-xl transition-colors"
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
        <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-[var(--gold)] border-t-transparent animate-spin" />
        </div>
      }
    >
      <BookingWizard />
    </Suspense>
  );
}
