"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const PLAN_CODE = "pro_monthly";

const features = [
  "Agenda online",
  "Fila online",
  "Comandas",
  "Gestão de clientes",
  "Produtos e estoque",
  "Caixa e financeiro",
  "Comissões",
  "Clube de assinaturas",
  "Relatórios",
];

const inputClass =
  "w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm disabled:opacity-60";
const labelClass =
  "block text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1.5";

interface BillingProfileResponse {
  completed: boolean;
  personType: "INDIVIDUAL" | "COMPANY" | null;
  legalName: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  documentConfigured: boolean;
  cpfCnpjMasked: string | null;
}

interface RecentPayment {
  status: string;
  billingType: string;
  value: string;
  dueDate: string | null;
  paymentDate: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
}

interface BillingStatusResponse {
  hasSubscription?: boolean;
  accessStatus?: "TRIAL" | "PENDING_PAYMENT" | "ACTIVE" | "OVERDUE" | "GRACE_PERIOD" | "CANCELED" | "EXPIRED";
  remainingDays?: number;
  remainingLabel?: string;
  recentPayments?: RecentPayment[];
  permissions?: {
    canEditProfile: boolean;
    canSubscribe: boolean;
  };
}

function translatePaymentStatus(status: string): { label: string; color: string } {
  switch (status) {
    case "PENDING":
      return { label: "Aguardando pagamento", color: "bg-amber-950/60 border-amber-500/40 text-amber-300" };
    case "RECEIVED":
    case "CONFIRMED":
      return { label: "Pago", color: "bg-emerald-950/60 border-emerald-500/40 text-emerald-300" };
    case "OVERDUE":
      return { label: "Vencido", color: "bg-red-950/60 border-red-500/40 text-red-300" };
    case "REFUNDED":
      return { label: "Estornado", color: "bg-purple-950/60 border-purple-500/40 text-purple-300" };
    case "CANCELED":
      return { label: "Cancelado", color: "bg-stone-800 border-stone-700 text-stone-400" };
    default:
      return { label: status, color: "bg-stone-800 border-stone-700 text-stone-300" };
  }
}

function translateAccessBadge(status: string | undefined): { label: string; color: string } {
  switch (status) {
    case "ACTIVE":
      return { label: "PLANO ATIVO", color: "bg-emerald-950/60 border-emerald-500/40 text-emerald-300" };
    case "PENDING_PAYMENT":
      return { label: "PAGAMENTO PENDENTE", color: "bg-amber-950/60 border-amber-500/40 text-amber-300" };
    case "OVERDUE":
      return { label: "PAGAMENTO EM ATRASO", color: "bg-red-950/60 border-red-500/40 text-red-300" };
    case "GRACE_PERIOD":
      return { label: "TOLERÂNCIA", color: "bg-amber-950/60 border-amber-500/40 text-amber-300" };
    case "CANCELED":
    case "EXPIRED":
      return { label: "ACESSO EXPIRADO", color: "bg-red-950/60 border-red-500/40 text-red-300" };
    case "TRIAL":
    default:
      return { label: "PERÍODO DE TESTE", color: "bg-amber-950/60 border-amber-500/40 text-amber-300" };
  }
}

