import { redirect } from "next/navigation";
import { requireAdmin, RECEPTIONIST_HOME_PATH } from "@/lib/admin-guard";

export default async function AdminIndexPage() {
  const { role, barbershopId, isPlatform } = await requireAdmin();
  if (!barbershopId) {
    return redirect(isPlatform ? "/admin/platform" : "/acesso-negado");
  }
  if (role === "RECEPTIONIST") {
    return redirect(RECEPTIONIST_HOME_PATH);
  }
  return redirect("/admin/dashboard");
}
