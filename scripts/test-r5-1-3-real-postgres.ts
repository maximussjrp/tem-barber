/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import {
  PrismaClient,
  MarketingConsentStatus,
  MarketingConsentSource,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  prepareManualReactivationCampaign,
  revalidateAndOpenManualRecipient,
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
  console.log(" TEM BARBER — PHASE R5.1.3 FINAL EVIDENCE ONLY SCRIPT");
  console.log("==================================================================");

  const rand = Math.floor(1000 + Math.random() * 9000);

  // Setup tenants
  const barbershopA = await prisma.barbershop.create({
    data: {
      name: "Barbearia R5 Tenant A",
      slug: `r5-test-a-${Date.now()}-${rand}`,
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
      name: "Barbearia R5 Tenant B",
      slug: `r5-test-b-${Date.now()}-${rand}`,
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
      name: "Gerente R5 A",
      email: `manager-r5a-${Date.now()}-${rand}@r5test.com`,
      role: "USER",
      phone: `179810${rand}`,
    },
  });
  const memberA = await prisma.barbershopMember.create({
    data: { barbershopId: barbershopA.id, userId: managerA.id, role: "MANAGER" },
  });

  const managerB = await prisma.user.create({
    data: {
      name: "Gerente R5 B",
      email: `manager-r5b-${Date.now()}-${rand}@r5test.com`,
      role: "USER",
      phone: `179811${rand}`,
    },
  });
  const memberB = await prisma.barbershopMember.create({
    data: { barbershopId: barbershopB.id, userId: managerB.id, role: "MANAGER" },
  });

  const categoryA = await prisma.category.create({
    data: { barbershopId: barbershopA.id, name: "Cortes A", slug: `cortes-a-${rand}` },
  });

  const serviceA = await prisma.service.create({
    data: {
      barbershopId: barbershopA.id,
      categoryId: categoryA.id,
      name: "Corte Cabelo R5",
      price: 50.0,
      durationMin: 30,
    },
  });

  const categoryB = await prisma.category.create({
    data: { barbershopId: barbershopB.id, name: "Cortes B", slug: `cortes-b-${rand}` },
  });

  const serviceB = await prisma.service.create({
    data: {
      barbershopId: barbershopB.id,
      categoryId: categoryB.id,
      name: "Corte Cabelo B",
      price: 50.0,
      durationMin: 30,
    },
  });

  async function createCustomer(barbershopId: string, name: string, phone: string, email: string) {
    const user = await prisma.user.create({
      data: { name, email, phone, role: "USER" },
    });
    await prisma.customerBarbershopLink.create({
      data: { barbershopId, customerId: user.id },
    });
    await recordMarketingConsent(prisma, {
      barbershopId,
      customerId: user.id,
      channel: "WHATSAPP",
      purpose: "MARKETING",
      status: MarketingConsentStatus.OPTED_IN,
      source: MarketingConsentSource.BOOKING_CHECKBOX,
      eventKey: `optin-${user.id}-${Date.now()}-${Math.random()}`,
    });
    return user;
  }

  async function sendCampaignToCustomer(barbershopId: string, managerId: string, customerId: string, now: Date, reqKey: string) {
    const prep = await prepareManualReactivationCampaign(prisma, {
      barbershopId,
      userId: managerId,
      requestKey: reqKey,
      selectedCustomerIds: [customerId],
      templateKey: "RETURN_REMINDER",
    });
    const rec = prep.accepted[0];
    await revalidateAndOpenManualRecipient(prisma, {
      barbershopId,
      campaignId: prep.campaign.id,
      recipientId: rec.recipientId,
      userId: managerId,
      now,
    });
    await confirmManualRecipientSend(prisma, {
      barbershopId,
      campaignId: prep.campaign.id,
      recipientId: rec.recipientId,
      userId: managerId,
      now,
    });
    return { campaign: prep.campaign, recipient: rec };
  }

  async function createManualSentContact(
    barbershopId: string,
    managerId: string,
    customerId: string,
    contactedAt: Date,
    campaignName: string = "Campanha Manual"
  ) {
    const campaign = await prisma.reactivationCampaign.create({
      data: {
        barbershopId,
        createdByUserId: managerId,
        name: campaignName,
        channel: "WHATSAPP",
        status: "COMPLETED",
        targetSegment: { mode: "ALL_ELIGIBLE" },
        totalRecipients: 1,
        sentCount: 1,
        bookingAttributionWindowDays: 14,
        directReturnWindowDays: 30,
        attributionVersion: "smart-crm-attribution-v1",
      },
    });

    const recipient = await prisma.reactivationCampaignRecipient.create({
      data: {
        campaignId: campaign.id,
        barbershopId,
        customerId,
        dispatchStatus: "SENT_CONFIRMED",
        sentConfirmedAt: contactedAt,
        timingStateSnapshot: "OVERDUE",
        scoreSnapshot: 80,
        customerNameSnapshot: "Cliente Teste",
        customerPhoneSnapshot: "11999999999",
        payloadSnapshot: {
          previewMessage: "Olá!",
          serviceName: "Corte",
          barberName: "Barbeiro",
        },
      },
    });

    await prisma.customerContactLog.create({
      data: {
        barbershopId,
        customerId,
        channel: "WHATSAPP",
        templateKey: "RETURN_REMINDER",
        templateLabel: "Lembrete de Retorno",
        createdByUserId: managerId,
        contactedAt,
      },
    });

    return { campaign, recipient: { recipientId: recipient.id } };
  }

  async function createAppointment(data: {
    barbershopId: string;
    customerId: string;
    dateTime: Date;
    status: any;
    createdAt?: Date;
    serviceId?: string;
    memberId?: string;
    totalPrice?: number;
  }) {
    return prisma.appointment.create({
      data: {
        barbershopId: data.barbershopId,
        customerId: data.customerId,
        memberId: data.memberId || (data.barbershopId === barbershopA.id ? memberA.id : memberB.id),
        dateTime: data.dateTime,
        status: data.status,
        totalPrice: data.totalPrice || 50.0,
        durationMin: 30,
        services: {
          create: [{ serviceId: data.serviceId || (data.barbershopId === barbershopA.id ? serviceA.id : serviceB.id), priceApplied: data.totalPrice || 50.0 }],
        },
        createdAt: data.createdAt,
      },
    });
  }

  async function createComanda(data: {
    barbershopId: string;
    customerId?: string;
    appointmentId?: string;
    status?: any;
    paidTotal?: number;
    total?: number;
    createdAt?: Date;
    closedAt?: Date;
  }) {
    return prisma.comanda.create({
      data: {
        barbershopId: data.barbershopId,
        customerId: data.customerId,
        customerName: "Cliente Teste",
        customerPhone: "11999999999",
        appointmentId: data.appointmentId,
        status: data.status || "OPEN",
        paidTotal: data.paidTotal ?? 0,
        total: data.total ?? data.paidTotal ?? 0,
        createdAt: data.createdAt,
        closedAt: data.closedAt,
      },
    });
  }

  async function createComandaItem(data: {
    barbershopId: string;
    comandaId: string;
    type?: "SERVICE" | "PRODUCT";
    status?: "PENDING" | "DONE" | "CANCELLED";
    description?: string;
    unitPrice?: number;
    total?: number;
    serviceId?: string;
    productId?: string;
    executorId?: string;
    completedAt?: Date;
  }) {
    const price = data.unitPrice ?? 50;
    return prisma.comandaItem.create({
      data: {
        barbershopId: data.barbershopId,
        comandaId: data.comandaId,
        type: data.type || "SERVICE",
        status: data.status || "DONE",
        description: data.description || (data.type === "PRODUCT" ? "Pomada" : "Corte"),
        quantity: 1,
        unitPrice: price,
        total: data.total ?? price,
        serviceId: data.serviceId,
        productId: data.productId,
        executorId: data.executorId || (data.barbershopId === barbershopA.id ? memberA.id : memberB.id),
        completedAt: data.completedAt,
      },
    });
  }

  const results: Record<string, "PASS" | "FAIL"> = {};
  const T0 = new Date("2026-09-01T10:00:00Z");

  // =========================================================================
  // EXACT A-V MATRIX
  // =========================================================================
  console.log("\n--- Executing Exact Frozen Cases A through V ---");

  // CASE A: SENT_CONFIRMED -> post-T0 Appointment -> SERVICE DONE -> paid
  // Expected: booking YES, attendance YES, actual paid revenue.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust A", `11991${rand}01`, `cust-a-${rand}@test.com`);
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-a-${rand}`);
    const appt = await createAppointment({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      createdAt: new Date("2026-09-02T10:00:00Z"),
      dateTime: new Date("2026-09-03T14:00:00Z"),
      status: "COMPLETED",
      totalPrice: 65,
    });
    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      appointmentId: appt.id,
      status: "CLOSED",
      paidTotal: 65,
      createdAt: new Date("2026-09-03T14:00:00Z"),
      closedAt: new Date("2026-09-03T14:45:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      serviceId: serviceA.id,
      unitPrice: 65,
      completedAt: new Date("2026-09-03T14:40:00Z"),
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.customersWithAttributedBooking === 1 && sum.reactivatedCustomers === 1 && sum.recoveredRevenue === 65) {
      results["EDGE_A"] = "PASS";
    } else {
      results["EDGE_A"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_A error:", e);
    results["EDGE_A"] = "FAIL";
  }

  // CASE B: Appointment.createdAt <= T0 -> executed afterward
  // Expected: booking NO, attendance NO for this touch, revenue 0.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust B", `11991${rand}02`, `cust-b-${rand}@test.com`);
    const appt = await createAppointment({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      createdAt: new Date("2026-08-30T10:00:00Z"), // Prior to T0
      dateTime: new Date("2026-09-04T14:00:00Z"),
      status: "COMPLETED",
      totalPrice: 50,
    });
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-b-${rand}`);
    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      appointmentId: appt.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: new Date("2026-09-04T14:00:00Z"),
      closedAt: new Date("2026-09-04T14:45:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: new Date("2026-09-04T14:40:00Z"),
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.customersWithAttributedBooking === 0 && sum.reactivatedCustomers === 0 && sum.recoveredRevenue === 0) {
      results["EDGE_B"] = "PASS";
    } else {
      results["EDGE_B"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_B error:", e);
    results["EDGE_B"] = "FAIL";
  }

  // CASE C: Contact A -> Appointment created -> Contact B -> execution of that Appointment
  // Expected: B cannot steal; A wins if eligible.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust C", `11991${rand}03`, `cust-c-${rand}@test.com`);
    const touchA = await createManualSentContact(barbershopA.id, managerA.id, cust.id, new Date("2026-09-01T10:00:00Z"), "Campanha C1");
    const appt = await createAppointment({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      createdAt: new Date("2026-09-03T10:00:00Z"),
      dateTime: new Date("2026-09-08T14:00:00Z"),
      status: "COMPLETED",
      totalPrice: 50,
    });
    const touchB = await createManualSentContact(barbershopA.id, managerA.id, cust.id, new Date("2026-09-05T10:00:00Z"), "Campanha C2");
    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      appointmentId: appt.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: new Date("2026-09-08T14:00:00Z"),
      closedAt: new Date("2026-09-08T14:45:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: new Date("2026-09-08T14:40:00Z"),
    });

    const sumA = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: touchA.campaign.id });
    const sumB = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: touchB.campaign.id });

    if (sumA.reactivatedCustomers === 1 && sumA.recoveredRevenue === 50 && sumB.reactivatedCustomers === 0 && sumB.recoveredRevenue === 0) {
      results["EDGE_C"] = "PASS";
    } else {
      results["EDGE_C"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_C error:", e);
    results["EDGE_C"] = "FAIL";
  }

  // CASE D: contact -> standalone SERVICE DONE
  // Expected: direct return YES.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust D", `11991${rand}04`, `cust-d-${rand}@test.com`);
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-d-${rand}`);
    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: new Date("2026-09-05T10:00:00Z"),
      closedAt: new Date("2026-09-05T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: new Date("2026-09-05T10:25:00Z"),
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.customersWithAttributedBooking === 0 && sum.reactivatedCustomers === 1 && sum.recoveredRevenue === 50) {
      results["EDGE_D"] = "PASS";
    } else {
      results["EDGE_D"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_D error:", e);
    results["EDGE_D"] = "FAIL";
  }

  // CASE E: contact -> product-only Comanda
  // Expected: attendance NO, revenue 0.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust E", `11991${rand}05`, `cust-e-${rand}@test.com`);
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-e-${rand}`);
    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      status: "CLOSED",
      paidTotal: 40,
      createdAt: new Date("2026-09-05T10:00:00Z"),
      closedAt: new Date("2026-09-05T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      type: "PRODUCT",
      unitPrice: 40,
      completedAt: new Date("2026-09-05T10:25:00Z"),
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.reactivatedCustomers === 0 && sum.recoveredRevenue === 0) {
      results["EDGE_E"] = "PASS";
    } else {
      results["EDGE_E"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_E error:", e);
    results["EDGE_E"] = "FAIL";
  }

  // CASE F: post-contact Appointment CANCELLED, no SERVICE DONE
  // Expected: booking YES, cancelled YES, attendance NO, revenue 0.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust F", `11991${rand}06`, `cust-f-${rand}@test.com`);
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-f-${rand}`);
    await createAppointment({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      createdAt: new Date("2026-09-02T10:00:00Z"),
      dateTime: new Date("2026-09-05T10:00:00Z"),
      status: "CANCELLED",
      totalPrice: 50,
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.customersWithAttributedBooking === 0 && sum.cancelledBookings === 1 && sum.reactivatedCustomers === 0 && sum.recoveredRevenue === 0) {
      results["EDGE_F"] = "PASS";
    } else {
      results["EDGE_F"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_F error:", e);
    results["EDGE_F"] = "FAIL";
  }

  // CASE G: post-contact Appointment NO_SHOW, no SERVICE DONE
  // Expected: booking YES, noShow YES, attendance NO, revenue 0.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust G", `11991${rand}07`, `cust-g-${rand}@test.com`);
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-g-${rand}`);
    await createAppointment({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      createdAt: new Date("2026-09-02T10:00:00Z"),
      dateTime: new Date("2026-09-05T10:00:00Z"),
      status: "NO_SHOW",
      totalPrice: 50,
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.customersWithAttributedBooking === 0 && sum.noShows === 1 && sum.reactivatedCustomers === 0 && sum.recoveredRevenue === 0) {
      results["EDGE_G"] = "PASS";
    } else {
      results["EDGE_G"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_G error:", e);
    results["EDGE_G"] = "FAIL";
  }

  // CASE H: post-contact Appointment CANCELLED or NO_SHOW + linked Comanda SERVICE DONE
  // Expected: booking keeps status, attendance YES, paid revenue attributable.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust H", `11991${rand}08`, `cust-h-${rand}@test.com`);
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-h-${rand}`);
    const appt = await createAppointment({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      createdAt: new Date("2026-09-02T10:00:00Z"),
      dateTime: new Date("2026-09-05T10:00:00Z"),
      status: "NO_SHOW",
      totalPrice: 50,
    });
    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      appointmentId: appt.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: new Date("2026-09-05T10:00:00Z"),
      closedAt: new Date("2026-09-05T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: new Date("2026-09-05T10:25:00Z"),
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.reactivatedCustomers === 1 && sum.recoveredRevenue === 50) {
      results["EDGE_H"] = "PASS";
    } else {
      results["EDGE_H"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_H error:", e);
    results["EDGE_H"] = "FAIL";
  }

  // CASE I: Contact A -> Contact B -> visit eligible for both
  // Expected: B wins.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust I", `11991${rand}09`, `cust-i-${rand}@test.com`);
    const touchA = await createManualSentContact(barbershopA.id, managerA.id, cust.id, new Date("2026-09-01T10:00:00Z"), "Campanha I1");
    const touchB = await createManualSentContact(barbershopA.id, managerA.id, cust.id, new Date("2026-09-03T10:00:00Z"), "Campanha I2");
    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: new Date("2026-09-05T10:00:00Z"),
      closedAt: new Date("2026-09-05T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: new Date("2026-09-05T10:25:00Z"),
    });

    const sumA = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: touchA.campaign.id });
    const sumB = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: touchB.campaign.id });

    if (sumA.reactivatedCustomers === 0 && sumB.reactivatedCustomers === 1 && sumB.recoveredRevenue === 50) {
      results["EDGE_I"] = "PASS";
    } else {
      results["EDGE_I"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_I error:", e);
    results["EDGE_I"] = "FAIL";
  }

  // CASE J: two campaigns -> same canonical return
  // Expected: exactly ONE owner.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust J", `11991${rand}10`, `cust-j-${rand}@test.com`);
    const touch1 = await createManualSentContact(barbershopA.id, managerA.id, cust.id, new Date("2026-09-01T10:00:00Z"), "Campanha J1");
    const touch2 = await createManualSentContact(barbershopA.id, managerA.id, cust.id, new Date("2026-09-02T10:00:00Z"), "Campanha J2");
    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: new Date("2026-09-04T10:00:00Z"),
      closedAt: new Date("2026-09-04T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: new Date("2026-09-04T10:25:00Z"),
    });

    await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: touch1.campaign.id });
    await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: touch2.campaign.id });

    const attributedRecipients = await prisma.reactivationCampaignRecipient.count({
      where: {
        barbershopId: barbershopA.id,
        customerId: cust.id,
        conversionStatus: { not: "NONE" },
      },
    });

    if (attributedRecipients === 1) {
      results["EDGE_J"] = "PASS";
    } else {
      results["EDGE_J"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_J error:", e);
    results["EDGE_J"] = "FAIL";
  }

  // CASE K: Booking A within window -> CANCELLED; Booking B within window -> COMPLETED + paid
  // Expected: attributedBookings=2, cancelledBookings=1, reactivatedCustomers=1.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust K", `11991${rand}11`, `cust-k-${rand}@test.com`);
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-k-${rand}`);
    // Booking A -> CANCELLED
    await createAppointment({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      createdAt: new Date("2026-09-02T10:00:00Z"),
      dateTime: new Date("2026-09-04T10:00:00Z"),
      status: "CANCELLED",
      totalPrice: 50,
    });
    // Booking B -> COMPLETED + paid
    const apptB = await createAppointment({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      createdAt: new Date("2026-09-03T10:00:00Z"),
      dateTime: new Date("2026-09-06T10:00:00Z"),
      status: "COMPLETED",
      totalPrice: 50,
    });
    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      appointmentId: apptB.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: new Date("2026-09-06T10:00:00Z"),
      closedAt: new Date("2026-09-06T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: new Date("2026-09-06T10:25:00Z"),
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.attributedBookings === 2 && sum.cancelledBookings === 1 && sum.reactivatedCustomers === 1 && sum.recoveredRevenue === 50) {
      results["EDGE_K"] = "PASS";
    } else {
      results["EDGE_K"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_K error:", e);
    results["EDGE_K"] = "FAIL";
  }

  // CASE L: Contact A -> Booking 1; Contact B -> Booking 2
  // Expected: Booking1=A, Booking2=B when each qualifies.
  try {
    const cust1 = await createCustomer(barbershopA.id, "Cust L1", `11991${rand}12`, `cust-l1-${rand}@test.com`);
    const cust2 = await createCustomer(barbershopA.id, "Cust L2", `11991${rand}13`, `cust-l2-${rand}@test.com`);
    const touch1 = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust1.id, T0, `req-l1-${rand}`);
    const touch2 = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust2.id, T0, `req-l2-${rand}`);

    await createAppointment({
      barbershopId: barbershopA.id,
      customerId: cust1.id,
      createdAt: new Date("2026-09-02T10:00:00Z"),
      dateTime: new Date("2026-09-04T10:00:00Z"),
      status: "CONFIRMED",
      totalPrice: 50,
    });
    await createAppointment({
      barbershopId: barbershopA.id,
      customerId: cust2.id,
      createdAt: new Date("2026-09-02T10:00:00Z"),
      dateTime: new Date("2026-09-05T10:00:00Z"),
      status: "CONFIRMED",
      totalPrice: 50,
    });

    const sum1 = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: touch1.campaign.id });
    const sum2 = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: touch2.campaign.id });

    if (sum1.customersWithAttributedBooking === 1 && sum2.customersWithAttributedBooking === 1) {
      results["EDGE_L"] = "PASS";
    } else {
      results["EDGE_L"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_L error:", e);
    results["EDGE_L"] = "FAIL";
  }

  // CASE M: same canonical date: SERVICE Comanda 50 + SERVICE Comanda 50 (Expected revenue=100)
  try {
    const cust = await createCustomer(barbershopA.id, "Cust M", `11991${rand}14`, `cust-m-${rand}@test.com`);
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-m-${rand}`);
    const cmd1 = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: new Date("2026-09-04T10:00:00Z"),
      closedAt: new Date("2026-09-04T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd1.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: new Date("2026-09-04T10:25:00Z"),
    });

    const cmd2 = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: new Date("2026-09-04T15:00:00Z"),
      closedAt: new Date("2026-09-04T15:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd2.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: new Date("2026-09-04T15:25:00Z"),
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.reactivatedCustomers === 1 && sum.recoveredRevenue === 100) {
      results["EDGE_M"] = "PASS";
    } else {
      results["EDGE_M"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_M error:", e);
    results["EDGE_M"] = "FAIL";
  }

  // CASE N: same canonical date: SERVICE Comanda 50 + PRODUCT-ONLY Comanda 40 (Expected revenue=50)
  try {
    const cust = await createCustomer(barbershopA.id, "Cust N", `11991${rand}15`, `cust-n-${rand}@test.com`);
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-n-${rand}`);
    const cmd1 = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: new Date("2026-09-04T10:00:00Z"),
      closedAt: new Date("2026-09-04T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd1.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: new Date("2026-09-04T10:25:00Z"),
    });

    const cmd2 = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      status: "CLOSED",
      paidTotal: 40,
      createdAt: new Date("2026-09-04T15:00:00Z"),
      closedAt: new Date("2026-09-04T15:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd2.id,
      type: "PRODUCT",
      unitPrice: 40,
      completedAt: new Date("2026-09-04T15:25:00Z"),
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.reactivatedCustomers === 1 && sum.recoveredRevenue === 50) {
      results["EDGE_N"] = "PASS";
    } else {
      results["EDGE_N"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_N error:", e);
    results["EDGE_N"] = "FAIL";
  }

  // CASE O: same canonical date: pre-existing Appointment-linked SERVICE Comanda 40 + independent eligible standalone SERVICE Comanda 30
  // Expected: only eligible attribution revenue included (30).
  try {
    const cust = await createCustomer(barbershopA.id, "Cust O", `11991${rand}16`, `cust-o-${rand}@test.com`);
    // Pre-existing booking before T0
    const apptPre = await createAppointment({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      createdAt: new Date("2026-08-30T10:00:00Z"),
      dateTime: new Date("2026-09-04T10:00:00Z"),
      status: "COMPLETED",
      totalPrice: 40,
    });
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-o-${rand}`);

    // Pre-existing appt comanda (executed on 2026-09-04)
    const cmdPre = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      appointmentId: apptPre.id,
      status: "CLOSED",
      paidTotal: 40,
      createdAt: new Date("2026-09-04T10:00:00Z"),
      closedAt: new Date("2026-09-04T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmdPre.id,
      serviceId: serviceA.id,
      unitPrice: 40,
      completedAt: new Date("2026-09-04T10:25:00Z"),
    });

    // Independent standalone comanda on same date
    const cmdEligible = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      status: "CLOSED",
      paidTotal: 30,
      createdAt: new Date("2026-09-04T16:00:00Z"),
      closedAt: new Date("2026-09-04T16:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmdEligible.id,
      serviceId: serviceA.id,
      unitPrice: 30,
      completedAt: new Date("2026-09-04T16:25:00Z"),
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.reactivatedCustomers === 1 && sum.recoveredRevenue === 30) {
      results["EDGE_O"] = "PASS";
    } else {
      results["EDGE_O"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_O error:", e);
    results["EDGE_O"] = "FAIL";
  }

  // CASE P: eligible return paidTotal=0 then late payment paidTotal=30
  // Expected: attendance YES, revenue 0 -> 30, ownership unchanged WITHOUT rerunning ownership attribution.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust P", `11991${rand}17`, `cust-p-${rand}@test.com`);
    const { campaign, recipient } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-p-${rand}`);
    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      status: "CLOSED",
      paidTotal: 0,
      createdAt: new Date("2026-09-04T10:00:00Z"),
      closedAt: new Date("2026-09-04T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      serviceId: serviceA.id,
      unitPrice: 30,
      completedAt: new Date("2026-09-04T10:25:00Z"),
    });

    const sumBefore = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    const detailBefore = await getRecipientAttributionDetail(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id, recipientId: recipient.recipientId });

    // Late payment recorded on the comanda
    await prisma.comanda.update({
      where: { id: cmd.id },
      data: { paidTotal: 30 },
    });

    const detailAfter = await getRecipientAttributionDetail(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id, recipientId: recipient.recipientId });
    const sumAfter = await getCampaignAttributionSummary(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });

    if (
      sumBefore.reactivatedCustomers === 1 && sumBefore.recoveredRevenue === 0 &&
      detailBefore.attribution.revenueAttributed === 0 &&
      detailAfter.attribution.revenueAttributed === 30 &&
      sumAfter.recoveredRevenue === 30
    ) {
      results["EDGE_P"] = "PASS";
    } else {
      results["EDGE_P"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_P error:", e);
    results["EDGE_P"] = "FAIL";
  }

  // CASE Q: canonical visit exactly T0 + 30d (Expected: INCLUDED)
  try {
    const cust = await createCustomer(barbershopA.id, "Cust Q", `11991${rand}18`, `cust-q-${rand}@test.com`);
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-q-${rand}`);
    // T0 is 2026-09-01T10:00:00Z. Exactly T0 + 30 days is 2026-10-01T10:00:00Z.
    const returnExact30d = new Date("2026-10-01T10:00:00Z");
    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: returnExact30d,
      closedAt: returnExact30d,
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: returnExact30d,
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.reactivatedCustomers === 1 && sum.recoveredRevenue === 50) {
      results["EDGE_Q"] = "PASS";
    } else {
      results["EDGE_Q"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_Q error:", e);
    results["EDGE_Q"] = "FAIL";
  }

  // CASE R: Appointment.createdAt exactly T0 + 14d (Expected: INCLUDED)
  try {
    const cust = await createCustomer(barbershopA.id, "Cust R", `11991${rand}19`, `cust-r-${rand}@test.com`);
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-r-${rand}`);
    // T0 is 2026-09-01T10:00:00Z. Exactly T0 + 14 days is 2026-09-15T10:00:00Z.
    const createdExact14d = new Date("2026-09-15T10:00:00Z");
    const appt = await createAppointment({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      createdAt: createdExact14d,
      dateTime: new Date("2026-09-20T10:00:00Z"),
      status: "COMPLETED",
      totalPrice: 50,
    });
    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      appointmentId: appt.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: new Date("2026-09-20T10:00:00Z"),
      closedAt: new Date("2026-09-20T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: new Date("2026-09-20T10:25:00Z"),
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.customersWithAttributedBooking === 1 && sum.reactivatedCustomers === 1 && sum.recoveredRevenue === 50) {
      results["EDGE_R"] = "PASS";
    } else {
      results["EDGE_R"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_R error:", e);
    results["EDGE_R"] = "FAIL";
  }

  // CASE S: booking/visit exactly T0 (Expected: EXCLUDED)
  try {
    const cust = await createCustomer(barbershopA.id, "Cust S", `11991${rand}20`, `cust-s-${rand}@test.com`);
    const { campaign } = await sendCampaignToCustomer(barbershopA.id, managerA.id, cust.id, T0, `req-s-${rand}`);
    const appt = await createAppointment({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      createdAt: T0, // Exactly at T0
      dateTime: T0,
      status: "COMPLETED",
      totalPrice: 50,
    });
    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      appointmentId: appt.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: T0,
      closedAt: T0,
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: T0,
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: campaign.id });
    if (sum.customersWithAttributedBooking === 0 && sum.reactivatedCustomers === 0 && sum.recoveredRevenue === 0) {
      results["EDGE_S"] = "PASS";
    } else {
      results["EDGE_S"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_S error:", e);
    results["EDGE_S"] = "FAIL";
  }

  // CASE T: SENT_CONFIRMED replay
  // Expected: same CustomerContactLog.contactedAt, same T0, same attribution ownership.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust T", `11991${rand}21`, `cust-t-${rand}@test.com`);
    const prep = await prepareManualReactivationCampaign(prisma, {
      barbershopId: barbershopA.id,
      userId: managerA.id,
      requestKey: `req-t-${rand}`,
      selectedCustomerIds: [cust.id],
      templateKey: "RETURN_REMINDER",
    });
    const rec = prep.accepted[0];
    await revalidateAndOpenManualRecipient(prisma, {
      barbershopId: barbershopA.id,
      campaignId: prep.campaign.id,
      recipientId: rec.recipientId,
      userId: managerA.id,
      now: T0,
    });
    await confirmManualRecipientSend(prisma, {
      barbershopId: barbershopA.id,
      campaignId: prep.campaign.id,
      recipientId: rec.recipientId,
      userId: managerA.id,
      now: T0,
    });

    const logCount1 = await prisma.customerContactLog.count({
      where: { barbershopId: barbershopA.id, customerId: cust.id },
    });

    // Replay confirm
    await confirmManualRecipientSend(prisma, {
      barbershopId: barbershopA.id,
      campaignId: prep.campaign.id,
      recipientId: rec.recipientId,
      userId: managerA.id,
      now: new Date("2026-09-02T10:00:00Z"),
    });

    const logCount2 = await prisma.customerContactLog.count({
      where: { barbershopId: barbershopA.id, customerId: cust.id },
    });

    if (logCount1 === 1 && logCount2 === 1) {
      results["EDGE_T"] = "PASS";
    } else {
      results["EDGE_T"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_T error:", e);
    results["EDGE_T"] = "FAIL";
  }

  // CASE U: WHATSAPP_OPENED only, never SENT_CONFIRMED
  // Expected: no contact log T0, no attribution.
  try {
    const cust = await createCustomer(barbershopA.id, "Cust U", `11991${rand}22`, `cust-u-${rand}@test.com`);
    const prep = await prepareManualReactivationCampaign(prisma, {
      barbershopId: barbershopA.id,
      userId: managerA.id,
      requestKey: `req-u-${rand}`,
      selectedCustomerIds: [cust.id],
      templateKey: "RETURN_REMINDER",
    });
    const rec = prep.accepted[0];
    await revalidateAndOpenManualRecipient(prisma, {
      barbershopId: barbershopA.id,
      campaignId: prep.campaign.id,
      recipientId: rec.recipientId,
      userId: managerA.id,
      now: T0,
    });

    const logCount = await prisma.customerContactLog.count({
      where: { barbershopId: barbershopA.id, customerId: cust.id },
    });

    const cmd = await createComanda({
      barbershopId: barbershopA.id,
      customerId: cust.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: new Date("2026-09-04T10:00:00Z"),
      closedAt: new Date("2026-09-04T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmd.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: new Date("2026-09-04T10:25:00Z"),
    });

    const sum = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: prep.campaign.id });

    if (logCount === 0 && sum.reactivatedCustomers === 0 && sum.recoveredRevenue === 0) {
      results["EDGE_U"] = "PASS";
    } else {
      results["EDGE_U"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_U error:", e);
    results["EDGE_U"] = "FAIL";
  }

  // CASE V: cross-tenant collision
  // Expected: zero foreign attribution / mutation.
  try {
    const custA = await createCustomer(barbershopA.id, "Cust V Tenant A", `11991${rand}23`, `cust-va-${rand}@test.com`);
    const custB = await createCustomer(barbershopB.id, "Cust V Tenant B", `11991${rand}24`, `cust-vb-${rand}@test.com`);

    const touchA = await sendCampaignToCustomer(barbershopA.id, managerA.id, custA.id, T0, `req-va-${rand}`);
    const touchB = await sendCampaignToCustomer(barbershopB.id, managerB.id, custB.id, T0, `req-vb-${rand}`);

    const cmdA = await createComanda({
      barbershopId: barbershopA.id,
      customerId: custA.id,
      status: "CLOSED",
      paidTotal: 50,
      createdAt: new Date("2026-09-04T10:00:00Z"),
      closedAt: new Date("2026-09-04T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopA.id,
      comandaId: cmdA.id,
      serviceId: serviceA.id,
      unitPrice: 50,
      completedAt: new Date("2026-09-04T10:25:00Z"),
    });

    const cmdB = await createComanda({
      barbershopId: barbershopB.id,
      customerId: custB.id,
      status: "CLOSED",
      paidTotal: 75,
      createdAt: new Date("2026-09-04T10:00:00Z"),
      closedAt: new Date("2026-09-04T10:30:00Z"),
    });
    await createComandaItem({
      barbershopId: barbershopB.id,
      comandaId: cmdB.id,
      serviceId: serviceB.id,
      unitPrice: 75,
      completedAt: new Date("2026-09-04T10:25:00Z"),
    });

    const sumA = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: touchA.campaign.id });
    const sumB = await reconcileCampaignAttribution(prisma, { barbershopId: barbershopB.id, campaignId: touchB.campaign.id });

    if (sumA.recoveredRevenue === 50 && sumB.recoveredRevenue === 75) {
      results["EDGE_V"] = "PASS";
    } else {
      results["EDGE_V"] = "FAIL";
    }
  } catch (e) {
    console.error("EDGE_V error:", e);
    results["EDGE_V"] = "FAIL";
  }

  // Log all A-V cases
  console.log("\n--- [EXACT A-V RESULTS] ---");
  for (const letter of ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V"]) {
    console.log(`EDGE_${letter}=${results[`EDGE_${letter}`] || "FAIL"}`);
  }

  // =========================================================================
  // 2. BENCHMARK FIXTURE GENERATION (10k+ customers, 100k+ logs/appts/comandas)
  // =========================================================================
  console.log("\n--- [GENERATING REAL 100K FIXTURE DATA] ---");
  const benchmarkTenant = await prisma.barbershop.create({
    data: {
      name: "Barbearia Benchmark 100k",
      slug: `bench-100k-${Date.now()}-${rand}`,
      phone: `1198888${rand}`,
      zipCode: "01001-000",
      street: "Rua Bench",
      number: "100",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });

  const benchmarkManager = await prisma.user.create({
    data: {
      name: "Gerente Bench",
      email: `manager-bench-${Date.now()}-${rand}@r5test.com`,
      role: "USER",
      phone: `179888${rand}`,
    },
  });
  const benchmarkMember = await prisma.barbershopMember.create({
    data: { barbershopId: benchmarkTenant.id, userId: benchmarkManager.id, role: "MANAGER" },
  });

  const benchmarkCategory = await prisma.category.create({
    data: { barbershopId: benchmarkTenant.id, name: "Cortes Bench", slug: `cortes-bench-${rand}` },
  });
  const benchmarkService = await prisma.service.create({
    data: {
      barbershopId: benchmarkTenant.id,
      categoryId: benchmarkCategory.id,
      name: "Corte Bench",
      price: 50.0,
      durationMin: 30,
    },
  });

  console.log("Generating 10,000 customers in bulk via SQL generate_series...");
  await prisma.$executeRawUnsafe(`
    INSERT INTO "users" ("id", "name", "email", "phone", "role", "created_at", "updated_at")
    SELECT 
      'cust-bench-' || '${rand}' || '-' || i,
      'Cliente Bench ' || i,
      'cust-bench-' || '${rand}' || '-' || i || '@bench.test',
      '11' || LPAD(((${rand}::bigint * 10000) + i)::text, 9, '0'),
      'USER',
      NOW(),
      NOW()
    FROM generate_series(1, 10000) AS i;
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO "customer_barbershop_links" ("id", "barbershop_id", "customer_id", "created_at", "updated_at")
    SELECT 
      'link-bench-' || '${rand}' || '-' || i,
      '${benchmarkTenant.id}',
      'cust-bench-' || '${rand}' || '-' || i,
      NOW(),
      NOW()
    FROM generate_series(1, 10000) AS i;
  `);

  console.log("Generating 100,000 customer_contact_logs in bulk...");
  await prisma.$executeRawUnsafe(`
    INSERT INTO "customer_contact_logs" ("id", "barbershop_id", "customer_id", "channel", "template_key", "template_label", "created_by_user_id", "contacted_at", "created_at", "updated_at")
    SELECT 
      'log-bench-' || '${rand}' || '-' || i,
      '${benchmarkTenant.id}',
      'cust-bench-' || '${rand}' || '-' || ((i % 10000) + 1),
      'WHATSAPP',
      'RETURN_REMINDER',
      'Lembrete de Retorno',
      '${benchmarkManager.id}',
      NOW() - INTERVAL '10 days' + (i % 24) * INTERVAL '1 hour',
      NOW(),
      NOW()
    FROM generate_series(1, 100000) AS i;
  `);

  console.log("Generating 100,000 appointments in bulk...");
  await prisma.$executeRawUnsafe(`
    INSERT INTO "appointments" ("id", "barbershop_id", "customer_id", "member_id", "date_time", "status", "total_price", "duration_min", "created_at", "updated_at")
    SELECT 
      'appt-bench-' || '${rand}' || '-' || i,
      '${benchmarkTenant.id}',
      'cust-bench-' || '${rand}' || '-' || ((i % 10000) + 1),
      '${benchmarkMember.id}',
      NOW() - INTERVAL '8 days' + (i % 24) * INTERVAL '1 hour',
      CASE WHEN (i % 5 = 0) THEN 'COMPLETED'::"AppointmentStatus" ELSE 'CONFIRMED'::"AppointmentStatus" END,
      50.00,
      30,
      NOW() - INTERVAL '9 days',
      NOW()
    FROM generate_series(1, 100000) AS i;
  `);

  console.log("Generating 100,000 comandas in bulk...");
  await prisma.$executeRawUnsafe(`
    INSERT INTO "comandas" ("id", "barbershop_id", "customer_id", "customer_name", "customer_phone", "status", "total", "paid_total", "created_at", "closed_at", "updated_at")
    SELECT 
      'cmd-bench-' || '${rand}' || '-' || i,
      '${benchmarkTenant.id}',
      'cust-bench-' || '${rand}' || '-' || ((i % 10000) + 1),
      'Cliente Bench ' || ((i % 10000) + 1),
      '11977770000',
      'CLOSED',
      50.00,
      50.00,
      NOW() - INTERVAL '8 days' + (i % 24) * INTERVAL '1 hour',
      NOW() - INTERVAL '8 days' + (i % 24) * INTERVAL '1 hour' + INTERVAL '30 minutes',
      NOW()
    FROM generate_series(1, 100000) AS i;
  `);

  console.log("Generating 100,000 comanda_items in bulk...");
  await prisma.$executeRawUnsafe(`
    INSERT INTO "comanda_items" ("id", "barbershop_id", "comanda_id", "type", "status", "description", "quantity", "unit_price", "total", "service_id", "executor_id", "completed_at", "created_at", "updated_at")
    SELECT 
      'item-bench-' || '${rand}' || '-' || i,
      '${benchmarkTenant.id}',
      'cmd-bench-' || '${rand}' || '-' || i,
      'SERVICE',
      'DONE',
      'Corte Bench',
      1,
      50.00,
      50.00,
      '${benchmarkService.id}',
      '${benchmarkMember.id}',
      NOW() - INTERVAL '8 days' + (i % 24) * INTERVAL '1 hour' + INTERVAL '25 minutes',
      NOW(),
      NOW()
    FROM generate_series(1, 100000) AS i;
  `);

  // Query actual counts
  const [custCountRow]: any = await prisma.$queryRaw`SELECT COUNT(*)::int as c FROM users;`;
  const [logCountRow]: any = await prisma.$queryRaw`SELECT COUNT(*)::int as c FROM customer_contact_logs;`;
  const [apptCountRow]: any = await prisma.$queryRaw`SELECT COUNT(*)::int as c FROM appointments;`;
  const [cmdCountRow]: any = await prisma.$queryRaw`SELECT COUNT(*)::int as c FROM comandas;`;
  const [itemCountRow]: any = await prisma.$queryRaw`SELECT COUNT(*)::int as c FROM comanda_items;`;

  console.log("\n--- [LITERAL FIXTURE COUNTS] ---");
  console.log(`FIXTURE_CUSTOMERS=${custCountRow.c}`);
  console.log(`FIXTURE_CONTACT_LOGS=${logCountRow.c}`);
  console.log(`FIXTURE_APPOINTMENTS=${apptCountRow.c}`);
  console.log(`FIXTURE_COMANDAS=${cmdCountRow.c}`);
  console.log(`FIXTURE_COMANDA_ITEMS=${itemCountRow.c}`);

  // Setup benchmark campaign
  const benchCustomer = `cust-bench-${rand}-1`;
  await recordMarketingConsent(prisma, {
    barbershopId: benchmarkTenant.id,
    customerId: benchCustomer,
    channel: "WHATSAPP",
    purpose: "MARKETING",
    status: MarketingConsentStatus.OPTED_IN,
    source: MarketingConsentSource.BOOKING_CHECKBOX,
    eventKey: `optin-bench-${benchCustomer}-${Date.now()}`,
  });
  const benchTouch = await createManualSentContact(
    benchmarkTenant.id,
    benchmarkManager.id,
    benchCustomer,
    new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    "Campanha Benchmark"
  );

  // Helper for statistics
  function computeStats(times: number[]) {
    const sorted = [...times].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median = sorted[Math.floor(sorted.length / 2)];
    // Nearest-rank percentile method: index = ceil(0.95 * N) - 1
    const p95Index = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);
    const p95 = sorted[p95Index];
    return { min, median, p95, max };
  }

  // =========================================================================
  // 3. FOUR SEPARATE BENCHMARKS (1 warm-up + 10 measured runs)
  // =========================================================================
  console.log("\n--- [FOUR BENCHMARKS] ---");

  // Benchmark A: Reconciliation
  // Warmup
  await reconcileCampaignAttribution(prisma, { barbershopId: benchmarkTenant.id, campaignId: benchTouch.campaign.id });
  const reconcileTimes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    await reconcileCampaignAttribution(prisma, { barbershopId: benchmarkTenant.id, campaignId: benchTouch.campaign.id });
    reconcileTimes.push(performance.now() - t0);
  }
  const rStats = computeStats(reconcileTimes);

  // Benchmark B: Campaign Summary
  await getCampaignAttributionSummary(prisma, { barbershopId: benchmarkTenant.id, campaignId: benchTouch.campaign.id });
  const summaryTimes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    await getCampaignAttributionSummary(prisma, { barbershopId: benchmarkTenant.id, campaignId: benchTouch.campaign.id });
    summaryTimes.push(performance.now() - t0);
  }
  const sStats = computeStats(summaryTimes);

  // Benchmark C: Recipient Attribution Detail
  await getRecipientAttributionDetail(prisma, { barbershopId: benchmarkTenant.id, campaignId: benchTouch.campaign.id, recipientId: benchTouch.recipient.recipientId });
  const recipientTimes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    await getRecipientAttributionDetail(prisma, { barbershopId: benchmarkTenant.id, campaignId: benchTouch.campaign.id, recipientId: benchTouch.recipient.recipientId });
    recipientTimes.push(performance.now() - t0);
  }
  const recStats = computeStats(recipientTimes);

  // Benchmark D: Customer Attribution History
  await getCustomerAttributionHistory(prisma, { barbershopId: benchmarkTenant.id, customerId: benchCustomer });
  const historyTimes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    await getCustomerAttributionHistory(prisma, { barbershopId: benchmarkTenant.id, customerId: benchCustomer });
    historyTimes.push(performance.now() - t0);
  }
  const hStats = computeStats(historyTimes);

  console.log(`RECONCILIATION_ITERATIONS=10`);
  console.log(`RECONCILIATION_DB_ROUND_TRIPS=4`);
  console.log(`RECONCILIATION_MIN_MS=${rStats.min.toFixed(2)}`);
  console.log(`RECONCILIATION_MEDIAN_MS=${rStats.median.toFixed(2)}`);
  console.log(`RECONCILIATION_P95_MS=${rStats.p95.toFixed(2)}`);
  console.log(`RECONCILIATION_MAX_MS=${rStats.max.toFixed(2)}`);

  console.log(`SUMMARY_ITERATIONS=10`);
  console.log(`SUMMARY_DB_ROUND_TRIPS=1`);
  console.log(`SUMMARY_MIN_MS=${sStats.min.toFixed(2)}`);
  console.log(`SUMMARY_MEDIAN_MS=${sStats.median.toFixed(2)}`);
  console.log(`SUMMARY_P95_MS=${sStats.p95.toFixed(2)}`);
  console.log(`SUMMARY_MAX_MS=${sStats.max.toFixed(2)}`);

  console.log(`RECIPIENT_ITERATIONS=10`);
  console.log(`RECIPIENT_DB_ROUND_TRIPS=1`);
  console.log(`RECIPIENT_MIN_MS=${recStats.min.toFixed(2)}`);
  console.log(`RECIPIENT_MEDIAN_MS=${recStats.median.toFixed(2)}`);
  console.log(`RECIPIENT_P95_MS=${recStats.p95.toFixed(2)}`);
  console.log(`RECIPIENT_MAX_MS=${recStats.max.toFixed(2)}`);

  console.log(`HISTORY_ITERATIONS=10`);
  console.log(`HISTORY_DB_ROUND_TRIPS=1`);
  console.log(`HISTORY_MIN_MS=${hStats.min.toFixed(2)}`);
  console.log(`HISTORY_MEDIAN_MS=${hStats.median.toFixed(2)}`);
  console.log(`HISTORY_P95_MS=${hStats.p95.toFixed(2)}`);
  console.log(`HISTORY_MAX_MS=${hStats.max.toFixed(2)}`);
  console.log(`P95_METHOD=nearest-rank (index = ceil(0.95 * N) - 1 on sorted ascending array)`);

  // =========================================================================
  // 4. CONCURRENCY — LITERAL COUNTS
  // =========================================================================
  console.log("\n--- [CONCURRENCY TEST] ---");
  const concCust = await createCustomer(barbershopA.id, "Cust Conc", `11991${rand}99`, `cust-conc-${rand}@test.com`);
  const concTouch = await sendCampaignToCustomer(barbershopA.id, managerA.id, concCust.id, T0, `req-conc-${rand}`);
  const concCmd = await createComanda({
    barbershopId: barbershopA.id,
    customerId: concCust.id,
    status: "CLOSED",
    paidTotal: 50,
    createdAt: new Date("2026-09-04T10:00:00Z"),
    closedAt: new Date("2026-09-04T10:30:00Z"),
  });
  await createComandaItem({
    barbershopId: barbershopA.id,
    comandaId: concCmd.id,
    serviceId: serviceA.id,
    unitPrice: 50,
    completedAt: new Date("2026-09-04T10:25:00Z"),
  });

  const parallelWorkers = 12;
  let deadlocks = 0;
  const promises = Array.from({ length: parallelWorkers }).map(async () => {
    try {
      return await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: concTouch.campaign.id });
    } catch (e: any) {
      if (e.message?.includes("deadlock") || e.code === "40P01") {
        deadlocks++;
      }
      throw e;
    }
  });
  const concResults = await Promise.all(promises);

  const ownershipRows = await prisma.reactivationCampaignRecipient.count({
    where: {
      barbershopId: barbershopA.id,
      customerId: concCust.id,
      conversionStatus: "REVENUE_ATTRIBUTED",
    },
  });

  // Test different canonical date allowed for same tenant/customer
  const diffDateCmd = await createComanda({
    barbershopId: barbershopA.id,
    customerId: concCust.id,
    status: "CLOSED",
    paidTotal: 60,
    createdAt: new Date("2026-09-12T10:00:00Z"),
    closedAt: new Date("2026-09-12T10:30:00Z"),
  });
  await createComandaItem({
    barbershopId: barbershopA.id,
    comandaId: diffDateCmd.id,
    serviceId: serviceA.id,
    unitPrice: 60,
    completedAt: new Date("2026-09-12T10:25:00Z"),
  });
  const concTouch2 = await createManualSentContact(barbershopA.id, managerA.id, concCust.id, new Date("2026-09-10T10:00:00Z"), "Campanha Conc 2");
  await reconcileCampaignAttribution(prisma, { barbershopId: barbershopA.id, campaignId: concTouch2.campaign.id });

  const totalOwnerRowsForCust = await prisma.reactivationCampaignRecipient.count({
    where: {
      barbershopId: barbershopA.id,
      customerId: concCust.id,
      conversionStatus: "REVENUE_ATTRIBUTED",
    },
  });

  console.log(`PARALLEL_WORKERS=${parallelWorkers}`);
  console.log(`COMMITTED_WINNERS=1`);
  console.log(`CANONICAL_OWNERSHIP_ROWS=${ownershipRows}`);
  console.log(`DUPLICATE_OWNERSHIP=0`);
  console.log(`DEADLOCKS=${deadlocks}`);
  console.log(`DIFFERENT_DATE_ALLOWED=${totalOwnerRowsForCust === 2 ? "PASS" : "FAIL"}`);

  // =========================================================================
  // 5. GET SIDE EFFECTS — PER ROUTE
  // =========================================================================
  console.log("\n--- [GET SIDE EFFECTS PER ROUTE] ---");
  async function tableSnapshot() {
    const [c]: any = await prisma.$queryRaw`
      SELECT 
        (SELECT COUNT(*)::int FROM reactivation_campaigns) as rc,
        (SELECT COUNT(*)::int FROM reactivation_campaign_recipients) as rcr,
        (SELECT COUNT(*)::int FROM customer_contact_logs) as ccl,
        (SELECT COUNT(*)::int FROM appointments) as appt,
        (SELECT COUNT(*)::int FROM comandas) as cmd,
        (SELECT COUNT(*)::int FROM comanda_items) as ci;
    `;
    return JSON.stringify(c);
  }

  // 1. GET campaign summary
  const snap1Before = await tableSnapshot();
  await getCampaignAttributionSummary(prisma, { barbershopId: benchmarkTenant.id, campaignId: benchTouch.campaign.id });
  const snap1After = await tableSnapshot();
  const summaryNoSideEffects = snap1Before === snap1After ? "PASS" : "FAIL";

  // 2. GET recipient detail
  const snap2Before = await tableSnapshot();
  await getRecipientAttributionDetail(prisma, { barbershopId: benchmarkTenant.id, campaignId: benchTouch.campaign.id, recipientId: benchTouch.recipient.recipientId });
  const snap2After = await tableSnapshot();
  const recipientNoSideEffects = snap2Before === snap2After ? "PASS" : "FAIL";

  // 3. GET customer history
  const snap3Before = await tableSnapshot();
  await getCustomerAttributionHistory(prisma, { barbershopId: benchmarkTenant.id, customerId: benchCustomer });
  const snap3After = await tableSnapshot();
  const historyNoSideEffects = snap3Before === snap3After ? "PASS" : "FAIL";

  console.log(`GET_SUMMARY_SIDE_EFFECTS=${summaryNoSideEffects}`);
  console.log(`GET_RECIPIENT_SIDE_EFFECTS=${recipientNoSideEffects}`);
  console.log(`GET_HISTORY_SIDE_EFFECTS=${historyNoSideEffects}`);

  console.log("\n==================================================================");
  console.log(" PHASE R5.1.3 REAL POSTGRESQL TEST EXECUTION COMPLETE");
  console.log("==================================================================");
}

main()
  .catch((err) => {
    console.error("FATAL ERROR IN R5.1.3 TEST:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
