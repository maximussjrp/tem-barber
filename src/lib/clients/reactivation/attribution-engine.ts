/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Prisma,
  RecipientDispatchStatus,
  RecipientConversionStatus,
} from "@prisma/client";
import {
  getSaoPauloCivilDateString,
  extractCanonicalVisitsForCustomer,
  CanonicalCustomerVisit,
} from "./canonical-visit-engine";

export interface ReconcileCampaignAttributionInput {
  barbershopId: string;
  campaignId: string;
  now?: Date;
}

export interface RecipientAttributionSummaryItem {
  recipientId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  dispatchStatus: RecipientDispatchStatus;
  sentConfirmedAt: string | null;
  conversionStatus: RecipientConversionStatus;
  canonicalReturnDate: string | null;
  conversionAttributedAt: string | null;
  revenueAttributed: number;
  attributedAppointment: {
    id: string;
    dateTime: string;
    createdAt: string;
    status: string;
    serviceName?: string | null;
    memberName?: string | null;
  } | null;
  attributedComanda: {
    id: string;
    paidTotal: number;
    status: string;
    closedAt: string | null;
  } | null;
}

export interface CampaignAttributionSummary {
  campaignId: string;
  name: string;
  status: string;
  attributionVersion: string;
  bookingAttributionWindowDays: number;
  directReturnWindowDays: number;
  contacts: number;
  customersWithAttributedBooking: number;
  attributedBookings: number;
  cancelledBookings: number;
  noShows: number;
  reactivatedCustomers: number;
  bookingRate: number;
  attendanceRate: number;
  conversionRate: number;
  recoveredRevenue: number;
  recipients: RecipientAttributionSummaryItem[];
}

export interface RecipientAttributionDetail {
  recipient: {
    id: string;
    campaignId: string;
    barbershopId: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    dispatchStatus: RecipientDispatchStatus;
    sentConfirmedAt: string | null;
    timingStateSnapshot: string;
    scoreSnapshot: number;
    previewMessage: string;
  };
  attribution: {
    conversionStatus: RecipientConversionStatus;
    canonicalReturnDate: string | null;
    conversionAttributedAt: string | null;
    revenueAttributed: number;
  };
  evidence: {
    appointment: {
      id: string;
      dateTime: string;
      createdAt: string;
      status: string;
      serviceName?: string | null;
      memberName?: string | null;
    } | null;
    comandas: Array<{
      id: string;
      paidTotal: number;
      status: string;
      closedAt: string | null;
      itemsCount: number;
    }>;
    timeline: Array<{
      event: string;
      timestamp: string;
      detail: string;
    }>;
  };
}

export interface CustomerAttributionHistoryItem {
  recipientId: string;
  campaignId: string;
  campaignName: string;
  channel: string;
  sentConfirmedAt: string | null;
  dispatchStatus: RecipientDispatchStatus;
  conversionStatus: RecipientConversionStatus;
  canonicalReturnDate: string | null;
  revenueAttributed: number;
  appointment: {
    id: string;
    dateTime: string;
    status: string;
  } | null;
}

export interface CustomerAttributionHistoryResponse {
  customerId: string;
  barbershopId: string;
  totalTouches: number;
  totalConversions: number;
  totalRevenueRecovered: number;
  history: CustomerAttributionHistoryItem[];
}

/**
 * Parses YYYY-MM-DD into a UTC Date object for @db.Date column.
 */
