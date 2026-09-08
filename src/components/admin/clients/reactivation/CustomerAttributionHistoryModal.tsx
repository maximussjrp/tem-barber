/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState, useCallback } from "react";
import { CustomerAttributionHistoryResponse } from "@/lib/clients/reactivation/attribution-engine";

interface CustomerAttributionHistoryModalProps {
  customerId: string;
  customerName?: string;
  onClose: () => void;
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

const CONVERSION_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  NONE: { label: "Não convertido", color: "bg-stone-800 text-stone-400 border-stone-700" },
  BOOKED: { label: "Agendado (Pendente)", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  ATTENDED: { label: "Compareceu", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  DIRECT_RETURN: { label: "Retorno direto (Walk-in)", color: "bg-teal-500/20 text-teal-300 border-teal-500/30" },
  REVENUE_ATTRIBUTED: { label: "Reativado com receita", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
};

export function CustomerAttributionHistoryModal({
  customerId,
  customerName,
  onClose,
}: CustomerAttributionHistoryModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CustomerAttributionHistoryResponse | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/clients/${customerId}/attribution-history`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || payload.error || "Erro ao carregar histórico de atribuição.");
      }
      const resData = await res.json();
      setData(resData.history);
    } catch (err: any) {
      setError(err.message || "Falha na conexão.");
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl bg-stone-900 border border-stone-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-modal-title"
      >
        {/* Header */}
        <div className="p-5 border-b border-stone-800 flex items-center justify-between bg-stone-900/90">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
              Histórico de Reativação e Atribuição
            </span>
            <h2 id="history-modal-title" className="text-lg font-bold text-stone-100 mt-0.5">
              {customerName || "Histórico do Cliente"}
            </h2>
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-stone-500 gap-3">
              <div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs">Buscando histórico consolidado de campanhas...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl space-y-3">
              <p className="text-red-400 font-semibold">{error}</p>
              <button
                onClick={fetchHistory}
                className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded text-xs font-semibold"
              >
                Tentar novamente
              </button>
            </div>
          ) : data ? (
            <>
              {/* Summary Metrics */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-stone-950/70 border border-stone-800 rounded-xl p-3.5 text-center">
                  <span className="text-[10px] uppercase font-bold text-stone-400">Total de Contatos</span>
                  <p className="text-xl font-bold text-stone-100 mt-1">{data.totalTouches}</p>
                </div>
                <div className="bg-stone-950/70 border border-stone-800 rounded-xl p-3.5 text-center">
                  <span className="text-[10px] uppercase font-bold text-stone-400">Conversões</span>
                  <p className="text-xl font-bold text-amber-400 mt-1">{data.totalConversions}</p>
                </div>
                <div className="bg-stone-950/70 border border-stone-800 rounded-xl p-3.5 text-center">
                  <span className="text-[10px] uppercase font-bold text-emerald-400">Receita Recuperada</span>
                  <p className="text-xl font-bold text-emerald-300 mt-1">{formatCurrency(data.totalRevenueRecovered)}</p>
                </div>
              </div>

              {/* Touch History Table */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
                  Campanhas e Disparos Anteriores
                </h3>

                {data.history.length === 0 ? (
                  <div className="p-8 text-center bg-stone-950/50 border border-stone-800 rounded-xl text-stone-500">
                    Nenhum disparo de reativação registrado para este cliente.
                  </div>
                ) : (
                  <div className="border border-stone-800 rounded-xl overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-stone-950 text-stone-400 border-b border-stone-800 text-[11px]">
                          <th className="p-3 font-semibold">Campanha</th>
                          <th className="p-3 font-semibold">Data do Contato</th>
                          <th className="p-3 font-semibold">Status / Retorno</th>
                          <th className="p-3 font-semibold text-right">Receita Atribuída</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-800/60 bg-stone-900/40">
                        {data.history.map((item) => {
                          const statusInfo = CONVERSION_STATUS_LABELS[item.conversionStatus] || {
                            label: item.conversionStatus,
                            color: "bg-stone-800 text-stone-300 border-stone-700",
                          };

                          return (
                            <tr key={item.recipientId} className="hover:bg-stone-800/40 transition-colors">
                              <td className="p-3 font-medium text-stone-200">
                                {item.campaignName}
                                <span className="block text-[10px] text-stone-400 font-mono">
                                  {item.channel}
                                </span>
                              </td>
                              <td className="p-3 text-stone-300 font-mono text-[11px]">
                                {formatDateTime(item.sentConfirmedAt)}
                              </td>
                              <td className="p-3">
                                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold border ${statusInfo.color}`}>
                                  {statusInfo.label}
                                </span>
                                {item.canonicalReturnDate && (
                                  <span className="block text-[10px] text-stone-400 mt-0.5">
                                    Retorno: {formatDate(item.canonicalReturnDate)}
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-right font-bold text-emerald-300">
                                {item.revenueAttributed > 0 ? formatCurrency(item.revenueAttributed) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-stone-800 bg-stone-900/90 flex justify-end">
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
