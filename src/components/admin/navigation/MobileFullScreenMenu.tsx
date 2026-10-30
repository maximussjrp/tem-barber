"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cleanupCurrentPushSubscriptionBeforeLogout } from "@/lib/push/logout-cleanup";
import { NavIcon } from "./NavIcon";
import { getVisibleNavItems, groupNavItems } from "./nav-config";

interface MobileFullScreenMenuProps {
  isOpen: boolean;
  onClose: () => void;
  barbershopName: string;
  barbershopLogo?: string | null;
  subtitle?: string | null;
  formattedDate?: string | null;
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
  formattedDate,
  userName,
  userRole,
  isPlatformAdmin = false,
}: MobileFullScreenMenuProps) {
  const pathname = usePathname();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageError, setImageError] = useState(false);

  const visibleItems = getVisibleNavItems({ userRole, isPlatformAdmin });
  const groups = groupNavItems(visibleItems);

  const isRouteActive = (href: string) => {
    if (href === "/admin/dashboard") {
      return pathname === href || pathname === "/visual-harness";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

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

  useEffect(() => {
    if (!isOpen) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

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

  const dateDisplay =
    formattedDate ||
    new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "America/Sao_Paulo",
    }).format(new Date());

  const capitalizedDate =
    dateDisplay.charAt(0).toUpperCase() + dateDisplay.slice(1);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-menu-title"
      className="fixed inset-0 z-50 flex flex-col bg-[#0D0F13] text-[#F5F5F5] overflow-hidden no-print"
      style={{
        height: "100dvh",
      }}
    >
      {/* Header matching approved mobile full-screen menu */}
      <div className="flex items-start justify-between px-4 pt-3.5 pb-3 border-b border-white/[0.07] bg-gradient-to-b from-[#17191F] to-[#111318] shrink-0">
        <div className="flex items-start gap-3 min-w-0">
          {!barbershopLogo || imageError ? (
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#232019] to-[#16171B] border border-[#D3AE55]/45 flex items-center justify-center font-serif font-bold text-[#E8C76E] text-base shrink-0 shadow-[0_0_16px_rgba(211,174,85,0.15)]">
              {initials}
            </div>
          ) : (
            <img
              src={barbershopLogo}
              alt={barbershopName}
              onError={() => setImageError(true)}
              className="w-11 h-11 rounded-2xl object-contain p-1 bg-[#1A1C20] border border-[#D3AE55]/35 shrink-0"
            />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2
                id="mobile-menu-title"
                className="font-serif text-base font-bold text-white tracking-wide truncate leading-tight"
              >
                {barbershopName}
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wider bg-[#D3AE55]/20 text-[#E8C76E] border border-[#D3AE55]/40 shrink-0">
                PRO
              </span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-zinc-300 mt-0.5">
              <span className="truncate">{subtitle || "Painel de Gestão"}</span>
              <svg
                className="w-3 h-3 text-[#D3AE55] shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
            <p className="text-[10.5px] text-zinc-400 truncate mt-0.5">
              {capitalizedDate}
            </p>
          </div>
        </div>

        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Fechar menu"
          className="w-10 h-10 rounded-xl bg-[#1A1C22] hover:bg-[#23262E] border border-white/[0.10] text-zinc-300 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#D3AE55] flex items-center justify-center shrink-0 cursor-pointer"
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Scrollable Navigation List */}
      <div className="flex-1 overflow-y-auto px-3.5 py-2 space-y-2 overscroll-contain">
        {groups.map((group) => (
          <div key={group.id} className="space-y-1">
            <h3 className="px-2 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[#8E95A2]">
              {group.title}
            </h3>

            <div className="bg-[#15171C] border border-white/[0.07] rounded-2xl overflow-hidden divide-y divide-white/[0.05] shadow-[0_6px_20px_rgba(0,0,0,0.35)]">
              {group.items.map((item) => {
                const hasChildren = item.children.length > 0;
                const active = isRouteActive(item.href);
                const isOpenAccordion = !!openAccordion[item.href];

                return (
                  <div key={item.href} className={active ? "p-1" : ""}>
                    <div className="flex items-center">
                      <Link
                        href={item.href}
                        onClick={onClose}
                        className={`flex-1 flex items-center justify-between px-3 py-1.5 text-[13px] font-medium transition-all min-h-[34px] ${
                          active
                            ? "rounded-xl bg-gradient-to-r from-[#D3AE55]/25 via-[#D3AE55]/15 to-[#D3AE55]/[0.05] border border-[#D3AE55]/45 text-[#E8C76E] font-semibold shadow-[0_0_20px_rgba(211,174,85,0.14)]"
                            : "text-[#F0F2F5] hover:bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <NavIcon
                            name={item.iconName}
                            className={`w-4 h-4 ${
                              active ? "text-[#E8C76E]" : "text-zinc-300"
                            }`}
                          />
                          <span>{item.label}</span>
                        </div>

                        {!hasChildren && (
                          <svg
                            className={`w-3.5 h-3.5 ${
                              active ? "text-[#E8C76E]" : "text-zinc-500"
                            }`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        )}
                      </Link>

                      {hasChildren && (
                        <button
                          type="button"
                          onClick={() => toggleAccordion(item.href)}
                          aria-label={`Expandir ${item.label}`}
                          className="px-3 py-1.5 min-h-[34px] text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer"
                        >
                          <svg
                            className={`w-3.5 h-3.5 transition-transform duration-200 ${
                              isOpenAccordion ? "rotate-90 text-[#E8C76E]" : ""
                            }`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {hasChildren && isOpenAccordion && (
                      <div className="mx-3 mb-1.5 pl-3.5 border-l border-white/[0.08] space-y-0.5 py-0.5">
                        {item.children
                          .filter(
                            (c) =>
                              !c.roles ||
                              c.roles.includes(userRole ?? "") ||
                              isPlatformAdmin
                          )
                          .map((child) => {
                            const childActive = pathname === child.href;
                            return (
                              <Link
                                key={child.href}
                                href={child.href}
                                onClick={onClose}
                                className={`flex items-center px-2.5 py-1.5 rounded-lg text-xs font-medium min-h-[34px] transition-colors ${
                                  childActive
                                    ? "bg-[#D3AE55]/15 text-[#E8C76E] font-bold"
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
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer / User Session matching approved mobile menu */}
      <div className="px-4 py-3 border-t border-white/[0.08] bg-[#121419] shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-[#1C1F26] border border-white/[0.12] flex items-center justify-center font-serif font-bold text-xs text-white shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">{userName}</p>
              <p className="text-[11px] text-zinc-400">
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
            className="px-3 py-1.5 rounded-xl text-xs font-semibold text-[#EF5A67] hover:bg-[#EF5A67]/10 transition-colors min-h-[38px] cursor-pointer"
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}
