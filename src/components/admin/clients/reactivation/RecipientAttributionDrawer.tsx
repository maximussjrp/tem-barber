/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState, useCallback } from "react";
import { RecipientAttributionDetail } from "@/lib/clients/reactivation/attribution-engine";

interface RecipientAttributionDrawerProps {
  campaignId: string;
  recipientId: string;
  onClose: () => void;
  onOpenCustomerHistory?: (customerId: string, customerName: string) => void;
}

function formatCurrency(val?: number | null) {
  return (val ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "—";
  if (dateStr.length === 10 && dateStr.includes("-")) {
    const [y, m, d] = dateStr.split("-");
    return `${d}/${m}/${y}`;
  }
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

const CONVERSION_STATUS_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  NONE: {
    label: "Não convertido",
    color: "bg-stone-800 text-stone-400 border-stone-700",
    desc: "Nenhum retorno ou agendamento qualificado foi registrado dentro das janelas de atribuição (14 dias para agendamento, 30 dias para retorno).",
  },
  BOOKED: {
    label: "Agendado (Aguardando atendimento)",
    color: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    desc: "Cliente realizou um agendamento atribuído dentro de até 14 dias após o contato.",
  },
  ATTENDED: {
    label: "Compareceu ao atendimento",
    color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    desc: "Cliente realizou o atendimento dentro da janela de até 30 dias após o contato (sem cobrança registrada ou valor zerado).",
  },
  DIRECT_RETURN: {
    label: "Retorno direto (Walk-in)",
    color: "bg-teal-500/20 text-teal-300 border-teal-500/30",
    desc: "Cliente retornou diretamente à barbearia sem agendamento prévio dentro da janela de até 30 dias.",
  },
  REVENUE_ATTRIBUTED: {
    label: "Reativado com receita atribuída",
    color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    desc: "Cliente retornou dentro de até 30 dias após o contato e pagou pela comanda na primeira visita canônica elegível.",
  },
};

export function RecipientAttributionDrawer({
  campaignId,
  recipientId,
  onClose,
  onOpenCustomerHistory,
}: RecipientAttributionDrawerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecipientAttributionDetail | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/clients/reactivation/manual-campaigns/${campaignId}/recipients/${recipientId}/attribution`
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || payload.error || "Erro ao carregar detalhes de atribuição.");
      }
      const data = await res.json();
      setDetail(data.detail);
    } catch (err: any) {
      setError(err.message || "Falha na conexão.");
    } finally {
      setLoading(false);
    }
  }, [campaignId, recipientId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const convInfo = detail
    ? CONVERSION_STATUS_LABELS[detail.attribution.conversionStatus] || {
        label: detail.attribution.conversionStatus,
        color: "bg-stone-800 text-stone-300 border-stone-700",
        desc: "",
      }
    : null;

  const isReturned = Boolean(detail?.attribution.canonicalReturnDate);
  const apptStatus = detail?.evidence.appointment?.status;
  const isCancelledOrNoShow = apptStatus === "CANCELLED" || apptStatus === "NO_SHOW";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm transition-opacity">
      <div
        className="w-full max-w-xl h-full bg-stone-900 border-l border-stone-800 shadow-2xl flex flex-col justify-between overflow-hidden animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        {/* Header */}
        <div className="p-5 border-b border-stone-800 flex items-center justify-between bg-stone-900/90 sticky top-0 z-10">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
                Transparência de Atribuição
              </span>
              <span className="text-[10px] font-mono text-stone-400 bg-stone-950 px-2 py-0.5 rounded border border-stone-800">
                smart-crm-attribution-v1
              </span>
            </div>
            <h2 id="drawer-title" className="text-lg font-bold text-stone-100 mt-1">
              {detail ? detail.recipient.customerName : "Detalhes do Contato"}
            </h2>
            <p className="text-xs text-stone-400">
              {detail?.recipient.customerPhone || "Telefone não informado"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs text-stone-300">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-stone-500 gap-3">
              <div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs">Auditando evidências de agendamento e comanda...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl space-y-3">
              <p className="text-red-400 font-semibold">{error}</p>
              <button
                onClick={fetchDetail}
                className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded text-xs font-semibold"
              >
                Tentar novamente
              </button>
            </div>
          ) : detail ? (
            <>
              {/* Attribution Status Banner */}
              <div className="bg-stone-950/70 border border-stone-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-stone-400 font-medium">Status da Atribuição</span>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${convInfo?.color}`}>
                    {convInfo?.label}
                  </span>
                </div>
                {convInfo?.desc && <p className="text-[11px] text-stone-400">{convInfo.desc}</p>}
                
                {/* Clear Booking vs Attendance Diagnostic */}
                <div className="pt-2 border-t border-stone-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-stone-400">Agendamento:</span>
                    <span className="font-semibold text-stone-200">
                      {detail.evidence.appointment
                        ? detail.evidence.appointment.status === "CANCELLED"
                          ? "Cancelado"
                          : detail.evidence.appointment.status === "NO_SHOW"
                          ? "Não compareceu"
                          : detail.evidence.appointment.status === "COMPLETED"
                          ? "Concluído"
                          : detail.evidence.appointment.status
                        : "Sem agendamento"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-stone-400">Retorno:</span>
                    <span
                      className={`font-semibold ${
                        isReturned ? "text-emerald-400" : "text-stone-400"
                      }`}
                    >
                      {isReturned
                        ? isCancelledOrNoShow
                          ? "Confirmado pelo serviço executado"
                          : "Confirmado"
                        : "Não confirmado"}
                    </span>
                  </div>
                </div>
              </div>

              {/* T0 & Core Metrics */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-stone-950/60 border border-stone-800/80 rounded-xl p-3.5">
                  <span className="text-[10px] uppercase font-bold text-stone-400">T0 (Disparo Confirmado)</span>
                  <p className="text-sm font-semibold text-stone-100 mt-1">
                    {formatDateTime(detail.recipient.sentConfirmedAt)}
                  </p>
                  <span className="text-[10px] text-stone-500">Marco temporal de elegibilidade</span>
                </div>
                <div className="bg-stone-950/60 border border-stone-800/80 rounded-xl p-3.5">
                  <span className="text-[10px] uppercase font-bold text-emerald-400">Receita Atribuída</span>
                  <p className="text-sm font-bold text-emerald-300 mt-1">
                    {formatCurrency(detail.attribution.revenueAttributed)}
                  </p>
                  <span className="text-[10px] text-stone-500">
                    {isReturned ? "Primeira visita canônica elegível" : "Sem receita no período"}
                  </span>
                </div>
                {detail.attribution.canonicalReturnDate && (
                  <div className="bg-stone-950/60 border border-stone-800/80 rounded-xl p-3.5 col-span-2">
                    <span className="text-[10px] uppercase font-bold text-teal-400">Data do Retorno Canônico</span>
                    <p className="text-sm font-bold text-stone-100 mt-1">
                      {formatDate(detail.attribution.canonicalReturnDate)}
                      {detail.attribution.conversionAttributedAt && (
                        <span className="text-xs font-normal text-stone-400 ml-2 font-mono">
                          ({formatDateTime(detail.attribution.conversionAttributedAt)})
                        </span>
                      )}
                    </p>
                    <span className="text-[10px] text-stone-500">Timestamp auditado da visita realizada</span>
                  </div>
                )}
              </div>

              {/* Explanatory Rule Summary */}
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>Regras de Atribuição (Transparência Operacional)</span>
                </div>
                <div className="space-y-1.5 text-[11px] text-stone-300 leading-relaxed">
                  <p>
                    • <strong>Janela de Agendamento:</strong> até 14 dias após o disparo confirmado (T0).
                  </p>
                  <p>
                    • <strong>Janela de Retorno / Atendimento:</strong> até 30 dias após o disparo confirmado (T0).
                  </p>
                  <p>
                    • <strong>Last Eligible Touch:</strong> Este contato recebeu a atribuição porque foi o contato elegível mais recente antes do retorno.
                  </p>
                  <p>
                    • <strong>Proteção Pré-existente:</strong> O cliente já havia agendado antes deste contato, então esse agendamento não foi atribuído à reativação.
                  </p>
                </div>
              </div>

              {/* Timeline of Events */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
                  Linha do Tempo de Evidências
                </h3>
                {detail.evidence.timeline.length === 0 ? (
                  <p className="text-stone-500 italic">Nenhum evento registrado após o disparo.</p>
                ) : (
                  <div className="relative pl-5 border-l border-stone-800 space-y-4">
                    {detail.evidence.timeline.map((item, idx) => (
                      <div key={idx} className="relative">
                        <div className="absolute -left-[25px] top-0.5 w-2.5 h-2.5 rounded-full bg-amber-500 ring-4 ring-stone-900" />
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-stone-200">{item.event}</span>
                          <span className="text-[10px] text-stone-400 font-mono">
                            {formatDateTime(item.timestamp)}
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-400 mt-0.5">{item.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Appointment Evidence */}
              {detail.evidence.appointment && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
                    Evidência de Agendamento
                  </h3>
                  <div className="bg-stone-950/80 border border-stone-800 rounded-xl p-3.5 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-stone-200">
                        {detail.evidence.appointment.serviceName || "Serviço"}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-stone-800 text-stone-300">
                        {detail.evidence.appointment.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-stone-400">
                      <div>
                        <span className="block text-stone-400">Data do Atendimento:</span>
                        <span className="font-medium text-stone-200">
                          {formatDateTime(detail.evidence.appointment.dateTime)}
                        </span>
                      </div>
                      <div>
                        <span className="block text-stone-400">Criado em:</span>
                        <span className="font-medium text-stone-200">
                          {formatDateTime(detail.evidence.appointment.createdAt)}
                        </span>
                      </div>
                      {detail.evidence.appointment.memberName && (
                        <div className="col-span-2">
                          <span className="block text-stone-400">Profissional:</span>
                          <span className="font-medium text-stone-200">
                            {detail.evidence.appointment.memberName}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Comanda Evidence */}
              {detail.evidence.comandas.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
                    Evidência de Comanda / Pagamento
                  </h3>
                  {detail.evidence.comandas.map((c) => (
                    <div key={c.id} className="bg-stone-950/80 border border-stone-800 rounded-xl p-3.5 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="font-mono text-stone-400 text-[11px]">Comanda #{c.id.slice(0, 8)}</span>
                        <span className="text-emerald-400 font-bold text-xs">
                          {formatCurrency(c.paidTotal)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-stone-400">
                        <div>
                          <span className="block text-stone-400">Status:</span>
                          <span className="font-medium text-stone-200">{c.status}</span>
                        </div>
                        <div>
                          <span className="block text-stone-400">Fechada em:</span>
                          <span className="font-medium text-stone-200">{formatDateTime(c.closedAt)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Message Snapshot */}
              {detail.recipient.previewMessage && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
                    Mensagem Enviada
                  </h3>
                  <div className="bg-stone-950 border border-stone-800 rounded-xl p-3 text-stone-300 font-sans text-xs whitespace-pre-wrap leading-relaxed">
                    {detail.recipient.previewMessage}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-stone-800 bg-stone-900/90 flex items-center justify-between gap-3">
          {detail && onOpenCustomerHistory ? (
            <button
              onClick={() => {
                onClose();
                onOpenCustomerHistory(detail.recipient.customerId, detail.recipient.customerName);
              }}
              className="px-3 py-2 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Histórico completo do cliente</span>
            </button>
          ) : <div />}

          <button
            onClick={onClose}
            className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg text-xs font-semibold transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
