"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cleanupCurrentPushSubscriptionBeforeLogout } from "@/lib/push/logout-cleanup";
import { NavIcon } from "./NavIcon";
import {
  getVisibleNavItems,
  groupNavItems,
} from "./nav-config";

interface MobileFullScreenMenuProps {
  isOpen: boolean;
  onClose: () => void;
  barbershopName: string;
  barbershopLogo?: string | null;
  subtitle?: string | null;
  userName: string;
  userRole?: string | null;
  isPlatformAdmin?: boolean;
}

export function MobileFullScreenMenu({
  isOpen,
  onClose,
  barbershopName,
  barbershopLogo,
  subtitle,
  userName,
  userRole,
  isPlatformAdmin = false,
}: MobileFullScreenMenuProps) {
  const pathname = usePathname();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageError, setImageError] = useState(false);

  // Grouped navigation
  const visibleItems = getVisibleNavItems({ userRole, isPlatformAdmin });
  const groups = groupNavItems(visibleItems);

  // Accordion state
  const isRouteActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const [openAccordion, setOpenAccordion] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const item of visibleItems) {
      if (item.children.length > 0) {
        map[item.href] =
          isRouteActive(item.href) ||
          item.children.some((c) => isRouteActive(c.href));
      }
    }
    return map;
  });

  const toggleAccordion = (href: string) => {
    setOpenAccordion((prev) => ({ ...prev, [href]: !prev[href] }));
  };

  // Close on Escape & Lock body scroll
  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus close button
    const timer = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const initials = barbershopName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-menu-title"
      className="fixed inset-0 z-50 flex flex-col bg-[#0B0D10] text-[#F5F5F5] overflow-hidden no-print"
      style={{
        height: "100dvh",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] bg-[#16181D]/80 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {!barbershopLogo || imageError ? (
            <div className="w-10 h-10 rounded-xl bg-[#22252B] border border-[#D3AE55]/30 flex items-center justify-center font-serif font-bold text-[#D3AE55] text-sm shrink-0 shadow-sm">
              {initials}
            </div>
          ) : (
            <img
              src={barbershopLogo}
              alt={barbershopName}
              onError={() => setImageError(true)}
              className="w-10 h-10 rounded-xl object-contain p-0.5 bg-[#22252B] border border-white/[0.08] shrink-0"
            />
          )}
          <div className="min-w-0">
            <h2
              id="mobile-menu-title"
              className="font-serif text-base font-bold text-white tracking-wide truncate leading-tight"
            >
              {barbershopName}
            </h2>
            <p className="text-xs text-zinc-400 truncate mt-0.5">
              {subtitle || "Painel de Gestão"}
            </p>
          </div>
        </div>

        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Fechar menu"
          className="p-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#D3AE55] min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Scrollable Navigation List */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6 overscroll-contain">
        {groups.map((group) => (
          <div key={group.id} className="space-y-1.5">
            <h3 className="px-3 text-[11px] font-bold uppercase tracking-widest text-zinc-500">
              {group.title}
            </h3>

            <div className="bg-[#1A1C20] border border-white/[0.06] rounded-2xl p-1.5 space-y-0.5 shadow-sm">
              {group.items.map((item) => {
                const hasChildren = item.children.length > 0;
                const active = isRouteActive(item.href);
                const isOpenAccordion = !!openAccordion[item.href];

                if (hasChildren) {
                  return (
                    <div key={item.href} className="space-y-0.5">
                      <button
                        type="button"
                        onClick={() => toggleAccordion(item.href)}
                        className={`w-full flex items-center justify-between px-3 py-3 rounded-xl text-sm font-medium transition-colors min-h-[44px] ${
                          active
                            ? "bg-[#D3AE55]/10 text-[#D3AE55] font-semibold"
                            : "text-zinc-300 hover:bg-white/[0.04] hover:text-white"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <NavIcon
                            name={item.iconName}
                            className={`w-4 h-4 ${
                              active ? "text-[#D3AE55]" : "text-zinc-400"
                            }`}
                          />
                          <span>{item.label}</span>
                        </div>
                        <svg
                          className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${
                            isOpenAccordion ? "rotate-180" : ""
                          }`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>

                      {isOpenAccordion && (
                        <div className="ml-7 pl-3 border-l border-white/[0.08] space-y-0.5 py-1">
                          {item.children
                            .filter((c) => {
                              return (
                                !c.roles ||
                                c.roles.includes(userRole ?? "") ||
                                isPlatformAdmin
                              );
                            })
                            .map((child) => {
                              const childActive = pathname === child.href;
                              return (
                                <Link
                                  key={child.href}
                                  href={child.href}
                                  onClick={onClose}
                                  className={`flex items-center px-3 py-2.5 rounded-lg text-xs font-medium min-h-[40px] transition-colors ${
                                    childActive
                                      ? "bg-[#D3AE55]/15 text-[#D3AE55] font-bold"
                                      : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
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
                    onClick={onClose}
                    className={`flex items-center justify-between px-3 py-3 rounded-xl text-sm font-medium transition-colors min-h-[44px] ${
                      active
                        ? "bg-[#D3AE55]/10 text-[#D3AE55] font-semibold"
                        : "text-zinc-300 hover:bg-white/[0.04] hover:text-white"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <NavIcon
                        name={item.iconName}
                        className={`w-4 h-4 ${
                          active ? "text-[#D3AE55]" : "text-zinc-400"
                        }`}
                      />
                      <span>{item.label}</span>
                    </div>
                    <svg
                      className="w-3.5 h-3.5 text-zinc-600"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer / User Session */}
      <div className="p-4 border-t border-white/[0.08] bg-[#16181D] shrink-0 space-y-3 pb-8">
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#22252B] border border-white/[0.08] flex items-center justify-center font-bold text-xs text-zinc-300 font-serif shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{userName}</p>
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
              onClose();
              await cleanupCurrentPushSubscriptionBeforeLogout();
              signOut({ callbackUrl: "/login" });
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition-colors min-h-[44px]"
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
        </div>

        <p className="text-[10px] text-center text-zinc-600 font-medium tracking-wider uppercase">
          Powered by Tem Barber
        </p>
      </div>
    </div>
  );
}
