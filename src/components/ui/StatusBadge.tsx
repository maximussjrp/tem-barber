import React from "react";
import { Badge, BadgeProps } from "./Badge";

type StatusKey = 
  | "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW"
  | "OPEN" | "IN_SERVICE" | "PENDING_PAYMENT" | "PAID";

const config: Record<StatusKey, { label: string; variant: BadgeProps["variant"] }> = {
  PENDING:         { label: "Pendente", variant: "warning" },
  CONFIRMED:       { label: "Confirmado", variant: "success" },
  IN_PROGRESS:     { label: "Em atendimento", variant: "info" },
  COMPLETED:       { label: "Concluído", variant: "neutral" },
  CANCELLED:       { label: "Cancelado", variant: "danger" },
  NO_SHOW:         { label: "Não compareceu", variant: "danger" },
  
  OPEN:            { label: "Comanda aberta", variant: "neutral" },
  IN_SERVICE:      { label: "Atendimento iniciado", variant: "info" },
  PENDING_PAYMENT: { label: "Aguardando pagamento", variant: "warning" },
  PAID:            { label: "Pago", variant: "success" },
};

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const c = config[status as StatusKey] ?? {
    label: status,
    variant: "neutral",
  };
  
  return (
    <Badge variant={c.variant} className={className}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {c.label}
    </Badge>
  );
}

