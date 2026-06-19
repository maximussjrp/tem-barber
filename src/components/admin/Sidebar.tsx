"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { IconButton } from "@/components/ui/IconButton";

interface SidebarProps {
  barbershopName: string;
  barbershopLogo?: string | null;
  subtitle?: string | null;
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
    label: "Comissões",
    href: "/admin/comissoes",
    icon: Icons.dashboard,
    children: [
      { label: "Geral", href: "/admin/comissoes" },
      { label: "Configuracoes", href: "/admin/comissoes/configuracoes" },
      { label: "Periodos", href: "/admin/comissoes/periodos" },
    ],
  },
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

export function AdminSidebar({ barbershopName, barbershopLogo, subtitle, userName }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isGroupActive = (item: (typeof navItems)[number]) =>
    pathname.startsWith(item.href) ||
    item.children.some((c) => pathname.startsWith(c.href));
  const isExact = (href: string) => pathname === href;

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const item of navItems) {
      if (item.children.length > 0) {
        initial[item.href] =
          pathname.startsWith(item.href) ||
          item.children.some((c) => pathname.startsWith(c.href));
      }
    }
    return initial;
  });

  const toggleGroup = (href: string) =>
    setOpenGroups((prev) => ({ ...prev, [href]: !prev[href] }));

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-surface border-r border-border-subtle">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          {barbershopLogo ? (
            <img src={barbershopLogo} alt={barbershopName} className="w-9 h-9 rounded-xl object-contain p-0.5 bg-surface-raised shrink-0 border border-border-subtle" />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-surface-raised border border-border-subtle flex items-center justify-center shrink-0 shadow-sm">
              <span className="font-serif font-bold text-text-primary text-sm">
                {barbershopName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="min-w-0">
            <p className="font-serif text-sm font-bold text-text-primary tracking-wide leading-tight truncate">
              {barbershopName}
            </p>
            <p className="text-[11px] text-text-muted mt-0.5 truncate">{subtitle || "Painel de Gestão"}</p>
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
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    active
                      ? "text-brand bg-brand-subtle"
                      : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
                  }`}
                >
                  <span className={active ? "text-brand" : "text-text-muted"}>{item.icon}</span>
                  <span className="flex-1 text-left text-xs uppercase tracking-widest font-bold">
                    {item.label}
                  </span>
                  <span className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""} text-text-muted`}>
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
                        className={`flex items-center px-3 py-2 rounded-lg text-xs transition-colors font-medium ${
                          isExact(child.href)
                            ? "bg-brand-subtle text-brand font-bold"
                            : "text-text-muted hover:bg-surface-hover hover:text-text-secondary"
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
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isExact(item.href)
                    ? "bg-brand-subtle text-brand font-bold"
                    : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
                }`}
              >
                <span className={isExact(item.href) ? "text-brand" : "text-text-muted"}>{item.icon}</span>
                {item.label}
              </Link>
            )}
          </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-border-subtle">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-7 h-7 rounded-lg bg-surface-raised flex items-center justify-center text-xs font-bold text-text-secondary font-serif shrink-0">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-secondary truncate">{userName}</p>
            <p className="text-[10px] text-text-muted">Administrador</p>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-text-muted hover:text-danger hover:bg-danger-subtle transition-colors mb-3"
        >
          {Icons.logout}
          Sair
        </button>
        <div className="text-center pb-1">
          <p className="text-[9px] text-text-muted/40 uppercase tracking-widest font-semibold">
            Powered by <span className="text-text-muted/60">Match Barber</span>
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 bg-surface border-b border-border-subtle">
        <div className="flex items-center gap-2 min-w-0 pr-4">
          {barbershopLogo ? (
            <img src={barbershopLogo} alt={barbershopName} className="w-8 h-8 rounded-lg object-contain p-0.5 bg-surface-raised shrink-0 border border-border-subtle" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-surface-raised border border-border-subtle flex items-center justify-center shrink-0 shadow-sm">
              <span className="font-serif font-bold text-text-primary text-xs">
                {barbershopName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <p className="font-serif text-sm font-bold text-text-primary tracking-wide truncate">
            {barbershopName}
          </p>
        </div>
        <IconButton
          variant="ghost"
          onClick={() => setMobileOpen(true)}
          className="text-text-secondary"
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          }
          aria-label="Abrir menu"
        />
      </div>

      {/* Mobile Drawer using new Sheet component */}
      <Sheet
        isOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        side="left"
        title="Menu principal"
        description="Navegação administrativa"
      >
        {renderSidebarContent()}
      </Sheet>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed top-0 left-0 h-full w-64 flex-col bg-surface border-r border-border-subtle z-30">
        {renderSidebarContent()}
      </aside>
    </>
  );
}

