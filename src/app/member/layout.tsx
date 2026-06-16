import { requireMember } from "@/lib/member-guard";
import { MemberNav } from "@/components/member/MemberNav";

export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { barbershop, member, role } = await requireMember();

  return (
    <div className="flex min-h-screen bg-stone-950">
      <MemberNav
        barbershopName={barbershop.name}
        memberName={member.user.name}
        avatarUrl={member.user.avatarUrl}
        role={role}
      />
      <main className="flex-1 md:ml-64 min-h-screen overflow-x-hidden pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}
