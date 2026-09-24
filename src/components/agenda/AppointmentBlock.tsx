"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Appointment,
  AppointmentWhatsappConfirmation,
  AppStatus,
  ClubBalance,
} from "./types";
import {
  fetchClubBalance,
  formatDateTime,
  formatTime,
  getPrimaryStatusPresentation,
  getUIStatus,
  getWhatsappConfirmedLabel,
  INACTIVE_CLUB_STATUSES,
  INPUT_CLASS,
  isoToMinutes,
  LABEL_INPUT,
  minutesToHeight,
  minutesToTop,
  ROW_HEIGHT,
  WHATSAPP_STATUS_BG,
  WHATSAPP_STATUS_LABEL,
} from "./utils";
import {
  extractServiceQuantities,
  stripMetadataFromNotes,
} from "@/lib/appointments/notes-metadata";
import {
  formatWhatsAppPhone,
  generateWhatsAppLink,
  generateWhatsAppMessage,
} from "@/lib/whatsapp";
import { formatAppointmentDateTimeForMessage } from "@/lib/time-utils";

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
  mode = "admin",
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
  mode?: "admin" | "member";
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
    if (!isOpen || !appointment.customer?.id) {
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
  }, [isOpen, appointment.customer?.id]);

  const getAppointmentPreview = () => {
    let totalOriginal = 0;
    let totalToday = 0;

    const benefits = clubBalance?.benefits ? clubBalance.benefits.map((b) => ({ ...b })) : [];
    const isInactive = !!clubBalance?.status && INACTIVE_CLUB_STATUSES.includes(clubBalance.status);

    const quantitiesMap = extractServiceQuantities(appointment.notes);
    const expandedServices: typeof appointment.services = [];
    appointment.services?.forEach((s) => {
      const qty = quantitiesMap[s.service?.id] ?? 1;
      for (let i = 0; i < qty; i++) {
        expandedServices.push(s);
      }
    });

    const processed = expandedServices.map((s) => {
      const originalPrice = parseFloat(s.priceApplied || "0");
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
  const canConfirmWhatsapp =
    currentRole === "OWNER" || currentRole === "MANAGER" || currentRole === "RECEPTIONIST";
  const quantitiesMap = extractServiceQuantities(appointment.notes);
  const serviceNames = appointment.services
    ?.map((s) => {
      const qty = quantitiesMap[s.serviceId ?? s.service?.id] ?? 1;
      return qty > 1 ? `${s.service?.name} x${qty}` : s.service?.name;
    })
    .join(", ");

  const formattedPhone = formatWhatsAppPhone(appointment.customer?.phone);
  const { date: waDate, time: waTime } = formatAppointmentDateTimeForMessage(appointment.dateTime);
  const message = generateWhatsAppMessage(
    appointment.customer?.name || "Cliente",
    barbershopName || "Barbearia",
    waDate,
    waTime,
    serviceNames,
    appointment.barber?.user?.name
  );
  const waLink = formattedPhone ? generateWhatsAppLink(appointment.customer?.phone, message) : null;
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

  const handleConfirmWhatsapp = async (modeWhatsapp: "TOKEN" | "MANUAL_OVERRIDE") => {
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
    if (modeWhatsapp === "TOKEN" && !token) {
      setWhatsappError("Informe o codigo recebido no WhatsApp.");
      return;
    }

    setConfirmingWhatsapp(true);
    try {
      const payload =
        modeWhatsapp === "TOKEN"
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
        modeWhatsapp === "MANUAL_OVERRIDE"
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
      const endpoint =
        mode === "member"
          ? `/api/member/agenda/${appointment.id}/status`
          : `/api/admin/appointments/${appointment.id}`;
      const res = await fetch(endpoint, {
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
        <p className="text-[11px] font-semibold leading-tight truncate">
          {appointment.customer?.name}
        </p>
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
                <p className="text-base font-bold text-[var(--text-primary)]">{appointment.customer?.name}</p>
                <p className="text-sm text-[var(--text-muted)]">{appointment.customer?.phone}</p>
                {appointment.bookingMode === "FIT_IN" && (
                  <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold border border-orange-500/30 bg-orange-500/10 text-orange-300">
                    ENCAIXE OPERACIONAL
                  </span>
                )}
                {effectiveWhatsappConfirmation?.status && (
                  <span
                    className={`inline-block mt-1 ml-1 px-2 py-0.5 rounded text-[10px] font-bold border ${WHATSAPP_STATUS_BG[effectiveWhatsappConfirmation.status]}`}
                  >
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {formatTime(appointment.dateTime)} · {appointment.durationMin}min
              </p>

              {/* Serviços e Valores */}
              <div className="space-y-2 rounded-xl bg-stone-900/40 border border-stone-800/80 p-3">
                <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1 flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
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
                          <span className="truncate">{s.service?.name}</span>
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
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.706 1.459h.008c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
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
                    <p className="mt-1 text-sm text-[var(--text-primary)]">{appointment.customer?.phone}</p>
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
                <button
                  onClick={() => changeStatus("CONFIRMED")}
                  disabled={loadingStatus}
                  className="w-full text-sm font-bold px-4 py-3 rounded-xl bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 border border-sky-500/20 transition-colors disabled:opacity-50"
                >
                  Confirmar Agendamento
                </button>
              )}

              {uiStatus === "CONFIRMED" && (
                <button
                  onClick={() => {
                    onToggleOpen(false);
                    onOpenComanda(appointment);
                  }}
                  className="w-full text-sm font-bold px-4 py-3 rounded-xl bg-[var(--gold)] hover:bg-[#c99833] text-stone-900 transition-colors disabled:opacity-50"
                >
                  Abrir Atendimento
                </button>
              )}

              {(uiStatus === "OPEN_COMANDA" || uiStatus === "IN_SERVICE" || uiStatus === "PENDING_PAYMENT") && (
                <button
                  onClick={() => {
                    if (mode === "member") {
                      onOpenComanda(appointment);
                    } else {
                      router.push(`/admin/comandas/${appointment.comandas![0].id}`);
                    }
                  }}
                  className="w-full text-sm font-bold px-4 py-3 rounded-xl bg-[var(--gold)] hover:bg-[#c99833] text-stone-900 transition-colors"
                >
                  Ver/Finalizar Comanda
                </button>
              )}

              {isTerminal && appointment.comandas?.[0] && (
                <button
                  onClick={() => {
                    if (mode === "member") {
                      onOpenComanda(appointment);
                    } else {
                      router.push(`/admin/comandas/${appointment.comandas![0].id}`);
                    }
                  }}
                  className="w-full text-sm font-bold px-4 py-3 rounded-xl bg-[var(--surface-3)] hover:bg-[var(--surface-4)] text-[var(--text-primary)] border border-[var(--border-subtle)] transition-colors"
                >
                  Ver Comanda
                </button>
              )}

              {/* Botões secundários (apenas para não-terminais e sem comanda avançada) */}
              {!isTerminal && uiStatus !== "IN_SERVICE" && uiStatus !== "PENDING_PAYMENT" && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    onClick={() => {
                      onToggleOpen(false);
                      onEdit(appointment);
                    }}
                    className="text-sm font-bold px-3 py-2 rounded-xl bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-3)] border border-[var(--border-subtle)] transition-colors"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => {
                      onToggleOpen(false);
                      onCancel(appointment);
                    }}
                    disabled={loadingStatus}
                    className="text-sm font-bold px-3 py-2 rounded-xl bg-transparent text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              )}

              {/* Botão de Excluir agendamento (permitido para PENDING, CONFIRMED, CANCELLED quando sem comanda avançada, apenas em modo admin) */}
              {mode !== "member" &&
                ["PENDING", "CONFIRMED", "CANCELLED"].includes(appointment.status) &&
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
                <button
                  onClick={() => changeStatus("NO_SHOW")}
                  disabled={loadingStatus}
                  className="w-full text-sm font-bold px-3 py-2 mt-2 rounded-xl bg-transparent text-[var(--text-muted)] hover:bg-[var(--surface-3)] border border-[var(--border-subtle)] transition-colors disabled:opacity-50"
                >
                  Marcar como Falta
                </button>
              )}

              <button
                onClick={() => onToggleOpen(false)}
                className="w-full text-sm font-semibold px-3 py-2 mt-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
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
