import type { Prisma, PrismaClient } from "@prisma/client";
import {
  InvalidServiceSelectionError,
  ProfessionalNotAvailableError,
  ProfessionalServiceMismatchError,
} from "./errors";
import type { AppointmentServiceInput } from "./calculate-appointment";

type CapabilityDb = PrismaClient | Prisma.TransactionClient;

type CapabilityMember = {
  id: string;
  barbershopId: string;
  isActive: boolean;
};

export interface ValidatedProfessionalServiceCapability {
  member: CapabilityMember;
  services: AppointmentServiceInput[];
  normalizedServiceIds: string[];
}

export interface EligibleMembersForServices {
  services: AppointmentServiceInput[];
  normalizedServiceIds: string[];
  memberIds: string[];
}

export function normalizeServiceIds(serviceIds: string[] | undefined | null) {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const id of serviceIds ?? []) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function orderServicesByInput<T extends { id: string }>(services: T[], serviceIds: string[]) {
  const order = new Map(serviceIds.map((id, index) => [id, index]));
  return [...services].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function validateProfessionalServiceCapability(
  db: CapabilityDb,
  {
    barbershopId,
    memberId,
    serviceIds,
  }: {
    barbershopId: string;
    memberId: string;
    serviceIds: string[];
  }
): Promise<ValidatedProfessionalServiceCapability> {
  const normalizedServiceIds = normalizeServiceIds(serviceIds);
  if (!normalizedServiceIds.length) {
    throw new InvalidServiceSelectionError();
  }

  const member = await db.barbershopMember.findFirst({
    where: { id: memberId, barbershopId, isActive: true },
    select: { id: true, barbershopId: true, isActive: true },
  });
  if (!member) {
    throw new ProfessionalNotAvailableError();
  }

  const services = await db.service.findMany({
    where: { id: { in: normalizedServiceIds }, barbershopId, isActive: true },
    select: { id: true, price: true, durationMin: true },
  });
  if (services.length !== normalizedServiceIds.length) {
    throw new InvalidServiceSelectionError();
  }

  const links = await db.barberService.findMany({
    where: { barberId: memberId, serviceId: { in: normalizedServiceIds } },
    select: { serviceId: true },
  });
  if (links.length !== normalizedServiceIds.length) {
    throw new ProfessionalServiceMismatchError();
  }

  return {
    member,
    services: orderServicesByInput(services, normalizedServiceIds),
    normalizedServiceIds,
  };
}

export async function findEligibleMembersForServices(
  db: CapabilityDb,
  {
    barbershopId,
    serviceIds,
    memberId,
  }: {
    barbershopId: string;
    serviceIds: string[];
    memberId?: string;
  }
): Promise<EligibleMembersForServices> {
  const normalizedServiceIds = normalizeServiceIds(serviceIds);
  if (!normalizedServiceIds.length) {
    return { services: [], normalizedServiceIds, memberIds: [] };
  }

  const services = await db.service.findMany({
    where: { id: { in: normalizedServiceIds }, barbershopId, isActive: true },
    select: { id: true, price: true, durationMin: true },
  });
  if (services.length !== normalizedServiceIds.length) {
    return { services: [], normalizedServiceIds, memberIds: [] };
  }

  const members = await db.barbershopMember.findMany({
    where: {
      barbershopId,
      isActive: true,
      ...(memberId ? { id: memberId } : {}),
    },
    select: { id: true },
  });
  if (!members.length) {
    return {
      services: orderServicesByInput(services, normalizedServiceIds),
      normalizedServiceIds,
      memberIds: [],
    };
  }

  const candidateIds = members.map((member) => member.id);
  const links = await db.barberService.findMany({
    where: {
      barberId: { in: candidateIds },
      serviceId: { in: normalizedServiceIds },
    },
    select: { barberId: true, serviceId: true },
  });

  const serviceIdsByMember = new Map<string, Set<string>>();
  for (const link of links) {
    const set = serviceIdsByMember.get(link.barberId) ?? new Set<string>();
    set.add(link.serviceId);
    serviceIdsByMember.set(link.barberId, set);
  }

  const memberIds = candidateIds.filter(
    (id) => (serviceIdsByMember.get(id)?.size ?? 0) === normalizedServiceIds.length
  );

  return {
    services: orderServicesByInput(services, normalizedServiceIds),
    normalizedServiceIds,
    memberIds,
  };
}
