import { Prisma } from "@prisma/client";
import {
  normalizeBrazilianMobilePhone,
  validateBrazilianMobilePhone,
  getBrazilianPhoneVariants,
} from "./phone/br-phone";

export type CustomerLookupResult = {
  id: string;
  name: string;
  phone: string;
};

type CustomerTx = Pick<Prisma.TransactionClient, "appointment" | "user">;

type AdminClientDelegate = Prisma.TransactionClient | typeof import("@/lib/prisma").default;

export type AdminClientFilter =
  | "all"
  | "with_appointment"
  | "without_appointment"
  | "upcoming"
  | "open_comanda"
  | "club"
  | "blocked"
  | "never_contacted"
  | "no_contact_30"
  | "no_contact_60"
  | "no_contact_90"
  | "recently_contacted";

export type ManualClientInput = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type AdminClientListItem = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  createdAt: Date;
  sources: {
    link: boolean;
    appointment: boolean;
    comanda: boolean;
    club: boolean;
  };
  stats: {
    total: number;
    completed: number;
    cancelled: number;
    noShows: number;
    totalSpent: number;
    lastVisit: string | null;
    nextAppointmentAt: string | null;
    openComandas: number;
    closedComandas: number;
    hasClubSubscription: boolean;
    isBlocked: boolean;
    lastContactedAt: string | null;
    contactLogCount: number;
  };
};

export function normalizePhone(phone: string | null | undefined): string {
  return normalizeBrazilianMobilePhone(phone) ?? "";
}

