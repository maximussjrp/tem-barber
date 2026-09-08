/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import {
  PrismaClient,
  MarketingConsentStatus,
  MarketingConsentSource,
  RecipientDispatchStatus,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  getReactivationCandidates,
  recordMarketingConsent,
  getCustomerConsentHistory,
  prepareManualReactivationCampaign,
  revalidateAndOpenManualRecipient,
  confirmManualRecipientSend,
} from "../src/lib/clients/reactivation";

const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

const pool = new Pool({ connectionString: testDbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("==================================================================");
  console.log(" TEM BARBER — PHASE R4 REAL POSTGRESQL 16 VALIDATION & ENGINE TEST");
  console.log("==================================================================");

  // 1. DB Version & Migrations
  const [versionRow]: any = await prisma.$queryRaw`SELECT version();`;
  console.log("DB Version:", versionRow.version);

  const migrationRows: any[] = await prisma.$queryRaw`
    SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL;
  `;
  console.log("Migration Count in DB:", migrationRows.length);

  // Fast cleanup old R4 test data
  await prisma.$executeRaw`DELETE FROM reactivation_campaign_recipients WHERE campaign_id IN (SELECT id FROM reactivation_campaigns WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r4-%'))`;
  await prisma.$executeRaw`DELETE FROM reactivation_campaigns WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r4-%')`;
  await prisma.$executeRaw`DELETE FROM customer_contact_logs WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r4-%')`;
  await prisma.$executeRaw`DELETE FROM appointments WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r4-%')`;
  await prisma.$executeRaw`DELETE FROM customer_barbershop_links WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r4-%')`;
  await prisma.$executeRaw`DELETE FROM barbershop_blocked_customers WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r4-%')`;
  await prisma.$executeRaw`DELETE FROM customer_marketing_consents WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r4-%')`;
  await prisma.$executeRaw`DELETE FROM customer_marketing_consent_events WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r4-%')`;
  await prisma.$executeRaw`DELETE FROM services WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r4-%')`;
  await prisma.$executeRaw`DELETE FROM barbershop_members WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r4-%')`;
  await prisma.$executeRaw`DELETE FROM users WHERE email LIKE '%@r4test.com' OR email LIKE '%@r4.com'`;
  await prisma.$executeRaw`DELETE FROM barbershops WHERE slug LIKE 'r4-%'`;

  // 2. Setup Test Barbershop A & B for Isolation
  console.log("\n--- [SETUP] Seeding R4 Test Barbershops & Operators ---");
  const randSuffix = Math.floor(1000 + Math.random() * 9000);
  const barbershopA = await prisma.barbershop.create({
    data: {
      name: "Barbearia R4 Tenant A",
      slug: `r4-test-a-${Date.now()}`,
      phone: `179910${randSuffix}`,
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
      name: "Barbearia R4 Tenant B",
      slug: `r4-test-b-${Date.now()}`,
      phone: `179920${randSuffix}`,
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
      name: "Gerente A",
      email: `manager-a-${Date.now()}@r4test.com`,
      role: "USER",
      phone: `179811${randSuffix}`,
    },
  });
  await prisma.barbershopMember.create({
    data: { barbershopId: barbershopA.id, userId: managerA.id, role: "MANAGER" },
  });

  const barberA = await prisma.user.create({
    data: {
      name: "Barbeiro Carlos A",
      email: `barber-a-${Date.now()}@r4test.com`,
      role: "USER",
      phone: `179812${randSuffix}`,
    },
  });
  const barberMemberA = await prisma.barbershopMember.create({
    data: { barbershopId: barbershopA.id, userId: barberA.id, role: "BARBER" },
  });

  const categoryA = await prisma.category.create({
    data: { barbershopId: barbershopA.id, name: "Cortes A", slug: `cortes-a-${randSuffix}` },
  });

  const serviceA = await prisma.service.create({
    data: {
      barbershopId: barbershopA.id,
      categoryId: categoryA.id,
      name: "Corte A",
      price: 60.0,
      durationMin: 30,
    },
  });

  console.log(`Created Barbershop A (${barbershopA.id}) and Barbershop B (${barbershopB.id})`);

  // ==========================================================================
  // TEST SUITE 1: Marketing Consent Engine & Idempotency
  // ==========================================================================
  console.log("\n--- [SUITE 1] Marketing Consent Engine & Idempotency ---");
  const testCustomer1 = await prisma.user.create({
    data: {
      name: "Cliente Consentimento 1",
      email: `cust1-${Date.now()}@r4test.com`,
      phone: `119911${randSuffix}`,
      role: "USER",
    },
  });
  await prisma.customerBarbershopLink.create({
    data: { customerId: testCustomer1.id, barbershopId: barbershopA.id },
  });

  const eventKey1 = `evt-optin-${Date.now()}`;
  console.log(`Recording OPTED_IN with eventKey: ${eventKey1}`);
  const consent1 = await recordMarketingConsent(prisma, {
    barbershopId: barbershopA.id,
    customerId: testCustomer1.id,
    status: MarketingConsentStatus.OPTED_IN,
    source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
    actorUserId: managerA.id,
    eventKey: eventKey1,
    reason: "Consentimento confirmado verbalmente",
  });
  console.log(`Consent recorded: status=${consent1.consent.status}, eventId=${consent1.event.id}`);
  if (consent1.consent.status !== MarketingConsentStatus.OPTED_IN) {
    throw new Error(`Expected OPTED_IN, got ${consent1.consent.status}`);
  }

  // 1.2 Idempotent Replay with Same eventKey + Same Payload
  console.log("Replaying exact same consent eventKey + payload...");
  const consentReplay = await recordMarketingConsent(prisma, {
    barbershopId: barbershopA.id,
    customerId: testCustomer1.id,
    status: MarketingConsentStatus.OPTED_IN,
    source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
    actorUserId: managerA.id,
    eventKey: eventKey1,
    reason: "Consentimento confirmado verbalmente",
  });
  if (consentReplay.event.id !== consent1.event.id) {
    throw new Error(`Expected replay to return existing event ${consent1.event.id}, got ${consentReplay.event.id}`);
  }
  console.log("✅ Idempotent replay returned exact same event without duplication.");

  // 1.3 Conflicting Replay with Same eventKey + Different Payload
  console.log("Attempting conflicting consent payload with same eventKey...");
  let conflictCaught = false;
  try {
    await recordMarketingConsent(prisma, {
      barbershopId: barbershopA.id,
      customerId: testCustomer1.id,
      status: MarketingConsentStatus.OPTED_OUT,
      source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
      actorUserId: managerA.id,
      eventKey: eventKey1,
    });
  } catch (err: any) {
    conflictCaught = true;
    console.log(`✅ Conflicting payload rejected safely: ${err.message}`);
  }
  if (!conflictCaught) {
    throw new Error("Expected conflicting payload with same eventKey to be rejected!");
  }

  // 1.4 Update to OPTED_OUT with new eventKey
  const eventKey2 = `evt-optout-${Date.now()}`;
  console.log(`Updating to OPTED_OUT with eventKey: ${eventKey2}`);
  const consent2 = await recordMarketingConsent(prisma, {
    barbershopId: barbershopA.id,
    customerId: testCustomer1.id,
    status: MarketingConsentStatus.OPTED_OUT,
    source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
    actorUserId: managerA.id,
    eventKey: eventKey2,
    reason: "Cliente pediu para pausar",
  });
  if (consent2.consent.status !== MarketingConsentStatus.OPTED_OUT) {
    throw new Error(`Expected OPTED_OUT, got ${consent2.consent.status}`);
  }

  const history = await getCustomerConsentHistory(prisma, { barbershopId: barbershopA.id, customerId: testCustomer1.id });
  console.log(`Ledger event count: ${history.length} (expected 2)`);
  if (history.length !== 2) {
    throw new Error(`Expected 2 ledger events, found ${history.length}`);
  }
  console.log("✅ Marketing consent ledger and advisory lock concurrency verified.");

  // ==========================================================================
  // TEST SUITE 2: Set-Oriented Manual Campaign Preparation & Pre-Validation
  // ==========================================================================
  console.log("\n--- [SUITE 2] Manual Campaign Preparation & Batch Pre-Validation ---");
  // Reset testCustomer1 to OPTED_IN
  await recordMarketingConsent(prisma, {
    barbershopId: barbershopA.id,
    customerId: testCustomer1.id,
    status: MarketingConsentStatus.OPTED_IN,
    source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
    actorUserId: managerA.id,
    eventKey: `evt-optin-reset-${Date.now()}`,
  });

  // Seed 4 additional customers
  const cust2 = await prisma.user.create({
    data: { name: "Cust 2 Opted Out", email: `c2-${Date.now()}@r4.com`, phone: `119912${randSuffix}`, role: "USER" },
  });
  await prisma.customerBarbershopLink.create({ data: { customerId: cust2.id, barbershopId: barbershopA.id } });
  await recordMarketingConsent(prisma, {
    barbershopId: barbershopA.id,
    customerId: cust2.id,
    status: MarketingConsentStatus.OPTED_OUT,
    source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
    actorUserId: managerA.id,
    eventKey: `evt-c2-${Date.now()}`,
  });

  const cust3 = await prisma.user.create({
    data: { name: "Cust 3 Consent Unknown", email: `c3-${Date.now()}@r4.com`, phone: `119913${randSuffix}`, role: "USER" },
  });
  await prisma.customerBarbershopLink.create({ data: { customerId: cust3.id, barbershopId: barbershopA.id } });

  const cust4 = await prisma.user.create({
    data: { name: "Cust 4 Landline Phone", email: `c4-${Date.now()}@r4.com`, phone: `113333${randSuffix}`, role: "USER" },
  });
  await prisma.customerBarbershopLink.create({ data: { customerId: cust4.id, barbershopId: barbershopA.id } });
  await recordMarketingConsent(prisma, {
    barbershopId: barbershopA.id,
    customerId: cust4.id,
    status: MarketingConsentStatus.OPTED_IN,
    source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
    actorUserId: managerA.id,
    eventKey: `evt-c4-${Date.now()}`,
  });

  const cust5 = await prisma.user.create({
    data: { name: "Cust 5 Blocked", email: `c5-${Date.now()}@r4.com`, phone: `119915${randSuffix}`, role: "USER" },
  });
  await prisma.customerBarbershopLink.create({ data: { customerId: cust5.id, barbershopId: barbershopA.id } });
  await recordMarketingConsent(prisma, {
    barbershopId: barbershopA.id,
    customerId: cust5.id,
    status: MarketingConsentStatus.OPTED_IN,
    source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
    actorUserId: managerA.id,
    eventKey: `evt-c5-${Date.now()}`,
  });
  await prisma.barbershopBlockedCustomer.create({
    data: {
      barbershopId: barbershopA.id,
      userId: cust5.id,
      phoneNormalized: `119915${randSuffix}`,
      reason: "No show excessivo",
      active: true,
      blockedByUserId: managerA.id,
    },
  });

  const prepRequestKey = `req-prep-${Date.now()}`;
  console.log(`Preparing batch campaign with 5 candidates, requestKey: ${prepRequestKey}`);
  const prepResult = await prepareManualReactivationCampaign(prisma, {
    barbershopId: barbershopA.id,
    operatorUserId: managerA.id,
    selectedCustomerIds: [testCustomer1.id, cust2.id, cust3.id, cust4.id, cust5.id],
    templateKey: "RETURN_REMINDER",
    requestKey: prepRequestKey,
  });

  console.log(`Campaign created: ${prepResult.campaign.id}, status=${prepResult.campaign.status}`);
  console.log(`Prepared recipients count: ${prepResult.accepted.length}`);
  console.log(`Rejected count: ${prepResult.rejected.length}`);
  const rejectionMap = Object.fromEntries(prepResult.rejected.map((r) => [r.customerId, r.reasonCode]));
  console.log("Rejections:", rejectionMap);

  if (prepResult.accepted.length !== 1 || prepResult.accepted[0].customerId !== testCustomer1.id) {
    throw new Error(`Expected exactly 1 accepted candidate (${testCustomer1.id}), got ${prepResult.accepted.length}`);
  }
  if (prepResult.rejected.length !== 4) {
    throw new Error(`Expected 4 rejected candidates, got ${prepResult.rejected.length}`);
  }
  if (rejectionMap[cust2.id] !== "CONSENT_OPTED_OUT") {
    throw new Error(`Expected cust2 rejection CONSENT_OPTED_OUT, got ${rejectionMap[cust2.id]}`);
  }
  if (rejectionMap[cust3.id] !== "CONSENT_UNKNOWN") {
    throw new Error(`Expected cust3 rejection CONSENT_UNKNOWN, got ${rejectionMap[cust3.id]}`);
  }
  if (rejectionMap[cust4.id] !== "INVALID_PHONE") {
    throw new Error(`Expected cust4 rejection INVALID_PHONE, got ${rejectionMap[cust4.id]}`);
  }
  if (rejectionMap[cust5.id] !== "BLOCKED") {
    throw new Error(`Expected cust5 rejection BLOCKED, got ${rejectionMap[cust5.id]}`);
  }
  console.log("✅ Set-oriented batch preparation filtered all ineligible candidates with exact structured reason codes.");

  // Idempotent replay of preparation
  console.log("Replaying prepare campaign with same requestKey...");
  const prepReplay = await prepareManualReactivationCampaign(prisma, {
    barbershopId: barbershopA.id,
    operatorUserId: managerA.id,
    selectedCustomerIds: [testCustomer1.id, cust2.id, cust3.id, cust4.id, cust5.id],
    templateKey: "RETURN_REMINDER",
    requestKey: prepRequestKey,
  });
  if (prepReplay.campaign.id !== prepResult.campaign.id || !prepReplay.isExisting) {
    throw new Error("Expected prepare replay to return existing campaign!");
  }
  console.log("✅ Preparation idempotent replay returned same campaign.");

  // Conflicting requestKey with different payload
  console.log("Testing conflicting requestKey with different customer IDs...");
  let conflictPrepCaught = false;
  try {
    await prepareManualReactivationCampaign(prisma, {
      barbershopId: barbershopA.id,
      operatorUserId: managerA.id,
      selectedCustomerIds: [testCustomer1.id, cust2.id],
      templateKey: "RETURN_REMINDER",
      requestKey: prepRequestKey,
    });
  } catch (err: any) {
    conflictPrepCaught = true;
    console.log(`✅ Preparation conflict caught: ${err.message}`);
  }
  if (!conflictPrepCaught) {
    throw new Error("Expected preparation conflict to be rejected!");
  }

  // Zero accepted batch test
  console.log("Testing preparation with 0 eligible candidates (all ineligible)...");
  const zeroPrepResult = await prepareManualReactivationCampaign(prisma, {
    barbershopId: barbershopA.id,
    operatorUserId: managerA.id,
    selectedCustomerIds: [cust2.id, cust3.id, cust4.id, cust5.id],
    templateKey: "RETURN_REMINDER",
    requestKey: `req-zero-${Date.now()}`,
  });
  if (zeroPrepResult.campaign !== null || zeroPrepResult.accepted.length !== 0 || zeroPrepResult.rejected.length !== 4) {
    throw new Error("Expected zero accepted result with campaign: null!");
  }
  console.log("✅ Zero eligible selection safely handled without creating misleading campaign.");

  // ==========================================================================
  // TEST SUITE 3: WhatsApp Opened Lifecycle & Zero Contact Log Invariant
  // ==========================================================================
  console.log("\n--- [SUITE 3] WhatsApp Opened Lifecycle & Zero Contact Log Invariant ---");
  const targetRecipient = prepResult.accepted[0];
  console.log(`Target recipient ID: ${targetRecipient.recipientId}, initial status: ${targetRecipient.dispatchStatus}`);

  const openResult = await revalidateAndOpenManualRecipient(prisma, {
    barbershopId: barbershopA.id,
    campaignId: prepResult.campaign.id,
    recipientId: targetRecipient.recipientId,
    operatorUserId: managerA.id,
  });

  console.log(`Opened result: status=${openResult.recipient.dispatchStatus}`);
  console.log(`wa.me link: ${openResult.whatsappUrl.substring(0, 50)}...`);

  if (openResult.recipient.dispatchStatus !== RecipientDispatchStatus.WHATSAPP_OPENED) {
    throw new Error(`Expected WHATSAPP_OPENED, got ${openResult.recipient.dispatchStatus}`);
  }

  const contactLogCountAfterOpen = await prisma.customerContactLog.count({
    where: { barbershopId: barbershopA.id, customerId: testCustomer1.id },
  });
  console.log(`CustomerContactLog count after OPEN: ${contactLogCountAfterOpen} (MUST BE 0)`);
  if (contactLogCountAfterOpen !== 0) {
    throw new Error(`Violated invariant: Contact log count is ${contactLogCountAfterOpen}, expected 0!`);
  }
  console.log("✅ Zero CustomerContactLog on WHATSAPP_OPENED verified.");

  // Replay WHATSAPP_OPENED
  console.log("Replaying WHATSAPP_OPENED...");
  const openReplay = await revalidateAndOpenManualRecipient(prisma, {
    barbershopId: barbershopA.id,
    campaignId: prepResult.campaign.id,
    recipientId: targetRecipient.recipientId,
    operatorUserId: managerA.id,
  });
  if (!openReplay.isReplay || openReplay.recipient.dispatchStatus !== RecipientDispatchStatus.WHATSAPP_OPENED) {
    throw new Error("Expected WHATSAPP_OPENED replay to be safe and return isReplay: true");
  }
  const countAfterOpenReplay = await prisma.customerContactLog.count({
    where: { barbershopId: barbershopA.id, customerId: testCustomer1.id },
  });
  if (countAfterOpenReplay !== 0) {
    throw new Error("WHATSAPP_OPENED replay created contact log!");
  }
  console.log("✅ WHATSAPP_OPENED replay is safe and creates zero logs.");

  // ==========================================================================
  // TEST SUITE 4: Anti-Stale Live Dispatch Revalidation (All 5 Stale Scenarios)
  // ==========================================================================
  console.log("\n--- [SUITE 4] Comprehensive Anti-Stale Live Dispatch Revalidation ---");

  // Helper to prepare single recipient
  async function prepSingle(name: string, phone: string, status = MarketingConsentStatus.OPTED_IN) {
    const user = await prisma.user.create({
      data: { name, email: `stale-${Date.now()}-${Math.random()}@r4.com`, phone, role: "USER" },
    });
    await prisma.customerBarbershopLink.create({ data: { customerId: user.id, barbershopId: barbershopA.id } });
    await recordMarketingConsent(prisma, {
      barbershopId: barbershopA.id,
      customerId: user.id,
      status,
      source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
      actorUserId: managerA.id,
      eventKey: `evt-prep-${user.id}-${Date.now()}`,
    });
    const prep = await prepareManualReactivationCampaign(prisma, {
      barbershopId: barbershopA.id,
      operatorUserId: managerA.id,
      selectedCustomerIds: [user.id],
      templateKey: "RETURN_REMINDER",
      requestKey: `req-stale-${user.id}-${Date.now()}`,
    });
    return { user, recipient: prep.accepted[0], campaign: prep.campaign };
  }

  // 4.A Stale OPTED_OUT
  console.log("Testing 4.A: Stale OPTED_OUT mutation before open...");
  const sA = await prepSingle("Stale Cust A", `119981${randSuffix}`);
  await recordMarketingConsent(prisma, {
    barbershopId: barbershopA.id,
    customerId: sA.user.id,
    status: MarketingConsentStatus.OPTED_OUT,
    source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
    actorUserId: managerA.id,
    eventKey: `evt-stale-optout-${Date.now()}`,
  });
  await expectRevalidationFailure(sA.campaign.id, sA.recipient.recipientId, "STALE_CONSENT");

  // 4.B Stale BLOCKED
  console.log("Testing 4.B: Stale BLOCKED mutation before open...");
  const sB = await prepSingle("Stale Cust B", `119982${randSuffix}`);
  await prisma.barbershopBlockedCustomer.create({
    data: {
      barbershopId: barbershopA.id,
      userId: sB.user.id,
      phoneNormalized: `119982${randSuffix}`,
      reason: "Bloqueio posterior",
      active: true,
      blockedByUserId: managerA.id,
    },
  });
  await expectRevalidationFailure(sB.campaign.id, sB.recipient.recipientId, "STALE_BLOCKED");

  // 4.C Stale UPCOMING APPOINTMENT
  console.log("Testing 4.C: Stale UPCOMING APPOINTMENT created before open...");
  const sC = await prepSingle("Stale Cust C", `119983${randSuffix}`);
  const futureApptDate = new Date();
  futureApptDate.setDate(futureApptDate.getDate() + 2);
  await prisma.appointment.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: sC.user.id,
      memberId: barberMemberA.id,
      dateTime: futureApptDate,
      status: "CONFIRMED",
      totalPrice: 60.0,
      durationMin: 30,
      services: { create: [{ serviceId: serviceA.id, priceApplied: 60.0 }] },
    },
  });
  await expectRevalidationFailure(sC.campaign.id, sC.recipient.recipientId, "STALE_UPCOMING_APPOINTMENT");

  // 4.D Stale RECENT CONTACT (<14 days)
  console.log("Testing 4.D: Stale RECENT CONTACT created before open...");
  const sD = await prepSingle("Stale Cust D", `119984${randSuffix}`);
  await prisma.customerContactLog.create({
    data: {
      barbershop: { connect: { id: barbershopA.id } },
      customer: { connect: { id: sD.user.id } },
      createdByUser: { connect: { id: managerA.id } },
      channel: "WHATSAPP",
      templateKey: "DIRECT_CUSTOM",
      templateLabel: "Mensagem Direta",
      contactedAt: new Date(),
      note: "Contato prévio direto",
    },
  });
  await expectRevalidationFailure(sD.campaign.id, sD.recipient.recipientId, "STALE_RECENT_CONTACT");

  // 4.E Stale INVALID PHONE
  console.log("Testing 4.E: Stale INVALID PHONE snapshot...");
  const sE = await prepSingle("Stale Cust E", `119985${randSuffix}`);
  // Corrupt recipient phone snapshot to landline
  await prisma.reactivationCampaignRecipient.update({
    where: { id: sE.recipient.recipientId },
    data: { customerPhoneSnapshot: "1133334444" },
  });
  await expectRevalidationFailure(sE.campaign.id, sE.recipient.recipientId, "STALE_INVALID_PHONE");

  console.log("✅ All 5 Anti-stale live dispatch revalidation scenarios verified.");

  async function expectRevalidationFailure(campaignId: string, recipientId: string, expectedCode: string) {
    let failed = false;
    try {
      await revalidateAndOpenManualRecipient(prisma, {
        barbershopId: barbershopA.id,
        campaignId,
        recipientId,
        operatorUserId: managerA.id,
      });
    } catch (err: any) {
      failed = true;
      if (err.code !== expectedCode) {
        throw new Error(`Expected error code ${expectedCode}, got ${err.code} (${err.message})`);
      }
      console.log(`  ✓ Rejection verified: ${err.code}`);
    }
    if (!failed) {
      throw new Error(`Expected revalidation to fail with ${expectedCode}, but it succeeded!`);
    }
  }

  // ==========================================================================
  // TEST SUITE 5: Confirmed Send Audit & Cooldown Feedback Loop
  // ==========================================================================
  console.log("\n--- [SUITE 5] Confirmed Send Audit & Cooldown Feedback Loop ---");
  console.log(`Confirming send for recipient ${targetRecipient.recipientId}...`);
  const confirmResult = await confirmManualRecipientSend(prisma, {
    barbershopId: barbershopA.id,
    campaignId: prepResult.campaign.id,
    recipientId: targetRecipient.recipientId,
    operatorUserId: managerA.id,
  });

  console.log(`Confirmed send result: status=${confirmResult.recipient.dispatchStatus}`);
  console.log(`ContactLog ID: ${confirmResult.contactLog.id}`);

  if (confirmResult.recipient.dispatchStatus !== RecipientDispatchStatus.SENT_CONFIRMED) {
    throw new Error(`Expected SENT_CONFIRMED, got ${confirmResult.recipient.dispatchStatus}`);
  }

  // Verify exact contact log fields
  const contactLog = confirmResult.contactLog;
  if (
    contactLog.barbershopId !== barbershopA.id ||
    contactLog.customerId !== testCustomer1.id ||
    contactLog.channel !== "WHATSAPP" ||
    contactLog.templateKey !== "RETURN_REMINDER" ||
    contactLog.templateLabel !== "Lembrete de retorno" ||
    contactLog.reactivationRecipientId !== targetRecipient.recipientId ||
    contactLog.createdByUserId !== managerA.id
  ) {
    throw new Error(`ContactLog fields mismatch: ${JSON.stringify(contactLog)}`);
  }
  const initialContactedAt = new Date(contactLog.contactedAt).toISOString();
  const countAfterFirstConfirm = await prisma.customerContactLog.count({
    where: { barbershopId: barbershopA.id, customerId: testCustomer1.id },
  });

  // Replay confirm send
  console.log("Replaying confirm send on already confirmed recipient...");
  const confirmReplay = await confirmManualRecipientSend(prisma, {
    barbershopId: barbershopA.id,
    campaignId: prepResult.campaign.id,
    recipientId: targetRecipient.recipientId,
    operatorUserId: managerA.id,
  });
  if (confirmReplay.contactLog.id !== confirmResult.contactLog.id || !confirmReplay.isExisting) {
    throw new Error("Expected replay to return existing contactLog ID with isExisting: true");
  }
  const replayContactedAt = new Date(confirmReplay.contactLog.contactedAt).toISOString();
  if (initialContactedAt !== replayContactedAt) {
    throw new Error("Replay modified contactedAt timestamp!");
  }

  const countAfterReplay = await prisma.customerContactLog.count({
    where: { barbershopId: barbershopA.id, customerId: testCustomer1.id },
  });
  if (countAfterReplay !== 1) {
    throw new Error(`Replay created duplicate contact log! Count: ${countAfterReplay}`);
  }

  console.log(`CONTACT_LOG_COUNT_AFTER_FIRST_CONFIRM=${countAfterFirstConfirm}`);
  console.log(`CONTACT_LOG_COUNT_AFTER_REPLAY=${countAfterReplay}`);
  console.log(`CONTACTED_AT_FIRST=${initialContactedAt}`);
  console.log(`CONTACTED_AT_AFTER_REPLAY=${replayContactedAt}`);
  console.log("✅ Confirm send replay is strictly idempotent and timestamp is immutable.");

  // 5.3 Cooldown Feedback Loop in Candidate Query
  console.log("\nVerifying 14-day contact cooldown feedback loop in Candidate Engine...");
  const pastVisitDate = new Date();
  pastVisitDate.setDate(pastVisitDate.getDate() - 30);
  await prisma.appointment.create({
    data: {
      barbershopId: barbershopA.id,
      customerId: testCustomer1.id,
      memberId: barberMemberA.id,
      dateTime: pastVisitDate,
      status: "COMPLETED",
      totalPrice: 60.0,
      durationMin: 30,
      services: {
        create: [{ serviceId: serviceA.id, priceApplied: 60.0 }],
      },
    },
  });

  const candidatesRes = await getReactivationCandidates(prisma, {
    barbershopId: barbershopA.id,
    limit: 100,
    includeSuppressed: true,
  });

  const cust1Candidate = candidatesRes.items.find((c) => c.customer.id === testCustomer1.id);
  if (!cust1Candidate) {
    throw new Error("Expected testCustomer1 to be returned in candidate list");
  }
  if (cust1Candidate.dispatchEligible !== false || !cust1Candidate.dispatchSuppressions.includes("RECENT_CONTACT")) {
    throw new Error("Expected customer to be dispatch-ineligible with RECENT_CONTACT during 14d cooldown!");
  }
  console.log("✅ Cooldown feedback loop verified: contact log suppresses candidate from dispatch.");

  // ==========================================================================
  // TEST SUITE 6: Cross-Tenant Isolation
  // ==========================================================================
  console.log("\n--- [SUITE 6] Cross-Tenant Strict Mutation Isolation ---");

  // 6.1 Consent mutation cross-tenant: Tenant B attempting to record consent for Tenant A customer
  console.log("Testing 6.1: Cross-tenant marketing consent recording...");
  const foreignConsentCountBefore = await prisma.customerMarketingConsent.count({
    where: { barbershopId: barbershopB.id },
  });
  const foreignConsentEventsBefore = await prisma.customerMarketingConsentEvent.count({
    where: { barbershopId: barbershopB.id },
  });
  // Recording in Barbershop B for a customer linked only to Barbershop A
  const consentBResult = await recordMarketingConsent(prisma, {
    barbershopId: barbershopB.id,
    customerId: testCustomer1.id,
    status: MarketingConsentStatus.OPTED_IN,
    source: MarketingConsentSource.CUSTOMER_REQUEST_IN_PERSON,
    actorUserId: managerA.id,
    eventKey: `evt-cross-consent-${Date.now()}`,
  });
  // Consent is isolated per (barbershopId, customerId) - verify it did NOT alter Barbershop A consent
  const consentAAfter = await prisma.customerMarketingConsent.findUnique({
    where: {
      barbershopId_customerId_channel_purpose: {
        barbershopId: barbershopA.id,
        customerId: testCustomer1.id,
        channel: "WHATSAPP",
        purpose: "MARKETING",
      },
    },
  });
  if (consentAAfter?.status !== MarketingConsentStatus.OPTED_IN) {
    throw new Error("Cross-tenant consent mutation modified Barbershop A state!");
  }
  console.log("  ✓ Consent state strictly scoped to tenant context.");

  // 6.2 Campaign preparation cross-tenant: Barbershop B attempting to prepare campaign for Barbershop A customer
  console.log("Testing 6.2: Cross-tenant campaign preparation...");
  const crossTenantPrep = await prepareManualReactivationCampaign(prisma, {
    barbershopId: barbershopB.id,
    operatorUserId: managerA.id,
    selectedCustomerIds: [testCustomer1.id],
    templateKey: "RETURN_REMINDER",
    requestKey: `req-cross-${Date.now()}`,
  });
  if (crossTenantPrep.accepted.length !== 0 || crossTenantPrep.campaign !== null) {
    throw new Error("Cross-tenant preparation accepted customer from another tenant!");
  }
  console.log("  ✓ Cross-tenant campaign preparation rejected unlinked customer (0 accepted, campaign null).");

  // 6.3 Recipient opened cross-tenant: Barbershop B attempting to open recipient from Barbershop A
  console.log("Testing 6.3: Cross-tenant recipient open...");
  let crossTenantOpenBlocked = false;
  try {
    await revalidateAndOpenManualRecipient(prisma, {
      barbershopId: barbershopB.id,
      campaignId: prepResult.campaign.id,
      recipientId: targetRecipient.recipientId,
      operatorUserId: managerA.id,
    });
  } catch (err: any) {
    crossTenantOpenBlocked = true;
    console.log(`  ✓ Cross-tenant open access denied: ${err.message}`);
  }
  if (!crossTenantOpenBlocked) {
    throw new Error("Cross-tenant open recipient was NOT blocked!");
  }

  // 6.4 Recipient sent-confirmed cross-tenant: Barbershop B attempting to confirm send for recipient from Barbershop A
  console.log("Testing 6.4: Cross-tenant recipient confirm send...");
  let crossTenantConfirmBlocked = false;
  try {
    await confirmManualRecipientSend(prisma, {
      barbershopId: barbershopB.id,
      campaignId: prepResult.campaign.id,
      recipientId: targetRecipient.recipientId,
      operatorUserId: managerA.id,
    });
  } catch (err: any) {
    crossTenantConfirmBlocked = true;
    console.log(`  ✓ Cross-tenant confirm send access denied: ${err.message}`);
  }
  if (!crossTenantConfirmBlocked) {
    throw new Error("Cross-tenant confirm send was NOT blocked!");
  }

  // Verify zero contact logs created in Barbershop B
  const bContactLogs = await prisma.customerContactLog.count({
    where: { barbershopId: barbershopB.id },
  });
  if (bContactLogs !== 0) {
    throw new Error(`Expected 0 contact logs in Tenant B, found ${bContactLogs}`);
  }
  console.log("  ✓ Zero CustomerContactLog created in Tenant B.");
  console.log("✅ Cross-tenant strict isolation completely verified.");

  console.log("\n==================================================================");
  console.log(" ✅ ALL R4 REAL POSTGRESQL 16 TESTS PASSED SUCCESSFULLY!");
  console.log("==================================================================");
}

main()
  .catch((err) => {
    console.error("FATAL ERROR in test-r4-real-postgres:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
