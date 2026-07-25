"use client";

import { useEffect, useState } from "react";

const PLAN_CODE = "pro_monthly";

const features = [
  "Agenda online",
  "Fila online",
  "Comandas",
  "Gestao de clientes",
  "Produtos e estoque",
  "Caixa e financeiro",
  "Comissoes",
  "Clube de assinaturas",
  "Relatorios",
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

interface BillingStatusResponse {
  permissions?: {
    canEditProfile: boolean;
    canSubscribe: boolean;
  };
}

export default function PlanoCobrancaPage() {
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [profileCompleted, setProfileCompleted] = useState(false);
  const [documentConfigured, setDocumentConfigured] = useState(false);
  const [cpfCnpjMasked, setCpfCnpjMasked] = useState<string | null>(null);
  const [editingDocument, setEditingDocument] = useState(false);
  const [canEditProfile, setCanEditProfile] = useState(false);
  const [canSubscribe, setCanSubscribe] = useState(false);

  const [personType, setPersonType] = useState<"INDIVIDUAL" | "COMPANY">("INDIVIDUAL");
  const [legalName, setLegalName] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [billingPhone, setBillingPhone] = useState("");
  const [billingType, setBillingType] = useState<"PIX" | "BOLETO">("PIX");
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [profileRes, statusRes] = await Promise.all([
          fetch("/api/admin/billing/profile"),
          fetch("/api/admin/billing/asaas/status"),
        ]);

        if (!profileRes.ok) {
          const data = await profileRes.json().catch(() => null);
          throw new Error(data?.message || data?.error || "Nao foi possivel carregar o perfil.");
        }

        const profile = (await profileRes.json()) as BillingProfileResponse;
        const status = statusRes.ok
          ? ((await statusRes.json()) as BillingStatusResponse)
          : ({ permissions: { canEditProfile: false, canSubscribe: false } } as BillingStatusResponse);

        if (!active) return;

        setPersonType(profile.personType ?? "INDIVIDUAL");
        setLegalName(profile.legalName ?? "");
        setBillingEmail(profile.billingEmail ?? "");
        setBillingPhone(profile.billingPhone ?? "");
        setDocumentConfigured(profile.documentConfigured);
        setCpfCnpjMasked(profile.cpfCnpjMasked);
        setProfileCompleted(profile.completed);
        setEditingDocument(!profile.documentConfigured);
        setCpfCnpj("");
        setCanEditProfile(Boolean(status.permissions?.canEditProfile));
        setCanSubscribe(Boolean(status.permissions?.canSubscribe));
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : "Nao foi possivel carregar o perfil.";
        setError(message);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

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
        throw new Error(data.message || data.error || "Nao foi possivel salvar o perfil.");
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
      const message = err instanceof Error ? err.message : "Nao foi possivel salvar o perfil.";
      setError(message);
    } finally {
      setSavingProfile(false);
    }
  }

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
        throw new Error(data.message || data.error || "Nao foi possivel ativar o plano.");
      }

      setConfirmOpen(false);
      setSuccess("Plano ativado com sucesso.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Nao foi possivel ativar o plano.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const activateDisabled = !profileCompleted || !canSubscribe || submitting;
  const profileDisabled = !canEditProfile || savingProfile;

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-96">
        <p className="text-stone-500 animate-pulse">Carregando plano e cobranca...</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-100">Plano e cobranca</h1>
        <p className="text-stone-400 text-sm mt-1">Assinatura mensal do Tem Barber.</p>
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

      <section className="bg-stone-900 border border-stone-800 rounded-xl p-6 mb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-stone-100">Plano Tem Barber</h2>
            <p className="text-stone-400 text-sm mt-2">Gestao completa para sua barbearia.</p>
          </div>
          <div className="md:text-right">
            <p className="text-3xl font-bold text-amber-400">R$ 49,90</p>
            <p className="text-sm text-stone-400">por mes</p>
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

      <form onSubmit={saveProfile} className="space-y-6">
        <section className="bg-stone-900 border border-stone-800 rounded-xl p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80">
              Dados de faturamento
            </h2>
            {!canEditProfile && (
              <span className="text-xs text-stone-500">Somente proprietarios podem editar.</span>
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
                <option value="INDIVIDUAL">Pessoa fisica</option>
                <option value="COMPANY">Pessoa juridica</option>
              </select>
            </div>
            <div>
              <label htmlFor="billing-legal-name" className={labelClass}>Nome completo ou razao social</label>
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
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-5 py-2.5 text-sm font-bold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
              >
                {savingProfile ? "Salvando..." : "Salvar dados de faturamento"}
              </button>
            </div>
          )}
        </section>
      </form>

      <section className="bg-stone-900 border border-stone-800 rounded-xl p-6 mt-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-5">
          Forma de pagamento
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
                disabled={!canSubscribe}
                className="sr-only"
              />
              {option === "PIX" ? "PIX" : "Boleto"}
            </label>
          ))}
        </div>
      </section>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          disabled={activateDisabled}
          onClick={() => setConfirmOpen(true)}
          className="bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold px-8 py-3 rounded-lg shadow-lg hover:from-amber-500 hover:to-amber-400 transition-all text-sm tracking-wide disabled:opacity-50"
        >
          Ativar plano por R$ 49,90/mes
        </button>
      </div>

      {!profileCompleted && (
        <p className="mt-3 text-right text-xs text-stone-500">
          Complete e salve os dados de faturamento antes de ativar o plano.
        </p>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-stone-800 bg-stone-950 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-stone-100">Plano Tem Barber</h2>
            <div className="mt-4 space-y-2 text-sm text-stone-300">
              <p>R$ 49,90 por mes</p>
              <p>Cobranca mensal recorrente</p>
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
