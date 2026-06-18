import React from "react";
import { IconButton } from "./IconButton";

export interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

export function Header({ title, subtitle, actions, onMenuClick, showMenuButton = true }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex w-full items-center justify-between border-b border-border-subtle bg-background/80 px-4 sm:px-6 lg:px-8 py-4 backdrop-blur-md">
      <div className="flex items-center gap-4">
        {showMenuButton && (
          <div className="lg:hidden">
            <IconButton
              variant="ghost"
              aria-label="Menu"
              onClick={onMenuClick}
              icon={
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <line x1="3" y1="18" x2="21" y2="18"></line>
                </svg>
              }
            />
          </div>
        )}
        <div className="flex flex-col">
          <h1 className="heading-2 text-text-primary">{title}</h1>
          {subtitle && <p className="body-small text-text-secondary">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </header>
  );
}