export function phoneLookupVariants(phone: string | null | undefined): string[] {
  return getBrazilianPhoneVariants(phone);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function phoneBlockVariants(phone: string | null | undefined): string[] {
  const variants = phoneLookupVariants(phone);
  const rawDigits = (phone ?? "").replace(/\D/g, "");
  if (rawDigits) variants.push(rawDigits);
  return unique(variants.filter(Boolean));
}

function matchesClientSearch(user: { name: string; phone: string; email?: string | null }, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;

  const normalizedQueryPhone = normalizePhone(query);
  const phone = normalizePhone(user.phone);
  return (
    user.name.toLowerCase().includes(query) ||
    (user.email ?? "").toLowerCase().includes(query) ||
    (!!normalizedQueryPhone && phone.includes(normalizedQueryPhone)) ||
    (normalizedQueryPhone.length >= 8 && phone.includes(normalizedQueryPhone.slice(-8)))
  );
}

function clientPassesFilter(client: AdminClientListItem, filter: AdminClientFilter) {
  if (filter === "with_appointment") return client.sources.appointment;
  if (filter === "without_appointment") return !client.sources.appointment;
  if (filter === "upcoming") return Boolean(client.stats.nextAppointmentAt);
  if (filter === "open_comanda") return client.stats.openComandas > 0;
  if (filter === "club") return client.stats.hasClubSubscription;
  if (filter === "blocked") return client.stats.isBlocked;
  if (filter === "never_contacted") return client.stats.contactLogCount === 0;
  if (filter === "recently_contacted") return isRecentlyContacted(client.stats.lastContactedAt);
  if (filter === "no_contact_30") return hasNoContactSince(client.stats.lastContactedAt, 30);
  if (filter === "no_contact_60") return hasNoContactSince(client.stats.lastContactedAt, 60);
  if (filter === "no_contact_90") return hasNoContactSince(client.stats.lastContactedAt, 90);
  return true;
}

function daysAgo(days: number, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function hasNoContactSince(lastContactedAt: string | null, days: number, now = new Date()) {
  if (!lastContactedAt) return true;
  return new Date(lastContactedAt).getTime() < daysAgo(days, now).getTime();
}

function isRecentlyContacted(lastContactedAt: string | null, now = new Date()) {
  if (!lastContactedAt) return false;
  return new Date(lastContactedAt).getTime() >= daysAgo(7, now).getTime();
}

function emptyContactMetrics() {
  return {
    neverContacted: 0,
    noContact30: 0,
    recentlyContacted: 0,
  };
}

export function buildClientWhatsappMessage(input: {
  template: "invite" | "week" | "return" | "feedback";
  customerName: string;
  barbershopName: string;
  bookingUrl?: string | null;
}) {
  const bookingLine = input.bookingUrl ? `\n\nAgendamento: ${input.bookingUrl}` : "";
  if (input.template === "week") {
    return `Oi, ${input.customerName}, aqui e da ${input.barbershopName}. Nossa agenda da semana esta aberta. Quer garantir seu horario?${bookingLine}`;
  }
  if (input.template === "return") {
    return `Oi, ${input.customerName}, aqui e da ${input.barbershopName}. Ja faz um tempo desde seu ultimo atendimento. Quer marcar seu retorno?${bookingLine}`;
  }
  if (input.template === "feedback") {
    return `Oi, ${input.customerName}, aqui e da ${input.barbershopName}. Como foi seu atendimento? Seu feedback ajuda a gente a melhorar.`;
  }
  return `Oi, ${input.customerName}, aqui e da ${input.barbershopName}. Quer agendar seu horario?${bookingLine}`;
}

export function buildClientWhatsappLink(phone: string, message: string) {
  const formattedPhone = normalizePhone(phone);
  if (!formattedPhone) return null;
  return `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`;
}

export function phonesMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizePhone(left);
  const normalizedRight = normalizePhone(right);
  return !!normalizedLeft && normalizedLeft === normalizedRight;
}

export function phoneSearchFragments(phone: string | null | undefined) {
  const normalizedPhone = normalizePhone(phone);
  const fragments = new Set<string>();

  if (normalizedPhone) {
    fragments.add(normalizedPhone);
    if (normalizedPhone.startsWith("55")) {
      fragments.add(normalizedPhone.slice(2));
    }
  }
  if (normalizedPhone.length >= 8) fragments.add(normalizedPhone.slice(-8));
  if (normalizedPhone.length >= 9) fragments.add(normalizedPhone.slice(-9, -4));
  if (normalizedPhone.length >= 5) fragments.add(normalizedPhone.slice(-5));

  return [...fragments].filter(Boolean);
}

export async function findBarbershopCustomerByPhone(
  tx: CustomerTx,
  barbershopId: string,
  phone: string | null | undefined
): Promise<CustomerLookupResult | null> {
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 8) return null;

  const phoneFragments = phoneSearchFragments(normalizedPhone);
  const rows = await tx.appointment.findMany({
    where: {
      barbershopId,
      OR: phoneFragments.map((fragment) => ({
        customer: { phone: { contains: fragment } },
      })),
    },
    distinct: ["customerId"],
    take: 50,
    orderBy: { dateTime: "desc" },
    select: {
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  return rows.find((row) => phonesMatch(row.customer.phone, normalizedPhone))?.customer ?? null;
}

export async function findBarbershopCustomerById(
  tx: CustomerTx,
  barbershopId: string,
  customerId: string
): Promise<CustomerLookupResult | null> {
  const row = await tx.appointment.findFirst({
    where: { barbershopId, customerId },
    orderBy: { dateTime: "desc" },
    select: {
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  return row?.customer ?? null;
}

export async function resolveBarbershopCustomerForBooking(
  tx: CustomerTx,
  input: {
    barbershopId: string;
    customerId?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
  }
): Promise<CustomerLookupResult> {
  if (input.customerId) {
    const scopedCustomer = await findBarbershopCustomerById(
      tx,
      input.barbershopId,
      input.customerId
    );
    if (scopedCustomer) return scopedCustomer;

    const globalUser = await tx.user.findFirst({
      where: { id: input.customerId },
      select: { id: true, name: true, phone: true },
    });
    if (globalUser && globalUser.id === input.customerId) return globalUser;

    throw new Error("CUSTOMER_NOT_FOUND_IN_BARBERSHOP");
  }

  const normalizedPhone = normalizePhone(input.customerPhone);
  if (!normalizedPhone) {
    throw new Error("CUSTOMER_PHONE_REQUIRED");
  }

  const existingCustomer = await findBarbershopCustomerByPhone(
    tx,
    input.barbershopId,
    normalizedPhone
  );
  if (existingCustomer) return existingCustomer;

  const globalUser = await tx.user.findFirst({
    where: { phone: { in: getBrazilianPhoneVariants(normalizedPhone) } },
    select: { id: true, name: true, phone: true },
  });
  if (globalUser && phonesMatch(globalUser.phone, normalizedPhone)) return globalUser;

  return tx.user.create({
    data: {
      name: input.customerName?.trim() || "Cliente",
      phone: normalizedPhone,
      role: "USER",
    },
    select: { id: true, name: true, phone: true },
  });
}

export async function createManualBarbershopClient(
  client: AdminClientDelegate,
  barbershopId: string,
  input: ManualClientInput
) {
  const name = input.name?.trim();
  const normalizedPhone = normalizePhone(input.phone);
  const email = input.email?.trim() || null;

  if (!name || name.length < 2) {
    return { error: "INVALID_NAME" as const, message: "Informe o nome do cliente." };
  }
  if (!validateBrazilianMobilePhone(normalizedPhone)) {
    return { error: "INVALID_PHONE" as const, message: "Informe um WhatsApp valido com DDD." };
  }

  const activeBlock = await client.barbershopBlockedCustomer.findFirst({
    where: {
      barbershopId,
      active: true,
      phoneNormalized: { in: phoneBlockVariants(normalizedPhone) },
    },
    select: { id: true },
  });

  if (activeBlock) {
    return {
      error: "CUSTOMER_BLOCKED" as const,
      message: "Este telefone esta bloqueado nesta barbearia.",
    };
  }

  const user = await client.user.upsert({
    where: { phone: normalizedPhone },
    create: {
      name,
      phone: normalizedPhone,
      email,
      role: "USER",
    },
    update: {
      ...(email ? { email } : {}),
    },
    select: { id: true, name: true, phone: true, email: true, createdAt: true },
  });

  const link = await client.customerBarbershopLink.upsert({
    where: {
      barbershopId_customerId: {
        barbershopId,
        customerId: user.id,
      },
    },
    create: {
      barbershopId,
      customerId: user.id,
    },
    update: {},
    select: { id: true, createdAt: true },
  });

  return {
    client: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      createdAt: user.createdAt,
      linkId: link.id,
    },
  };
}

export async function collectBarbershopCustomerIds(client: AdminClientDelegate, barbershopId: string) {
  const [links, appointments, comandas, subscriptions] = await Promise.all([
    client.customerBarbershopLink?.findMany({
      where: { barbershopId },
      select: { customerId: true },
    }) ?? Promise.resolve([]),
    client.appointment.findMany({
      where: { barbershopId },
      distinct: ["customerId"],
      select: { customerId: true },
    }),
    client.comanda?.findMany({
      where: { barbershopId, customerId: { not: null } },
      distinct: ["customerId"],
      select: { customerId: true },
    }) ?? Promise.resolve([]),
    client.customerClubSubscription?.findMany({
      where: { barbershopId },
      distinct: ["customerId"],
      select: { customerId: true },
    }) ?? Promise.resolve([]),
  ]);

  return {
    ids: unique([
      ...links.map((row) => row.customerId),
      ...appointments.map((row) => row.customerId),
      ...comandas.map((row) => row.customerId).filter(Boolean),
      ...subscriptions.map((row) => row.customerId),
    ] as string[]),
    sourceSets: {
      link: new Set(links.map((row) => row.customerId)),
      appointment: new Set(appointments.map((row) => row.customerId)),
      comanda: new Set(comandas.map((row) => row.customerId).filter(Boolean) as string[]),
      club: new Set(subscriptions.map((row) => row.customerId)),
    },
  };
}

export async function listBarbershopClients(
  client: AdminClientDelegate,
  params: {
    barbershopId: string;
    search?: string;
    filter?: AdminClientFilter;
    page?: number;
    pageSize?: number;
  }
) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 30));
  const filter = params.filter ?? "all";
  const { ids, sourceSets } = await collectBarbershopCustomerIds(client, params.barbershopId);

  if (ids.length === 0) {
    return { clients: [], total: 0, page, pageSize, contactMetrics: emptyContactMetrics() };
  }

  const users = await client.user.findMany({
    where: { id: { in: ids } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true, email: true, createdAt: true },
  });

  const matchingUsers = users.filter((user) => matchesClientSearch(user, params.search ?? ""));
  const matchingIds = matchingUsers.map((user) => user.id);

  if (matchingIds.length === 0) {
    return { clients: [], total: 0, page, pageSize, contactMetrics: emptyContactMetrics() };
  }

  const now = new Date();
  const [appointments, comandas, clubSubscriptions, blocks, contactGroups] = await Promise.all([
    client.appointment.findMany({
      where: { barbershopId: params.barbershopId, customerId: { in: matchingIds } },
      select: { customerId: true, status: true, dateTime: true },
    }),
    client.comanda.findMany({
      where: { barbershopId: params.barbershopId, customerId: { in: matchingIds } },
      select: { customerId: true, status: true, paidTotal: true },
    }),
    client.customerClubSubscription.findMany({
      where: {
        barbershopId: params.barbershopId,
        customerId: { in: matchingIds },
        status: { in: ["ACTIVE", "GRACE_PERIOD"] },
      },
      select: { customerId: true },
    }),
    client.barbershopBlockedCustomer.findMany({
      where: {
        barbershopId: params.barbershopId,
        active: true,
        OR: [
          { userId: { in: matchingIds } },
          {
            phoneNormalized: {
              in: unique(matchingUsers.flatMap((user) => phoneBlockVariants(user.phone))),
            },
          },
        ],
      },
      select: { userId: true, phoneNormalized: true },
    }),
    client.customerContactLog.groupBy({
      by: ["customerId"],
      where: { barbershopId: params.barbershopId, customerId: { in: matchingIds } },
      _max: { contactedAt: true },
      _count: { _all: true },
    }),
  ]);

  const statsMap = new Map<string, AdminClientListItem["stats"]>();
  const usersById = new Map(matchingUsers.map((user) => [user.id, user]));
  for (const user of matchingUsers) {
    statsMap.set(user.id, {
      total: 0,
      completed: 0,
      cancelled: 0,
      noShows: 0,
      totalSpent: 0,
      lastVisit: null,
      nextAppointmentAt: null,
      openComandas: 0,
      closedComandas: 0,
      hasClubSubscription: false,
      isBlocked: false,
      lastContactedAt: null,
      contactLogCount: 0,
    });
  }

  for (const appointment of appointments) {
    const stats = statsMap.get(appointment.customerId);
    if (!stats) continue;
    stats.total += 1;
    if (appointment.status === "COMPLETED") {
      stats.completed += 1;
      const iso = appointment.dateTime.toISOString();
      if (!stats.lastVisit || iso > stats.lastVisit) stats.lastVisit = iso;
    }
    if (appointment.status === "CANCELLED") stats.cancelled += 1;
    if (appointment.status === "NO_SHOW") stats.noShows += 1;
    if (
      appointment.dateTime.getTime() > now.getTime() &&
      (appointment.status === "CONFIRMED" || appointment.status === "PENDING")
    ) {
      const iso = appointment.dateTime.toISOString();
      if (!stats.nextAppointmentAt || iso < stats.nextAppointmentAt) stats.nextAppointmentAt = iso;
    }
  }

  for (const comanda of comandas) {
    if (!comanda.customerId) continue;
    const stats = statsMap.get(comanda.customerId);
    if (!stats) continue;
    if (comanda.status === "OPEN" || comanda.status === "IN_SERVICE") stats.openComandas += 1;
    if (comanda.status === "CLOSED") stats.closedComandas += 1;
    if (comanda.status !== "CANCELLED" && Number(comanda.paidTotal) > 0) {
      stats.totalSpent += Number(comanda.paidTotal);
    }
  }

  for (const subscription of clubSubscriptions) {
    statsMap.get(subscription.customerId)!.hasClubSubscription = true;
  }

  for (const block of blocks) {
    for (const user of matchingUsers) {
      if (block.userId === user.id || phoneBlockVariants(user.phone).includes(block.phoneNormalized)) {
        statsMap.get(user.id)!.isBlocked = true;
      }
    }
  }

  for (const contact of contactGroups) {
    const stats = statsMap.get(contact.customerId);
    if (!stats) continue;
    stats.lastContactedAt = contact._max.contactedAt?.toISOString() ?? null;
    stats.contactLogCount = contact._count._all;
  }

  const unfilteredClients = matchingUsers
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      createdAt: user.createdAt,
      sources: {
        link: sourceSets.link.has(user.id),
        appointment: sourceSets.appointment.has(user.id),
        comanda: sourceSets.comanda.has(user.id),
        club: sourceSets.club.has(user.id),
      },
      stats: statsMap.get(user.id)!,
    }));

  const contactMetrics = {
    neverContacted: unfilteredClients.filter((clientItem) => clientItem.stats.contactLogCount === 0).length,
    noContact30: unfilteredClients.filter((clientItem) => hasNoContactSince(clientItem.stats.lastContactedAt, 30, now)).length,
    recentlyContacted: unfilteredClients.filter((clientItem) => isRecentlyContacted(clientItem.stats.lastContactedAt, now)).length,
  };

  const clients = unfilteredClients.filter((clientItem) => clientPassesFilter(clientItem, filter));

  const total = clients.length;
  const paged = clients.slice((page - 1) * pageSize, page * pageSize);
  return { clients: paged, total, page, pageSize, contactMetrics };
}

export async function searchBarbershopClients(
  client: AdminClientDelegate,
  barbershopId: string,
  query: string
) {
  const result = await listBarbershopClients(client, {
    barbershopId,
    search: query,
    page: 1,
    pageSize: 10,
  });

  return result.clients.map((clientItem) => ({
    id: clientItem.id,
    name: clientItem.name,
    phone: clientItem.phone,
    lastAppointmentAt: clientItem.stats.lastVisit ?? clientItem.stats.nextAppointmentAt,
  }));
}
