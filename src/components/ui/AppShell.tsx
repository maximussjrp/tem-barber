import React from "react";

export interface AppShellProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({ sidebar, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Sidebar - Fixa à esquerda no desktop */}
      <aside className="hidden lg:flex flex-col w-64 h-screen fixed left-0 top-0 border-r border-border-subtle bg-surface z-30">
        {sidebar}
      </aside>

      {/* Conteúdo Principal */}
      <main className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        {children}
      </main>
    </div>
  );
}

export function PageShell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex-1 flex flex-col w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 ${className}`}>
      {children}
    </div>
  );
}
