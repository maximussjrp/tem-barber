import React from "react";
import Link from "next/link";
import { DashboardCard, SectionHeader, DashboardEmptyState } from "./DashboardPrimitives";

export interface DueAccountSummary {
  overdueCount: number;
  overdueAmountCents: number;
  todayCount: number;
  todayAmountCents: number;
  next7DaysCount: number;
  next7DaysAmountCents: number;
}

export interface DueAccountItem {
  id: string;
  title: string;
  categoryName: string;
  dueOnCivil: string;
  outstandingPrincipalCents: number;
  derivedStatus: "OVERDUE" | "OPEN" | "PARTIAL" | "PAID" | "CANCELLED";
}

interface FinancialDueCardProps {
  summary: DueAccountSummary;
  items: DueAccountItem[];
  canAccessFinancial: boolean;
  civilToday?: string;
  compactMobile?: boolean;
}

function formatCentsToBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatCivilDateBR(civilDate: string): string {
  if (!civilDate || !/^\d{4}-\d{2}-\d{2}$/.test(civilDate)) return civilDate;
  const parts = civilDate.split("-");
  return `${parts[2]}/${parts[1]}`;
}

function getDaysDiff(fromCivil: string, toCivil: string): number | null {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromCivil) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(toCivil)
  ) {
    return null;
  }
  const [fy, fm, fd] = fromCivil.split("-").map(Number);
  const [ty, tm, td] = toCivil.split("-").map(Number);
  const t1 = Date.UTC(fy, fm - 1, fd);
  const t2 = Date.UTC(ty, tm - 1, td);
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