export default function PlanoCobrancaPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [pollingMessage, setPollingMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  const [profileCompleted, setProfileCompleted] = useState(false);
  const [documentConfigured, setDocumentConfigured] = useState(false);
  const [cpfCnpjMasked, setCpfCnpjMasked] = useState<string | null>(null);
  const [editingDocument, setEditingDocument] = useState(false);
  const [canEditProfile, setCanEditProfile] = useState(false);
  const [canSubscribe, setCanSubscribe] = useState(false);

  const [hasSubscription, setHasSubscription] = useState(false);
  const [statusData, setStatusData] = useState<BillingStatusResponse | null>(null);

  const [personType, setPersonType] = useState<"INDIVIDUAL" | "COMPANY">("INDIVIDUAL");
  const [legalName, setLegalName] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [billingPhone, setBillingPhone] = useState("");
  const [billingType, setBillingType] = useState<"PIX" | "BOLETO">("PIX");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerRefresh = useCallback(() => {
    setRefreshIndex((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function fetchBillingData() {
      setError(null);
      try {
        const [profileRes, statusRes] = await Promise.all([
          fetch("/api/admin/billing/profile"),
          fetch("/api/admin/billing/asaas/status"),
        ]);

        if (!profileRes.ok) {
          const data = await profileRes.json().catch(() => null);
          throw new Error(data?.message || data?.error || "Não foi possível carregar o perfil.");
        }

        const profile = (await profileRes.json()) as BillingProfileResponse;
        const status = statusRes.ok ? ((await statusRes.json()) as BillingStatusResponse) : null;

        if (isMounted) {
          setPersonType(profile.personType ?? "INDIVIDUAL");
          setLegalName(profile.legalName ?? "");
          setBillingEmail(profile.billingEmail ?? "");
          setBillingPhone(profile.billingPhone ?? "");
          setDocumentConfigured(profile.documentConfigured);
          setCpfCnpjMasked(profile.cpfCnpjMasked);
          setProfileCompleted(profile.completed);
          setEditingDocument(!profile.documentConfigured);
          setCpfCnpj("");

          if (status) {
            setStatusData(status);
            setHasSubscription(Boolean(status.hasSubscription));
            setCanEditProfile(Boolean(status.permissions?.canEditProfile));
            setCanSubscribe(Boolean(status.permissions?.canSubscribe));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Não foi possível carregar os dados.";
        if (isMounted) setError(message);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchBillingData();

    return () => {
      isMounted = false;
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, [refreshIndex]);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (!canEditProfile) return;

    setSavingProfile(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/admin/billing/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personType,
          legalName,
          ...(editingDocument ? { cpfCnpj } : {}),
          billingEmail,
          billingPhone,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || "Não foi possível salvar o perfil.");
      }

      const profile = data as BillingProfileResponse;
      setPersonType(profile.personType ?? "INDIVIDUAL");
      setLegalName(profile.legalName ?? "");
      setBillingEmail(profile.billingEmail ?? "");
      setBillingPhone(profile.billingPhone ?? "");
      setDocumentConfigured(profile.documentConfigured);
      setCpfCnpjMasked(profile.cpfCnpjMasked);
      setProfileCompleted(profile.completed);
      setCpfCnpj("");
      setEditingDocument(!profile.documentConfigured);
      setSuccess("Dados de faturamento salvos.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível salvar o perfil.";
      setError(message);
    } finally {
      setSavingProfile(false);
    }
  }

  const pollForPayment = useCallback(() => {
    setPolling(true);
    setPollingMessage("Assinatura criada. Preparando sua cobrança...");

    let elapsed = 0;
    const interval = 2000;
    const maxTime = 15000;

    const check = async () => {
      try {
        const res = await fetch("/api/admin/billing/asaas/current-payment");
        if (res.ok) {
          const data = await res.json();
          if (data.exists) {
            if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
            setPolling(false);
            router.push("/admin/configuracoes/plano-cobranca/pagamento");
            return;
          }
        }
      } catch {
        // Ignora erros transitórios no polling
      }

      elapsed += interval;
      if (elapsed >= maxTime) {
        if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
        setPolling(false);
        setPollingMessage(null);
        setSuccess("Assinatura criada com sucesso! Sua cobrança está sendo preparada. Clique em 'Ver cobrança' para visualizar.");
        triggerRefresh();
      }
    };

    check();
    pollingTimerRef.current = setInterval(check, interval);
  }, [router, triggerRefresh]);

  async function confirmSubscription() {
    if (!canSubscribe || !profileCompleted) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/admin/billing/asaas/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planCode: PLAN_CODE,
          billingType,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || "Não foi possível assinar o plano.");
      }

      setConfirmOpen(false);
      setHasSubscription(true);
      setSuccess("Assinatura criada. Conclua o pagamento para ativar o plano.");
      pollForPayment();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível assinar o plano.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const activateDisabled = !profileCompleted || !canSubscribe || submitting || hasSubscription || polling;
  const profileDisabled = !canEditProfile || savingProfile;
  const accessBadge = translateAccessBadge(statusData?.accessStatus);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-96">
        <p className="text-stone-500 animate-pulse">Carregando plano e cobrança...</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-100">Plano e cobrança</h1>
        <p className="text-stone-400 text-sm mt-1">Gestão de assinatura e dados de faturamento do Tem Barber.</p>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-500/30 text-red-200 text-sm px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-sm px-4 py-3 rounded-lg mb-6">
          {success}
        </div>
      )}
      {pollingMessage && (
        <div className="bg-amber-950/40 border border-amber-500/30 text-amber-200 text-sm px-4 py-3 rounded-lg mb-6 animate-pulse">
          ⏳ {pollingMessage}
        </div>
      )}

      {/* Card Superior: Situacao da Assinatura */}
      <section className="bg-stone-900 border border-stone-800 rounded-xl p-6 mb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <span className={`inline-block px-3 py-1 text-xs font-bold rounded-full border mb-2 ${accessBadge.color}`}>
              {accessBadge.label}
            </span>
            <h2 className="text-xl font-bold text-stone-100">Plano Tem Barber</h2>
            {statusData?.remainingLabel && (
              <p className="text-stone-400 text-sm mt-1 font-medium">{statusData.remainingLabel}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {hasSubscription && (
              <Link
                href="/admin/configuracoes/plano-cobranca/pagamento"
                className="rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-bold text-stone-950 hover:bg-amber-400 transition-colors whitespace-nowrap shadow-md"
              >
                Ver cobrança
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Card do Plano */}
      <section className="bg-stone-900 border border-stone-800 rounded-xl p-6 mb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-stone-100">Recursos inclusos</h2>
            <p className="text-stone-400 text-sm mt-2">Tudo o que sua barbearia precisa em um único plano.</p>
          </div>
          <div className="md:text-right">
            <p className="text-3xl font-bold text-amber-400">R$ 49,90</p>
            <p className="text-sm text-stone-400">por mês</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {features.map((feature) => (
            <div key={feature} className="flex items-center gap-2 text-sm text-stone-300">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span>{feature}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Form de Dados de Faturamento */}
      <form onSubmit={saveProfile} className="space-y-6">
        <section className="bg-stone-900 border border-stone-800 rounded-xl p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80">
              Dados de faturamento
            </h2>
            {!canEditProfile && (
              <span className="text-xs text-stone-500">Somente proprietários podem editar.</span>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="billing-person-type" className={labelClass}>Tipo de pessoa</label>
              <select
                id="billing-person-type"
                value={personType}
                onChange={(event) => {
                  setPersonType(event.target.value as "INDIVIDUAL" | "COMPANY");
                  setEditingDocument(true);
                  setCpfCnpj("");
                }}
                disabled={profileDisabled}
                className={inputClass}
              >
                <option value="INDIVIDUAL">Pessoa física</option>
                <option value="COMPANY">Pessoa jurídica</option>
              </select>
            </div>
            <div>
              <label htmlFor="billing-legal-name" className={labelClass}>Nome completo ou razão social</label>
              <input
                id="billing-legal-name"
                type="text"
                required
                value={legalName}
                disabled={profileDisabled}
                onChange={(event) => setLegalName(event.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="billing-document" className={labelClass}>{personType === "INDIVIDUAL" ? "CPF" : "CNPJ"}</label>
              {documentConfigured && !editingDocument ? (
                <div className="flex gap-2">
                  <input id="billing-document" type="text" value={cpfCnpjMasked ?? ""} disabled className={inputClass} />
                  {canEditProfile && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingDocument(true);
                        setCpfCnpj("");
                      }}
                      className="rounded-lg border border-stone-700 px-4 py-2 text-sm font-medium text-stone-300 hover:bg-stone-900 whitespace-nowrap"
                    >
                      Alterar CPF/CNPJ
                    </button>
                  )}
                </div>
              ) : (
                <input
                  id="billing-document"
                  type="text"
                  required={!documentConfigured}
                  value={cpfCnpj}
                  disabled={profileDisabled}
                  onChange={(event) => setCpfCnpj(event.target.value)}
                  placeholder={personType === "INDIVIDUAL" ? "Informe o CPF" : "Informe o CNPJ"}
                  className={inputClass}
                />
              )}
            </div>
            <div>
              <label htmlFor="billing-email" className={labelClass}>E-mail financeiro</label>
              <input
                id="billing-email"
                type="email"
                required
                value={billingEmail}
                disabled={profileDisabled}
                onChange={(event) => setBillingEmail(event.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="billing-phone" className={labelClass}>Telefone financeiro</label>
              <input
                id="billing-phone"
                type="tel"
                value={billingPhone}
                disabled={profileDisabled}
                onChange={(event) => setBillingPhone(event.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          {canEditProfile && (
            <div className="mt-6 flex justify-end">
              <button
                type="submit"
                disabled={savingProfile}
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-5 py-2.5 text-sm font-bold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 transition-all"
              >
                {savingProfile ? "Salvando..." : "Salvar dados de faturamento"}
              </button>
            </div>
          )}
        </section>
      </form>

      {/* Forma de pagamento para contratacao */}
      {!hasSubscription && (
        <section className="bg-stone-900 border border-stone-800 rounded-xl p-6 mt-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-5">
            Forma de pagamento para contratação
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            {(["PIX", "BOLETO"] as const).map((option) => (
              <label
                key={option}
                className={`cursor-pointer rounded-lg border px-4 py-4 text-sm transition-all ${
                  billingType === option
                    ? "border-amber-500/70 bg-amber-500/10 text-amber-200"
                    : "border-stone-800 bg-stone-950/50 text-stone-300 hover:border-stone-700"
                }`}
              >
                <input
                  type="radio"
                  name="billingType"
                  value={option}
                  checked={billingType === option}
                  onChange={() => setBillingType(option)}
                  disabled={!canSubscribe || hasSubscription}
                  className="sr-only"
                />
                {option === "PIX" ? "PIX" : "Boleto"}
              </label>
            ))}
          </div>
        </section>
      )}

      {/* Botao de Acao de Assinatura */}
      <div className="mt-6 flex justify-end">
        {hasSubscription ? (
          <Link
            href="/admin/configuracoes/plano-cobranca/pagamento"
            className="bg-amber-500 text-stone-950 font-bold px-8 py-3 rounded-lg shadow-lg hover:bg-amber-400 transition-all text-sm tracking-wide"
          >
            Ver cobrança
          </Link>
        ) : (
          <button
            type="button"
            disabled={activateDisabled}
            onClick={() => setConfirmOpen(true)}
            className="bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold px-8 py-3 rounded-lg shadow-lg hover:from-amber-500 hover:to-amber-400 transition-all text-sm tracking-wide disabled:opacity-50"
          >
            Assinar plano por R$ 49,90/mês
          </button>
        )}
      </div>

      {!profileCompleted && !hasSubscription && (
        <p className="mt-3 text-right text-xs text-stone-500">
          Complete e salve os dados de faturamento antes de assinar o plano.
        </p>
      )}

      {/* Historico de Pagamentos */}
      {statusData?.recentPayments && statusData.recentPayments.length > 0 && (
        <section className="bg-stone-900 border border-stone-800 rounded-xl p-6 mt-8">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-5">
            Histórico de cobranças
          </h2>

          <div className="divide-y divide-stone-800 overflow-x-auto">
            {statusData.recentPayments.map((pmt, idx) => {
              const translated = translatePaymentStatus(pmt.status);
              const formattedDue = pmt.dueDate
                ? new Date(pmt.dueDate).toLocaleDateString("pt-BR")
                : "-";
              return (
                <div key={idx} className="py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
                  <div>
                    <span className={`inline-block px-2.5 py-0.5 rounded-full border text-[11px] font-semibold mr-3 ${translated.color}`}>
                      {translated.label}
                    </span>
                    <span className="text-stone-300 font-medium mr-3">{pmt.billingType}</span>
                    <span className="text-stone-400">Vencimento: {formattedDue}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-amber-400 text-sm">R$ {pmt.value}</span>
                    {(pmt.status === "PENDING" || pmt.status === "OVERDUE") && (
                      <Link
                        href="/admin/configuracoes/plano-cobranca/pagamento"
                        className="rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-bold text-amber-300 hover:bg-amber-500/20"
                      >
                        Ver cobrança
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Modal de Confirmacao */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-stone-800 bg-stone-950 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-stone-100">Plano Tem Barber</h2>
            <div className="mt-4 space-y-2 text-sm text-stone-300">
              <p>R$ 49,90 por mês</p>
              <p>Cobrança mensal recorrente</p>
              <p>Forma de pagamento escolhida: {billingType === "PIX" ? "PIX" : "Boleto"}</p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
                className="rounded-lg border border-stone-700 px-4 py-2 text-sm font-medium text-stone-300 hover:bg-stone-900 disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={confirmSubscription}
                disabled={submitting}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-stone-950 hover:bg-amber-400 disabled:opacity-50"
              >
                {submitting ? "Confirmando..." : "Confirmar assinatura"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
