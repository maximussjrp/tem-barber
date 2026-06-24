import { requireAdmin } from "@/lib/admin-guard";
import { AdminSidebar } from "@/components/admin/Sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { barbershop, session } = await requireAdmin();

  const subtitle = barbershop?.city ? barbershop.city : "Painel de Gestão";

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-stone-950">
      <AdminSidebar
        barbershopName={barbershop?.name ?? "Tem Barber"}
        barbershopLogo={barbershop?.logoUrl}
        subtitle={subtitle}
        userName={session.user?.name ?? "Admin"}
      />
      {/* Offset content by sidebar width on desktop */}
      <main className="flex-1 lg:ml-64 min-h-screen overflow-x-hidden pt-[57px] lg:pt-0">
        {children}
      </main>
    </div>
  );
}
