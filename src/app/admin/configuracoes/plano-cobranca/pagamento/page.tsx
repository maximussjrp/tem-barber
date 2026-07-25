"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface CurrentPaymentResponse {
  exists: boolean;
  status: string | null;
  billingType: string | null;
  value: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  canPay: boolean;
}

interface PixQrCodeResponse {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

function translatePaymentStatus(status: string | null): { label: string; color: string } {
  switch (status) {
    case "PENDING":
      return { label: "Aguardando pagamento", color: "bg-amber-950/60 border-amber-500/40 text-amber-300" };
    case "RECEIVED":
    case "CONFIRMED":
      return { label: "Pago com sucesso", color: "bg-emerald-950/60 border-emerald-500/40 text-emerald-300" };
    case "OVERDUE":
      return { label: "Pagamento em atraso", color: "bg-red-950/60 border-red-500/40 text-red-300" };
    case "REFUNDED":
      return { label: "Pagamento estornado", color: "bg-purple-950/60 border-purple-500/40 text-purple-300" };
    case "CANCELED":
      return { label: "Cobrança cancelada", color: "bg-stone-800 border-stone-700 text-stone-400" };
    default:
      return { label: "Situação pendente", color: "bg-stone-800 border-stone-700 text-stone-300" };
  }
}

export default function PagamentoPlanoPage() {
  const [loading, setLoading] = useState(true);
  const [loadingPix, setLoadingPix] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);

