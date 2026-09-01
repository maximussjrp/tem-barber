"use client";

import { SessionProvider } from "next-auth/react";
import { PushLifecycleProvider } from "@/components/providers/PushLifecycleProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PushLifecycleProvider>{children}</PushLifecycleProvider>
    </SessionProvider>
  );
}
