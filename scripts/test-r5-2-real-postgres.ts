/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import {
  PrismaClient,
  MarketingConsentStatus,
  MarketingConsentSource,
  RecipientDispatchStatus,
  RecipientConversionStatus,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  prepareManualReactivationCampaign,
  confirmManualRecipientSend,
  recordMarketingConsent,
  reconcileCampaignAttribution,
  getCampaignAttributionSummary,
  getRecipientAttributionDetail,
  getCustomerAttributionHistory,
} from "../src/lib/clients/reactivation";

const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

const pool = new Pool({ connectionString: testDbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("==================================================================");
  console.log(" TEM BARBER — PHASE R5.2.1 REAL POSTGRESQL 16 READ-MODEL FIXTURE TEST");
  console.log("==================================================================");

  const [versionRow]: any = await prisma.$queryRaw`SELECT version();`;
  console.log("DB Version:", versionRow.version);

  // Setup Clean Barbershops
  const rand = Math.floor(1000 + Math.random() * 9000);
  const barbershopA = await prisma.barbershop.create({
    data: {
      name: "Barbearia R5.2 Tenant A",
      slug: `r5-2-test-a-${Date.now()}-${rand}`,
      phone: `1199110${rand}`,
      zipCode: "01001-000",
      street: "Rua A",
      number: "100",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });

  const barbershopB = await prisma.barbershop.create({
    data: {
      name: "Barbearia R5.2 Tenant B (Cross-Tenant)",
      slug: `r5-2-test-b-${Date.now()}-${rand}`,
      phone: `1199120${rand}`,
      zipCode: "01001-000",
      street: "Rua B",
      number: "200",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });

  const managerA = await prisma.user.create({
    data: {
      name: "Gerente R5.2",
      email: `manager-r5-2-${Date.now()}-${rand}@r5test.com`,
      role: "USER",
      phone: `179810${rand}`,
    },
  });
  const memberA = await prisma.barbershopMember.create({
    data: { barbershopId: barbershopA.id, userId: managerA.id, role: "MANAGER" },
  });

  const categoryA = await prisma.category.create({
    data: { barbershopId: barbershopA.id, name: "Cortes A", slug: `cortes-a-${rand}` },
  });

  const serviceA = await prisma.service.create({
    data: {
      barbershopId: barbershopA.id,
      categoryId: categoryA.id,
      name: "Corte Barba R5.2",
      price: 50.0,
      durationMin: 30,
    },
  });

  async function createCust(bId: string, name: string, phone: string, email: string) {
    const user = await prisma.user.create({
      data: { name, email, phone, role: "USER" },
    });
    await prisma.customerBarbershopLink.create({
      data: { barbershopId: bId, customerId: user.id },
    });
    await recordMarketingConsent(prisma, {
      barbershopId: bId,
      customerId: user.id,
      channel: "WHATSAPP",
      purpose: "MARKETING",
      status: MarketingConsentStatus.OPTED_IN,
      source: MarketingConsentSource.BOOKING_CHECKBOX,
      eventKey: `optin-${user.id}-${Date.now()}`,
    });
    return user;
  }

  const T0 = new Date("2026-09-01T10:00:00Z");

  // 1. Booking + Return + Paid
  console.log("\n--- [FIXTURE 1] Booking + Return + Paid Comanda ---");
  const cust1 = await createCust(barbershopA.id, "Cliente 1 (Paid)", `1199101${rand}`, `c1-${rand}@test.com`);
  // 2. Direct return (Walk-in)
  console.log("--- [FIXTURE 2] Direct Return (Walk-in) ---");
  const cust2 = await createCust(barbershopA.id, "Cliente 2 (Walkin)", `1199102${rand}`, `c2-${rand}@test.com`);
  // 3. Cancelled only (No service)
  console.log("--- [FIXTURE 3] Cancelled Booking (No service) ---");
  const cust3 = await createCust(barbershopA.id, "Cliente 3 (Cancelled)", `1199103${rand}`, `c3-${rand}@test.com`);
  // 4. No-show only (No service)
  console.log("--- [FIXTURE 4] No-Show Booking (No service) ---");
  const cust4 = await createCust(barbershopA.id, "Cliente 4 (NoShow)", `1199104${rand}`, `c4-${rand}@test.com`);
  // 5. Cancelled/No-show + SERVICE DONE
  console.log("--- [FIXTURE 5] Cancelled/No-show + SERVICE DONE Canonical Return ---");
  const cust5 = await createCust(barbershopA.id, "Cliente 5 (Cancelled+Service)", `1199105${rand}`, `c5-${rand}@test.com`);
  // 6. Return with paidTotal = 0 (Free/complimentary service)
  console.log("--- [FIXTURE 6] Return with paidTotal = 0 ---");
  const cust6 = await createCust(barbershopA.id, "Cliente 6 (ZeroPaid)", `1199106${rand}`, `c6-${rand}@test.com`);
  // 7. Multiple attributed bookings for one customer (2 bookings)
  console.log("--- [FIXTURE 7] Multiple Attributed Bookings for One Customer ---");
  const cust7 = await createCust(barbershopA.id, "Cliente 7 (MultiBooking)", `1199107${rand}`, `c7-${rand}@test.com`);
  // 8. No-Show + SERVICE DONE on day 20
  console.log("--- [FIXTURE 8] No-Show + SERVICE DONE on Day 20 ---");
  const cust8 = await createCust(barbershopA.id, "Cliente 8 (NoShow+ServiceDay20)", `1199108${rand}`, `c8-${rand}@test.com`);
  // 9. Service done on day 31 (Outside 30-day return window)
  console.log("--- [FIXTURE 9] Service done on Day 31 (Outside Window) ---");
  const cust9 = await createCust(barbershopA.id, "Cliente 9 (ServiceDay31)", `1199109${rand}`, `c9-${rand}@test.com`);
  // 10. Booking created on day 15 (Outside 14-day booking window)
  console.log("--- [FIXTURE 10] Booking created on Day 15 (Outside Window) ---");
  const cust10 = await createCust(barbershopA.id, "Cliente 10 (BookingDay15)", `1199110${rand}`, `c10-${rand}@test.com`);

  // Create Campaign in Tenant A
  const prep = await prepareManualReactivationCampaign(prisma, {
    barbershopId: barbershopA.id,
    userId: managerA.id,
    requestKey: `req-r5-2-main-${rand}`,
    selectedCustomerIds: [
      cust1.id,
      cust2.id,
      cust3.id,
      cust4.id,
      cust5.id,
      cust6.id,
      cust7.id,
      cust8.id,
      cust9.id,
      cust10.id,
    ],
    templateKey: "RETURN_REMINDER",
  });

  const campaignId = prep.campaign.id;

  // Confirm all recipients at T0
  for (const rec of prep.accepted) {
    await prisma.reactivationCampaignRecipient.update({
      where: { id: rec.recipientId },
      data: {
        dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
        sentConfirmedAt: T0,
      },
    });
  }

  // Populate events for each customer:

  // Customer 1: Appointment + Comanda R$ 75
  const appt1 = await prisma.appointment.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust1.id,
      memberId: memberA.id,
      dateTime: new Date("2026-09-04T14:00:00Z"),
      status: "COMPLETED",
      totalPrice: 75.0,
      durationMin: 30,
      createdAt: new Date("2026-09-02T10:00:00Z"),
    },
  });
  const cmd1 = await prisma.comanda.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust1.id,
      customerName: cust1.name,
      appointmentId: appt1.id,
      status: "CLOSED",
      paidTotal: 75.0,
      total: 75.0,
      createdAt: new Date("2026-09-04T14:00:00Z"),
      closedAt: new Date("2026-09-04T14:45:00Z"),
    },
  });
  await prisma.comandaItem.create({
    data: {
      barbershopId: barbershopA.id,
      comandaId: cmd1.id,
      type: "SERVICE",
      status: "DONE",
      description: "Corte e Barba",
      quantity: 1,
      unitPrice: 75.0,
      total: 75.0,
      serviceId: serviceA.id,
      executorId: memberA.id,
      completedAt: new Date("2026-09-04T14:40:00Z"),
    },
  });

  // Customer 2: Direct return comanda R$ 60
  const cmd2 = await prisma.comanda.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust2.id,
      customerName: cust2.name,
      status: "CLOSED",
      paidTotal: 60.0,
      total: 60.0,
      createdAt: new Date("2026-09-05T16:00:00Z"),
      closedAt: new Date("2026-09-05T16:40:00Z"),
    },
  });
  await prisma.comandaItem.create({
    data: {
      barbershopId: barbershopA.id,
      comandaId: cmd2.id,
      type: "SERVICE",
      status: "DONE",
      description: "Corte",
      quantity: 1,
      unitPrice: 60.0,
      total: 60.0,
      serviceId: serviceA.id,
      executorId: memberA.id,
      completedAt: new Date("2026-09-05T16:35:00Z"),
    },
  });

  // Customer 3: Cancelled appointment, no service
  await prisma.appointment.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust3.id,
      memberId: memberA.id,
      dateTime: new Date("2026-09-05T10:00:00Z"),
      status: "CANCELLED",
      totalPrice: 50.0,
      durationMin: 30,
      createdAt: new Date("2026-09-02T11:00:00Z"),
    },
  });

  // Customer 4: No-show appointment, no service
  await prisma.appointment.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust4.id,
      memberId: memberA.id,
      dateTime: new Date("2026-09-05T11:00:00Z"),
      status: "NO_SHOW",
      totalPrice: 50.0,
      durationMin: 30,
      createdAt: new Date("2026-09-02T12:00:00Z"),
    },
  });

  // Customer 5: Appointment CANCELLED, but actual comanda with SERVICE DONE
  const appt5 = await prisma.appointment.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust5.id,
      memberId: memberA.id,
      dateTime: new Date("2026-09-06T10:00:00Z"),
      status: "CANCELLED",
      totalPrice: 50.0,
      durationMin: 30,
      createdAt: new Date("2026-09-02T14:00:00Z"),
    },
  });
  const cmd5 = await prisma.comanda.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust5.id,
      customerName: cust5.name,
      appointmentId: appt5.id,
      status: "CLOSED",
      paidTotal: 50.0,
      total: 50.0,
      createdAt: new Date("2026-09-06T10:00:00Z"),
      closedAt: new Date("2026-09-06T10:35:00Z"),
    },
  });
  await prisma.comandaItem.create({
    data: {
      barbershopId: barbershopA.id,
      comandaId: cmd5.id,
      type: "SERVICE",
      status: "DONE",
      description: "Corte",
      quantity: 1,
      unitPrice: 50.0,
      total: 50.0,
      serviceId: serviceA.id,
      executorId: memberA.id,
      completedAt: new Date("2026-09-06T10:30:00Z"),
    },
  });

  // Customer 6: Return with paidTotal = 0 (complimentary haircut)
  const appt6 = await prisma.appointment.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust6.id,
      memberId: memberA.id,
      dateTime: new Date("2026-09-07T14:00:00Z"),
      status: "COMPLETED",
      totalPrice: 0.0,
      durationMin: 30,
      createdAt: new Date("2026-09-03T10:00:00Z"),
    },
  });
  const cmd6 = await prisma.comanda.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust6.id,
      customerName: cust6.name,
      appointmentId: appt6.id,
      status: "CLOSED",
      paidTotal: 0.0,
      total: 0.0,
      createdAt: new Date("2026-09-07T14:00:00Z"),
      closedAt: new Date("2026-09-07T14:30:00Z"),
    },
  });
  await prisma.comandaItem.create({
    data: {
      barbershopId: barbershopA.id,
      comandaId: cmd6.id,
      type: "SERVICE",
      status: "DONE",
      description: "Corte Cortesia",
      quantity: 1,
      unitPrice: 0.0,
      total: 0.0,
      serviceId: serviceA.id,
      executorId: memberA.id,
      completedAt: new Date("2026-09-07T14:25:00Z"),
    },
  });

  // Customer 7: 1 customer with 2 attributed bookings within window
  await prisma.appointment.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust7.id,
      memberId: memberA.id,
      dateTime: new Date("2026-09-08T10:00:00Z"),
      status: "COMPLETED",
      totalPrice: 40.0,
      durationMin: 30,
      createdAt: new Date("2026-09-02T10:00:00Z"),
    },
  });
  await prisma.appointment.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust7.id,
      memberId: memberA.id,
      dateTime: new Date("2026-09-12T10:00:00Z"),
      status: "COMPLETED",
      totalPrice: 40.0,
      durationMin: 30,
      createdAt: new Date("2026-09-03T10:00:00Z"),
    },
  });

  // Customer 8: NO_SHOW appointment + SERVICE DONE on Day 20 (2026-09-21)
  await prisma.appointment.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust8.id,
      memberId: memberA.id,
      dateTime: new Date("2026-09-04T10:00:00Z"),
      status: "NO_SHOW",
      totalPrice: 50.0,
      durationMin: 30,
      createdAt: new Date("2026-09-02T10:00:00Z"),
    },
  });
  const cmd8 = await prisma.comanda.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust8.id,
      customerName: cust8.name,
      status: "CLOSED",
      paidTotal: 55.0,
      total: 55.0,
      createdAt: new Date("2026-09-21T15:00:00Z"),
      closedAt: new Date("2026-09-21T15:40:00Z"),
    },
  });
  await prisma.comandaItem.create({
    data: {
      barbershopId: barbershopA.id,
      comandaId: cmd8.id,
      type: "SERVICE",
      status: "DONE",
      description: "Corte e Barba Day 20",
      quantity: 1,
      unitPrice: 55.0,
      total: 55.0,
      serviceId: serviceA.id,
      executorId: memberA.id,
      completedAt: new Date("2026-09-21T15:35:00Z"),
    },
  });

  // Customer 9: Direct return service on Day 32 (2026-10-03, > 30 days window) -> DOES NOT QUALIFY
  const cmd9 = await prisma.comanda.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust9.id,
      customerName: cust9.name,
      status: "CLOSED",
      paidTotal: 60.0,
      total: 60.0,
      createdAt: new Date("2026-10-03T10:00:00Z"),
      closedAt: new Date("2026-10-03T10:40:00Z"),
    },
  });
  await prisma.comandaItem.create({
    data: {
      barbershopId: barbershopA.id,
      comandaId: cmd9.id,
      type: "SERVICE",
      status: "DONE",
      description: "Corte Fora da Janela",
      quantity: 1,
      unitPrice: 60.0,
      total: 60.0,
      serviceId: serviceA.id,
      executorId: memberA.id,
      completedAt: new Date("2026-10-03T10:35:00Z"),
    },
  });

  // Customer 10: Booking created on Day 16 (2026-09-17, > 14 days booking window) -> DOES NOT QUALIFY
  await prisma.appointment.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: cust10.id,
      memberId: memberA.id,
      dateTime: new Date("2026-09-20T10:00:00Z"),
      status: "COMPLETED",
      totalPrice: 50.0,
      durationMin: 30,
      createdAt: new Date("2026-09-17T10:00:00Z"),
    },
  });

  // Reconcile Campaign
  console.log("\nReconciling Campaign Attribution in Real PostgreSQL...");
  const summary = await reconcileCampaignAttribution(prisma, {
    barbershopId: barbershopA.id,
    campaignId,
  });

  console.log("Reconciled Campaign Summary:", {
    contacts: summary.contacts,
    customersWithAttributedBooking: summary.customersWithAttributedBooking,
    attributedBookings: summary.attributedBookings,
    cancelledBookings: summary.cancelledBookings,
    noShows: summary.noShows,
    reactivatedCustomers: summary.reactivatedCustomers,
    bookingRate: summary.bookingRate,
    attendanceRate: summary.attendanceRate,
    recoveredRevenue: summary.recoveredRevenue,
  });

  // VERIFICATION 1: Authority metrics
  // Contacts = 10
  // Attributed Bookings = 8 (Cust1: 1, Cust3: 1, Cust4: 1, Cust5: 1, Cust6: 1, Cust7: 2, Cust8: 1; Cust10 was Day 16 > 14 days so 0)
  // Cancelled Bookings = 2 (Cust3, Cust5)
  // No-shows = 2 (Cust4, Cust8)
  // Customers with Active Attributed Booking = 3 (Cust1, Cust6, Cust7)
  // Reactivated Customers = 6 (Cust1, Cust2, Cust5, Cust6, Cust7, Cust8; Cust9 was Day 32 > 30 days so not reactivated)
  // Recovered Revenue = 75 (Cust1) + 60 (Cust2) + 50 (Cust5) + 0 (Cust6) + 0 (Cust7 unbilled) + 55 (Cust8) = 240.0
  if (summary.contacts !== 10) throw new Error(`Expected 10 contacts, got ${summary.contacts}`);
  if (summary.customersWithAttributedBooking !== 3) {
    throw new Error(`Expected 3 customersWithAttributedBooking (active non-cancelled/no-show), got ${summary.customersWithAttributedBooking}`);
  }
  if (summary.attributedBookings !== 8) {
    throw new Error(`Expected 8 attributedBookings, got ${summary.attributedBookings}`);
  }
  if (summary.cancelledBookings !== 2) {
    throw new Error(`Expected 2 cancelledBookings, got ${summary.cancelledBookings}`);
  }
  if (summary.noShows !== 2) {
    throw new Error(`Expected 2 noShows, got ${summary.noShows}`);
  }
  if (summary.reactivatedCustomers !== 6) {
    throw new Error(`Expected 6 reactivatedCustomers, got ${summary.reactivatedCustomers}`);
  }
  if (summary.recoveredRevenue !== 240.0) {
    throw new Error(`Expected recoveredRevenue 240.0, got ${summary.recoveredRevenue}`);
  }
  console.log("✅ VERIFICATION 1 PASSED: Primary KPIs match exact source authority.");

  // VERIFICATION 2: Zero Payment Recipient Detail (Cust 6)
  const rec6 = prep.accepted.find((r) => r.customerId === cust6.id)!;
  const detail6 = await getRecipientAttributionDetail(prisma, {
    barbershopId: barbershopA.id,
    campaignId,
    recipientId: rec6.recipientId,
  });

  console.log("\nRecipient 6 Detail (Zero Paid Return):", {
    status: detail6.attribution.conversionStatus,
    canonicalReturnDate: detail6.attribution.canonicalReturnDate,
    revenueAttributed: detail6.attribution.revenueAttributed,
  });

  if (
    detail6.attribution.canonicalReturnDate !== "2026-09-07" ||
    detail6.attribution.revenueAttributed !== 0 ||
    detail6.attribution.conversionStatus !== "ATTENDED"
  ) {
    throw new Error("VERIFICATION 2 FAILED: Zero-paid return not properly recorded as ATTENDED with R$ 0,00.");
  }
  console.log("✅ VERIFICATION 2 PASSED: Zero-paid return displays Retorno: Confirmado and Receita: R$ 0,00.");

  // VERIFICATION 3: Late Payment Update 0 -> 30 (Cust 6)
  console.log("\n--- [LATE PAYMENT TEST] Updating comanda paidTotal 0 -> 30 without re-running ownership ---");
  await prisma.comanda.update({
    where: { id: cmd6.id },
    data: { paidTotal: 30.0, total: 30.0 },
  });

  const detail6Late = await getRecipientAttributionDetail(prisma, {
    barbershopId: barbershopA.id,
    campaignId,
    recipientId: rec6.recipientId,
  });

  console.log("Recipient 6 Detail after Late Payment:", {
    status: detail6Late.attribution.conversionStatus,
    canonicalReturnDate: detail6Late.attribution.canonicalReturnDate,
    revenueAttributed: detail6Late.attribution.revenueAttributed,
  });

  if (detail6Late.attribution.revenueAttributed !== 30.0) {
    throw new Error(`Expected revenueAttributed 30.0 on read-model, got ${detail6Late.attribution.revenueAttributed}`);
  }
  console.log("✅ VERIFICATION 3 PASSED: Late payment reflected dynamically in read-model.");

  // VERIFICATION 3.1: Specific Verification for Cancelled / No-show & Return Windows (A, B, C, D, E, F)
  console.log("\n--- [CASES A-F VERIFICATION] Checking Cancelled/NoShow/Day20/Day31/Day15 Details ---");
  const rec3 = prep.accepted.find((r) => r.customerId === cust3.id)!;
  const detail3 = await getRecipientAttributionDetail(prisma, { barbershopId: barbershopA.id, campaignId, recipientId: rec3.recipientId });
  if (detail3.evidence.appointment?.status !== "CANCELLED" || detail3.attribution.canonicalReturnDate !== null) {
    throw new Error("CASE A FAILED: Cancelled booking with no service must have return = null.");
  }
  console.log("✅ Case A Verified: Cancelled appointment without service -> Retorno: Não confirmado.");

  const rec4 = prep.accepted.find((r) => r.customerId === cust4.id)!;
  const detail4 = await getRecipientAttributionDetail(prisma, { barbershopId: barbershopA.id, campaignId, recipientId: rec4.recipientId });
  if (detail4.evidence.appointment?.status !== "NO_SHOW" || detail4.attribution.canonicalReturnDate !== null) {
    throw new Error("CASE B FAILED: No-show booking with no service must have return = null.");
  }
  console.log("✅ Case B Verified: No-show appointment without service -> Retorno: Não confirmado.");

  const rec5 = prep.accepted.find((r) => r.customerId === cust5.id)!;
  const detail5 = await getRecipientAttributionDetail(prisma, { barbershopId: barbershopA.id, campaignId, recipientId: rec5.recipientId });
  if (detail5.evidence.appointment?.status !== "CANCELLED" || detail5.attribution.canonicalReturnDate !== "2026-09-06" || detail5.attribution.revenueAttributed !== 50.0) {
    throw new Error("CASE C FAILED: Cancelled appointment with service done must qualify return.");
  }
  console.log("✅ Case C Verified: Cancelled appointment + executed service -> Retorno: Confirmado (R$ 50,00).");

  const rec8 = prep.accepted.find((r) => r.customerId === cust8.id)!;
  const detail8 = await getRecipientAttributionDetail(prisma, { barbershopId: barbershopA.id, campaignId, recipientId: rec8.recipientId });
  if (detail8.evidence.appointment?.status !== "NO_SHOW" || detail8.attribution.canonicalReturnDate !== "2026-09-21" || detail8.attribution.revenueAttributed !== 55.0) {
    throw new Error("CASE D FAILED: No-show appointment with service done on day 20 must qualify return.");
  }
  console.log("✅ Case D Verified: No-show appointment + Day 20 service -> Retorno: Confirmado (R$ 55,00).");

  const rec9 = prep.accepted.find((r) => r.customerId === cust9.id)!;
  const detail9 = await getRecipientAttributionDetail(prisma, { barbershopId: barbershopA.id, campaignId, recipientId: rec9.recipientId });
  if (detail9.attribution.canonicalReturnDate !== null || detail9.attribution.revenueAttributed !== 0) {
    throw new Error("CASE E FAILED: Service done on day 31 must NOT qualify as return (exceeds 30d window).");
  }
  console.log("✅ Case E Verified: Service done on Day 31 -> Retorno: Não confirmado (exceeds 30-day window).");

  const rec10 = prep.accepted.find((r) => r.customerId === cust10.id)!;
  const detail10 = await getRecipientAttributionDetail(prisma, { barbershopId: barbershopA.id, campaignId, recipientId: rec10.recipientId });
  if (detail10.evidence.appointment !== null) {
    throw new Error("CASE F FAILED: Booking created on day 15 must NOT be attributed (exceeds 14d window).");
  }
  console.log("✅ Case F Verified: Booking created on Day 15 -> Agendamento: Sem agendamento atribuído.");

  // VERIFICATION 4: Cross-Tenant Isolation
  console.log("\n--- [CROSS-TENANT ISOLATION TEST] Querying Tenant A resources with Tenant B ---");
  const summarySummaryB = await getCampaignAttributionSummary(prisma, {
    barbershopId: barbershopB.id,
    campaignId,
  }).catch((err) => err);

  if (!summarySummaryB || summarySummaryB.status !== 404 && !summarySummaryB.message?.includes("CAMPAIGN_NOT_FOUND")) {
    throw new Error("VERIFICATION 4 FAILED: Cross-tenant summary must return 404/not found.");
  }

  const detailB = await getRecipientAttributionDetail(prisma, {
    barbershopId: barbershopB.id,
    campaignId,
    recipientId: rec6.recipientId,
  }).catch((err) => err);

  if (!detailB || detailB.status !== 404 && !detailB.message?.includes("RECIPIENT_NOT_FOUND")) {
    throw new Error("VERIFICATION 4 FAILED: Cross-tenant recipient detail must return 404/not found.");
  }
  console.log("✅ VERIFICATION 4 PASSED: Cross-tenant leak strictly prevented.");

  // VERIFICATION 5: GET Side Effects (Zero DB mutations on GETs)
  console.log("\n--- [ZERO GET SIDE EFFECTS TEST] Checking DB state before/after GETs ---");
  const [recCountBefore]: any = await prisma.$queryRaw`SELECT COUNT(*) as count FROM reactivation_campaign_recipients;`;
  const [logCountBefore]: any = await prisma.$queryRaw`SELECT COUNT(*) as count FROM customer_contact_logs;`;

  await getCampaignAttributionSummary(prisma, { barbershopId: barbershopA.id, campaignId });
  await getRecipientAttributionDetail(prisma, { barbershopId: barbershopA.id, campaignId, recipientId: rec6.recipientId });
  await getCustomerAttributionHistory(prisma, { barbershopId: barbershopA.id, customerId: cust1.id });

  const [recCountAfter]: any = await prisma.$queryRaw`SELECT COUNT(*) as count FROM reactivation_campaign_recipients;`;
  const [logCountAfter]: any = await prisma.$queryRaw`SELECT COUNT(*) as count FROM customer_contact_logs;`;

  if (recCountBefore.count !== recCountAfter.count || logCountBefore.count !== logCountAfter.count) {
    throw new Error("VERIFICATION 5 FAILED: GET operations caused database side-effects.");
  }
  console.log("✅ VERIFICATION 5 PASSED: 0 writes/mutations during GET operations.");

  console.log("\n==================================================================");
  console.log(" ALL R5.2.1 REAL POSTGRESQL 16 FIXTURE CHECKS PASSED PERFECTLY!");
  console.log("==================================================================");
}

main()
  .catch((err) => {
    console.error("FATAL FIXTURE ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
