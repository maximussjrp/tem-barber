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
  asaasSubscriptionId?: string | null;
  isCurrentContract?: boolean;
  isCurrentPayment?: boolean;
}

interface BillingStatusResponse {
  hasSubscription?: boolean;
  hasSubscriptionRecord?: boolean;
  hasCurrentSubscription?: boolean;
  accessStatus?:
    | "TRIAL"
    | "ACTIVE"
    | "GRACE_PERIOD"
    | "PAST_DUE"
    | "SUSPENDED"
    | "CANCELED"
    | "EXPIRED"
    | "NO_SUBSCRIPTION"
    | "COMPLIMENTARY";
  accessAllowed?: boolean;
  accessType?: "TRIAL" | "PAID" | "GRACE" | "NONE" | "COMPLIMENTARY";
  remainingDays?: number;
  remainingLabel?: string;
  formattedValidUntil?: string | null;
  billingStatus?: "NONE" | "PENDING" | "PAID" | "OVERDUE" | "CANCELED" | "REFUNDED";
  billingLabel?: string | null;
  formattedBillingDueDate?: string | null;
  complimentary?: {
    active: boolean;
    queued: boolean;
    activeUntil?: string | null;
    nextStartsAt?: string | null;
    latestEndsAt?: string | null;
  };
  recentPayments?: RecentPayment[];
  synchronizationWarnings?: string[];
  permissions?: {
    canEditProfile: boolean;
    canSubscribe: boolean;
  };
}

function translatePaymentStatus(status: string | undefined): { label: string; color: string } {
  switch (status) {
    case "PENDING":
      return { label: "Aguardando pagamento", color: "bg-amber-950/60 border-amber-500/40 text-amber-300" };
    case "RECEIVED":
    case "CONFIRMED":
    case "PAID":
      return { label: "Pago", color: "bg-emerald-950/60 border-emerald-500/40 text-emerald-300" };
    case "OVERDUE":
      return { label: "Vencido", color: "bg-red-950/60 border-red-500/40 text-red-300" };
    case "REFUNDED":
      return { label: "Estornado", color: "bg-purple-950/60 border-purple-500/40 text-purple-300" };
    case "CANCELED":
      return { label: "Cancelado", color: "bg-stone-800 border-stone-700 text-stone-400" };
    case "NONE":
    default:
      return { label: "Sem cobrança", color: "bg-stone-800 border-stone-700 text-stone-400" };
  }
}

function translateAccessBadge(status: string | undefined): { label: string; color: string } {
  switch (status) {
    case "COMPLIMENTARY":
      return { label: "ACESSO CORTESIA", color: "bg-cyan-950/60 border-cyan-500/40 text-cyan-300" };
    case "ACTIVE":
      return { label: "PLANO ATIVO", color: "bg-emerald-950/60 border-emerald-500/40 text-emerald-300" };
    case "GRACE_PERIOD":
      return { label: "PERÍODO DE TOLERÂNCIA", color: "bg-amber-950/60 border-amber-500/40 text-amber-300" };
    case "PAST_DUE":
      return { label: "ACESSO SUSPENSO POR ATRASO", color: "bg-red-950/60 border-red-500/40 text-red-300" };
    case "SUSPENDED":
      return { label: "ACESSO SUSPENSO", color: "bg-red-950/60 border-red-500/40 text-red-300" };
    case "CANCELED":
      return { label: "PLANO CANCELADO", color: "bg-stone-800 border-stone-700 text-stone-400" };
    case "EXPIRED":
      return { label: "ACESSO EXPIRADO", color: "bg-red-950/60 border-red-500/40 text-red-300" };
    case "NO_SUBSCRIPTION":
      return { label: "SEM ASSINATURA", color: "bg-stone-800 border-stone-700 text-stone-400" };
    case "TRIAL":
    default:
      return { label: "PERÍODO DE TESTE", color: "bg-amber-950/60 border-amber-500/40 text-amber-300" };
  }
}

export interface PlatformBillingManagerProps {
  paymentPath: string;
  backPath?: string;
  isSuspendedArea?: boolean;
}