function parseCivilDateToDateObj(dateStr: string): Date {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  const d = Number(dateStr.slice(8, 10));
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

/**
 * Formats a Date object from @db.Date column into YYYY-MM-DD string.
 */
function formatCanonicalDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Calculates attribution rate strictly without silent error clamping.
 * Invariant: 0 <= numerator <= contacts.
 * If numerator < 0 or numerator > contacts, throws an explicit business error.
 */
export function calculateAttributionRate(numerator: number, contacts: number, rateName: string = "rate"): number {
  if (contacts < 0) {
    throw new Error(`INVALID_ATTRIBUTION_RATE: contacts (${contacts}) cannot be negative for ${rateName}.`);
  }
  if (contacts === 0) {
    if (numerator !== 0) {
      throw new Error(`INVALID_ATTRIBUTION_RATE: impossible state where contacts=0 but ${rateName} numerator=${numerator}.`);
    }
    return 0;
  }
  if (numerator < 0 || numerator > contacts) {
    throw new Error(
      `INVALID_ATTRIBUTION_RATE: impossible state where ${rateName} numerator (${numerator}) is outside [0, ${contacts}].`
    );
  }
  return Number((numerator / contacts).toFixed(4));
}

/**
 * Reconciles attribution deterministically for a campaign and all affected customers.
 */
export async function reconcileCampaignAttribution(
  prisma: Prisma.TransactionClient | any,
  input: ReconcileCampaignAttributionInput
): Promise<CampaignAttributionSummary> {
  const { barbershopId, campaignId } = input;

  const campaign = await prisma.reactivationCampaign.findFirst({
    where: { id: campaignId, barbershopId },
  });

  if (!campaign) {
    const err: any = new Error("CAMPAIGN_NOT_FOUND: Campaign not found for this barbershop.");
    err.status = 404;
    throw err;
  }

  // 1. Fetch all recipients in this campaign
  const campaignRecipients = await prisma.reactivationCampaignRecipient.findMany({
    where: { campaignId, barbershopId },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
    },
  });

  const sentRecipients = campaignRecipients.filter(
    (r: any) =>
      r.dispatchStatus === RecipientDispatchStatus.SENT_CONFIRMED &&
      r.sentConfirmedAt !== null
  );

  const customerIds: string[] = Array.from(
    new Set<string>(sentRecipients.map((r: any) => String(r.customerId)))
  ).sort();

  // If no sent recipients, return empty metrics immediately
  if (customerIds.length === 0) {
    await prisma.reactivationCampaign.update({
      where: { id: campaignId },
      data: {
        convertedCount: 0,
        totalRevenueAttributed: new Prisma.Decimal(0),
      },
    });

    return getCampaignAttributionSummary(prisma, { barbershopId, campaignId });
  }

  // 2. Concurrency Control: Acquire PostgreSQL Advisory Locks per customer in ascending order
  for (const custId of customerIds) {
    await prisma.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext('crm_attr:' || $1 || ':' || $2))`,
      barbershopId,
      custId
    );
  }

  // 3. Fetch all sent contacts across all campaigns for these customers (ordered by sentConfirmedAt ASC)
  const allCustomerSentContacts = await prisma.reactivationCampaignRecipient.findMany({
    where: {
      barbershopId,
      customerId: { in: customerIds },
      dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
      sentConfirmedAt: { not: null },
    },
    include: {
      campaign: true,
    },
    orderBy: [{ sentConfirmedAt: "asc" }, { id: "asc" }],
  });

  // 4. Fetch all appointments for these customers
  const allAppointments = await prisma.appointment.findMany({
    where: {
      barbershopId,
      customerId: { in: customerIds },
    },
    include: {
      services: {
        include: {
          service: { select: { id: true, name: true } },
        },
      },
      barber: {
        include: {
          user: { select: { id: true, name: true } },
        },
      },
      comandas: {
        where: { status: { not: "CANCELLED" } },
        include: {
          items: {
            where: { type: "SERVICE", status: "DONE" },
            select: { completedAt: true },
          },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { dateTime: "asc" }, { id: "asc" }],
  });

  // 5. Fetch all comandas with items for these customers
  const allComandas = await prisma.comanda.findMany({
    where: {
      barbershopId,
      customerId: { in: customerIds },
      status: { not: "CANCELLED" },
    },
    include: {
      items: {
        where: { type: "SERVICE", status: "DONE" },
        select: { id: true, type: true, status: true, completedAt: true },
      },
      appointment: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  // 6. Group by customerId
  const contactsByCustomer = new Map<string, any[]>();
  for (const contact of allCustomerSentContacts) {
    const list = contactsByCustomer.get(contact.customerId) || [];
    list.push(contact);
    contactsByCustomer.set(contact.customerId, list);
  }

  const appointmentsByCustomer = new Map<string, any[]>();
  for (const appt of allAppointments) {
    if (!appt.customerId) continue;
    const list = appointmentsByCustomer.get(appt.customerId) || [];
    list.push(appt);
    appointmentsByCustomer.set(appt.customerId, list);
  }

  const comandasByCustomer = new Map<string, any[]>();
  for (const comanda of allComandas) {
    if (!comanda.customerId) continue;
    const list = comandasByCustomer.get(comanda.customerId) || [];
    list.push(comanda);
    comandasByCustomer.set(comanda.customerId, list);
  }

  // 7. Deterministic Multi-Campaign Last Eligible Touch & First Return Reconciliation per Customer
  const recipientUpdates: Array<{
    id: string;
    campaignId: string;
    conversionStatus: RecipientConversionStatus;
    attributedAppointmentId: string | null;
    attributedComandaId: string | null;
    canonicalReturnDate: Date | null;
    conversionAttributedAt: Date | null;
    revenueAttributed: Prisma.Decimal | null;
  }> = [];

  for (const custId of customerIds) {
    const contacts = contactsByCustomer.get(custId) || [];
    const customerAppts = appointmentsByCustomer.get(custId) || [];
    const customerComandas = comandasByCustomer.get(custId) || [];

    // Extract all candidate canonical return visits using shared canonical visit engine (R3 authority)
    const candidateVisits = extractCanonicalVisitsForCustomer(
      customerAppts,
      customerComandas
    );

    // Sort candidate visits by timestamp ASC
    candidateVisits.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Step A: Match Bookings to Last Eligible Touch Contact
    // Rule: For each appointment A, find the latest contact C sent before A.createdAt within C's booking window.
    const appointmentsByContact = new Map<string, any[]>();

    for (const appt of customerAppts) {
      const apptCreatedTs = new Date(appt.createdAt).getTime();

      // Eligible contacts: sentConfirmedAt < appt.createdAt (strictly after T0)
      let bestContact: any = null;
      for (const contact of contacts) {
        const t0 = new Date(contact.sentConfirmedAt).getTime();
        if (apptCreatedTs <= t0) {
          // Pre-existing booking check: Contact sent AT or AFTER appointment creation cannot claim it!
          continue;
        }

        const bookingWindowDays = contact.campaign?.bookingAttributionWindowDays ?? 14;
        const windowEndTs = t0 + bookingWindowDays * 24 * 60 * 60 * 1000;

        if (apptCreatedTs <= windowEndTs) {
          // Candidate contact. Last Eligible Touch = latest t0
          if (!bestContact || t0 > new Date(bestContact.sentConfirmedAt).getTime()) {
            bestContact = contact;
          }
        }
      }

      if (bestContact) {
        const list = appointmentsByContact.get(bestContact.id) || [];
        list.push(appt);
        appointmentsByContact.set(bestContact.id, list);
      }
    }

    // Step B: Reconcile First Canonical Return Visit per Contact
    const claimedCivilDates = new Set<string>();

    for (const contact of contacts) {
      const t0 = new Date(contact.sentConfirmedAt).getTime();
      const directReturnWindowDays = contact.campaign?.directReturnWindowDays ?? 30;
      const returnWindowEndTs = t0 + directReturnWindowDays * 24 * 60 * 60 * 1000;

      const contactAppts = appointmentsByContact.get(contact.id) || [];
      let attributedAppt: any = null;
      let attributedVisit: CanonicalCustomerVisit | null = null;

      // 1. Check if any matched appointment had a completed return visit in window
      for (const appt of contactAppts) {
        for (const visit of candidateVisits) {
          if (visit.appointmentId === appt.id && visit.isCompletedService) {
            const visitTs = visit.timestamp.getTime();
            if (visitTs > t0 && visitTs <= returnWindowEndTs) {
              if (!claimedCivilDates.has(visit.civilDate)) {
                if (!attributedVisit || visitTs < attributedVisit.timestamp.getTime()) {
                  attributedVisit = visit;
                  attributedAppt = appt;
                }
              }
            }
          }
        }
      }

      // If no completed visit was linked to an appointment, but there were matched bookings, select primary booking
      if (!attributedAppt && contactAppts.length > 0) {
        attributedAppt =
          contactAppts.find(
            (a: any) => a.status !== "CANCELLED" && a.status !== "NO_SHOW"
          ) || contactAppts[0];
      }

      // 2. If no appointment-linked visit, check for direct return (walk-in) where contact is Last Eligible Touch
      if (!attributedVisit) {
        for (const visit of candidateVisits) {
          if (visit.source === "APPOINTMENT" || visit.appointmentId) {
            continue; // Appointment visits can only be attributed via Step 1 if the booking was attributed
          }
          const visitTs = visit.timestamp.getTime();
          if (visitTs <= t0 || visitTs > returnWindowEndTs) continue;
          if (!visit.isCompletedService) continue;
          if (claimedCivilDates.has(visit.civilDate)) continue;

          // Check if contact is Last Eligible Touch before visit
          let latestTouchBeforeVisit: any = null;
          for (const c of contacts) {
            const cT0 = new Date(c.sentConfirmedAt).getTime();
            if (cT0 < visitTs) {
              if (!latestTouchBeforeVisit || cT0 > new Date(latestTouchBeforeVisit.sentConfirmedAt).getTime()) {
                latestTouchBeforeVisit = c;
              }
            }
          }

          if (latestTouchBeforeVisit?.id === contact.id) {
            attributedVisit = visit;
            break; // First qualifying return visit only
          }
        }
      }

      // 3. Calculate conversion status and revenue for this contact
      let conversionStatus: RecipientConversionStatus = RecipientConversionStatus.NONE;
      const finalApptId: string | null = attributedAppt?.id || null;
      let finalComandaId: string | null = null;
      let canonicalReturnDate: Date | null = null;
      let conversionAttributedAt: Date | null = null;
      let revenueAttributed: Prisma.Decimal | null = null;

      if (attributedVisit) {
        claimedCivilDates.add(attributedVisit.civilDate);
        canonicalReturnDate = parseCivilDateToDateObj(attributedVisit.civilDate);
        conversionAttributedAt = attributedVisit.timestamp;
        finalComandaId = attributedVisit.comandaId || null;

        // Fetch all qualifying comandas on that civil date to compute exact revenue
        // Deduplicated by comanda.id
        const uniqueComandas = new Map<string, number>();

        if (attributedVisit.source === "APPOINTMENT") {
          for (const c of attributedVisit.comandas) {
            if (Number(c.paidTotal) > 0) {
              uniqueComandas.set(c.id, Number(c.paidTotal));
            }
          }
        } else {
          // Direct return: standalone comandas with completed services on that civil date
          for (const c of attributedVisit.comandas) {
            if (Number(c.paidTotal) > 0) {
              uniqueComandas.set(c.id, Number(c.paidTotal));
            }
          }
          for (const c of customerComandas) {
            if (c.appointmentId) continue; // Skip comandas tied to appointments
            const hasDoneService = (c.items || []).length > 0;
            if (!hasDoneService) continue; // Skip product-only comandas
            const cTs = c.closedAt ? new Date(c.closedAt) : new Date(c.createdAt);
            if (getSaoPauloCivilDateString(cTs) === attributedVisit.civilDate && Number(c.paidTotal) > 0) {
              uniqueComandas.set(c.id, Number(c.paidTotal));
            }
          }
        }

        let totalRev = 0;
        for (const amt of uniqueComandas.values()) {
          totalRev += amt;
        }

        revenueAttributed = new Prisma.Decimal(totalRev.toFixed(2));

        if (totalRev > 0) {
          conversionStatus = RecipientConversionStatus.REVENUE_ATTRIBUTED;
        } else if (attributedVisit.source === "APPOINTMENT") {
          conversionStatus = RecipientConversionStatus.ATTENDED;
        } else {
          conversionStatus = RecipientConversionStatus.DIRECT_RETURN;
        }
      } else if (attributedAppt) {
        conversionStatus = RecipientConversionStatus.BOOKED;
        conversionAttributedAt = new Date(attributedAppt.createdAt);
      }

      recipientUpdates.push({
        id: contact.id,
        campaignId: contact.campaignId,
        conversionStatus,
        attributedAppointmentId: finalApptId,
        attributedComandaId: finalComandaId,
        canonicalReturnDate,
        conversionAttributedAt,
        revenueAttributed,
      });
    }
  }

  // 8. Persist updates to DB
  for (const upd of recipientUpdates) {
    await prisma.reactivationCampaignRecipient.update({
      where: { id: upd.id },
      data: {
        conversionStatus: upd.conversionStatus,
        attributedAppointmentId: upd.attributedAppointmentId,
        attributedComandaId: upd.attributedComandaId,
        canonicalReturnDate: upd.canonicalReturnDate,
        conversionAttributedAt: upd.conversionAttributedAt,
        revenueAttributed: upd.revenueAttributed,
      },
    });
  }

  // 9. Update target campaign aggregates
  const targetCampaignRecipients = recipientUpdates.filter(
    (u) => u.campaignId === campaignId
  );

  const convertedCount = targetCampaignRecipients.filter(
    (u) =>
      u.conversionStatus === RecipientConversionStatus.ATTENDED ||
      u.conversionStatus === RecipientConversionStatus.DIRECT_RETURN ||
      u.conversionStatus === RecipientConversionStatus.REVENUE_ATTRIBUTED
  ).length;

  let totalRevSum = 0;
  for (const u of targetCampaignRecipients) {
    if (u.revenueAttributed) {
      totalRevSum += Number(u.revenueAttributed);
    }
  }

  await prisma.reactivationCampaign.update({
    where: { id: campaignId },
    data: {
      convertedCount,
      totalRevenueAttributed: new Prisma.Decimal(totalRevSum.toFixed(2)),
    },
  });

  return getCampaignAttributionSummary(prisma, { barbershopId, campaignId });
}

/**
 * Retrieves campaign attribution summary with live derived metrics.
 */
export async function getCampaignAttributionSummary(
  prisma: Prisma.TransactionClient | any,
  options: { barbershopId: string; campaignId: string }
): Promise<CampaignAttributionSummary> {
  const { barbershopId, campaignId } = options;

  const campaign = await prisma.reactivationCampaign.findFirst({
    where: { id: campaignId, barbershopId },
  });

  if (!campaign) {
    const err: any = new Error("CAMPAIGN_NOT_FOUND: Campaign not found.");
    err.status = 404;
    throw err;
  }

  const recipients = await prisma.reactivationCampaignRecipient.findMany({
    where: { campaignId, barbershopId },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      attributedAppointment: {
        include: {
          services: {
            include: {
              service: { select: { name: true } },
            },
          },
          barber: {
            include: {
              user: { select: { name: true } },
            },
          },
          comandas: {
            where: { status: { not: "CANCELLED" } },
            select: { id: true, paidTotal: true, status: true, closedAt: true },
          },
        },
      },
      attributedComanda: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const sentRecipients = recipients.filter(
    (r: any) => r.dispatchStatus === RecipientDispatchStatus.SENT_CONFIRMED
  );
  const contacts = sentRecipients.length;

  // Query all appointments for these customers created within booking window where this campaign is last eligible touch
  const sentCustomerIds = Array.from(new Set(sentRecipients.map((r: any) => r.customerId)));
  const allCustomerAppts = sentCustomerIds.length > 0
    ? await prisma.appointment.findMany({
        where: {
          barbershopId,
          customerId: { in: sentCustomerIds },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const allCustomerComandas = sentCustomerIds.length > 0
    ? await prisma.comanda.findMany({
        where: {
          barbershopId,
          customerId: { in: sentCustomerIds },
          status: { not: "CANCELLED" },
        },
        include: {
          items: {
            where: { type: "SERVICE", status: "DONE" },
            select: { id: true, completedAt: true },
          },
        },
      })
    : [];

  // All contacts for these customers to verify last eligible touch
  const allContactsForCustomers = sentCustomerIds.length > 0
    ? await prisma.reactivationCampaignRecipient.findMany({
        where: {
          barbershopId,
          customerId: { in: sentCustomerIds },
          dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
          sentConfirmedAt: { not: null },
        },
        include: { campaign: true },
        orderBy: [{ sentConfirmedAt: "asc" }, { id: "asc" }],
      })
    : [];

  const customersWithBookingSet = new Set<string>();
  let attributedBookings = 0;
  let cancelledBookings = 0;
  let noShows = 0;

  for (const appt of allCustomerAppts) {
    const apptCreatedTs = new Date(appt.createdAt).getTime();
    let bestContact: any = null;
    for (const c of allContactsForCustomers) {
      const t0 = new Date(c.sentConfirmedAt!).getTime();
      if (apptCreatedTs <= t0) continue;
      const winDays = c.campaign?.bookingAttributionWindowDays ?? 14;
      const winEndTs = t0 + winDays * 24 * 60 * 60 * 1000;
      if (apptCreatedTs <= winEndTs) {
        if (!bestContact || t0 > new Date(bestContact.sentConfirmedAt!).getTime()) {
          bestContact = c;
        }
      }
    }

    if (bestContact && bestContact.campaignId === campaignId) {
      attributedBookings++;
      if (appt.status === "CANCELLED") {
        cancelledBookings++;
      } else if (appt.status === "NO_SHOW") {
        noShows++;
      } else {
        customersWithBookingSet.add(appt.customerId);
      }
    }
  }

  const reactivatedCustomerSet = new Set<string>();
  let recoveredRevenue = 0;

  const summaryItems: RecipientAttributionSummaryItem[] = [];

  for (const r of recipients) {
    const appt = r.attributedAppointment;
    const comanda = r.attributedComanda;

    const isReactivated =
      r.canonicalReturnDate !== null ||
      r.conversionStatus === RecipientConversionStatus.ATTENDED ||
      r.conversionStatus === RecipientConversionStatus.DIRECT_RETURN ||
      r.conversionStatus === RecipientConversionStatus.REVENUE_ATTRIBUTED;

    if (isReactivated) {
      reactivatedCustomerSet.add(r.customerId);
    }

    // Live derived recovered revenue from the attributed return visit comandas
    let rev = Number(r.revenueAttributed) || 0;
    if (isReactivated && r.canonicalReturnDate) {
      if (appt?.comandas && appt.comandas.length > 0) {
        rev = appt.comandas.reduce((s: number, c: any) => s + (Number(c.paidTotal) || 0), 0);
      } else {
        const canonicalDateStr = formatCanonicalDate(r.canonicalReturnDate);
        const dateCmds = allCustomerComandas.filter((c: any) => {
          if (c.customerId !== r.customerId) return false;
          if (c.appointmentId) return false;
          const hasDoneService = (c.items || []).length > 0;
          if (!hasDoneService) return false;
          const cTs = c.closedAt ? new Date(c.closedAt) : new Date(c.createdAt);
          return formatCanonicalDate(cTs) === canonicalDateStr;
        });
        if (dateCmds.length > 0) {
          rev = dateCmds.reduce((s: number, c: any) => s + (Number(c.paidTotal) || 0), 0);
        }
      }
    }

    recoveredRevenue += rev;

    summaryItems.push({
      recipientId: r.id,
      customerId: r.customerId,
      customerName: r.customerNameSnapshot,
      customerPhone: r.customerPhoneSnapshot,
      dispatchStatus: r.dispatchStatus,
      sentConfirmedAt: r.sentConfirmedAt ? r.sentConfirmedAt.toISOString() : null,
      conversionStatus: r.conversionStatus,
      canonicalReturnDate: formatCanonicalDate(r.canonicalReturnDate),
      conversionAttributedAt: r.conversionAttributedAt
        ? r.conversionAttributedAt.toISOString()
        : null,
      revenueAttributed: rev,
      attributedAppointment: appt
        ? {
            id: appt.id,
            dateTime: appt.dateTime.toISOString(),
            createdAt: appt.createdAt.toISOString(),
            status: appt.status,
            serviceName: appt.services?.[0]?.service?.name || null,
            memberName: appt.barber?.user?.name || null,
          }
        : null,
      attributedComanda: comanda
        ? {
            id: comanda.id,
            paidTotal: Number(comanda.paidTotal) || 0,
            status: comanda.status,
            closedAt: comanda.closedAt ? comanda.closedAt.toISOString() : null,
          }
        : null,
    });
  }

  const customersWithAttributedBooking = customersWithBookingSet.size;
  const reactivatedCustomers = reactivatedCustomerSet.size;

  const bookingRate = calculateAttributionRate(customersWithAttributedBooking, contacts, "bookingRate");
  const attendanceRate = calculateAttributionRate(reactivatedCustomers, contacts, "attendanceRate");
  const conversionRate = attendanceRate; // Documented canonical alias: conversionRate === attendanceRate

  return {
    campaignId: campaign.id,
    name: campaign.name,
    status: campaign.status,
    attributionVersion: campaign.attributionVersion || "smart-crm-attribution-v1",
    bookingAttributionWindowDays: campaign.bookingAttributionWindowDays,
    directReturnWindowDays: campaign.directReturnWindowDays,
    contacts,
    customersWithAttributedBooking,
    attributedBookings,
    cancelledBookings,
    noShows,
    reactivatedCustomers,
    bookingRate: Number(bookingRate.toFixed(4)),
    attendanceRate: Number(attendanceRate.toFixed(4)),
    conversionRate: Number(conversionRate.toFixed(4)),
    recoveredRevenue: Number(recoveredRevenue.toFixed(2)),
    recipients: summaryItems,
  };
}

/**
 * Retrieves recipient attribution detail with full evidence and audit trail.
 */
export async function getRecipientAttributionDetail(
  prisma: Prisma.TransactionClient | any,
  options: { barbershopId: string; campaignId: string; recipientId: string }
): Promise<RecipientAttributionDetail> {
  const { barbershopId, campaignId, recipientId } = options;

  const recipient = await prisma.reactivationCampaignRecipient.findFirst({
    where: { id: recipientId, campaignId, barbershopId },
    include: {
      customer: true,
      campaign: true,
      attributedAppointment: {
        include: {
          services: {
            include: {
              service: true,
            },
          },
          barber: {
            include: {
              user: true,
            },
          },
          comandas: {
            where: { status: { not: "CANCELLED" } },
            include: {
              items: true,
            },
          },
        },
      },
      attributedComanda: {
        include: {
          items: true,
        },
      },
    },
  });

  if (!recipient) {
    const err: any = new Error("RECIPIENT_NOT_FOUND: Recipient not found.");
    err.status = 404;
    throw err;
  }

  const payload = (recipient.payloadSnapshot as any) || {};
  const timeline: Array<{ event: string; timestamp: string; detail: string }> = [];

  if (recipient.createdAt) {
    timeline.push({
      event: "PREPARED",
      timestamp: recipient.createdAt.toISOString(),
      detail: `Destinatário incluído na campanha '${recipient.campaign?.name}' com timing ${recipient.timingStateSnapshot} e score ${recipient.scoreSnapshot}.`,
    });
  }

  if (recipient.sentConfirmedAt) {
    timeline.push({
      event: "SENT_CONFIRMED",
      timestamp: recipient.sentConfirmedAt.toISOString(),
      detail: "Disparo manual via WhatsApp confirmado pelo operador (T0).",
    });
  }

  const appt = recipient.attributedAppointment;
  if (appt) {
    timeline.push({
      event: "BOOKING_CREATED",
      timestamp: appt.createdAt.toISOString(),
      detail: `Agendamento criado para ${appt.dateTime.toISOString()} (Status: ${appt.status}).`,
    });
  }

  const comanda = recipient.attributedComanda;
  if (comanda) {
    timeline.push({
      event: "COMANDA_SETTLED",
      timestamp: (comanda.closedAt || comanda.createdAt).toISOString(),
      detail: `Comanda finalizada com receita paga de R$ ${Number(comanda.paidTotal).toFixed(2)}.`,
    });
  }

  if (recipient.conversionAttributedAt) {
    timeline.push({
      event: "CONVERSION_ATTRIBUTED",
      timestamp: recipient.conversionAttributedAt.toISOString(),
      detail: `Conversão registrada (${recipient.conversionStatus}) para o retorno canônico em ${
        formatCanonicalDate(recipient.canonicalReturnDate) || "N/A"
      }.`,
    });
  }

  const comandasEvidence: any[] = [];
  const seenComandas = new Set<string>();
  if (comanda) {
    seenComandas.add(comanda.id);
    comandasEvidence.push({
      id: comanda.id,
      paidTotal: Number(comanda.paidTotal) || 0,
      status: comanda.status,
      closedAt: comanda.closedAt ? comanda.closedAt.toISOString() : null,
      itemsCount: comanda.items?.length || 0,
    });
  }
  if (appt?.comandas) {
    for (const c of appt.comandas) {
      if (!seenComandas.has(c.id)) {
        seenComandas.add(c.id);
        comandasEvidence.push({
          id: c.id,
          paidTotal: Number(c.paidTotal) || 0,
          status: c.status,
          closedAt: c.closedAt ? c.closedAt.toISOString() : null,
          itemsCount: c.items?.length || 0,
        });
      }
    }
  }

  let liveRevenue = Number(recipient.revenueAttributed) || 0;
  if (
    recipient.canonicalReturnDate !== null ||
    recipient.conversionStatus === RecipientConversionStatus.ATTENDED ||
    recipient.conversionStatus === RecipientConversionStatus.DIRECT_RETURN ||
    recipient.conversionStatus === RecipientConversionStatus.REVENUE_ATTRIBUTED
  ) {
    if (comandasEvidence.length > 0) {
      liveRevenue = comandasEvidence.reduce((sum, c) => sum + c.paidTotal, 0);
    }
  }

  return {
    recipient: {
      id: recipient.id,
      campaignId: recipient.campaignId,
      barbershopId: recipient.barbershopId,
      customerId: recipient.customerId,
      customerName: recipient.customerNameSnapshot,
      customerPhone: recipient.customerPhoneSnapshot,
      dispatchStatus: recipient.dispatchStatus,
      sentConfirmedAt: recipient.sentConfirmedAt ? recipient.sentConfirmedAt.toISOString() : null,
      timingStateSnapshot: recipient.timingStateSnapshot,
      scoreSnapshot: recipient.scoreSnapshot,
      previewMessage: payload.previewMessage || "",
    },
    attribution: {
      conversionStatus: recipient.conversionStatus,
      canonicalReturnDate: formatCanonicalDate(recipient.canonicalReturnDate),
      conversionAttributedAt: recipient.conversionAttributedAt
        ? recipient.conversionAttributedAt.toISOString()
        : null,
      revenueAttributed: Number(liveRevenue.toFixed(2)),
    },
    evidence: {
      appointment: appt
        ? {
            id: appt.id,
            dateTime: appt.dateTime.toISOString(),
            createdAt: appt.createdAt.toISOString(),
            status: appt.status,
            serviceName: appt.services?.[0]?.service?.name || null,
            memberName: appt.barber?.user?.name || null,
          }
        : null,
      comandas: comandasEvidence,
      timeline,
    },
  };
}

/**
 * Retrieves cross-campaign customer attribution history.
 */
export async function getCustomerAttributionHistory(
  prisma: Prisma.TransactionClient | any,
  options: { barbershopId: string; customerId: string }
): Promise<CustomerAttributionHistoryResponse> {
  const { barbershopId, customerId } = options;

  const recipients = await prisma.reactivationCampaignRecipient.findMany({
    where: { barbershopId, customerId },
    include: {
      campaign: true,
      attributedAppointment: {
        include: {
          comandas: {
            where: { status: { not: "CANCELLED" } },
            select: { id: true, paidTotal: true },
          },
        },
      },
      attributedComanda: {
        select: { id: true, paidTotal: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  let totalConversions = 0;
  let totalRevenueRecovered = 0;

  const history: CustomerAttributionHistoryItem[] = [];

  for (const r of recipients) {
    const isReactivated =
      r.canonicalReturnDate !== null ||
      r.conversionStatus === RecipientConversionStatus.ATTENDED ||
      r.conversionStatus === RecipientConversionStatus.DIRECT_RETURN ||
      r.conversionStatus === RecipientConversionStatus.REVENUE_ATTRIBUTED;

    let rev = Number(r.revenueAttributed) || 0;
    if (isReactivated) {
      const uniqueComandas = new Map<string, number>();
      if (r.attributedComanda && Number(r.attributedComanda.paidTotal) >= 0) {
        uniqueComandas.set(r.attributedComanda.id, Number(r.attributedComanda.paidTotal));
      }
      if (r.attributedAppointment?.comandas) {
        for (const c of r.attributedAppointment.comandas) {
          if (Number(c.paidTotal) >= 0) {
            uniqueComandas.set(c.id, Number(c.paidTotal));
          }
        }
      }
      if (uniqueComandas.size > 0) {
        let liveSum = 0;
        for (const amt of uniqueComandas.values()) {
          liveSum += amt;
        }
        rev = liveSum;
      }
    }

    if (isReactivated) {
      totalConversions++;
      totalRevenueRecovered += rev;
    }

    history.push({
      recipientId: r.id,
      campaignId: r.campaignId,
      campaignName: r.campaign?.name || "Reativação",
      channel: r.campaign?.channel || "WHATSAPP",
      sentConfirmedAt: r.sentConfirmedAt ? r.sentConfirmedAt.toISOString() : null,
      dispatchStatus: r.dispatchStatus,
      conversionStatus: r.conversionStatus,
      canonicalReturnDate: formatCanonicalDate(r.canonicalReturnDate),
      revenueAttributed: Number(rev.toFixed(2)),
      appointment: r.attributedAppointment
        ? {
            id: r.attributedAppointment.id,
            dateTime: r.attributedAppointment.dateTime.toISOString(),
            status: r.attributedAppointment.status,
          }
        : null,
    });
  }

  return {
    customerId,
    barbershopId,
    totalTouches: recipients.length,
    totalConversions,
    totalRevenueRecovered: Number(totalRevenueRecovered.toFixed(2)),
    history,
  };
}
