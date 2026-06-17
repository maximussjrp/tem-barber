"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";

interface SidebarProps {
  barbershopName: string;
  userName: string;
}

// SVG icons
const Icons = {
  dashboard: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  calendar: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
  clients: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
      <circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
  scissors: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
      <line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/>
      <line x1="8.12" y1="8.12" x2="12" y2="12"/>
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  ),
  logout: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  chevron: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
};

const navItems = [
  { label: "Dashboard",     href: "/admin/dashboard",    icon: Icons.dashboard, children: [] },
  { label: "Agendamentos",  href: "/admin/agendamentos", icon: Icons.calendar,  children: [] },
  { label: "Comandas",      href: "/admin/comandas",     icon: Icons.calendar,  children: [] },
  { label: "Clientes",      href: "/admin/clientes",     icon: Icons.clients,   children: [] },
  { label: "Produtos",      href: "/admin/produtos",     icon: Icons.scissors,  children: [] },
  { label: "Caixa",         href: "/admin/caixa",        icon: Icons.dashboard, children: [] },
  { label: "Financeiro",    href: "/admin/financeiro",   icon: Icons.dashboard, children: [] },
  {
    label: "Serviços",
    href: "/admin/servicos",
    icon: Icons.scissors,
    children: [
      { label: "Catálogo",    href: "/admin/servicos" },
      { label: "Categorias",  href: "/admin/servicos/categorias" },
    ],
  },
  {
    label: "Configurações",
    href: "/admin/configuracoes",
    icon: Icons.settings,
    children: [
      { label: "Geral",     href: "/admin/configuracoes" },
      { label: "Horários",  href: "/admin/configuracoes/horarios" },
      { label: "Equipe",    href: "/admin/equipe" },
    ],
  },
];

export function AdminSidebar({ barbershopName, userName }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isGroupActive = (item: (typeof navItems)[number]) =>
    pathname.startsWith(item.href) ||
    item.children.some((c) => pathname.startsWith(c.href));
  const isExact = (href: string) => pathname === href;

  // Track open/closed state for each expandable group
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const item of navItems) {
      if (item.children.length > 0) initial[item.href] = false;
    }
    return initial;
  });

  const toggleGroup = (href: string) =>
    setOpenGroups((prev) => ({ ...prev, [href]: !prev[href] }));

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-[var(--surface-1)] border-r border-[var(--border-subtle)]">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--gold-surface)] border border-[var(--gold-border)] flex items-center justify-center shrink-0">
            <span className="font-serif font-bold text-[var(--gold)] text-sm">MB</span>
          </div>
          <div className="min-w-0">
            <p className="font-serif text-sm font-bold text-[var(--gold)] tracking-wide leading-tight truncate">
              MATCH BARBER
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{barbershopName}</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isOpen = openGroups[item.href];
          const active = isGroupActive(item);
          return (
          <div key={item.href}>
            {item.children.length > 0 ? (
              <>
                <button
                  onClick={() => toggleGroup(item.href)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    active
                      ? "text-[var(--gold)] bg-[var(--gold-surface)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <span className={active ? "text-[var(--gold)]" : "text-[var(--text-muted)]"}>{item.icon}</span>
                  <span className="flex-1 text-left text-xs uppercase tracking-widest font-bold">
                    {item.label}
                  </span>
                  <span className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""} text-[var(--text-muted)]`}>
                    {Icons.chevron}
                  </span>
                </button>
                {isOpen && (
                  <div className="ml-9 space-y-0.5 mb-1 mt-0.5">
                    {item.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center px-3 py-2 rounded-lg text-xs transition-all font-medium ${
                          isExact(child.href)
                            ? "bg-[var(--gold-surface)] text-[var(--gold)] border border-[var(--gold-border)]"
                            : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]"
                        }`}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <Link
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isExact(item.href)
                    ? "bg-[var(--gold-surface)] text-[var(--gold)] border border-[var(--gold-border)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-secondary)]"
                }`}
              >
                <span className={isExact(item.href) ? "text-[var(--gold)]" : "text-[var(--text-muted)]"}>{item.icon}</span>
                {item.label}
              </Link>
            )}
          </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-[var(--border-subtle)]">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-7 h-7 rounded-lg bg-[var(--surface-3)] flex items-center justify-center text-xs font-bold text-[var(--text-secondary)] font-serif shrink-0">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--text-secondary)] truncate">{userName}</p>
            <p className="text-[10px] text-[var(--text-muted)]">Administrador</p>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          {Icons.logout}
          Sair
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        className="fixed top-4 left-4 z-50 md:hidden bg-[var(--surface-2)] border border-[var(--border-medium)] p-2 rounded-xl text-[var(--text-secondary)]"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Abrir menu"
      >
        {mobileOpen ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        )}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-40 md:hidden backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-[var(--surface-1)] z-40 transition-transform duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* eslint-disable-next-line react-hooks/static-components */}
        <SidebarContent />
      </aside>
    </>
  );
}
