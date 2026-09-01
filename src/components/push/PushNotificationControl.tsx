"use client";

import React from "react";
import { usePushLifecycle } from "@/components/providers/PushLifecycleProvider";

export function PushNotificationControl({ className = "" }: { className?: string }) {
  const { state, error, publicKey, subscribe, unsubscribe } = usePushLifecycle();

  if (state === "UNSUPPORTED") {
    return (
      <div className={`text-xs text-muted-foreground ${className}`}>
        Navegador sem suporte a notificações push.
      </div>
    );
  }

  if (state === "NOT_INSTALLED_IOS") {
    return (
      <div className={`p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 ${className}`}>
        Adicione o Tem Barber à Tela de Início para ativar notificações.
      </div>
    );
  }

  if (state === "AUTH_INELIGIBLE" || state === "SIGNED_OUT") {
    return (
      <div className={`text-xs text-muted-foreground ${className}`}>
        Notificações push requerem autenticação administrativa ou verificada.
      </div>
    );
  }

  if (state === "DENIED") {
    return (
      <div className={`text-xs text-red-400 ${className}`}>
        Notificações bloqueadas nas configurações do navegador.
      </div>
    );
  }

  if (state === "ACTIVE") {
    return (
      <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 ${className}`}>
        <div>
          <p className="text-sm font-medium text-emerald-400">Notificações ativadas</p>
          <p className="text-xs text-muted-foreground mt-0.5">Você receberá alertas neste dispositivo.</p>
        </div>
        <button
          type="button"
          onClick={unsubscribe}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-secondary hover:bg-secondary/80 text-foreground transition-colors"
        >
          Desativar neste dispositivo
        </button>
      </div>
    );
  }

  const isPending = state === "REQUESTING" || state === "SUBSCRIBING";
  const isConfigLoading = state === "CONFIG_LOADING" || (!publicKey && error !== "PUSH_NOT_CONFIGURED");

  return (
    <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-lg bg-card border ${className}`}>
      <div>
        <p className="text-sm font-medium text-foreground">Notificações Push</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Receba notificações em tempo real sobre agendamentos e fila.
        </p>
        {error === "PUSH_NOT_CONFIGURED" && (
          <p className="text-xs text-amber-400 mt-1">Notificações temporariamente indisponíveis no servidor.</p>
        )}
      </div>
      <button
        type="button"
        disabled={isPending || isConfigLoading || error === "PUSH_NOT_CONFIGURED"}
        onClick={subscribe}
        className="px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {isPending ? "Ativando..." : isConfigLoading ? "Carregando..." : "Ativar notificações"}
      </button>
    </div>
  );
}
