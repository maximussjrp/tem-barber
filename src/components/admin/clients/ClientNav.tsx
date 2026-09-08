"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";

export function ClientNav() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const role = (session?.user as { role?: string } | undefined)?.role;
  const isPlatform = role === "SUPER_ADMIN";
  const canAccessReactivation = !role || isPlatform || role === "OWNER" || role === "MANAGER";

  const tabs = [
    { label: "Base de clientes", href: "/admin/clientes", exact: true },
  ];

  if (canAccessReactivation) {
    tabs.push({ label: "Reativação", href: "/admin/clientes/reativacao", exact: false });
  }

  return (
    <nav aria-label="Navegação de Clientes" className="flex flex-wrap gap-2 border-b border-[var(--border-subtle)] pb-3 mb-6">
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
