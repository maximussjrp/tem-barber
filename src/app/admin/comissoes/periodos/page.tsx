import { redirect } from "next/navigation";
import { requireManagerialAdmin } from "@/lib/admin-guard";

export default async function CommissionPeriodsPage() {
  await requireManagerialAdmin();
  return redirect("/admin/comissoes/pagamentos");
}
