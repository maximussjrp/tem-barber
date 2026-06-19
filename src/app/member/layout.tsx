import { requireMember } from "@/lib/member-guard";
import { MemberNav } from "@/components/member/MemberNav";

export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { barbershop, member, role } = await requireMember();

  const subtitle = barbershop?.city ? barbershop.city : "Painel Profissional";

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-stone-950">
      <MemberNav
        barbershopName={barbershop.name}
        barbershopLogo={barbershop.logoUrl}
        subtitle={subtitle}
        memberName={member.user.name}
        avatarUrl={member.user.avatarUrl}
        role={role}
      />
      <main className="flex-1 lg:ml-64 min-h-screen overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
