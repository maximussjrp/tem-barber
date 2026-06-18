"use client";

type Item = {
  id: string;
  type: string;
  status: string;
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
  executor?: { id: string; user: { name: string } } | null;
};

interface Props {
  item: Item;
  busy: boolean;
  comandaClosed: boolean;
  onConclude: (id: string) => void;
  onCancel: (id: string) => void;
}

export function ComandaItemCard({ item, busy, comandaClosed, onConclude, onCancel }: Props) {
  function brl(value: string | number) {
    return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  const isDone = item.status === "DONE";
  const isCancelled = item.status === "CANCELLED";

  return (
    <div className={`p-4 border-b border-stone-800 flex flex-col md:flex-row md:items-center justify-between gap-4 ${isCancelled ? 'opacity-50' : ''}`}>
      <div className="flex-1">
        <h3 className="font-semibold text-stone-100">{item.description}</h3>
        <p className="text-xs text-stone-400 mt-1">
          {item.type === "SERVICE" ? "Serviço" : item.type === "PRODUCT" ? "Produto" : item.type === "DISCOUNT" ? "Desconto" : "Acréscimo"} 
          {" • "}
          <span className={item.status === "DONE" ? "text-emerald-400" : item.status === "CANCELLED" ? "text-red-400" : "text-amber-400"}>
            {item.status === "DONE" ? "Concluído" : item.status === "CANCELLED" ? "Cancelado" : "Pendente"}
          </span>
          {item.executor && ` • ${item.executor.user.name}`}
        </p>
        {(item.type === "SERVICE" || item.type === "PRODUCT") && (
          <p className="text-xs text-stone-500 mt-1">
            {Number(item.quantity)}x {brl(item.unitPrice)}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between md:justify-end gap-4 w-full md:w-auto">
        <span className="font-bold text-stone-100">{item.type === "DISCOUNT" ? "-" : ""}{brl(item.total)}</span>
        
        <div className="flex items-center gap-2">
          {!isDone && !isCancelled && !comandaClosed && item.type !== "DISCOUNT" && item.type !== "SURCHARGE" && (
            <button
              disabled={busy}
              onClick={() => onConclude(item.id)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
            >
              Concluir
            </button>
          )}
          {!isCancelled && !comandaClosed && (
            <button
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Tem certeza que deseja cancelar "${item.description}"?`)) {
                  onCancel(item.id);
                }
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
