"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cleanupCurrentPushSubscriptionBeforeLogout } from "@/lib/push/logout-cleanup";
import { NavIcon } from "./navigation/NavIcon";
import { getVisibleNavItems } from "./navigation/nav-config";
import { MobileBottomNavigation } from "./navigation/MobileBottomNavigation";
import { MobileFullScreenMenu } from "./navigation/MobileFullScreenMenu";

interface AdminSidebarProps {
  barbershopName: string;
  barbershopLogo?: string | null;
  subtitle?: string | null;
  userName: string;
  userRole?: string | null;
  isPlatformAdmin?: boolean;
}

const DESKTOP_SIDEBAR_ORDER = [
  "/admin/platform",
  "/admin/dashboard",
  "/admin/agendamentos",
  "/admin/comandas",
  "/admin/clientes",
  "/admin/financeiro",
  "/admin/produtos",
  "/admin/servicos",
  "/admin/financeiro/relatorio-gerencial",
  "/admin/marketing",
  "/admin/configuracoes",
  "/admin/fila",
  "/admin/caixa",
  "/admin/comissoes",
  "/admin/gorjetas",
  "/admin/clube",
];

export function AdminSidebar({
  barbershopName,
  barbershopLogo,
  subtitle,
  userName,
  userRole,
  isPlatformAdmin = false,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    const handler = () => setMobileMenuOpen(true);
    window.addEventListener("tembarber:open-mobile-menu", handler);
    return () =>
      window.removeEventListener("tembarber:open-mobile-menu", handler);
  }, []);

  const rawVisibleItems = getVisibleNavItems({ userRole, isPlatformAdmin });
  const visibleNavItems = rawVisibleItems
    .filter((item) => item.href !== "/admin/financeiro/contas")
    .sort((a, b) => {
      const idxA = DESKTOP_SIDEBAR_ORDER.indexOf(a.href);
      const idxB = DESKTOP_SIDEBAR_ORDER.indexOf(b.href);
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });

  const isRouteActive = (href: string) => {
    if (href === "/admin/dashboard") {
      return pathname === href || pathname === "/visual-harness";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const isGroupActive = (item: (typeof visibleNavItems)[number]) =>
    isRouteActive(item.href) ||
    item.children.some((c) => isRouteActive(c.href));

  // Keep Financeiro expanded by default on desktop to match approved reference
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {
      "/admin/financeiro": true,
    };
    for (const item of visibleNavItems) {
      if (item.children.length > 0) {
        if (
          isRouteActive(item.href) ||
          item.children.some((c) => isRouteActive(c.href))
        ) {
          initial[item.href] = true;
        }
      }
    }
    return initial;
  });

  const toggleGroup = (href: string) =>
    setOpenGroups((prev) => ({ ...prev, [href]: !prev[href] }));

  const initials = barbershopName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  const userInitials = userName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  const canAccessFinancial =
    userRole === "OWNER" ||
    userRole === "MANAGER" ||
    userRole === "SUPER_ADMIN" ||
    isPlatformAdmin;

  const isDashboardView =
    pathname === "/admin/dashboard" || pathname === "/visual-harness";

  return (
    <>
      {/* Mobile Top Bar (hidden on Dashboard where the dedicated mobile dashboard header renders) */}
      <header
        className={`lg:hidden fixed top-0 left-0 right-0 z-30 items-center justify-between px-4 py-3 bg-[#111318]/95 backdrop-blur-md border-b border-white/[0.08] no-print ${
          isDashboardView ? "hidden" : "flex"
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0 pr-3">
          {!barbershopLogo || imageError ? (
            <div className="w-8 h-8 rounded-lg bg-[#22252B] border border-[#D3AE55]/35 flex items-center justify-center font-serif font-bold text-[#E8C76E] text-xs shrink-0 shadow-sm">
              {initials}
            </div>
          ) : (
            <img
              src={barbershopLogo}
              alt={barbershopName}
              onError={() => setImageError(true)}
              className="w-8 h-8 rounded-lg object-contain p-0.5 bg-[#22252B] border border-white/[0.08] shrink-0"
            />
          )}
          <p className="font-serif text-sm font-bold text-white tracking-wide truncate">
            {barbershopName}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Abrir menu"
          className="p-2 rounded-lg text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors focus:outline-none focus:ring-2 focus:ring-[#D3AE55] min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
        >
          <NavIcon name="menu" className="w-5 h-5" />
        </button>
      </header>

      {/* Mobile Bottom Fixed Navigation */}
      <MobileBottomNavigation
        onOpenMenu={() => setMobileMenuOpen(true)}
        canAccessFinancial={canAccessFinancial}
      />

      {/* Mobile Full-Screen Navigation Drawer */}
      <MobileFullScreenMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        barbershopName={barbershopName}
        barbershopLogo={barbershopLogo}
        subtitle={subtitle}
        userName={userName}
        userRole={userRole}
        isPlatformAdmin={isPlatformAdmin}
      />

      {/* Desktop Sidebar matching approved reference */}
      <aside className="hidden lg:flex fixed top-0 left-0 h-full w-64 flex-col bg-[#121419] border-r border-white/[0.07] z-30 no-print select-none">
        {/* Brand Header */}
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-3.5">
            {!barbershopLogo || imageError ? (
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#232018] to-[#17181C] border border-[#D3AE55]/40 flex items-center justify-center font-serif font-bold text-[#E8C76E] text-base shrink-0 shadow-[0_0_16px_rgba(211,174,85,0.12)]">
                {initials}
              </div>
            ) : (
              <img
                src={barbershopLogo}
                alt={barbershopName}
                onError={() => setImageError(true)}
                className="w-11 h-11 rounded-2xl object-contain p-0.5 bg-[#22252B] border border-white/[0.08] shrink-0"
              />
            )}
            <div className="min-w-0">
              <p className="font-serif text-[15px] font-bold text-white tracking-wide leading-tight truncate">
                {barbershopName}
              </p>
              <p className="text-xs text-[#9CA3AF] mt-0.5 truncate">
                {subtitle || "Painel de Gestão"}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav
          aria-label="Navegação administrativa"
          className="flex-1 overflow-y-auto px-3.5 py-1 space-y-0.5 overscroll-contain"
        >
          {visibleNavItems.map((item) => {
            const isOpen = !!openGroups[item.href];
            const active = isGroupActive(item);
            const hasChildren = item.children.length > 0;

            if (hasChildren) {
              // In Financeiro, show Contas a Pagar & Contas a Receber prominently when on Dashboard, or all children when inside Financeiro
              const childrenToShow =
                item.href === "/admin/financeiro" && !pathname.startsWith("/admin/financeiro")
                  ? item.children.slice(0, 2)
                  : item.children;

              return (
                <div key={item.href} className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => toggleGroup(item.href)}
                    className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-[13px] font-medium transition-all cursor-pointer ${
                      active
                        ? "bg-gradient-to-r from-[#D3AE55]/25 via-[#D3AE55]/15 to-transparent border border-[#D3AE55]/40 text-[#E8C76E] font-semibold shadow-[0_0_18px_rgba(211,174,85,0.12)]"
                        : "text-[#A6ADB9] hover:text-white hover:bg-white/[0.04]"
                    }`}
                  >
                    <NavIcon
                      name={item.iconName}
                      className={`w-[16px] h-[16px] ${
                        active ? "text-[#E8C76E]" : "text-[#8E95A2]"
                      }`}
                    />
                    <span className="flex-1 text-left">{item.label}</span>
                    <svg
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                        isOpen ? "rotate-180" : ""
                      } text-zinc-500`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div className="ml-5 pl-3 border-l border-white/[0.06] space-y-0.5 py-0.5">
                      {childrenToShow
                        .filter((child) => {
                          return (
                            !child.roles ||
                            child.roles.includes(userRole ?? "") ||
                            isPlatformAdmin
                          );
                        })
                        .map((child) => {
                          const childActive = pathname === child.href;
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs transition-colors font-medium ${
                                childActive
                                  ? "bg-[#D3AE55]/15 text-[#E8C76E] font-semibold"
                                  : "text-[#9CA3AF] hover:bg-white/[0.04] hover:text-zinc-200"
                              }`}
                            >
                              {child.iconName && (
                                <NavIcon
                                  name={child.iconName}
                                  className="w-3.5 h-3.5 text-[#8E95A2]"
                                />
                              )}
                              <span>{child.label}</span>
                            </Link>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            }

            const itemActive = isRouteActive(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3.5 py-2 rounded-xl text-[13px] font-medium transition-all ${
                  itemActive
                    ? "bg-gradient-to-r from-[#D3AE55]/25 via-[#D3AE55]/15 to-transparent border border-[#D3AE55]/45 text-[#E8C76E] font-semibold shadow-[0_0_20px_rgba(211,174,85,0.14)]"
                    : "text-[#A6ADB9] hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                <NavIcon
                  name={item.iconName}
                  className={`w-[16px] h-[16px] ${
                    itemActive ? "text-[#E8C76E]" : "text-[#8E95A2]"
                  }`}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer: User profile and Logout */}
        <div className="px-4 py-3.5 border-t border-white/[0.07] bg-[#101216]">
          <div className="flex items-center gap-3 px-2 py-1 mb-1.5">
            <div className="w-9 h-9 rounded-full bg-[#1C1F26] border border-white/[0.10] flex items-center justify-center text-xs font-bold text-[#E8C76E] font-serif shrink-0">
              {userInitials}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">{userName}</p>
              <p className="text-[11px] text-[#8E95A2]">
                {userRole === "OWNER"
                  ? "Proprietário"
                  : userRole === "MANAGER"
                  ? "Gerente"
                  : userRole === "RECEPTIONIST"
                  ? "Recepcionista"
                  : isPlatformAdmin
                  ? "Super Admin"
                  : "Colaborador"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={async () => {
              await cleanupCurrentPushSubscriptionBeforeLogout();
              signOut({ callbackUrl: "/login" });
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-[#9CA3AF] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sair
          </button>
        </div>
      </aside>
    </>
  );
}