export function PlatformBillingManager({
  paymentPath,
  backPath,
  isSuspendedArea = false,
}: PlatformBillingManagerProps) {
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
            setHasSubscription(Boolean(status.hasCurrentSubscription ?? status.hasSubscription));
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
      triggerRefresh();
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
            router.push(paymentPath);
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
  }, [paymentPath, router, triggerRefresh]);

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

      if (data.alreadyExisted) {
        setSuccess("Assinatura identificada. Redirecionando para cobrança...");
        router.push(paymentPath);
        return;
      }

      pollForPayment();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao processar assinatura.";
      setError(message);
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 md:p-8 max-w-4xl animate-pulse space-y-6">
        <div className="h-8 w-64 bg-stone-800 rounded" />
        <div className="h-40 bg-stone-900 border border-stone-800 rounded-xl" />
        <div className="h-64 bg-stone-900 border border-stone-800 rounded-xl" />
      </div>
    );
  }

  const accessBadge = translateAccessBadge(statusData?.accessStatus);
  const paymentBadge = translatePaymentStatus(statusData?.billingStatus);
  const profileDisabled = !canEditProfile || savingProfile;
  const activateDisabled = !canSubscribe || !profileCompleted || submitting || polling;

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          {backPath && (
            <Link
              href={backPath}
              className="text-xs font-semibold uppercase tracking-wider text-amber-500 hover:text-amber-400 mb-2 inline-block transition-colors"
            >
              ← Voltar
            </Link>
          )}
          <h1 className="text-2xl font-bold text-stone-100">
            {isSuspendedArea ? "Regularização de Assinatura" : "Plano e cobrança"}
          </h1>
          <p className="text-stone-400 text-sm mt-1">
            {isSuspendedArea
              ? "Regularize seus dados e pendências financeiras para restaurar o acesso operacional."
              : "Gerencie os dados de faturamento e a assinatura da sua barbearia."}
          </p>
        </div>
        <button
          type="button"
          onClick={triggerRefresh}
          className="self-start sm:self-auto rounded-lg border border-stone-800 bg-stone-900 px-4 py-2 text-xs font-semibold text-stone-300 hover:bg-stone-800 transition-colors"
        >
          Atualizar dados
        </button>
      </div>

      {/* Banner de suspensao se aplicavel */}
      {isSuspendedArea && (
        statusData?.accessAllowed ? (
          <div className="mb-6 rounded-xl border border-cyan-500/30 bg-cyan-950/30 p-4 text-sm text-cyan-200 flex items-start gap-3 shadow-lg">
            <span className="text-lg">🎉</span>
            <div className="flex-1">
              <p className="font-bold text-cyan-300">Acesso liberado</p>
              <p className="text-xs text-cyan-200/80 mt-1 leading-relaxed">
                Sua barbearia possui acesso cortesia ativo. O acesso aos módulos operacionais está liberado.
              </p>
              <div className="mt-3">
                <Link
                  href="/admin"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors"
                >
                  Voltar ao painel operacional →
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-950/30 p-4 text-sm text-amber-200 flex items-start gap-3 shadow-lg">
            <span className="text-lg">⚠️</span>
            <div>
              <p className="font-bold text-amber-300">Acesso operacional suspenso</p>
              <p className="text-xs text-amber-200/80 mt-1 leading-relaxed">
                O acesso aos módulos operacionais (agenda, clientes, comandas, financeiro) está suspenso temporariamente.
                Você pode conferir sua cobrança em aberto, emitir PIX/boleto ou atualizar seus dados fiscais abaixo.
              </p>
            </div>
          </div>
        )
      )}

      {/* Alertas */}
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
      {polling && (
        <div className="bg-amber-950/40 border border-amber-500/30 text-amber-200 text-sm px-4 py-3 rounded-lg mb-6 flex items-center gap-3">
          <div className="h-4 w-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
          <span>{pollingMessage}</span>
        </div>
      )}

      {/* Card do Plano */}
      <section className="bg-stone-900 border border-stone-800 rounded-xl p-6 relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-800 pb-5">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-stone-100">Plano Tem Barber</h2>
              <span className={`inline-block px-3 py-1 rounded-full border text-xs font-bold tracking-wide ${accessBadge.color}`}>
                {accessBadge.label}
              </span>
            </div>
            <p className="text-stone-400 text-sm mt-1">Tudo o que sua barbearia precisa em um único plano.</p>
          </div>
          <div className="text-right">
            <span className="text-3xl font-extrabold text-amber-400">R$ 49,90</span>
            <span className="text-stone-400 text-sm"> / mês</span>
          </div>
        </div>

        {/* Resumo da Situacao */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-5 text-xs text-stone-300">
          <div>
            <span className="text-stone-500 uppercase block font-semibold text-[10px] tracking-wider mb-1">
              Acesso
            </span>
            <p className="font-semibold text-stone-200 text-sm">
              {statusData?.remainingLabel || "Sem informações"}
            </p>
            {statusData?.formattedValidUntil && (
              <p className="text-stone-400 text-[11px] mt-0.5">
                Válido até {statusData.formattedValidUntil}
              </p>
            )}
          </div>
          <div>
            <span className="text-stone-500 uppercase block font-semibold text-[10px] tracking-wider mb-1">
              Cobrança
            </span>
            <span className={`inline-block px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${paymentBadge.color}`}>
              {statusData?.billingLabel || paymentBadge.label}
            </span>
            {statusData?.formattedBillingDueDate && (
              <p className="text-stone-400 text-[11px] mt-1">
                Vencimento: {statusData.formattedBillingDueDate}
              </p>
            )}
          </div>
          <div>
            <span className="text-stone-500 uppercase block font-semibold text-[10px] tracking-wider mb-1">
              Recorrência
            </span>
            <p className="font-semibold text-stone-200 text-sm">Mensal via Asaas</p>
            <p className="text-stone-400 text-[11px] mt-0.5">PIX ou Boleto Bancário</p>
          </div>
        </div>

        {/* Beneficios do Plano */}
        <div className="mt-6 pt-5 border-t border-stone-800">
          <p className="text-xs uppercase font-semibold tracking-wider text-stone-400 mb-3">
            Incluso na sua assinatura:
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {features.map((feat) => (
              <div key={feat} className="flex items-center gap-2 text-xs text-stone-300">
                <span className="text-amber-500 font-bold">✓</span>
                <span>{feat}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Form de Dados Fiscais */}
      <form onSubmit={saveProfile} className="bg-stone-900 border border-stone-800 rounded-xl p-6 mt-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-800 pb-4 mb-5">
          <div>
            <h2 className="text-base font-bold text-stone-100">Dados de Faturamento</h2>
            <p className="text-stone-400 text-xs mt-0.5">
              Necessários para a emissão correta da cobrança e nota fiscal.
            </p>
          </div>
          {profileCompleted && !editingDocument && canEditProfile && (
            <button
              type="button"
              onClick={() => setEditingDocument(true)}
              className="text-xs text-amber-500 hover:text-amber-400 font-semibold"
            >
              Alterar documento fiscal
            </button>
          )}
        </div>

        <section className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="billing-person-type" className={labelClass}>Tipo de Pessoa</label>
              <select
                id="billing-person-type"
                value={personType}
                disabled={profileDisabled}
                onChange={(event) => setPersonType(event.target.value as "INDIVIDUAL" | "COMPANY")}
                className={inputClass}
              >
                <option value="INDIVIDUAL">Pessoa Física (CPF)</option>
                <option value="COMPANY">Pessoa Jurídica (CNPJ)</option>
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
                placeholder="Nome completo ou Razão Social"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="billing-document" className={labelClass}>
                {personType === "INDIVIDUAL" ? "CPF" : "CNPJ"}
              </label>
              {documentConfigured && !editingDocument ? (
                <div className="flex gap-2">
                  <input
                    id="billing-document"
                    type="text"
                    value={cpfCnpjMasked ?? ""}
                    disabled
                    className={inputClass}
                  />
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
            href={paymentPath}
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
            {statusData?.hasSubscriptionRecord ? "Reassinar plano por R$ 49,90/mês" : "Assinar plano por R$ 49,90/mês"}
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
                        href={paymentPath}
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

export default PlatformBillingManager;