"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cleanupCurrentPushSubscriptionBeforeLogout } from "@/lib/push/logout-cleanup";
import { NavIcon } from "./navigation/NavIcon";
import { getVisibleNavItems, NavItemConfig } from "./navigation/nav-config";
import { MobileBottomNavigation } from "./navigation/MobileBottomNavigation";
import { MobileFullScreenMenu } from "./navigation/MobileFullScreenMenu";

export interface AdminSidebarProps {
  barbershopName: string;
  barbershopLogo?: string | null;
  subtitle?: string | null;
  userName: string;
  userRole?: string | null;
  isPlatformAdmin?: boolean;
  currentPathname?: string;
  currentSearch?: string;
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

function toSidebarTestSlug(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\ba\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseHrefParts(href: string): {
  path: string;
  queryEntries: [string, string][];
} {
  const [rawPath, rawQuery = ""] = href.split("?");
  const normalizedPath =
    rawPath.length > 1 && rawPath.endsWith("/")
      ? rawPath.slice(0, -1)
      : rawPath;
  const params = new URLSearchParams(rawQuery);
  return {
    path: normalizedPath,
    queryEntries: Array.from(params.entries()),
  };
}

export interface SidebarResolvedActiveState {
  activeGroupHref: string | null;
  activeItemHref: string | null;
}

export function resolveSidebarActiveState(params: {
  items: NavItemConfig[];
  pathname: string;
  search?: string;
  userRole?: string | null;
  isPlatformAdmin?: boolean;
}): SidebarResolvedActiveState {
  const {
    items,
    pathname,
    search = "",
    userRole,
    isPlatformAdmin = false,
  } = params;

  const [pathnameOnly, inlineQuery = ""] = (pathname || "").split("?");
  const normalizedCurrentPath =
    pathnameOnly === "/visual-harness"
      ? "/admin/dashboard"
      : pathnameOnly.length > 1 && pathnameOnly.endsWith("/")
      ? pathnameOnly.slice(0, -1)
      : pathnameOnly;

  const rawSearch = search ? search.replace(/^\?/, "") : inlineQuery;
  const currentSearchParams = new URLSearchParams(rawSearch);

  interface Candidate {
    groupHref: string | null;
    itemHref: string;
    isChild: boolean;
    score: number;
  }

  let best: Candidate | null = null;

  for (const item of items) {
    const visibleChildren = item.children.filter(
      (child) =>
        !child.roles ||
        child.roles.includes(userRole ?? "") ||
        isPlatformAdmin
    );

    if (visibleChildren.length > 0) {
      for (const child of visibleChildren) {
        const { path: childPath, queryEntries } = parseHrefParts(child.href);
        const isGroupRootChild = childPath === item.href;

        let pathMatched = false;
        let isExactPath = false;

        if (normalizedCurrentPath === childPath) {
          pathMatched = true;
          isExactPath = true;
        } else if (
          !isGroupRootChild &&
          normalizedCurrentPath.startsWith(`${childPath}/`)
        ) {
          pathMatched = true;
          isExactPath = false;
        }

        if (!pathMatched) continue;

        if (queryEntries.length > 0) {
          const allMatched = queryEntries.every(
            ([k, v]) => currentSearchParams.get(k) === v
          );
          if (!allMatched) {
            continue;
          }
          const score =
            (isExactPath ? 400 : 250) +
            childPath.length +
            queryEntries.length * 10;
          if (!best || score > best.score) {
            best = {
              groupHref: item.href,
              itemHref: child.href,
              isChild: true,
              score,
            };
          }
        } else {
          const score = (isExactPath ? 300 : 150) + childPath.length;
          if (!best || score > best.score) {
            best = {
              groupHref: item.href,
              itemHref: child.href,
              isChild: true,
              score,
            };
          }
        }
      }

      if (
        item.href === "/admin/financeiro" &&
        normalizedCurrentPath === "/admin/financeiro/contas" &&
        !currentSearchParams.get("kind") &&
        !best
      ) {
        best = {
          groupHref: item.href,
          itemHref: null as unknown as string,
          isChild: true,
          score: 200,
        };
      }
    } else {
      const { path: leafPath, queryEntries } = parseHrefParts(item.href);
      const isExactPath = normalizedCurrentPath === leafPath;
      const isPrefixPath = normalizedCurrentPath.startsWith(`${leafPath}/`);

      if (!isExactPath && !isPrefixPath) continue;

      if (queryEntries.length > 0) {
        const allMatched = queryEntries.every(
          ([k, v]) => currentSearchParams.get(k) === v
        );
        if (!allMatched) continue;
      }

      const score = (isExactPath ? 350 : 120) + leafPath.length;
      if (!best || score > best.score) {
        best = {
          groupHref: null,
          itemHref: item.href,
          isChild: false,
          score,
        };
      }
    }
  }

  return {
    activeGroupHref: best?.groupHref ?? null,
    activeItemHref: best?.itemHref ?? null,
  };
}

export function AdminSidebar({
  barbershopName,
  barbershopLogo,
  subtitle,
  userName,
  userRole,
  isPlatformAdmin = false,
  currentPathname,
  currentSearch,
}: AdminSidebarProps) {
  const hookPathname = usePathname() || "";
  const effectivePathname = currentPathname ?? hookPathname;

  const [browserSearch, setBrowserSearch] = useState<string>(() => {
    if (currentSearch !== undefined) return currentSearch;
    if (typeof window !== "undefined") return window.location.search;
    return "";
  });
  const [prevPathnameForSearch, setPrevPathnameForSearch] =
    useState<string>(effectivePathname);

  if (effectivePathname !== prevPathnameForSearch) {
    setPrevPathnameForSearch(effectivePathname);
    if (currentSearch === undefined && typeof window !== "undefined") {
      setBrowserSearch(window.location.search);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = () => {
      if (currentSearch === undefined) {
        setBrowserSearch(window.location.search);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [currentSearch]);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [prevLogo, setPrevLogo] = useState(barbershopLogo);
  const [imageError, setImageError] = useState(false);

  if (barbershopLogo !== prevLogo) {
    setPrevLogo(barbershopLogo);
    setImageError(false);
  }

  useEffect(() => {
    const handler = () => setMobileMenuOpen(true);
    window.addEventListener("tembarber:open-mobile-menu", handler);
    return () =>
      window.removeEventListener("tembarber:open-mobile-menu", handler);
  }, []);

  const visibleNavItems = useMemo(() => {
    const rawVisibleItems = getVisibleNavItems({ userRole, isPlatformAdmin });
    return rawVisibleItems
      .filter((item) => item.href !== "/admin/financeiro/contas")
      .sort((a, b) => {
        const idxA = DESKTOP_SIDEBAR_ORDER.indexOf(a.href);
        const idxB = DESKTOP_SIDEBAR_ORDER.indexOf(b.href);
        return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
      });
  }, [userRole, isPlatformAdmin]);

  const effectiveSearch = currentSearch ?? browserSearch;

  const { activeGroupHref, activeItemHref } = useMemo(
    () =>
      resolveSidebarActiveState({
        items: visibleNavItems,
        pathname: effectivePathname,
        search: effectiveSearch,
        userRole,
        isPlatformAdmin,
      }),
    [
      visibleNavItems,
      effectivePathname,
      effectiveSearch,
      userRole,
      isPlatformAdmin,
    ]
  );

  // Open only the group that contains the active route by default
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    if (activeGroupHref) {
      initial[activeGroupHref] = true;
    }
    return initial;
  });
  const [prevActiveGroupHref, setPrevActiveGroupHref] = useState<string | null>(
    activeGroupHref
  );

  if (activeGroupHref !== prevActiveGroupHref) {
    setPrevActiveGroupHref(activeGroupHref);
    if (activeGroupHref && !openGroups[activeGroupHref]) {
      setOpenGroups((prev) => ({ ...prev, [activeGroupHref]: true }));
    }
  }

  const toggleGroup = (href: string) =>
    setOpenGroups((prev) => ({ ...prev, [href]: !prev[href] }));

  const handleLinkClick = (href: string) => {
    if (currentSearch === undefined) {
      const qIdx = href.indexOf("?");
      setBrowserSearch(qIdx >= 0 ? href.slice(qIdx) : "");
    }
  };

  const initials = barbershopName
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
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

  const cleanPathname = effectivePathname.split("?")[0];
  const isDashboardView =
    cleanPathname === "/admin/dashboard" || cleanPathname === "/visual-harness";

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

      {/* Desktop Sidebar */}
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
            const hasChildren = item.children.length > 0;
            const isGroupContainingActive =
              hasChildren && activeGroupHref === item.href;
            const groupSlug = toSidebarTestSlug(item.label);

            if (hasChildren) {
              const childrenToShow = item.children.filter(
                (child) =>
                  !child.roles ||
                  child.roles.includes(userRole ?? "") ||
                  isPlatformAdmin
              );

              // Group header visual states:
              // 1. Group containing an active child route -> discreet hierarchical indicator (no gold border/fill)
              // 2. Expanded group without active route -> subtle neutral expanded state (never looks selected)
              // 3. Collapsed group without active route -> default muted state with hover
              let groupButtonClasses =
                "border border-transparent text-[#A6ADB9] hover:text-white hover:bg-white/[0.04]";
              let groupIconClasses = "text-[#8E95A2]";

              if (isGroupContainingActive) {
                groupButtonClasses =
                  "bg-white/[0.04] border border-white/[0.09] text-white font-semibold";
                groupIconClasses = "text-[#D3AE55]/85";
              } else if (isOpen) {
                groupButtonClasses =
                  "bg-white/[0.02] border border-transparent text-zinc-200 hover:text-white hover:bg-white/[0.04]";
                groupIconClasses = "text-[#8E95A2]";
              }

              return (
                <div key={item.href} className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => toggleGroup(item.href)}
                    aria-expanded={isOpen}
                    data-testid={`sidebar-group-${groupSlug}`}
                    data-active="false"
                    data-group-active={
                      isGroupContainingActive ? "true" : "false"
                    }
                    data-expanded={isOpen ? "true" : "false"}
                    className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-[13px] font-medium transition-all cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20 ${groupButtonClasses}`}
                  >
                    <NavIcon
                      name={item.iconName}
                      className={`w-[16px] h-[16px] ${groupIconClasses}`}
                    />
                    <span className="flex-1 text-left">{item.label}</span>
                    {isGroupContainingActive && (
                      <span
                        data-testid={`group-active-indicator-${item.label}`}
                        className="w-1.5 h-1.5 rounded-full bg-[#D3AE55]/80 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <svg
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                        isOpen ? "rotate-180 text-zinc-300" : "text-zinc-500"
                      }`}
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
                    <div
                      className={`ml-5 pl-3 border-l space-y-0.5 py-0.5 ${
                        isGroupContainingActive
                          ? "border-[#D3AE55]/30"
                          : "border-white/[0.06]"
                      }`}
                    >
                      {childrenToShow.map((child) => {
                        const childSelected =
                          isGroupContainingActive &&
                          activeItemHref === child.href;
                        const childSlug = toSidebarTestSlug(child.label);

                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={() => handleLinkClick(child.href)}
                            aria-current={childSelected ? "page" : undefined}
                            data-testid={`sidebar-subitem-${childSlug}`}
                            data-active={childSelected ? "true" : "false"}
                            className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs transition-all font-medium ${
                              childSelected
                                ? "bg-gradient-to-r from-[#D3AE55]/25 via-[#D3AE55]/15 to-transparent border border-[#D3AE55]/45 text-[#E8C76E] font-semibold shadow-[0_0_16px_rgba(211,174,85,0.12)]"
                                : "border border-transparent text-[#9CA3AF] hover:bg-white/[0.04] hover:text-zinc-200"
                            }`}
                          >
                            {child.iconName && (
                              <NavIcon
                                name={child.iconName}
                                className={`w-3.5 h-3.5 ${
                                  childSelected
                                    ? "text-[#E8C76E]"
                                    : "text-[#8E95A2]"
                                }`}
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

            const itemSelected =
              activeGroupHref === null && activeItemHref === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => handleLinkClick(item.href)}
                aria-current={itemSelected ? "page" : undefined}
                data-testid={`sidebar-item-${groupSlug}`}
                data-active={itemSelected ? "true" : "false"}
                className={`flex items-center gap-3 px-3.5 py-2 rounded-xl text-[13px] font-medium transition-all ${
                  itemSelected
                    ? "bg-gradient-to-r from-[#D3AE55]/25 via-[#D3AE55]/15 to-transparent border border-[#D3AE55]/45 text-[#E8C76E] font-semibold shadow-[0_0_20px_rgba(211,174,85,0.14)]"
                    : "border border-transparent text-[#A6ADB9] hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                <NavIcon
                  name={item.iconName}
                  className={`w-[16px] h-[16px] ${
                    itemSelected ? "text-[#E8C76E]" : "text-[#8E95A2]"
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
              <p className="text-xs font-bold text-white truncate">
                {userName}
              </p>
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
