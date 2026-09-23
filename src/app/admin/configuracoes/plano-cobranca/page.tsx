"use client";

import { PlatformBillingManager } from "@/components/billing/PlatformBillingManager";

export default function PlanoCobrancaPage() {
  return (
    <PlatformBillingManager
      paymentPath="/admin/configuracoes/plano-cobranca/pagamento"
      backPath="/admin"
      isSuspendedArea={false}
    />
  );
}