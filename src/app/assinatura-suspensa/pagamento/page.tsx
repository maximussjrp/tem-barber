import React from "react";
import { requireBillingAdmin } from "@/lib/admin-guard";
import { SubscriptionPaymentPanel } from "@/components/billing/SubscriptionPaymentPanel";

export const metadata = {
  title: "Pagamento da Assinatura | Tem Barber",
  description: "Conclua o pagamento para reativar seu acesso.",
};

export default async function AssinaturaSuspensaPagamentoPage() {
  await requireBillingAdmin();

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 flex flex-col items-center justify-start py-10 px-4">
      <div className="w-full max-w-4xl">
        <SubscriptionPaymentPanel backPath="/assinatura-suspensa" />
      </div>
    </div>
  );
}