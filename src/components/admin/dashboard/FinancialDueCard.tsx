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

export function FinancialDueCard({
  summary,
  items,
  canAccessFinancial,
}: FinancialDueCardProps) {
  if (!canAccessFinancial) {
    return null;
  }

  return (
    <DashboardCard
      variant="elevated"
      className="p-5 border-[#D3AE55]/20 bg-gradient-to-b from-[#1C1E24] to-[#16181D]"
    >
      <SectionHeader
        title="Contas a vencer"
        subtitle="Obrigações e títulos a pagar"
        icon={
          <svg
            className="w-4 h-4 text-[#D3AE55]"
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
        }
        action={
          <Link
            href="/admin/financeiro/contas?kind=PAYABLE"
            className="text-xs font-semibold text-[#D3AE55] hover:text-[#E8C76E] transition-colors flex items-center gap-1 cursor-pointer"
          >
            Ver todas
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
        }
      />

      {/* 3 Metric Pills: Atrasadas, Vencem hoje, Próximos 7 dias */}
      <div className="grid grid-cols-3 gap-2.5 mb-5">
        {/* Atrasadas */}
        <div
          className={`p-3 rounded-xl border flex flex-col justify-between ${
            summary.overdueCount > 0
              ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
              : "bg-white/[0.03] border-white/[0.06] text-zinc-400"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wider">
              Atrasadas
            </span>
            {summary.overdueCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            )}
          </div>
          <p className="font-serif text-lg sm:text-xl font-bold mt-1 text-white tabular-nums">
            {summary.overdueCount}
          </p>
          <span className="text-[11px] font-medium text-rose-400 truncate">
            {formatCentsToBRL(summary.overdueAmountCents)}
          </span>
        </div>

        {/* Vencem hoje */}
        <div
          className={`p-3 rounded-xl border flex flex-col justify-between ${
            summary.todayCount > 0
              ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
              : "bg-white/[0.03] border-white/[0.06] text-zinc-400"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wider">
              Hoje
            </span>
            {summary.todayCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-400" />
            )}
          </div>
          <p className="font-serif text-lg sm:text-xl font-bold mt-1 text-white tabular-nums">
            {summary.todayCount}
          </p>
          <span className="text-[11px] font-medium text-amber-300 truncate">
            {formatCentsToBRL(summary.todayAmountCents)}
          </span>
        </div>

        {/* Próximos 7 dias */}
        <div className="p-3 rounded-xl border bg-white/[0.03] border-white/[0.06] flex flex-col justify-between text-zinc-400">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wider">
              7 dias
            </span>
          </div>
          <p className="font-serif text-lg sm:text-xl font-bold mt-1 text-white tabular-nums">
            {summary.next7DaysCount}
          </p>
          <span className="text-[11px] font-medium text-zinc-300 truncate">
            {formatCentsToBRL(summary.next7DaysAmountCents)}
          </span>
        </div>
      </div>

      {/* List of upcoming items */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 px-1">
          Próximos vencimentos
        </p>

        {items.length === 0 ? (
          <DashboardEmptyState
            title="Nenhuma conta pendente"
            description="Todas as contas a pagar estão em dia."
          />
        ) : (
          <div className="space-y-1.5">
            {items.slice(0, 5).map((item) => {
              const isOverdue = item.derivedStatus === "OVERDUE";
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05] transition-colors"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-white truncate">
                        {item.title}
                      </p>
                      {item.categoryName && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-400 truncate hidden sm:inline-block">
                          {item.categoryName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className={`text-[11px] font-mono tabular-nums ${
                          isOverdue ? "text-rose-400 font-semibold" : "text-zinc-400"
                        }`}
                      >
                        Vence {formatCivilDateBR(item.dueOnCivil)}
                      </span>
                      {isOverdue && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 font-bold uppercase tracking-wider">
                          Atrasada
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-xs font-bold text-white tabular-nums">
                      {formatCentsToBRL(item.outstandingPrincipalCents)}
                    </span>
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
