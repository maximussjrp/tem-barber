type AppStatus =
  | "PENDING"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

const config: Record<AppStatus, { label: string; cls: string; dotCls: string }> = {
  PENDING:     { label: "Pendente",       cls: "badge badge-pending",   dotCls: "bg-yellow-300" },
  CONFIRMED:   { label: "Confirmado",     cls: "badge badge-confirmed", dotCls: "bg-green-400" },
  IN_PROGRESS: { label: "Em atendimento", cls: "badge badge-progress",  dotCls: "bg-blue-400" },
  COMPLETED:   { label: "Concluído",      cls: "badge badge-completed", dotCls: "bg-gray-400" },
  CANCELLED:   { label: "Cancelado",      cls: "badge badge-cancelled", dotCls: "bg-red-400" },
  NO_SHOW:     { label: "Não compareceu", cls: "badge badge-noshow",    dotCls: "bg-violet-400" },
};

export function StatusBadge({ status }: { status: string }) {
  const c = config[status as AppStatus] ?? {
    label: status,
    cls: "badge badge-pending",
    dotCls: "bg-gray-400",
  };
  return (
    <span className={c.cls}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${c.dotCls}`} />
      {c.label}
    </span>
  );
}
