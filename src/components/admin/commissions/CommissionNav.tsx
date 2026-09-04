"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function CommissionNav() {
  const pathname = usePathname();

  const tabs = [
    { label: "Visão Geral", href: "/admin/comissoes", exact: true },
    { label: "Pagamento de Comissões", href: "/admin/comissoes/pagamentos" },
    { label: "Configurações", href: "/admin/comissoes/configuracoes" },
  ];

  return (
    <nav aria-label="Navegação de Comissões" className="flex flex-wrap gap-2 border-b border-[var(--border-subtle)] pb-3 mb-6">
      {tabs.map((tab) => {
        const isActive = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname?.startsWith(tab.href + "/");

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? "bg-[var(--gold)] text-[var(--text-inverse)] font-semibold shadow-sm"
                : "bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
