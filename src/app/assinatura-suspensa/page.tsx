import React from "react";
import { requireBillingAdmin } from "@/lib/admin-guard";
import { PlatformBillingManager } from "@/components/billing/PlatformBillingManager";

export const metadata = {
  title: "Assinatura Suspensa | Regularização | Tem Barber",
  description: "Regularize sua assinatura para reativar seu acesso.",
};

export default async function AssinaturaSuspensaPage() {
  await requireBillingAdmin();

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 flex flex-col items-center justify-start py-10 px-4">
      <div className="w-full max-w-4xl">
        <PlatformBillingManager
          paymentPath="/assinatura-suspensa/pagamento"
          backPath="/login"
          isSuspendedArea={true}
        />
      </div>
    </div>
  );
}