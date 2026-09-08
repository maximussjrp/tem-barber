/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import {
  PrismaClient,
  MarketingConsentStatus,
  MarketingConsentSource,
  CampaignStatus,
  RecipientDispatchStatus,
  CustomerTimingState,
  ExpectedReturnSource,
  UserRole,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  recordMarketingConsent,
  getMarketingConsentStatus,
  createReactivationContactLog,
} from "../src/lib/clients/reactivation";

const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

const pool = new Pool({ connectionString: testDbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("==================================================================");
  console.log(" TEM BARBER — PHASE R2.1a FOUNDATION REAL POSTGRESQL SUITE");
  console.log("==================================================================");

  // 1. Verify DB Version
  const [versionRow]: any = await prisma.$queryRaw`SELECT version();`;
  console.log("DB Version:", versionRow.version);

  // Clean up any test fixtures from previous runs
  const testBarbershopSlug = "r2-1a-test-barbershop";
  await prisma.barbershop.deleteMany({ where: { slug: testBarbershopSlug } });
  await prisma.user.deleteMany({ where: { phone: { startsWith: "+551199991" } } });

  console.log("\n--- [STEP 1] Verifying PostgreSQL Enums in Database Catalog ---");
  const enumChecks: Record<string, string[]> = {
    MarketingConsentStatus: ["OPTED_IN", "OPTED_OUT"],
    MarketingConsentSource: [
      "ADMIN_WITH_PROOF",
      "BOOKING_CHECKBOX",
      "CUSTOMER_REQUEST_IN_PERSON",
      "CUSTOMER_REQUEST_WHATSAPP",
      "IMPORT_WITH_PROOF",
    ],
    CampaignStatus: ["CANCELLED", "COMPLETED", "DRAFT", "IN_PROGRESS", "READY"],
    RecipientDispatchStatus: [
      "EXCLUDED",
      "FAILED",
      "OPTED_OUT",
      "READY",
      "SENT_CONFIRMED",
      "WHATSAPP_OPENED",
    ],
    RecipientConversionStatus: [
      "ATTENDED",
      "BOOKED",
      "DIRECT_RETURN",
      "NONE",
      "REVENUE_ATTRIBUTED",
    ],
    CustomerTimingState: [
      "DUE",
      "DUE_SOON",
      "INACTIVE",
      "NOT_DUE",
      "NO_HISTORY",
      "OVERDUE",
    ],
    ExpectedReturnSource: [
      "BARBERSHOP_MEDIAN",
      "PERSONAL",
      "PLATFORM_FALLBACK",
      "SERVICE_MEDIAN",
    ],
  };

  for (const [enumName, expectedValues] of Object.entries(enumChecks)) {
    const rows: any[] = await prisma.$queryRaw`
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = ${enumName}
      ORDER BY e.enumlabel;
    `;
    const actualValues = rows.map((r) => r.enumlabel).sort();
    const sortedExpected = [...expectedValues].sort();
    if (JSON.stringify(actualValues) !== JSON.stringify(sortedExpected)) {
      throw new Error(
        `Catalog enum mismatch for ${enumName}. Expected ${JSON.stringify(sortedExpected)}, got ${JSON.stringify(actualValues)}`
      );
    }
  }
  console.log("✅ All 7 PostgreSQL enums strictly match frozen contract");

  console.log("\n--- [STEP 2] Creating Test Fixtures ---");
  const barbershop = await prisma.barbershop.create({
    data: {
      name: "Smart CRM Test Barbearia",
      slug: testBarbershopSlug,
      phone: "+5511999910000",
      zipCode: "01001-000",
      street: "Rua Teste",
      number: "100",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });

  const ownerUser = await prisma.user.create({
    data: {
      name: "Owner Test",
      email: "owner-r21a@test.com",
      phone: "+5511999910001",
      role: UserRole.USER,
    },
  });

  const ownerMember = await prisma.barbershopMember.create({
    data: {
      barbershopId: barbershop.id,
      userId: ownerUser.id,
      role: "OWNER",
    },
  });

  const customer1 = await prisma.user.create({
    data: {
      name: "Customer One",
      email: "customer1-r21a@test.com",
      phone: "+5511999910002",
      role: UserRole.USER,
    },
  });

  const category = await prisma.category.create({
    data: {
      barbershopId: barbershop.id,
      name: "Cortes",
      slug: "cortes-r21a",
    },
  });

  const service = await prisma.service.create({
    data: {
      barbershopId: barbershop.id,
      categoryId: category.id,
      name: "Corte Tradicional",
      price: 50.0,
      durationMin: 30,
    },
  });

  console.log("✅ Fixtures created successfully");

  console.log("\n--- [STEP 3] Marketing Consent: Negative Inference Invariant Test ---");
  // Customer with verified WhatsApp link, completed appointment and completed comanda
  await prisma.customerBarbershopLink.create({
    data: {
      barbershopId: barbershop.id,
      customerId: customer1.id,
      whatsappVerifiedAt: new Date(),
      whatsappVerifiedById: ownerUser.id,
    },
  });

  const completedAppt = await prisma.appointment.create({
    data: {
      barbershopId: barbershop.id,
      memberId: ownerMember.id,
      customerId: customer1.id,
      dateTime: new Date("2026-08-01T14:00:00Z"),
      totalPrice: 50.0,
      durationMin: 30,
      status: "COMPLETED",
    },
  });

  await prisma.comanda.create({
    data: {
      barbershopId: barbershop.id,
      appointmentId: completedAppt.id,
      customerId: customer1.id,
      customerName: customer1.name,
      status: "CLOSED",
      total: 50.0,
      paidTotal: 50.0,
      closedAt: new Date("2026-08-01T15:00:00Z"),
    },
  });

  // Verify that despite full historical operational interaction, marketing consent is UNKNOWN
  const consentCheck = await getMarketingConsentStatus(prisma, {
    barbershopId: barbershop.id,
    customerId: customer1.id,
    channel: "WHATSAPP",
    purpose: "MARKETING",
  });
  if (consentCheck.status !== "UNKNOWN" || consentCheck.consent !== null) {
    throw new Error(
      `Violation of zero-inference rule: Expected UNKNOWN for customer without explicit consent event, got: ${consentCheck.status}`
    );
  }
  console.log("✅ Zero-inference invariant confirmed: operational activity does NOT infer marketing consent (status: UNKNOWN)");

  console.log("\n--- [STEP 4] Marketing Consent: Concurrency with 2 Distinct Events on Initial No-Row ---");
  const eventKeyA = `event-concurrent-A-${Date.now()}`;
  const eventKeyB = `event-concurrent-B-${Date.now()}`;

  // Launch two concurrent transactions trying to insert consent events simultaneously for same customer/channel/purpose
  const [resA, resB] = await Promise.all([
    prisma.$transaction(async (tx) => {
      return recordMarketingConsent(tx, {
        barbershopId: barbershop.id,
        customerId: customer1.id,
        channel: "WHATSAPP",
        purpose: "MARKETING",
        status: MarketingConsentStatus.OPTED_IN,
        source: MarketingConsentSource.BOOKING_CHECKBOX,
        eventKey: eventKeyA,
        evidence: "Checkbox checked at checkout",
        actorUserId: ownerUser.id,
      });
    }),
    prisma.$transaction(async (tx) => {
      return recordMarketingConsent(tx, {
        barbershopId: barbershop.id,
        customerId: customer1.id,
        channel: "WHATSAPP",
        purpose: "MARKETING",
        status: MarketingConsentStatus.OPTED_OUT,
        source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
        eventKey: eventKeyB,
        evidence: "Opt-out requested via WhatsApp",
        actorUserId: ownerUser.id,
      });
    }),
  ]);

  if (!resA.consent || !resB.consent) {
    throw new Error("Concurrent consent recording failed");
  }

  // Assert current rows = 1
  const consentRows = await prisma.customerMarketingConsent.findMany({
    where: {
      barbershopId: barbershop.id,
      customerId: customer1.id,
      channel: "WHATSAPP",
      purpose: "MARKETING",
    },
  });
  if (consentRows.length !== 1) {
    throw new Error(`Expected exactly 1 consent row, found ${consentRows.length}`);
  }

  // Assert events = 2
  const eventRows = await prisma.customerMarketingConsentEvent.findMany({
    where: {
      barbershopId: barbershop.id,
      customerId: customer1.id,
      channel: "WHATSAPP",
      purpose: "MARKETING",
    },
    orderBy: { createdAt: "asc" },
  });
  if (eventRows.length !== 2) {
    throw new Error(`Expected exactly 2 consent events, found ${eventRows.length}`);
  }

  // Assert lastEventId references exactly the final serialized event, and current status matches
  const currentConsent = consentRows[0];
  const lastRecordedEvent = eventRows[eventRows.length - 1];
  if (currentConsent.lastEventId !== lastRecordedEvent.id) {
    throw new Error(
      `lastEventId mismatch! Expected ${lastRecordedEvent.id}, got ${currentConsent.lastEventId}`
    );
  }
  if (currentConsent.status !== lastRecordedEvent.eventType) {
    throw new Error(
      `Status mismatch! Current status ${currentConsent.status} does not match last event ${lastRecordedEvent.eventType}`
    );
  }
  console.log(`✅ Concurrency on initial no-row passed: 1 aggregate row, 2 events, lastEventId (${currentConsent.lastEventId}) matched serialized last event (status: ${currentConsent.status})`);

  console.log("\n--- [STEP 5] Marketing Consent: Concurrent Duplicate eventKey Idempotency ---");
  const duplicateKey = `idempotent-dup-key-${Date.now()}`;
  const [dupRes1, dupRes2] = await Promise.all([
    prisma.$transaction((tx) =>
      recordMarketingConsent(tx, {
        barbershopId: barbershop.id,
        customerId: customer1.id,
        status: MarketingConsentStatus.OPTED_IN,
        source: MarketingConsentSource.ADMIN_WITH_PROOF,
        eventKey: duplicateKey,
        actorUserId: ownerUser.id,
      })
    ),
    prisma.$transaction((tx) =>
      recordMarketingConsent(tx, {
        barbershopId: barbershop.id,
        customerId: customer1.id,
        status: MarketingConsentStatus.OPTED_IN,
        source: MarketingConsentSource.ADMIN_WITH_PROOF,
        eventKey: duplicateKey,
        actorUserId: ownerUser.id,
      })
    ),
  ]);

  const dupEvents = await prisma.customerMarketingConsentEvent.findMany({
    where: { barbershopId: barbershop.id, eventKey: duplicateKey },
  });
  if (dupEvents.length !== 1) {
    throw new Error(`Expected exactly 1 event for duplicate key, found ${dupEvents.length}`);
  }
  if (dupRes1.isDuplicateEvent === dupRes2.isDuplicateEvent) {
    throw new Error("One duplicate call should have succeeded and one flagged isDuplicateEvent");
  }
  console.log("✅ Concurrent duplicate eventKey idempotency verified: 1 event created, 1 flagged as duplicate");

  console.log("\n--- [STEP 6] Campaign & Recipient Lifecycle and ContactLog SENT_CONFIRMED Invariant ---");
  const campaign = await prisma.reactivationCampaign.create({
    data: {
      barbershopId: barbershop.id,
      name: "Campanha R2.1a Reativação",
      channel: "WHATSAPP",
      status: CampaignStatus.DRAFT,
      targetSegment: { timingState: "OVERDUE", minScore: 50 },
      createdByUserId: ownerUser.id,
      createdByMemberId: ownerMember.id,
      totalRecipients: 1,
    },
  });

  const recipient = await prisma.reactivationCampaignRecipient.create({
    data: {
      campaignId: campaign.id,
      barbershopId: barbershop.id,
      customerId: customer1.id,
      customerNameSnapshot: customer1.name,
      customerPhoneSnapshot: customer1.phone,
      timingStateSnapshot: CustomerTimingState.OVERDUE,
      scoreSnapshot: 85,
      expectedReturnDateSnapshot: new Date("2026-08-15"),
      expectedReturnSourceSnapshot: ExpectedReturnSource.PERSONAL,
      lastVisitDateSnapshot: new Date("2026-07-15"),
      daysOverdueSnapshot: 20,
      avgTicketSnapshot: 50.0,
      preferredMemberIdSnapshot: ownerMember.id,
      preferredServiceIdSnapshot: service.id,
      dispatchStatus: RecipientDispatchStatus.READY,
    },
  });

  // Attempting to create ContactLog on READY status must throw
  let rejectedOnReady = false;
  try {
    await prisma.$transaction((tx) =>
      createReactivationContactLog(tx, {
        barbershopId: barbershop.id,
        customerId: customer1.id,
        recipientId: recipient.id,
        templateKey: "REACTIVATION_V1",
        templateLabel: "Reativação Especial",
        createdByUserId: ownerUser.id,
      })
    );
  } catch (err: any) {
    if (err.message.includes("SENT_CONFIRMED")) {
      rejectedOnReady = true;
    }
  }
  if (!rejectedOnReady) {
    throw new Error("Expected createReactivationContactLog to reject when recipient is READY");
  }
  console.log("✅ createReactivationContactLog successfully blocked on READY status");

  // Advance recipient to WHATSAPP_OPENED, then attempt ContactLog
  await prisma.reactivationCampaignRecipient.update({
    where: { id: recipient.id },
    data: { dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED },
  });

  let rejectedOnOpened = false;
  try {
    await prisma.$transaction((tx) =>
      createReactivationContactLog(tx, {
        barbershopId: barbershop.id,
        customerId: customer1.id,
        recipientId: recipient.id,
        templateKey: "REACTIVATION_V1",
        templateLabel: "Reativação Especial",
        createdByUserId: ownerUser.id,
      })
    );
  } catch (err: any) {
    if (err.message.includes("SENT_CONFIRMED")) {
      rejectedOnOpened = true;
    }
  }
  if (!rejectedOnOpened) {
    throw new Error("Expected createReactivationContactLog to reject when recipient is WHATSAPP_OPENED");
  }
  console.log("✅ createReactivationContactLog successfully blocked on WHATSAPP_OPENED status (WA_ME_OPEN != SENT)");

  // Advance recipient to SENT_CONFIRMED and create ContactLog
  await prisma.reactivationCampaignRecipient.update({
    where: { id: recipient.id },
    data: {
      dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
      sentConfirmedAt: new Date(),
    },
  });

  const contactLogRes1 = await prisma.$transaction((tx) =>
    createReactivationContactLog(tx, {
      barbershopId: barbershop.id,
      customerId: customer1.id,
      recipientId: recipient.id,
      templateKey: "REACTIVATION_V1",
      templateLabel: "Reativação Especial",
      createdByUserId: ownerUser.id,
    })
  );
  if (contactLogRes1.isExisting || !contactLogRes1.contactLog.id) {
    throw new Error("Failed to create ContactLog on SENT_CONFIRMED");
  }

  // Second call returns existing
  const contactLogRes2 = await prisma.$transaction((tx) =>
    createReactivationContactLog(tx, {
      barbershopId: barbershop.id,
      customerId: customer1.id,
      recipientId: recipient.id,
      templateKey: "REACTIVATION_V1",
      templateLabel: "Reativação Especial",
      createdByUserId: ownerUser.id,
    })
  );
  if (!contactLogRes2.isExisting || contactLogRes2.contactLog.id !== contactLogRes1.contactLog.id) {
    throw new Error("Expected idempotent return of existing ContactLog");
  }
  console.log("✅ ContactLog creation on SENT_CONFIRMED verified with strict 1:1 idempotency");

  console.log("\n--- [STEP 7] PostgreSQL Check Constraint: chk_single_attribution ---");
  const customer2 = await prisma.user.create({
    data: {
      name: "Customer Two",
      email: "customer2-r21a@test.com",
      phone: "+5511999910003",
      role: UserRole.USER,
    },
  });

  const appt2 = await prisma.appointment.create({
    data: {
      barbershopId: barbershop.id,
      memberId: ownerMember.id,
      customerId: customer2.id,
      dateTime: new Date("2026-09-04T16:00:00Z"),
      totalPrice: 50.0,
      durationMin: 30,
      status: "CONFIRMED",
    },
  });

  const comanda2 = await prisma.comanda.create({
    data: {
      barbershopId: barbershop.id,
      customerId: customer2.id,
      customerName: customer2.name,
      status: "OPEN",
      total: 50.0,
    },
  });

  // Test violating chk_single_attribution
  let chkViolated = false;
  try {
    await prisma.reactivationCampaignRecipient.create({
      data: {
        campaignId: campaign.id,
        barbershopId: barbershop.id,
        customerId: customer2.id,
        customerNameSnapshot: customer2.name,
        customerPhoneSnapshot: customer2.phone,
        timingStateSnapshot: CustomerTimingState.DUE,
        scoreSnapshot: 70,
        attributedAppointmentId: appt2.id,
        attributedComandaId: comanda2.id, // BOTH
      },
    });
  } catch (err: any) {
    if (err.message.includes("chk_single_attribution") || err.code === "P2010" || err.message.includes("check constraint")) {
      chkViolated = true;
    }
  }
  if (!chkViolated) {
    throw new Error("Expected chk_single_attribution check constraint violation");
  }
  console.log("✅ chk_single_attribution check constraint strictly rejected mutual attribution");

  console.log("\n--- [STEP 8] Delete Safety (Foreign Key Restrict on User) ---");
  let deleteBlocked = false;
  try {
    await prisma.user.delete({ where: { id: customer1.id } });
  } catch {
    deleteBlocked = true;
  }
  if (!deleteBlocked) {
    throw new Error("Deleting customer with active audit records must be blocked by FK Restrict");
  }
  console.log("✅ Foreign Key Restrict prevented accidental audit deletion of User");

  console.log("\n--- [STEP 9] DRAFT Campaign Cascade Cleanup ---");
  await prisma.reactivationCampaign.delete({
    where: {
      id_barbershopId: {
        id: campaign.id,
        barbershopId: barbershop.id,
      },
    },
  });

  const remainingRecipients = await prisma.reactivationCampaignRecipient.count({
    where: { campaignId: campaign.id },
  });
  if (remainingRecipients !== 0) {
    throw new Error(`Expected 0 recipients after campaign deletion, found ${remainingRecipients}`);
  }
  console.log("✅ DRAFT campaign cascade deletion cleaned up recipients");

  console.log("\n==================================================================");
  console.log(" ALL REAL POSTGRESQL R2.1a INVARIANTS VERIFIED SUCCESSFULLY!");
  console.log("==================================================================");
}

main()
  .catch((e) => {
    console.error("FATAL in test-r2-1-real-postgres:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
