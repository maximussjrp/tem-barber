"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";

interface MemberNavProps {
  barbershopName: string;
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
  { label: "Meu Perfil", href: "/member/perfil", icon: "👤" },
];

export function MemberNav({ barbershopName, memberName, avatarUrl, role }: MemberNavProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="px-6 py-5 border-b border-stone-800">
        <p className="font-serif text-lg font-bold text-amber-500 tracking-wide leading-tight">
          MATCH BARBER
        </p>
        <p className="text-xs text-stone-500 mt-0.5 truncate">{barbershopName}</p>
      </div>

      {/* Member identity */}
      <div className="px-6 py-4 border-b border-stone-800 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center overflow-hidden shrink-0">
          {avatarUrl ? (
            <img src={avatarUrl} alt={memberName} className="w-full h-full object-cover" />
          ) : (
            <span className="text-stone-400 text-lg font-bold">
              {memberName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-100 truncate">{memberName}</p>
          <p className="text-xs text-amber-500/80">{ROLE_LABELS[role] ?? role}</p>
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
                  ? "bg-amber-500/10 text-amber-400"
                  : "text-stone-400 hover:bg-stone-800/60 hover:text-stone-200"
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-stone-800 space-y-1">
        <Link
          href="/admin/dashboard"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-stone-500 hover:bg-stone-800/60 hover:text-stone-300 transition-colors"
        >
          <span>⚙️</span>
          <span>Painel Admin</span>
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-stone-500 hover:bg-red-950/40 hover:text-red-400 transition-colors"
        >
          <span>🚪</span>
          <span>Sair</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 bg-stone-950 border-b border-stone-800">
        <p className="font-serif text-base font-bold text-amber-500 tracking-wide">
          MATCH BARBER
        </p>
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 text-stone-400 hover:text-stone-100 transition-colors"
          title="Abrir menu"
        >
          ☰
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/60"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`md:hidden fixed top-0 left-0 h-full w-64 z-50 bg-stone-950 border-r border-stone-800 transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute top-4 right-4 text-stone-500 hover:text-stone-200 transition-colors"
          title="Fechar menu"
        >
          ✕
        </button>
        <SidebarContent />
      </aside>

      {/* Desktop fixed sidebar */}
      <aside className="hidden md:flex fixed top-0 left-0 h-full w-64 flex-col bg-stone-950 border-r border-stone-800 z-30">
        <SidebarContent />
      </aside>
    </>
  );
}
