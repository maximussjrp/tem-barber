"use client";

import { useEffect, useState, useCallback } from "react";

interface TipEntry {
  id: string;
  barbershopId: string;
  comandaId: string;
  memberId: string;
  amount: number;
  method: string;
  status: "ACTIVE" | "REFUNDED" | "PAID_OUT" | "PAID_OUT_REVERSED";
  createdAt: string;
  member: {
    id: string;
    user?: {
      name: string;
      avatarUrl?: string;
    };
  };
  createdBy?: {
    name: string;
  };
}

export default function GorjetasAdminPage() {
  const [tips, setTips] = useState<TipEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const [selectedMember, setSelectedMember] = useState<string>("ALL");
  const [payoutMethod, setPayoutMethod] = useState<string>("PIX");
  const [processing, setProcessing] = useState(false);

  const fetchTips = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const query = statusFilter ? `?status=${statusFilter}` : "";
      const res = await fetch(`/api/admin/tips${query}`);
      if (res.ok) {
        const data = await res.json();
        setTips(data);
      }
    } catch (err) {
      console.error("Erro ao carregar gorjetas:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    let isSubscribed = true;
    const query = statusFilter ? `?status=${statusFilter}` : "";
    fetch(`/api/admin/tips${query}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (isSubscribed) {
          setTips(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Erro ao carregar gorjetas:", err);
        if (isSubscribed) setLoading(false);
      });

    return () => {
      isSubscribed = false;
    };
  }, [statusFilter]);

  const uniqueMembers = Array.from(
    new Map(
      tips.map((t) => [t.memberId, t.member.user?.name || t.memberId.split("-")[0]])
    ).entries()
  );

  const filteredTips = tips.filter(
    (t) => selectedMember === "ALL" || t.memberId === selectedMember
  );

  const totalActiveCents = filteredTips
    .filter((t) => t.status === "ACTIVE")
    .reduce((sum, t) => sum + Math.round(Number(t.amount) * 100), 0);

  async function handlePayout() {
    if (selectedMember === "ALL") {
      alert("Selecione um profissional específico para realizar o repasse.");
      return;
    }
    if (totalActiveCents <= 0) {
      alert("Nenhuma gorjeta pendente para o profissional selecionado.");
      return;
    }

    setProcessing(true);
    try {
      const res = await fetch("/api/admin/tips/payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: selectedMember,
          payoutMethod,
        }),
      });

      if (res.ok) {
        alert("Repasse de gorjetas realizado com sucesso!");
        fetchTips(true);
      } else {
        const errData = await res.json();
        alert(errData.message || "Erro ao realizar repasse.");
      }
    } catch {
      alert("Erro ao realizar repasse de gorjetas.");
    } finally {
      setProcessing(false);
    }
  }

  async function handleRefund(tipId: string) {
    const reason = prompt("Motivo do estorno da gorjeta:");
    if (!reason) return;
    setProcessing(true);
    try {
      const res = await fetch(`/api/admin/tips/${tipId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });

      if (res.ok) {
        alert("Gorjeta estornada com sucesso!");
        fetchTips(true);
      } else {
        const errData = await res.json();
        alert(errData.message || "Erro ao estornar gorjeta.");
      }
    } catch {
      alert("Erro ao estornar gorjeta.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center border-b border-[var(--border-subtle)] pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Gestão de Gorjetas</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Controle de repasses e custódia de valores devidos aos profissionais.
          </p>
        </div>
        <div className="bg-[var(--surface-raised)] border border-[var(--border-strong)] p-3 rounded-lg flex items-center gap-4">
          <div>
            <span className="block text-xs text-[var(--text-secondary)]">Total Pendente de Repasse</span>
            <span className="text-xl font-bold text-[var(--gold)] font-serif">
              R$ {(totalActiveCents / 100).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-center justify-between bg-[var(--surface)] p-4 rounded-xl border border-[var(--border-subtle)] shadow-sm">
        <div className="flex gap-3 items-center">
          <label className="text-sm font-medium text-[var(--text-secondary)]">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[var(--surface-raised)] border border-[var(--border-strong)] text-[var(--text-primary)] px-3 py-1.5 rounded-lg text-sm"
          >
            <option value="ACTIVE">Pendentes (Ativas)</option>
            <option value="PAID_OUT">Repassadas</option>
            <option value="REFUNDED">Estornadas</option>
            <option value="">Todas</option>
          </select>

          <label className="text-sm font-medium text-[var(--text-secondary)] ml-4">Profissional:</label>
          <select
            value={selectedMember}
            onChange={(e) => setSelectedMember(e.target.value)}
            className="bg-[var(--surface-raised)] border border-[var(--border-strong)] text-[var(--text-primary)] px-3 py-1.5 rounded-lg text-sm"
          >
            <option value="ALL">Todos os profissionais</option>
            {uniqueMembers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {selectedMember !== "ALL" && statusFilter === "ACTIVE" && totalActiveCents > 0 && (
          <div className="flex gap-2 items-center">
            <select
              value={payoutMethod}
              onChange={(e) => setPayoutMethod(e.target.value)}
              className="bg-[var(--surface-raised)] border border-[var(--border-strong)] text-[var(--text-primary)] px-3 py-1.5 rounded-lg text-sm"
            >
              <option value="PIX">PIX</option>
              <option value="CASH">Dinheiro (Caixa)</option>
              <option value="DEBIT">Débito</option>
              <option value="CREDIT">Crédito</option>
              <option value="OTHER">Outro</option>
            </select>

            <button
              onClick={() => handlePayout()}
              disabled={processing}
              className="bg-[var(--gold)] text-[var(--text-inverse)] px-4 py-1.5 rounded-lg text-sm font-bold hover:brightness-110 disabled:opacity-50 cursor-pointer"
            >
              {processing ? "Repassando..." : "Realizar Repasse"}
            </button>
          </div>
        )}
      </div>

      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border-subtle)] overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-[var(--text-secondary)]">Carregando gorjetas...</div>
        ) : filteredTips.length === 0 ? (
          <div className="p-8 text-center text-[var(--text-secondary)]">Nenhuma gorjeta encontrada.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--surface-raised)] border-b border-[var(--border-subtle)] text-[var(--text-secondary)]">
              <tr>
                <th className="p-3">Data</th>
                <th className="p-3">Profissional</th>
                <th className="p-3">Comanda</th>
                <th className="p-3">Método</th>
                <th className="p-3 text-right">Valor</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {filteredTips.map((tip) => (
                <tr key={tip.id} className="hover:bg-[var(--surface-hover)]">
                  <td className="p-3 text-[var(--text-primary)]">
                    {new Date(tip.createdAt).toLocaleString("pt-BR")}
                  </td>
                  <td className="p-3 font-medium text-[var(--text-primary)]">
                    {tip.member.user?.name || tip.memberId.split("-")[0]}
                  </td>
                  <td className="p-3 text-[var(--text-secondary)]">
                    {tip.comandaId.split("-")[0]}
                  </td>
                  <td className="p-3 text-[var(--text-secondary)] font-mono">{tip.method}</td>
                  <td className="p-3 text-right font-bold text-[var(--gold)]">
                    R$ {Number(tip.amount).toFixed(2)}
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-semibold ${
                        tip.status === "ACTIVE"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : tip.status === "PAID_OUT"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {tip.status === "ACTIVE"
                        ? "Pendente"
                        : tip.status === "PAID_OUT"
                        ? "Repassada"
                        : "Estornada"}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {tip.status === "ACTIVE" && (
                      <button
                        onClick={() => handleRefund(tip.id)}
                        disabled={processing}
                        className="text-xs text-rose-500 hover:text-rose-700 font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        Estornar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
