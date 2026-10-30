import { requireAdmin } from "@/lib/admin-guard";
import { AdminSidebar } from "@/components/admin/Sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { barbershop, session, role, isPlatform } = await requireAdmin();

  const subtitle = barbershop?.city ? barbershop.city : "Painel de Gestão";

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-[#0B0D10] text-[#F5F5F5] print:bg-white print:text-black print:min-h-0">
      <AdminSidebar
        barbershopName={barbershop?.name ?? "Tem Barber"}
        barbershopLogo={barbershop?.logoUrl}
        subtitle={subtitle}
        userName={session.user?.name ?? "Admin"}
        userRole={role}
        isPlatformAdmin={isPlatform}
      />
      {/* Offset content by sidebar width on desktop, and leave padding-bottom for mobile bottom navigation */}
      <main className="flex-1 lg:ml-64 min-h-screen overflow-x-hidden pt-[57px] lg:pt-0 pb-20 lg:pb-8 print:ml-0 print:pt-0 print:pb-0 print:min-h-0 print:overflow-visible">
        {children}
      </main>
    </div>
  );
}
