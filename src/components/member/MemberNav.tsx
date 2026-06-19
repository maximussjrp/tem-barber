"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { IconButton } from "@/components/ui/IconButton";
import { Avatar } from "@/components/ui/Avatar";

interface MemberNavProps {
  barbershopName: string;
  barbershopLogo?: string | null;
  subtitle?: string | null;
  memberName: string;
  avatarUrl?: string | null;
  role: string;
}

const ROLE_LABELS: Record<string, string> = {
  BARBER: "Barbeiro",
  MANAGER: "Gerente",
  OWNER: "Proprietário",
};

const navItems = [
  { label: "Minha Agenda", href: "/member/agenda", icon: "📅" },
  { label: "Comissões", href: "/member/comissoes", icon: "R$" },
  { label: "Meu Perfil", href: "/member/perfil", icon: "👤" },
];

export function MemberNav({ barbershopName, barbershopLogo, subtitle, memberName, avatarUrl, role }: MemberNavProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

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
            <p className="text-[11px] text-text-muted mt-0.5 truncate">{subtitle || "Painel Profissional"}</p>
          </div>
        </div>
      </div>

      {/* Member identity */}
      <div className="px-5 py-4 border-b border-border-subtle flex items-center gap-3">
        <Avatar src={avatarUrl} alt={memberName} size="md" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{memberName}</p>
          <p className="text-xs text-text-secondary">{ROLE_LABELS[role] ?? role}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-brand-subtle text-brand font-bold border border-brand/20"
                  : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-border-subtle space-y-1">
        {(role === "OWNER" || role === "MANAGER") && (
          <Link
            href="/admin/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-text-muted hover:bg-surface-hover hover:text-text-primary transition-colors"
          >
            <span>⚙️</span>
            <span>Painel Admin</span>
          </Link>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-text-muted hover:bg-danger-subtle hover:text-danger transition-colors mb-3"
        >
          <span>🚪</span>
          <span>Sair</span>
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
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          }
          aria-label="Abrir menu"
        />
      </div>

      {/* Mobile drawer using Sheet component */}
      <Sheet
        isOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        side="left"
        title="Menu profissional"
        description="Acesso aos agendamentos e comissões"
      >
        {renderSidebarContent()}
      </Sheet>

      {/* Desktop fixed sidebar */}
      <aside className="hidden lg:flex fixed top-0 left-0 h-full w-64 flex-col bg-surface border-r border-border-subtle z-30">
        {renderSidebarContent()}
      </aside>
    </>
  );
}