function DueItemCategoryIcon({
  title,
  categoryName,
}: {
  title: string;
  categoryName: string;
}) {
  const combined = `${title} ${categoryName}`.toLowerCase();

  if (combined.includes("energia") || combined.includes("luz") || combined.includes("cpfl")) {
    return (
      <svg
        className="w-4 h-4 text-[#E8C76E]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    );
  }

  if (combined.includes("aluguel") || combined.includes("ponto") || combined.includes("fixo")) {
    return (
      <svg
        className="w-4 h-4 text-[#E8C76E]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z" />
      </svg>
    );
  }

  if (combined.includes("internet") || combined.includes("wifi") || combined.includes("telefone")) {
    return (
      <svg
        className="w-4 h-4 text-[#E8C76E]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12.55a11 11 0 0 1 14.08 0" />
        <path d="M1.42 9a16 16 0 0 1 21.16 0" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
    );
  }

  if (combined.includes("sistema") || combined.includes("software") || combined.includes("mensalidade")) {
    return (
      <svg
        className="w-4 h-4 text-[#E8C76E]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    );
  }

  return (
    <svg
      className="w-4 h-4 text-[#E8C76E]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

export function FinancialDueCard({
  summary,
  items,
  canAccessFinancial,
  civilToday,
  compactMobile = false,
}: FinancialDueCardProps) {
  if (!canAccessFinancial) {
    return null;
  }

  return (
    <DashboardCard
      variant="danger"
      className="p-4 sm:p-5 h-full flex flex-col justify-between"
    >
      <div>
        <SectionHeader
          title="Contas a vencer"
          iconTone={compactMobile ? "red" : "gold"}
          icon={
            compactMobile ? (
              <svg
                className="w-4 h-4 text-[#EF5A67]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
            ) : (
              <svg
                className="w-4 h-4 text-[#E8C76E]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
            )
          }
          action={
            <Link
              href="/admin/financeiro/contas?kind=PAYABLE"
              className="text-xs font-semibold text-[#E8C76E] hover:text-[#F4DC92] transition-colors flex items-center gap-1 cursor-pointer"
            >
              Ver todas
              <span aria-hidden="true">→</span>
            </Link>
          }
        />

        {/* Desktop 3 Summary Boxes: Atrasadas, Hoje, Próximos 7 dias */}
        {!compactMobile && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {/* Atrasadas */}
            <div className="p-2.5 rounded-xl border bg-gradient-to-b from-[#2E171C] to-[#1D1316] border-[#DC4854]/45 flex flex-col justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-[#DC4854]/25 flex items-center justify-center text-[#FF6B78] shrink-0">
                  <svg
                    className="w-2.5 h-2.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <polyline points="12 7 12 12 15 14" />
                  </svg>
                </span>
                <span className="text-[10.5px] font-semibold text-zinc-200 whitespace-nowrap">
                  Atrasadas
                </span>
              </div>
              <p className="text-lg font-extrabold mt-1.5 text-white tabular-nums leading-none">
                {summary.overdueCount}
              </p>
              <span className="text-[11px] font-bold text-[#FF6B78] truncate mt-1 tabular-nums">
                {formatCentsToBRL(summary.overdueAmountCents)}
              </span>
            </div>

            {/* Hoje */}
            <div className="p-2.5 rounded-xl border bg-gradient-to-b from-[#282115] to-[#1A1713] border-[#D3AE55]/40 flex flex-col justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-md bg-[#D3AE55]/20 flex items-center justify-center text-[#E8C76E] shrink-0">
                  <svg
                    className="w-2.5 h-2.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </span>
                <span className="text-[10.5px] font-semibold text-zinc-200 whitespace-nowrap">
                  Hoje
                </span>
              </div>
              <p className="text-lg font-extrabold mt-1.5 text-white tabular-nums leading-none">
                {summary.todayCount}
              </p>
              <span className="text-[11px] font-bold text-[#E8C76E] truncate mt-1 tabular-nums">
                {formatCentsToBRL(summary.todayAmountCents)}
              </span>
            </div>

            {/* Próximos 7 dias */}
            <div className="p-2.5 rounded-xl border bg-[#1B1E24] border-white/[0.08] flex flex-col justify-between">
              <div className="flex items-center gap-1">
                <span className="w-4 h-4 rounded-md bg-white/[0.06] flex items-center justify-center text-zinc-400 shrink-0">
                  <svg
                    className="w-2.5 h-2.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </span>
                <span className="text-[10px] font-semibold text-zinc-300 whitespace-nowrap">
                  <span className="sr-only">7 dias</span>
                  <span aria-hidden="true">Próximos 7 dias</span>
                </span>
              </div>
              <p className="text-lg font-extrabold mt-1.5 text-white tabular-nums leading-none">
                {summary.next7DaysCount}
              </p>
              <span className="text-[11px] font-bold text-zinc-200 truncate mt-1 tabular-nums">
                {formatCentsToBRL(summary.next7DaysAmountCents)}
              </span>
            </div>
          </div>
        )}

        {/* List of upcoming items */}
        {items.length === 0 ? (
          <DashboardEmptyState
            title="Nenhuma conta pendente"
            description="Todas as contas a pagar estão em dia."
          />
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {items.slice(0, compactMobile ? 3 : 5).map((item) => {
              const isOverdue = item.derivedStatus === "OVERDUE";
              const diffDays = civilToday
                ? getDaysDiff(civilToday, item.dueOnCivil)
                : null;
              const isToday = !isOverdue && diffDays === 0;
              const isTomorrow = !isOverdue && diffDays === 1;

              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2.5 py-2.5 first:pt-1 last:pb-1"
                >
                  {/* Category Icon */}
                  <div className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0">
                    <DueItemCategoryIcon
                      title={item.title}
                      categoryName={item.categoryName}
                    />
                  </div>

                  {/* Title & Due status */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-bold text-white truncate">
                        {item.title}
                      </p>
                      {!compactMobile && item.categoryName && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.06] text-[#9CA3AF] truncate shrink-0">
                          {item.categoryName}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 mt-0.5">
                      {isOverdue ? (
                        <>
                          <span className="text-[11px] font-semibold text-[#FF6B78] tabular-nums">
                            {compactMobile
                              ? `Vence hoje • ${formatCivilDateBR(item.dueOnCivil)}`
                              : `Vence ${formatCivilDateBR(item.dueOnCivil)}`}
                          </span>
                          {!compactMobile && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#DC4854]/25 text-[#FF6B78] border border-[#DC4854]/40 font-semibold">
                              Atrasada
                            </span>
                          )}
                        </>
                      ) : isToday ? (
                        <span className="text-[11px] font-semibold text-[#E8C76E]">
                          {compactMobile
                            ? `Vence hoje • ${formatCivilDateBR(item.dueOnCivil)}`
                            : "Vence hoje"}
                        </span>
                      ) : isTomorrow ? (
                        <span className="text-[11px] text-[#9CA3AF]">
                          <strong className="text-[#E8C76E] font-semibold">
                            Vence amanhã
                          </strong>{" "}
                          · {formatCivilDateBR(item.dueOnCivil)}
                        </span>
                      ) : diffDays !== null && diffDays > 1 ? (
                        <span className="text-[11px] text-[#9CA3AF] tabular-nums">
                          Vence em {diffDays} dias ·{" "}
                          {formatCivilDateBR(item.dueOnCivil)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#9CA3AF] tabular-nums">
                          Vence {formatCivilDateBR(item.dueOnCivil)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right amount & badge/menu */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-extrabold text-white tabular-nums">
                      {formatCentsToBRL(item.outstandingPrincipalCents)}
                    </span>

                    {compactMobile ? (
                      isOverdue ? (
                        <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-[#DC4854]/20 text-[#FF6B78] border border-[#DC4854]/40">
                          Atrasada
                        </span>
                      ) : isToday ? (
                        <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-[#D3AE55]/20 text-[#E8C76E] border border-[#D3AE55]/40">
                          Vence hoje
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-white/[0.06] text-zinc-300 border border-white/[0.12]">
                          Em breve
                        </span>
                      )
                    ) : (
                      <Link
                        href="/admin/financeiro/contas?kind=PAYABLE"
                        aria-label={`Ver conta ${item.title}`}
                        className="text-zinc-500 hover:text-zinc-200 px-1 text-sm select-none"
                      >
                        ⋮
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
