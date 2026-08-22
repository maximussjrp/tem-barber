import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

const activeMembershipArgs = Prisma.validator<Prisma.BarbershopMemberDefaultArgs>()({
  select: {
    id: true,
    userId: true,
    barbershopId: true,
    role: true,
    isActive: true,
    barbershop: {
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        description: true,
        phone: true,
        city: true,
      },
    },
    user: {
      select: {
        id: true,
        name: true,
        avatarUrl: true,
      },
    },
  },
});

export type ActiveMembership = Prisma.BarbershopMemberGetPayload<typeof activeMembershipArgs>;

export type ActiveMembershipResolution =
  | { status: "NONE"; membership: null }
  | { status: "SINGLE"; membership: ActiveMembership }
  | { status: "MULTIPLE"; membership: null };

export async function resolveSingleActiveMembership(
  userId: string
): Promise<ActiveMembershipResolution> {
  const memberships = await prisma.barbershopMember.findMany({
    where: { userId, isActive: true },
    take: 2,
    ...activeMembershipArgs,
  });

  if (memberships.length === 0) {
    return { status: "NONE", membership: null };
  }

  if (memberships.length > 1) {
    return { status: "MULTIPLE", membership: null };
  }

  return { status: "SINGLE", membership: memberships[0] };
}