  const [payment, setPayment] = useState<CurrentPaymentResponse | null>(null);
  const [pixData, setPixData] = useState<PixQrCodeResponse | null>(null);
  const [pixError, setPixError] = useState<string | null>(null);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    setRefreshIndex((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function fetchPaymentDetails() {
      setError(null);
      try {
        const res = await fetch("/api/admin/billing/asaas/current-payment");
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.message || "Não foi possível carregar a cobrança.");
        }
        const data = (await res.json()) as CurrentPaymentResponse;
        if (isMounted) setPayment(data);

        if (data.exists && data.billingType === "PIX" && data.canPay) {
          if (isMounted) {
            setLoadingPix(true);
            setPixError(null);
          }
          try {
            const pixRes = await fetch("/api/admin/billing/asaas/current-payment/pix");
            if (pixRes.ok) {
              const pixJson = (await pixRes.json()) as PixQrCodeResponse;
              if (isMounted) setPixData(pixJson);
            } else {
              const pixDataErr = await pixRes.json().catch(() => null);
              if (isMounted) setPixError(pixDataErr?.message || "Não foi possível carregar o QR Code Pix.");
            }
          } catch {
            if (isMounted) setPixError("Erro de conexão ao buscar o QR Code Pix.");
          } finally {
            if (isMounted) setLoadingPix(false);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao carregar cobrança.";
        if (isMounted) setError(msg);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchPaymentDetails();

    return () => {
      isMounted = false;
    };
  }, [refreshIndex]);

  function copyPixCode() {
    if (!pixData?.payload) return;
    navigator.clipboard.writeText(pixData.payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-96">
        <p className="text-stone-500 animate-pulse">Carregando detalhes do pagamento...</p>
      </div>
    );
  }

  const statusInfo = translatePaymentStatus(payment?.status ?? null);
  const formattedDueDate = payment?.dueDate
    ? new Date(payment.dueDate).toLocaleDateString("pt-BR")
    : null;
  const formattedExpiration = pixData?.expirationDate
    ? new Date(pixData.expirationDate).toLocaleString("pt-BR")
    : null;

  const imgSrc = pixData?.encodedImage
    ? pixData.encodedImage.startsWith("data:")
      ? pixData.encodedImage
      : `data:image/png;base64,${pixData.encodedImage}`
    : null;

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/admin/configuracoes/plano-cobranca"
            className="text-xs font-semibold uppercase tracking-wider text-amber-500 hover:text-amber-400 mb-2 inline-block transition-colors"
          >
            ← Voltar para Plano e cobrança
          </Link>
          <h1 className="text-2xl font-bold text-stone-100">Pagamento da Assinatura</h1>
          <p className="text-stone-400 text-sm mt-1">Conclua o pagamento para ativar seu acesso ao Tem Barber.</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          className="rounded-lg border border-stone-800 bg-stone-900 px-4 py-2 text-xs font-semibold text-stone-300 hover:bg-stone-800 transition-colors"
        >
          Atualizar situação
        </button>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-500/30 text-red-200 text-sm px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {!payment?.exists ? (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-8 text-center">
          <p className="text-stone-300 text-base font-semibold">Nenhuma cobrança em aberto encontrada.</p>
          <p className="text-stone-500 text-sm mt-2">
            Acesse a página de Plano e cobrança para gerenciar sua assinatura.
          </p>
          <Link
            href="/admin/configuracoes/plano-cobranca"
            className="mt-6 inline-block rounded-lg bg-amber-500 px-6 py-2.5 text-sm font-bold text-stone-950 hover:bg-amber-400 transition-colors"
          >
            Ir para Plano e cobrança
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Card Resumo */}
          <section className="bg-stone-900 border border-stone-800 rounded-xl p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <span className={`inline-block px-3 py-1 text-xs font-bold rounded-full border mb-3 ${statusInfo.color}`}>
                  {statusInfo.label}
                </span>
                <h2 className="text-xl font-bold text-stone-100">Plano Tem Barber</h2>
                <p className="text-stone-400 text-sm mt-1">Assinatura mensal recorrente.</p>
              </div>
              <div className="md:text-right">
                <p className="text-3xl font-bold text-amber-400">R$ {payment.value ?? "49,90"}</p>
                {formattedDueDate && (
                  <p className="text-xs text-stone-400 mt-1">Vencimento: {formattedDueDate}</p>
                )}
              </div>
            </div>

            <div className="mt-6 border-t border-stone-800/80 pt-4 flex flex-wrap gap-4 text-xs text-stone-400">
              <div>
                <span className="text-stone-500">Forma de pagamento:</span>{" "}
                <strong className="text-stone-200">{payment.billingType === "PIX" ? "PIX" : "Boleto"}</strong>
              </div>
              {payment.invoiceUrl && (
                <div>
                  <a
                    href={payment.invoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amber-400 underline hover:text-amber-300"
                  >
                    Abrir fatura completa no Asaas ↗
                  </a>
                </div>
              )}
            </div>
          </section>

          {/* Area PIX */}
          {payment.billingType === "PIX" && payment.canPay && (
            <section className="bg-stone-900 border border-stone-800 rounded-xl p-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-amber-500 mb-4">
                Pagamento via PIX
              </h2>

              {loadingPix ? (
                <div className="p-8 text-center text-stone-500 animate-pulse">
                  Gerando QR Code Pix...
                </div>
              ) : pixError ? (
                <div className="bg-red-950/30 border border-red-500/30 text-red-300 text-sm p-4 rounded-lg">
                  {pixError}
                  {payment.invoiceUrl && (
                    <div className="mt-3">
                      <a
                        href={payment.invoiceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-stone-950 inline-block hover:bg-amber-400"
                      >
                        Pagar fatura diretamente no Asaas ↗
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2 items-center">
                  <div className="flex flex-col items-center justify-center p-4 bg-stone-950 rounded-xl border border-stone-800">
                    {imgSrc ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={imgSrc} alt="QR Code Pix" className="w-56 h-56 rounded-lg bg-white p-2" />
                    ) : (
                      <p className="text-xs text-stone-500">QR Code indisponível.</p>
                    )}
                    {formattedExpiration && (
                      <p className="text-[11px] text-stone-400 mt-3 text-center">
                        Validade do QR Code: {formattedExpiration}
                      </p>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
                        Pix Copia e Cola
                      </label>
                      <textarea
                        readOnly
                        value={pixData?.payload ?? ""}
                        rows={4}
                        className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-xs text-stone-300 font-mono focus:outline-none resize-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={copyPixCode}
                      disabled={!pixData?.payload}
                      className="w-full rounded-lg bg-gradient-to-r from-amber-600 to-amber-500 px-6 py-3 text-sm font-bold text-stone-950 hover:from-amber-500 hover:to-amber-400 transition-all disabled:opacity-50"
                    >
                      {copied ? "✓ Código Pix copiado!" : "Copiar código Pix"}
                    </button>
                    <p className="text-xs text-stone-400">
                      Abra o aplicativo do seu banco, escolha <strong>Pix Copia e Cola</strong> ou escaneie o código QR acima.
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Area BOLETO */}
          {payment.billingType === "BOLETO" && payment.canPay && (
            <section className="bg-stone-900 border border-stone-800 rounded-xl p-6 space-y-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-amber-500">
                Pagamento via Boleto Bancário
              </h2>
              <p className="text-sm text-stone-300">
                Seu boleto foi gerado com vencimento em{" "}
                <strong className="text-stone-100">{formattedDueDate}</strong>.
              </p>
              <div className="flex flex-wrap gap-3">
                {payment.bankSlipUrl ? (
                  <a
                    href={payment.bankSlipUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-amber-500 px-6 py-3 text-sm font-bold text-stone-950 hover:bg-amber-400 transition-colors"
                  >
                    Abrir e imprimir boleto ↗
                  </a>
                ) : payment.invoiceUrl ? (
                  <a
                    href={payment.invoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-amber-500 px-6 py-3 text-sm font-bold text-stone-950 hover:bg-amber-400 transition-colors"
                  >
                    Visualizar fatura e boleto ↗
                  </a>
                ) : null}
              </div>
            </section>
          )}

          {/* Aviso de confirmacao */}
          <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-4 text-xs text-amber-300/90 leading-relaxed">
            💡 <strong>Ativação automática:</strong> Assim que a confirmação do pagamento for enviada pelo Asaas, seu plano será ativado imediatamente sem a necessidade de intervenção manual.
          </div>
        </div>
      )}
    </div>
  );
}
