interface ClubStatusBadgeProps {
  status: string;
  type?: "subscription" | "settlement" | "payment" | "usage";
}

const SUBSCRIPTION_LABELS: Record<string, { label: string; cls: string }> = {
  ACTIVE:       { label: "Ativo",         cls: "badge-confirmed" },
  GRACE_PERIOD: { label: "Carência",      cls: "badge-progress" },
  PAST_DUE:     { label: "Em atraso",     cls: "badge-pending" },
  SUSPENDED:    { label: "Suspenso",      cls: "badge-cancelled" },
  CANCELED:     { label: "Cancelado",     cls: "badge-completed" },
  EXPIRED:      { label: "Expirado",      cls: "badge-noshow" },
};

const SETTLEMENT_LABELS: Record<string, { label: string; cls: string }> = {
  CALCULATED: { label: "Calculado",     cls: "badge-progress" },
  APPROVED:   { label: "Aprovado",      cls: "badge-confirmed" },
  PAID:       { label: "Pago",          cls: "badge-completed" },
  CANCELED:   { label: "Cancelado",     cls: "badge-cancelled" },
};

const PAYMENT_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING:   { label: "Pendente",   cls: "badge-pending" },
  PAID:      { label: "Pago",       cls: "badge-confirmed" },
  REFUNDED:  { label: "Estornado",  cls: "badge-noshow" },
  CANCELED:  { label: "Cancelado",  cls: "badge-cancelled" },
};

const USAGE_LABELS: Record<string, { label: string; cls: string }> = {
  APPLIED:  { label: "Aplicado",  cls: "badge-confirmed" },
  REVERSED: { label: "Revertido", cls: "badge-completed" },
};

export function ClubStatusBadge({ status, type = "subscription" }: ClubStatusBadgeProps) {
  const map =
    type === "settlement" ? SETTLEMENT_LABELS :
    type === "payment"    ? PAYMENT_LABELS :
    type === "usage"      ? USAGE_LABELS :
    SUBSCRIPTION_LABELS;

  const entry = map[status] ?? { label: status, cls: "badge-completed" };

  return (
    <span className={`badge ${entry.cls}`}>
      {entry.label}
    </span>
  );
}
