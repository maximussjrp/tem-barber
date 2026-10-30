"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "./NavIcon";

interface MobileBottomNavigationProps {
  onOpenMenu: () => void;
  canAccessFinancial?: boolean;
}

export function MobileBottomNavigation({
  onOpenMenu,
  canAccessFinancial = true,
}: MobileBottomNavigationProps) {
  const pathname = usePathname();

  const isCurrent = (href: string) => {
    if (href === "/admin/dashboard") {
      return pathname === href;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const tabs = [
    {
      id: "inicio",
      label: "Início",
      href: "/admin/dashboard",
      iconName: "dashboard",
    },
    {
      id: "agenda",
      label: "Agenda",
      href: "/admin/agendamentos",
      iconName: "calendar",
    },
    {
      id: "comandas",
      label: "Comandas",
      href: "/admin/comandas",
      iconName: "calendar",
    },
    canAccessFinancial
      ? {
          id: "financeiro",
          label: "Financeiro",
          href: "/admin/financeiro",
          iconName: "financial",
        }
      : {
          id: "clientes",
          label: "Clientes",
          href: "/admin/clientes",
          iconName: "clients",
        },
  ];

  return (
    <nav
      aria-label="Navegação móvel principal"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#16181D]/95 backdrop-blur-md border-t border-white/[0.08] shadow-[0_-4px_20px_rgba(0,0,0,0.5)] no-print"
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="grid grid-cols-5 h-16 max-w-md mx-auto items-center px-1">
        {tabs.map((tab) => {
          const active = isCurrent(tab.href);
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors relative select-none touch-manipulation ${
                active
                  ? "text-[#D3AE55] font-semibold"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {active && (
                <span className="absolute top-0 inset-x-3 h-0.5 bg-[#D3AE55] rounded-full shadow-[0_0_8px_rgba(211,174,85,0.6)]" />
              )}
              <NavIcon
                name={tab.iconName}
                className={`w-5 h-5 mb-1 transition-transform ${
                  active ? "scale-110 text-[#D3AE55]" : "text-zinc-400"
                }`}
              />
              <span className="text-[10px] leading-tight tracking-tight truncate max-w-[56px]">
                {tab.label}
              </span>
            </Link>
          );
        })}

        {/* 5th Tab: Menu (Full-screen trigger) */}
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir menu completo"
          className="flex flex-col items-center justify-center h-full min-h-[44px] text-zinc-400 hover:text-zinc-200 transition-colors select-none touch-manipulation"
        >
          <NavIcon name="menu" className="w-5 h-5 mb-1 text-zinc-400" />
          <span className="text-[10px] leading-tight tracking-tight">Menu</span>
        </button>
      </div>
    </nav>
  );
}
