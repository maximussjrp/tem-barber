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
      return pathname === href || pathname === "/visual-harness";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const tabs = [
    {
      id: "inicio",
      label: "Início",
      href: "/admin/dashboard",
      iconName: "home",
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
      iconName: "comandas",
    },
    canAccessFinancial
      ? {
          id: "financeiro",
          label: "Financeiro",
          href: "/admin/financeiro",
          iconName: "chart",
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
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#111317]/95 backdrop-blur-xl border-t border-white/[0.08] shadow-[0_-8px_28px_rgba(0,0,0,0.65)] no-print"
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="grid grid-cols-5 h-[68px] max-w-md mx-auto items-center px-1">
        {tabs.map((tab) => {
          const active = isCurrent(tab.href);
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors relative select-none touch-manipulation ${
                active
                  ? "text-[#E8C76E] font-semibold"
                  : "text-[#9CA3AF] hover:text-zinc-200"
              }`}
            >
              <NavIcon
                name={tab.iconName}
                className={`w-5 h-5 mb-1 transition-transform ${
                  active
                    ? "text-[#E8C76E] drop-shadow-[0_0_8px_rgba(232,199,110,0.45)]"
                    : "text-[#9CA3AF]"
                }`}
              />
              <span className="text-[11px] leading-tight tracking-tight truncate max-w-[64px]">
                {tab.label}
              </span>
              {active && (
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#E8C76E] shadow-[0_0_8px_rgba(232,199,110,0.9)]" />
              )}
            </Link>
          );
        })}

        {/* 5th Tab: Menu (Full-screen trigger) */}
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir menu completo"
          className="flex flex-col items-center justify-center h-full min-h-[44px] text-[#9CA3AF] hover:text-zinc-200 transition-colors select-none touch-manipulation cursor-pointer"
        >
          <NavIcon name="menu" className="w-5 h-5 mb-1 text-[#9CA3AF]" />
          <span className="text-[11px] leading-tight tracking-tight">Menu</span>
        </button>
      </div>
    </nav>
  );
}
