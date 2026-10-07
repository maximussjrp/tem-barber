"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface FinancialNavItem {
  label: string;
  href: string;
  exact?: boolean;
}

export const FINANCIAL_NAV_ITEMS: FinancialNavItem[] = [
  { label: "Visão Geral", href: "/admin/financeiro", exact: true },
  { label: "Contas", href: "/admin/financeiro/contas" },
  { label: "Movimentações", href: "/admin/financeiro/movimentacoes" },
  { label: "Fluxo de Caixa", href: "/admin/financeiro/fluxo-caixa" },
  { label: "Contas Recorrentes", href: "/admin/financeiro/recorrentes" },
  { label: "Categorias", href: "/admin/financeiro/categorias" },
];

export function FinancialNav() {
  const pathname = usePathname() || "";

  const isItemActive = (item: FinancialNavItem) => {
    if (!pathname) return false;
    if (item.exact) {
      return pathname === item.href;
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  };

  return (
    <nav
      aria-label="Navegação do módulo financeiro"
      className="border-b border-[var(--border-subtle)] bg-[var(--surface)] -mx-4 md:-mx-6 px-4 md:px-6 mb-6"
    >
      <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar py-2">
        {FINANCIAL_NAV_ITEMS.map((item) => {
          const active = isItemActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`px-3.5 py-2 rounded-lg text-xs md:text-sm font-semibold whitespace-nowrap transition-all touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${
                active
                  ? "bg-[var(--surface-raised)] text-[var(--brand)] border border-[var(--border-subtle)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] border border-transparent"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
