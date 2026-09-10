"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  loadFacebookSdk,
  launchCoexistenceEmbeddedSignup,
} from "@/lib/meta/whatsapp/embedded-signup";

interface ConnectionDetails {
  id: string;
  connectionMode: string;
  businessId?: string | null;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
  qualityRating?: string | null;
  wabaReviewStatus?: string | null;
  status: string;
  connectedAt?: string | null;
  systemUserAssignedAt?: string | null;
  webhookSubscribedAt?: string | null;
  phoneRegisteredAt?: string | null;
  lastHealthCheckAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MetaStatusResponse {
  configured: boolean;
  status: string;
  connection: ConnectionDetails | null;
  systemReadiness: {
    ready: boolean;
    activeKeyVersion: string;
  };
}

export default function MetaWhatsappSettingsPage() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [statusData, setStatusData] = useState<MetaStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const userRole = (session?.user as { role?: string })?.role || "OWNER";
  const isOwner = userRole === "OWNER";

  const fetchStatus = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/admin/integrations/meta/whatsapp/status");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao consultar status do WhatsApp.");
      }
      setStatusData(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Não foi possível carregar o status da conexão.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        const res = await fetch("/api/admin/integrations/meta/whatsapp/status");
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Erro ao consultar status do WhatsApp.");
        }
        if (isMounted) {
          setStatusData(data);
        }
      } catch (err) {
        if (isMounted) {
          const msg = err instanceof Error ? err.message : "Não foi possível carregar o status da conexão.";
          setError(msg);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleStartConnection() {
    if (!isOwner) {
      setError("Apenas o proprietário da barbearia pode iniciar a conexão.");
      return;
    }

    setConnecting(true);
    setError(null);
    setSuccess(null);

    try {
      // 1. Request secure onboarding session
      const sessionRes = await fetch(
        "/api/admin/integrations/meta/whatsapp/onboarding/session",
        { method: "POST" }
      );
      const sessionJson = await sessionRes.json();
      if (!sessionRes.ok) {
        throw new Error(sessionJson.error || "Falha ao iniciar sessão de conexão.");
      }

      const { sessionId, nonce, appId, configId, graphApiVersion } = sessionJson;
      if (
        typeof graphApiVersion !== "string" ||
        graphApiVersion.trim() === ""
      ) {
        throw new Error("Versão da Graph API não fornecida pelo servidor.");
      }

      // 2. Load SDK with explicit server-provided Graph API version
      await loadFacebookSdk(appId, graphApiVersion);

      // 3. Launch Embedded Signup
      launchCoexistenceEmbeddedSignup({
        appId,
        configId,
        nonce,
        onComplete: async (completionData) => {
          try {
            // 4. Send code & hints to completion endpoint
            const completeRes = await fetch(
              "/api/admin/integrations/meta/whatsapp/onboarding/complete",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  sessionId,
                  nonce,
                  code: completionData.code,
                  wabaIdHint: completionData.wabaIdHint,
                  phoneNumberIdHint: completionData.phoneNumberIdHint,
                  completionMetadata: completionData.metadata,
                }),
              }
            );

            const completeJson = await completeRes.json();
            if (!completeRes.ok) {
              throw new Error(
                completeJson.error || "Erro ao concluir vinculação do WhatsApp."
              );
            }

            setSuccess("WhatsApp conectado com sucesso!");
            await fetchStatus();
          } catch (compErr) {
            const msg = compErr instanceof Error ? compErr.message : "Falha ao concluir integração.";
            setError(msg);
          } finally {
            setConnecting(false);
          }
        },
        onCancel: () => {
          setConnecting(false);
        },
        onError: (sdkErr) => {
          setError(sdkErr.message || "Erro no popup de conexão do WhatsApp.");
          setConnecting(false);
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao preparar conexão.";
      setError(msg);
      setConnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 md:p-8 flex items-center justify-center min-h-[400px]">
        <p className="text-stone-400 animate-pulse text-sm">
          Carregando status da integração WhatsApp...
        </p>
      </div>
    );
  }

  const isServerReady = Boolean(statusData?.systemReadiness?.ready);
  const conn = statusData?.connection;
  const rawStatus =
    conn?.status || statusData?.status || (statusData?.configured ? "CONNECTED" : "NOT_CONFIGURED");

  let displayState:
    | "SERVER_NOT_CONFIGURED"
    | "NOT_CONFIGURED"
    | "READY_TO_CONNECT"
    | "CONNECTING"
    | "CONNECTED"
    | "DEGRADED"
    | "FAILED" = "NOT_CONFIGURED";

  if (!isServerReady) {
    displayState = "SERVER_NOT_CONFIGURED";
  } else if (connecting) {
    displayState = "CONNECTING";
  } else if (rawStatus === "CONNECTED" && conn) {
    displayState = "CONNECTED";
  } else if (rawStatus === "DEGRADED") {
    displayState = "DEGRADED";
  } else if (rawStatus === "FAILED") {
    displayState = "FAILED";
  } else {
    displayState = "READY_TO_CONNECT";
  }

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-100">WhatsApp Oficial (Meta)</h1>
        <p className="text-stone-400 text-sm mt-1">
          Integração oficial via WhatsApp Cloud API em modo de coexistência com o aplicativo móvel.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 bg-red-950/40 border border-red-800 text-red-300 text-sm px-4 py-3 rounded-lg flex items-start gap-3"
        >
          <span className="font-bold">Atenção:</span>
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div
          role="status"
          className="mb-6 bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-sm px-4 py-3 rounded-lg flex items-start gap-3"
        >
          <span className="font-bold">Sucesso:</span>
          <span>{success}</span>
        </div>
      )}

      <div className="bg-stone-900 border border-stone-800 rounded-xl p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-stone-800">
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold text-stone-400 mb-1">
              Status da Conexão
            </div>
            <div className="flex items-center gap-3">
              {displayState === "CONNECTED" && (
                <>
                  <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-lg font-bold text-emerald-400">CONECTADO</span>
                </>
              )}
              {displayState === "CONNECTING" && (
                <>
                  <span className="h-3 w-3 rounded-full bg-amber-500 animate-ping" />
                  <span className="text-lg font-bold text-amber-400">CONECTANDO...</span>
                </>
              )}
              {displayState === "READY_TO_CONNECT" && (
                <>
                  <span className="h-3 w-3 rounded-full bg-stone-500" />
                  <span className="text-lg font-bold text-stone-300">PRONTO PARA CONECTAR</span>
                </>
              )}
              {displayState === "SERVER_NOT_CONFIGURED" && (
                <>
                  <span className="h-3 w-3 rounded-full bg-amber-600" />
                  <span className="text-lg font-bold text-amber-500">
                    SERVIDOR NÃO CONFIGURADO
                  </span>
                </>
              )}
              {displayState === "DEGRADED" && (
                <>
                  <span className="h-3 w-3 rounded-full bg-amber-500" />
                  <span className="text-lg font-bold text-amber-400">REQUER ATENÇÃO</span>
                </>
              )}
              {displayState === "FAILED" && (
                <>
                  <span className="h-3 w-3 rounded-full bg-red-500" />
                  <span className="text-lg font-bold text-red-400">ERRO NA INTEGRAÇÃO</span>
                </>
              )}
            </div>
          </div>

          <div>
            {displayState === "CONNECTED" ? (
              isOwner ? (
                <button
                  type="button"
                  onClick={handleStartConnection}
                  disabled={connecting}
                  className="px-4 py-2.5 bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-medium rounded-lg transition-colors border border-stone-700 disabled:opacity-50"
                >
                  {connecting ? "Reconectando..." : "Reconectar Conta"}
                </button>
              ) : null
            ) : isOwner ? (
              <button
                type="button"
                onClick={handleStartConnection}
                disabled={connecting || !isServerReady}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition-colors shadow-lg shadow-emerald-950/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {connecting ? "Conectando..." : "Conectar WhatsApp"}
              </button>
            ) : (
              <div className="text-xs text-stone-500 italic max-w-xs text-right">
                Apenas o proprietário (OWNER) pode iniciar ou reconectar o WhatsApp.
              </div>
            )}
          </div>
        </div>

        {/* Coexistence Information Card */}
        <div className="mt-6">
          <div className="text-xs uppercase tracking-wider font-semibold text-stone-400 mb-3">
            Modo de Operação
          </div>
          <div className="bg-stone-950 border border-stone-800/80 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-stone-200">
                Coexistência com WhatsApp Business App
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                COEXISTENCE
              </span>
            </div>
            <p className="text-xs text-stone-400 leading-relaxed">
              Sua barbearia continua utilizando o aplicativo móvel oficial do WhatsApp no
              celular normalmente, enquanto o Tem Barber opera em paralelo na nuvem para
              automações e notificações.
            </p>
          </div>
        </div>

        {/* Connection Details when connected */}
        {conn && displayState === "CONNECTED" && (
          <div className="mt-6 pt-6 border-t border-stone-800 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-xs text-stone-500 uppercase tracking-wider block mb-1">
                Número Conectado
              </span>
              <span className="font-mono text-stone-200">
                {conn.displayPhoneNumber || "Não informado"}
              </span>
            </div>
            <div>
              <span className="text-xs text-stone-500 uppercase tracking-wider block mb-1">
                Nome Verificado
              </span>
              <span className="text-stone-200">
                {conn.verifiedName || "Em análise / Padrão"}
              </span>
            </div>
            <div>
              <span className="text-xs text-stone-500 uppercase tracking-wider block mb-1">
                Qualidade da Conta
              </span>
              <span className="text-emerald-400 font-medium">
                {conn.qualityRating || "GREEN"}
              </span>
            </div>
            <div>
              <span className="text-xs text-stone-500 uppercase tracking-wider block mb-1">
                Conectado em
              </span>
              <span className="text-stone-300">
                {conn.connectedAt
                  ? new Date(conn.connectedAt).toLocaleString("pt-BR")
                  : "Recente"}
              </span>
            </div>
          </div>
        )}

        {/* Degraded error details */}
        {displayState === "DEGRADED" && conn?.lastErrorMessage && (
          <div className="mt-6 pt-6 border-t border-stone-800 text-sm text-amber-300">
            <span className="text-xs uppercase tracking-wider block mb-1 text-amber-400 font-semibold">
              Último Alerta do Provedor
            </span>
            <p className="font-mono text-xs bg-amber-950/30 p-3 rounded border border-amber-900/50">
              {conn.lastErrorMessage}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
