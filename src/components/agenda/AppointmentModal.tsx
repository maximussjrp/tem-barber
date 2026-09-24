"use client";

import React, { useEffect, useState } from "react";
import {
  Appointment,
  BookingMode,
  ClubBalance,
  CustomerSearchResult,
  FitInConflictPreview,
  Member,
  NewAppointmentInitialState,
  Service,
} from "./types";
import {
  fetchClubBalance,
  formatTime,
  INACTIVE_CLUB_STATUSES,
  INPUT_CLASS,
  LABEL_INPUT,
} from "./utils";
import {
  extractServiceQuantities,
  stripMetadataFromNotes,
} from "@/lib/appointments/notes-metadata";

export function AppointmentModal({
  appointment,
  members,
  barbershopServices,
  appointments = [],
  currentDate,
  initialState,
  initialBookingMode,
  mode = "admin",
  scopedMemberId,
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
  mode?: "admin" | "member";
  scopedMemberId?: string;
  onClose: () => void;
  onSaved: (a: Appointment) => void;
}) {
  const isMemberMode = mode === "member" || !!scopedMemberId;
  const isEdit = !!appointment;
  const [bookingMode, setBookingMode] = useState<BookingMode>(
    isMemberMode ? "NORMAL" : appointment?.bookingMode ?? initialBookingMode ?? "NORMAL"
  );
  const [memberId, setMemberId] = useState(
    isMemberMode
      ? scopedMemberId ?? initialState?.memberId ?? members[0]?.id ?? ""
      : appointment?.barber?.id ?? initialState?.memberId ?? ""
  );
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
  const [customerName, setCustomerName] = useState(
    appointment?.customer.name ?? initialState?.customerName ?? ""
  );
  const [customerPhone, setCustomerPhone] = useState(
    appointment?.customer.phone ?? initialState?.customerPhone ?? ""
  );
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
        const searchUrl = isMemberMode
          ? `/api/member/clients/search?q=${encodeURIComponent(query)}`
          : `/api/admin/clients/search?q=${encodeURIComponent(query)}`;
        const res = await fetch(searchUrl, {
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
  }, [customerLookupQuery, isEdit, isMemberMode]);

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
        const phoneUrl = isMemberMode
          ? `/api/member/clients/search?q=${encodeURIComponent(phoneDigits)}`
          : `/api/admin/clients/search?q=${encodeURIComponent(phoneDigits)}`;
        const res = await fetch(phoneUrl, {
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
  }, [customerPhone, isEdit, isMemberMode, selectedCustomer]);

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

  const effectiveMemberId = isMemberMode ? scopedMemberId ?? memberId : memberId;

  const fitInConflicts: FitInConflictPreview[] =
    !isEdit && !isMemberMode && bookingMode === "FIT_IN" && effectiveMemberId && dateTime && selectedDurationMin > 0
      ? appointments
          .filter((candidate) => {
            if (candidate.barber.id !== effectiveMemberId) return false;
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
  const selectedMember = members.find((m) => m.id === effectiveMemberId);

  const toggleService = (id: string) => {
    const isServiceIncompatible =
      !!selectedMember && selectedMember.serviceIds && !selectedMember.serviceIds.includes(id);
    const checked = (serviceQuantities[id] ?? 0) > 0;
    if (isServiceIncompatible && !checked) {
      return;
    }
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
    const isServiceIncompatible =
      !!selectedMember && selectedMember.serviceIds && !selectedMember.serviceIds.includes(id);
    if (isServiceIncompatible) {
      return;
    }
    setServiceQuantities((prev) => {
      const current = prev[id] ?? 0;
      if (current < 5) {
        return { ...prev, [id]: current + 1 };
      }
      return prev;
    });
  };

  const decrementService = (id: string) => {
    const isServiceIncompatible =
      !!selectedMember && selectedMember.serviceIds && !selectedMember.serviceIds.includes(id);
    const checked = (serviceQuantities[id] ?? 0) > 0;
    if (isServiceIncompatible && !checked) {
      return;
    }
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
    if (!effectiveMemberId) {
      setError("Selecione um barbeiro.");
      return;
    }
    if (selectedServiceIds.length === 0) {
      setError("Selecione ao menos um serviço.");
      return;
    }
    if (!dateTime) {
      setError("Informe data e hora.");
      return;
    }
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
        const editUrl = isMemberMode
          ? `/api/member/agenda/${appointment!.id}`
          : `/api/admin/appointments/${appointment!.id}`;
        res = await fetch(editUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            memberId: effectiveMemberId,
            services: servicesPayload,
            dateTime,
            notes,
          }),
        });
      } else {
        const createUrl = isMemberMode
          ? "/api/member/agenda"
          : "/api/admin/appointments";
        const finalBookingMode = isMemberMode ? "NORMAL" : bookingMode;
        res = await fetch(createUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            memberId: effectiveMemberId,
            services: servicesPayload,
            dateTime,
            customerId: selectedCustomer?.id,
            customerName: customerName.trim() || undefined,
            customerPhone: customerPhone.trim(),
            bookingMode: finalBookingMode,
            fitInReason: finalBookingMode === "FIT_IN" ? fitInReason.trim() : undefined,
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
      const svc = barbershopServices.find((s) => s.id === id);
      if (svc && qty > 0) {
        for (let i = 0; i < qty; i++) {
          selectedServices.push(svc);
        }
      }
    });

    let totalOriginal = 0;
    let totalToday = 0;

    const benefits = customerClubBalance?.benefits
      ? customerClubBalance.benefits.map((b) => ({ ...b }))
      : [];
    const isInactive =
      !!customerClubBalance?.status && INACTIVE_CLUB_STATUSES.includes(customerClubBalance.status);

    const processed = selectedServices.map((s) => {
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
        limitExhausted,
      };
    });

    return {
      totalOriginal,
      totalToday,
      services: processed,
      isInactive,
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
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title="Fechar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {!isEdit && !isMemberMode && (
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

          {!isEdit && !isMemberMode && bookingMode === "FIT_IN" && (
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

          {!isMemberMode ? (
            <div className="space-y-1.5">
              <label className={LABEL_INPUT}>Barbeiro</label>
              <select
                value={memberId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setMemberId(nextId);
                  if (nextId) {
                    const m = members.find((item) => item.id === nextId);
                    const serviceIds = m?.serviceIds;
                    if (serviceIds) {
                      setServiceQuantities((prev) => {
                        const next = { ...prev };
                        let changed = false;
                        for (const svcId of Object.keys(prev)) {
                          if (!serviceIds.includes(svcId)) {
                            delete next[svcId];
                            changed = true;
                          }
                        }
                        return changed ? next : prev;
                      });
                    }
                  }
                }}
                title="Barbeiro"
                className={INPUT_CLASS}
              >
                <option value="">Selecione...</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.user.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className={LABEL_INPUT}>Barbeiro</label>
              <div className="py-2 text-sm font-semibold text-[var(--text-primary)]">
                {members.find((m) => m.id === effectiveMemberId)?.user?.name ?? "Meu usuário"}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className={LABEL_INPUT}>Serviços</label>
            {loadingClub && (
              <p className="text-xs text-stone-500 italic">Consultando benefícios do Clube...</p>
            )}
            {customerClubBalance && (
              <div className="mb-2">
                {customerClubBalance.status &&
                !["ACTIVE", "GRACE_PERIOD"].includes(customerClubBalance.status) ? (
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

                  const benefit = customerClubBalance?.benefits?.find((b) => b.serviceId === s.id);
                  const isInactive =
                    !!customerClubBalance?.status &&
                    INACTIVE_CLUB_STATUSES.includes(customerClubBalance.status);

                  const isServiceIncompatible =
                    !!selectedMember &&
                    selectedMember.serviceIds &&
                    !selectedMember.serviceIds.includes(s.id);
                  const isServiceDisabled = isServiceIncompatible && !checked;

                  let priceText = originalPrice.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  });
                  let strikethroughPriceText = "";
                  let clubBadge = null;

                  if (customerClubBalance && !isInactive && benefit) {
                    if (benefit.benefitType === "INCLUDED_SERVICE") {
                      const canUse =
                        benefit.canUse !== undefined
                          ? benefit.canUse
                          : benefit.isUnlimited ||
                            (benefit.availableQty && benefit.availableQty > 0);
                      if (canUse) {
                        priceText = (0).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        });
                        strikethroughPriceText = originalPrice.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        });
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
                      priceText = discounted.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      });
                      strikethroughPriceText = originalPrice.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      });
                      clubBadge = (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-sky-400">
                          -{pct}% Clube
                        </span>
                      );
                    }
                  }

                  const qty = serviceQuantities[s.id] ?? 0;

                  return (
                    <label
                      key={s.id}
                      className={`flex items-center justify-between gap-3 px-4 py-2.5 transition-colors ${isServiceDisabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-stone-800/40"} ${checked ? "bg-amber-500/5" : ""}`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleService(s.id)}
                          disabled={isServiceDisabled}
                          title={s.name}
                          className="accent-amber-500 cursor-pointer disabled:cursor-not-allowed"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-stone-300 truncate">{s.name}</span>
                            {clubBadge}
                          </div>
                          {isServiceIncompatible && (
                            <span className="text-[10px] text-red-400 block font-medium">
                              {checked
                                ? "Este profissional não executa mais este serviço — remova para continuar"
                                : "Não disponível para este profissional"}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-stone-500 shrink-0">{s.durationMin}min</span>
                      </div>

                      <div
                        className="flex items-center gap-4 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {checked && (
                          <div
                            className="flex items-center bg-stone-900 border border-stone-800 rounded-lg px-1.5 py-0.5"
                            onClick={(e) => e.preventDefault()}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                decrementService(s.id);
                              }}
                              className="text-stone-400 hover:text-white px-1.5 py-0.5 font-bold"
                            >
                              -
                            </button>
                            <span className="text-xs text-stone-200 font-semibold px-1 min-w-[12px] text-center">
                              {qty}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                incrementService(s.id);
                              }}
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
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              title="Data e hora"
              className={INPUT_CLASS}
            />
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
                    <p className="text-xs font-bold uppercase tracking-widest text-stone-400">
                      Clientes encontrados
                    </p>
                  </div>
                  <div>
                    {searchingCustomers ? (
                      <p className="px-4 py-3 text-sm text-stone-500">Buscando...</p>
                    ) : customerResults.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-stone-500">
                        Nenhum cliente encontrado. Continue preenchendo para criar um novo cliente.
                      </p>
                    ) : (
                      customerResults.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => chooseCustomer(customer)}
                          className="w-full px-4 py-3 text-left hover:bg-stone-800/60 border-b last:border-b-0 border-stone-800 transition-colors"
                        >
                          <span className="block text-sm font-semibold text-stone-200">
                            {customer.name}
                          </span>
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
                  <p className="text-xs text-amber-200/80">
                    {selectedCustomer.name} - {selectedCustomer.phone}
                  </p>
                  <button
                    type="button"
                    onClick={clearCustomer}
                    className="mt-2 text-xs font-bold text-amber-300 hover:text-amber-200"
                  >
                    Limpar seleção
                  </button>
                </div>
              )}

              {phoneSuggestion && canShowPhoneSuggestion && !selectedCustomer && (
                <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3">
                  <p className="text-sm font-semibold text-sky-100">
                    Já existe um cliente com este telefone:
                  </p>
                  <p className="text-xs text-sky-200/80">
                    {phoneSuggestion.name} - {phoneSuggestion.phone}
                  </p>
                  <button
                    type="button"
                    onClick={() => chooseCustomer(phoneSuggestion)}
                    className="mt-2 text-xs font-bold text-sky-300 hover:text-sky-200"
                  >
                    Usar este cliente
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label className={LABEL_INPUT}>Observações</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Observações opcionais..."
              title="Observações"
              className={`${INPUT_CLASS} resize-none`}
            />
          </div>

          {selectedServiceIds.length > 0 && (
            <div className="p-3.5 rounded-xl bg-stone-900/60 border border-stone-800 text-sm flex flex-col gap-1">
              <div className="flex justify-between items-center text-stone-400 text-xs">
                <span>Valor original total:</span>
                <span className="tabular-nums">
                  {preview.totalOriginal.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </span>
              </div>
              <div className="flex justify-between items-center text-stone-200 font-semibold">
                <span>Valor previsto hoje:</span>
                <span className="text-amber-400 font-bold tabular-nums">
                  {preview.totalToday.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-950/40 border border-red-800/50 rounded-lg px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors text-sm font-semibold"
            >
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-gold flex-1 py-3">
              {saving ? "Salvando..." : isEdit ? "Salvar" : "Criar agendamento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
