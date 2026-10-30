"use client";

import React, { useState } from "react";
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

  const visibleNavItems = getVisibleNavItems({ userRole, isPlatformAdmin });

  const isRouteActive = (href: string) => {
    if (href === "/admin/dashboard") {
      return pathname === href;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const isGroupActive = (item: (typeof visibleNavItems)[number]) =>
    isRouteActive(item.href) ||
    item.children.some((c) => isRouteActive(c.href));

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const item of visibleNavItems) {
      if (item.children.length > 0) {
        initial[item.href] =
          isRouteActive(item.href) ||
          item.children.some((c) => isRouteActive(c.href));
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

  const canAccessFinancial =
    userRole === "OWNER" ||
    userRole === "MANAGER" ||
    userRole === "SUPER_ADMIN" ||
    isPlatformAdmin;

  return (
    <>
      {/* Mobile Top Bar */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-[#16181D]/90 backdrop-blur-md border-b border-white/[0.08] no-print">
        <div className="flex items-center gap-2.5 min-w-0 pr-3">
          {!barbershopLogo || imageError ? (
            <div className="w-8 h-8 rounded-lg bg-[#22252B] border border-[#D3AE55]/30 flex items-center justify-center font-serif font-bold text-[#D3AE55] text-xs shrink-0 shadow-sm">
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

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed top-0 left-0 h-full w-64 flex-col bg-[#16181D] border-r border-white/[0.08] z-30 no-print select-none">
        {/* Brand Header */}
        <div className="px-5 py-5 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            {!barbershopLogo || imageError ? (
              <div className="w-9 h-9 rounded-xl bg-[#22252B] border border-[#D3AE55]/30 flex items-center justify-center font-serif font-bold text-[#D3AE55] text-sm shrink-0 shadow-sm">
                {initials}
              </div>
            ) : (
              <img
                src={barbershopLogo}
                alt={barbershopName}
                onError={() => setImageError(true)}
                className="w-9 h-9 rounded-xl object-contain p-0.5 bg-[#22252B] border border-white/[0.08] shrink-0"
              />
            )}
            <div className="min-w-0">
              <p className="font-serif text-sm font-bold text-white tracking-wide leading-tight truncate">
                {barbershopName}
              </p>
              <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                {subtitle || "Painel de Gestão"}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav
          aria-label="Navegação administrativa"
          className="flex-1 overflow-y-auto px-3 py-4 space-y-1 overscroll-contain"
        >
          {visibleNavItems.map((item) => {
            const isOpen = openGroups[item.href];
            const active = isGroupActive(item);
            const hasChildren = item.children.length > 0;

            if (hasChildren) {
              return (
                <div key={item.href} className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => toggleGroup(item.href)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                      active
                        ? "text-[#D3AE55] bg-[#D3AE55]/10"
                        : "text-zinc-400 hover:text-white hover:bg-white/[0.04]"
                    }`}
                  >
                    <NavIcon
                      name={item.iconName}
                      className={active ? "text-[#D3AE55]" : "text-zinc-400"}
                    />
                    <span className="flex-1 text-left text-xs uppercase tracking-wider font-bold">
                      {item.label}
                    </span>
                    <svg
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                        isOpen ? "rotate-180" : ""
                      } text-zinc-500`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {isOpen && (
                    <div className="ml-8 space-y-0.5 mb-1 mt-0.5 pl-2 border-l border-white/[0.06]">
                      {item.children
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
                              className={`flex items-center px-3 py-2 rounded-lg text-xs transition-colors font-medium ${
                                childActive
                                  ? "bg-[#D3AE55]/15 text-[#D3AE55] font-bold"
                                  : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                              }`}
                            >
                              {child.label}
                            </Link>
                          );
                        })}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isRouteActive(item.href)
                    ? "bg-[#D3AE55]/10 text-[#D3AE55] font-bold"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                <NavIcon
                  name={item.iconName}
                  className={
                    isRouteActive(item.href) ? "text-[#D3AE55]" : "text-zinc-400"
                  }
                />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer: User profile and Logout */}
        <div className="px-3 py-4 border-t border-white/[0.08] bg-[#121418]">
          <div className="flex items-center gap-3 px-3 py-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-[#22252B] border border-white/[0.08] flex items-center justify-center text-xs font-bold text-zinc-300 font-serif shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-zinc-200 truncate">{userName}</p>
              <p className="text-[10px] text-zinc-400">
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
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors mb-2 cursor-pointer"
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
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sair
          </button>

          <p className="text-[9px] text-center text-zinc-600 font-medium tracking-widest uppercase">
            Powered by Tem Barber
          </p>
        </div>
      </aside>
    </>
  );
}
