import { redirect } from "next/navigation";
import { requireManagerialAdmin } from "@/lib/admin-guard";

export default async function ConfiguracoesPage() {
  await requireManagerialAdmin();
  return redirect("/admin/financeiro/recorrentes");
}
