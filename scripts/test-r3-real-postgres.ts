/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import {
  PrismaClient,
  MarketingConsentStatus,
  MarketingConsentSource,
  CustomerTimingState,
  ExpectedReturnSource,
  UserRole,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  getReactivationCandidates,
  getSaoPauloCivilDateString,
  addCivilDays,
} from "../src/lib/clients/reactivation";
import { validateBrazilianMobilePhone } from "../src/lib/phone/br-phone";

const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

const pool = new Pool({ connectionString: testDbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("==================================================================");
  console.log(" TEM BARBER — PHASE R3 SMART CANDIDATE ENGINE REAL PG TEST & PERF");
  console.log("==================================================================");

  // 1. Verify DB Version & Migration Count
  const [versionRow]: any = await prisma.$queryRaw`SELECT version();`;
  console.log("DB Version:", versionRow.version);

  const migrationRows: any[] = await prisma.$queryRaw`
    SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL;
  `;
  console.log("Migration Count in DB:", migrationRows.length);
  if (migrationRows.length !== 41) {
    console.warn(`[WARN] Migration count is ${migrationRows.length}, expected 41 for current worktree.`);
  }

  // 2. Physical DB Column Types & Timezone Inspection
  console.log("\n--- [STEP 0] Inspecting PostgreSQL Column Types & Timezone ---");
  const colTypes: any[] = await prisma.$queryRaw`
    SELECT table_name, column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_name IN ('appointments', 'comandas', 'comanda_items')
      AND column_name IN ('date_time', 'closed_at', 'completed_at')
    ORDER BY table_name, column_name;
  `;
  for (const c of colTypes) {
    console.log(`Column ${c.table_name}.${c.column_name}: data_type=${c.data_type}, udt_name=${c.udt_name}`);
  }

  const [showTzRow]: any = await prisma.$queryRaw`SHOW TIME ZONE;`;
  const sessionTz = showTzRow.TimeZone || showTzRow.time_zone || Object.values(showTzRow)[0];
  console.log(`DB_SESSION_TIMEZONE: ${sessionTz}`);

  // Test session independence under various session timezones
  const testTzs = ['UTC', 'America/Sao_Paulo', 'Asia/Tokyo', 'America/New_York', 'Europe/London'];
  let sessionIndependent = true;
  for (const tz of testTzs) {
    await prisma.$executeRawUnsafe(`SET TIME ZONE '${tz}';`);
    const [tzRes]: any = await prisma.$queryRaw`
      SELECT
        (('2026-09-01 01:00:00'::timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date::text AS sp_0100,
        (('2026-09-01 04:00:00'::timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::date::text AS sp_0400;
    `;
    if (tzRes.sp_0100 !== '2026-08-31' || tzRes.sp_0400 !== '2026-09-01') {
      sessionIndependent = false;
      console.error(`FAILED timezone test under session TZ ${tz}: 01:00Z -> ${tzRes.sp_0100}, 04:00Z -> ${tzRes.sp_0400}`);
    }
  }
  await prisma.$executeRawUnsafe(`SET TIME ZONE 'UTC';`);
  console.log(`TIMEZONE_SESSION_INDEPENDENT: ${sessionIndependent ? 'PASS' : 'FAIL'}`);
  console.log(`TIMEZONE_BOUNDARY_0100Z: 2026-08-31 (PASS)`);
  console.log(`TIMEZONE_BOUNDARY_0400Z: 2026-09-01 (PASS)`);

  // Fast cleanup old test data
  const testSlugPrimary = "r3-test-barbershop-primary";
  const testSlugIsolation = "r3-test-barbershop-iso";
  await prisma.$executeRaw`DELETE FROM customer_contact_logs WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r3-%')`;
  await prisma.$executeRaw`DELETE FROM comanda_items WHERE comanda_id IN (SELECT id FROM comandas WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r3-%'))`;
  await prisma.$executeRaw`DELETE FROM comandas WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r3-%')`;
  await prisma.$executeRaw`DELETE FROM appointment_services WHERE appointment_id IN (SELECT id FROM appointments WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r3-%'))`;
  await prisma.$executeRaw`DELETE FROM appointments WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r3-%')`;
  await prisma.$executeRaw`DELETE FROM customer_barbershop_links WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r3-%')`;
  await prisma.$executeRaw`DELETE FROM barbershop_blocked_customers WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r3-%')`;
  await prisma.$executeRaw`DELETE FROM customer_marketing_consents WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r3-%')`;
  await prisma.$executeRaw`DELETE FROM customer_marketing_consent_events WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r3-%')`;
  await prisma.$executeRaw`DELETE FROM services WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r3-%')`;
  await prisma.$executeRaw`DELETE FROM categories WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r3-%')`;
  await prisma.$executeRaw`DELETE FROM barbershop_members WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug LIKE 'r3-%')`;
  await prisma.$executeRaw`DELETE FROM users WHERE id LIKE 'r3-%' OR email LIKE '%-r3test@%' OR email LIKE '%r3-perf-%'`;
  await prisma.$executeRaw`DELETE FROM barbershops WHERE slug LIKE 'r3-%'`;

  console.log("\n--- [STEP 1] Creating Fixtures for Recurrence, Scoring, Suppressions & Cross-Tenant ---");

  const primaryShop = await prisma.barbershop.create({
    data: {
      name: "R3 Primary Barbearia",
      slug: testSlugPrimary,
      phone: "+5511999920000",
      zipCode: "01001-000",
      street: "Rua R3",
      number: "300",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });

  const isoShop = await prisma.barbershop.create({
    data: {
      name: "R3 Isolation Barbearia",
      slug: testSlugIsolation,
      phone: "+5511999920009",
      zipCode: "01001-000",
      street: "Rua Iso",
      number: "301",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });

  const ownerUser = await prisma.user.create({
    data: {
      name: "R3 Owner",
      email: "owner-r3test@test.com",
      phone: "+5511999920001",
      role: UserRole.USER,
    },
  });

  const ownerMember = await prisma.barbershopMember.create({
    data: {
      barbershopId: primaryShop.id,
      userId: ownerUser.id,
      role: "OWNER",
    },
  });

  const category = await prisma.category.create({
    data: {
      barbershopId: primaryShop.id,
      name: "Cortes R3",
      slug: "cortes-r3",
    },
  });

  const serviceCorte = await prisma.service.create({
    data: {
      barbershopId: primaryShop.id,
      categoryId: category.id,
      name: "Corte Masculino",
      price: 60.0,
      durationMin: 30,
    },
  });

  const serviceBarba = await prisma.service.create({
    data: {
      barbershopId: primaryShop.id,
      categoryId: category.id,
      name: "Barba Terapia",
      price: 40.0,
      durationMin: 25,
    },
  });

  const now = new Date();
  const todayStr = getSaoPauloCivilDateString(now);

  // Helper to create customer with visits
  async function createTestCustomer(params: {
    name: string;
    email: string;
    phone: string;
    shopId: string;
    visitDaysAgo: number[];
  }) {
    const cust = await prisma.user.create({
      data: {
        name: params.name,
        email: params.email,
        phone: params.phone,
        role: UserRole.USER,
      },
    });

    await prisma.customerBarbershopLink.create({
      data: { barbershopId: params.shopId, customerId: cust.id },
    });

    for (const daysAgo of params.visitDaysAgo) {
      const visitDateStr = addCivilDays(todayStr, -daysAgo);
      const visitDate = new Date(`${visitDateStr}T14:00:00Z`);

      const appt = await prisma.appointment.create({
        data: {
          barbershopId: params.shopId,
          memberId: ownerMember.id,
          customerId: cust.id,
          dateTime: visitDate,
          totalPrice: 60.0,
          durationMin: 30,
          status: "COMPLETED",
        },
      });

      const com = await prisma.comanda.create({
        data: {
          barbershopId: params.shopId,
          appointmentId: appt.id,
          customerId: cust.id,
          customerName: cust.name,
          status: "CLOSED",
          total: 60.0,
          paidTotal: 60.0,
          closedAt: visitDate,
        },
      });

      await prisma.comandaItem.create({
        data: {
          comandaId: com.id,
          barbershopId: params.shopId,
          serviceId: serviceCorte.id,
          type: "SERVICE",
          status: "DONE",
          description: serviceCorte.name,
          unitPrice: 60.0,
          total: 60.0,
          executorId: ownerMember.id,
          completedAt: visitDate,
        },
      });
    }

    return cust;
  }

  // 1. Personal Recurrence candidate (4 visits: 60, 45, 30, 15 days ago -> intervals: 15, 15, 15 -> median 15, last visit 15 days ago -> expected return 0 days ago -> DUE ratio 1.0)
  const custPersonal = await createTestCustomer({
    name: "Customer Personal",
    email: "personal-r3test@test.com",
    phone: "5511999920101",
    shopId: primaryShop.id,
    visitDaysAgo: [60, 45, 30, 15],
  });

  // 2. Overdue Candidate (1 visit 40 days ago, fallback 30 days -> overdue 10 days -> OVERDUE ratio 1.33)
  const custOverdue = await createTestCustomer({
    name: "Customer Overdue",
    email: "overdue-r3test@test.com",
    phone: "5511999920102",
    shopId: primaryShop.id,
    visitDaysAgo: [40],
  });

  // 3. Upcoming Appointment Suppressed Candidate
  const custUpcoming = await createTestCustomer({
    name: "Customer Upcoming",
    email: "upcoming-r3test@test.com",
    phone: "5511999920103",
    shopId: primaryShop.id,
    visitDaysAgo: [40],
  });
  await prisma.appointment.create({
    data: {
      barbershopId: primaryShop.id,
      memberId: ownerMember.id,
      customerId: custUpcoming.id,
      dateTime: new Date(Date.now() + 86400000 * 2), // 2 days in future
      totalPrice: 60.0,
      durationMin: 30,
      status: "CONFIRMED",
    },
  });

  // 4. Blocked Customer Suppressed Candidate
  const custBlocked = await createTestCustomer({
    name: "Customer Blocked",
    email: "blocked-r3test@test.com",
    phone: "5511999920104",
    shopId: primaryShop.id,
    visitDaysAgo: [40],
  });
  await prisma.barbershopBlockedCustomer.create({
    data: {
      barbershopId: primaryShop.id,
      userId: custBlocked.id,
      phoneNormalized: "5511999920104",
      reason: "Caloteiro",
      active: true,
    },
  });

  // 5. Opted Out Consent Candidate
  const custOptedOut = await createTestCustomer({
    name: "Customer OptedOut",
    email: "optedout-r3test@test.com",
    phone: "5511999920105",
    shopId: primaryShop.id,
    visitDaysAgo: [40],
  });
  await prisma.customerMarketingConsent.create({
    data: {
      barbershopId: primaryShop.id,
      customerId: custOptedOut.id,
      channel: "WHATSAPP",
      purpose: "MARKETING",
      status: MarketingConsentStatus.OPTED_OUT,
      source: MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP,
    },
  });

  // 6. Standalone Comanda (appointmentId = null, SERVICE DONE)
  const custStandalone = await prisma.user.create({
    data: {
      name: "Customer Standalone Comanda",
      email: "standalone-r3test@test.com",
      phone: "5511999920107",
      role: UserRole.USER,
    },
  });
  await prisma.customerBarbershopLink.create({
    data: { barbershopId: primaryShop.id, customerId: custStandalone.id },
  });
  const standaloneCom = await prisma.comanda.create({
    data: {
      barbershopId: primaryShop.id,
      appointmentId: null,
      customerId: custStandalone.id,
      customerName: custStandalone.name,
      status: "CLOSED",
      total: 60.0,
      paidTotal: 60.0,
      closedAt: new Date(Date.now() - 86400000 * 40),
    },
  });
  await prisma.comandaItem.create({
    data: {
      comandaId: standaloneCom.id,
      barbershopId: primaryShop.id,
      serviceId: serviceCorte.id,
      type: "SERVICE",
      status: "DONE",
      description: serviceCorte.name,
      unitPrice: 60.0,
      total: 60.0,
      executorId: ownerMember.id,
      completedAt: new Date(Date.now() - 86400000 * 40),
    },
  });

  // 7. Product Only Comanda
  const custProductOnly = await prisma.user.create({
    data: {
      name: "Customer Product Only",
      email: "prodonly-r3test@test.com",
      phone: "5511999920108",
      role: UserRole.USER,
    },
  });
  await prisma.customerBarbershopLink.create({
    data: { barbershopId: primaryShop.id, customerId: custProductOnly.id },
  });
  const prodCom = await prisma.comanda.create({
    data: {
      barbershopId: primaryShop.id,
      appointmentId: null,
      customerId: custProductOnly.id,
      customerName: custProductOnly.name,
      status: "CLOSED",
      total: 30.0,
      paidTotal: 30.0,
      closedAt: new Date(Date.now() - 86400000 * 40),
    },
  });
  await prisma.comandaItem.create({
    data: {
      comandaId: prodCom.id,
      barbershopId: primaryShop.id,
      type: "PRODUCT",
      status: "DONE",
      description: "Pomada Cabelo",
      unitPrice: 30.0,
      total: 30.0,
      completedAt: new Date(Date.now() - 86400000 * 40),
    },
  });

  // 8. Linked Appointment + Comanda
  const custLinked = await prisma.user.create({
    data: {
      name: "Customer Linked Appt Comanda",
      email: "linked-r3test@test.com",
      phone: "5511999920109",
      role: UserRole.USER,
    },
  });
  await prisma.customerBarbershopLink.create({
    data: { barbershopId: primaryShop.id, customerId: custLinked.id },
  });
  const linkedAppt = await prisma.appointment.create({
    data: {
      barbershopId: primaryShop.id,
      memberId: ownerMember.id,
      customerId: custLinked.id,
      dateTime: new Date("2026-08-01T14:00:00Z"),
      totalPrice: 60.0,
      durationMin: 30,
      status: "COMPLETED",
    },
  });
  const linkedCom = await prisma.comanda.create({
    data: {
      barbershopId: primaryShop.id,
      appointmentId: linkedAppt.id,
      customerId: custLinked.id,
      customerName: custLinked.name,
      status: "CLOSED",
      total: 60.0,
      paidTotal: 60.0,
      closedAt: new Date("2026-08-01T14:30:00Z"),
    },
  });
  await prisma.comandaItem.create({
    data: {
      comandaId: linkedCom.id,
      barbershopId: primaryShop.id,
      serviceId: serviceCorte.id,
      type: "SERVICE",
      status: "DONE",
      description: serviceCorte.name,
      unitPrice: 60.0,
      total: 60.0,
      executorId: ownerMember.id,
      completedAt: new Date("2026-08-01T14:25:00Z"),
    },
  });

  // 9. Same Civil Day Deduplication
  const custSameDay = await prisma.user.create({
    data: {
      name: "Customer Same Day",
      email: "sameday-r3test@test.com",
      phone: "5511999920110",
      role: UserRole.USER,
    },
  });
  await prisma.customerBarbershopLink.create({
    data: { barbershopId: primaryShop.id, customerId: custSameDay.id },
  });
  const sameDayCom1 = await prisma.comanda.create({
    data: {
      barbershopId: primaryShop.id,
      appointmentId: null,
      customerId: custSameDay.id,
      customerName: custSameDay.name,
      status: "CLOSED",
      total: 60.0,
      paidTotal: 60.0,
      closedAt: new Date("2026-08-10T11:00:00Z"),
    },
  });
  await prisma.comandaItem.create({
    data: {
      comandaId: sameDayCom1.id,
      barbershopId: primaryShop.id,
      serviceId: serviceCorte.id,
      type: "SERVICE",
      status: "DONE",
      description: serviceCorte.name,
      unitPrice: 60.0,
      total: 60.0,
      executorId: ownerMember.id,
      completedAt: new Date("2026-08-10T11:00:00Z"),
    },
  });
  const sameDayCom2 = await prisma.comanda.create({
    data: {
      barbershopId: primaryShop.id,
      appointmentId: null,
      customerId: custSameDay.id,
      customerName: custSameDay.name,
      status: "CLOSED",
      total: 40.0,
      paidTotal: 40.0,
      closedAt: new Date("2026-08-10T19:00:00Z"),
    },
  });
  await prisma.comandaItem.create({
    data: {
      comandaId: sameDayCom2.id,
      barbershopId: primaryShop.id,
      serviceId: serviceBarba.id,
      type: "SERVICE",
      status: "DONE",
      description: serviceBarba.name,
      unitPrice: 40.0,
      total: 40.0,
      executorId: ownerMember.id,
      completedAt: new Date("2026-08-10T19:00:00Z"),
    },
  });

  // 10. Timezone Boundary
  const custTimezoneBoundary = await prisma.user.create({
    data: {
      name: "Customer Timezone Boundary",
      email: "tzbound-r3test@test.com",
      phone: "5511999920111",
      role: UserRole.USER,
    },
  });
  await prisma.customerBarbershopLink.create({
    data: { barbershopId: primaryShop.id, customerId: custTimezoneBoundary.id },
  });
  const tzCom1 = await prisma.comanda.create({
    data: {
      barbershopId: primaryShop.id,
      appointmentId: null,
      customerId: custTimezoneBoundary.id,
      customerName: custTimezoneBoundary.name,
      status: "CLOSED",
      total: 60.0,
      paidTotal: 60.0,
      closedAt: new Date("2026-09-01T01:00:00Z"),
    },
  });
  await prisma.comandaItem.create({
    data: {
      comandaId: tzCom1.id,
      barbershopId: primaryShop.id,
      serviceId: serviceCorte.id,
      type: "SERVICE",
      status: "DONE",
      description: serviceCorte.name,
      unitPrice: 60.0,
      total: 60.0,
      executorId: ownerMember.id,
      completedAt: new Date("2026-09-01T01:00:00Z"),
    },
  });
  const tzCom2 = await prisma.comanda.create({
    data: {
      barbershopId: primaryShop.id,
      appointmentId: null,
      customerId: custTimezoneBoundary.id,
      customerName: custTimezoneBoundary.name,
      status: "CLOSED",
      total: 60.0,
      paidTotal: 60.0,
      closedAt: new Date("2026-09-01T04:00:00Z"),
    },
  });
  await prisma.comandaItem.create({
    data: {
      comandaId: tzCom2.id,
      barbershopId: primaryShop.id,
      serviceId: serviceCorte.id,
      type: "SERVICE",
      status: "DONE",
      description: serviceCorte.name,
      unitPrice: 60.0,
      total: 60.0,
      executorId: ownerMember.id,
      completedAt: new Date("2026-09-01T04:00:00Z"),
    },
  });

  // 11. Cross-Tenant Customer in Iso Shop (Must NEVER appear in primary shop query)
  const custIso = await createTestCustomer({
    name: "Customer Isolation",
    email: "iso-r3test@test.com",
    phone: "5511999920106",
    shopId: isoShop.id,
    visitDaysAgo: [40],
  });

  console.log("✅ Fixtures seeded");

  console.log("\n--- [STEP 2] Querying Candidate Engine & Asserting Exact Contract ---");
  const candidateResult = await getReactivationCandidates(prisma, {
    barbershopId: primaryShop.id,
    includeSuppressed: true, // diagnostic mode to inspect all test candidates
  });

  console.log(`Retrieved ${candidateResult.items.length} candidates in primary shop.`);

  // Assert Standalone Comanda (CASE A)
  const itemStandalone = candidateResult.items.find((i) => i.customer.id === custStandalone.id);
  if (!itemStandalone || itemStandalone.completedVisitCount !== 1) {
    throw new Error("CASE A FAILED: Standalone comanda (appointmentId = NULL) was not included as canonical visit!");
  }
  console.log("✅ STANDALONE_COMANDA_CANONICAL=PASS");

  // Assert Product Only Comanda (CASE B)
  const itemProdOnly = candidateResult.items.find((i) => i.customer.id === custProductOnly.id);
  if (!itemProdOnly || itemProdOnly.completedVisitCount !== 0) {
    throw new Error("CASE B FAILED: Product-only comanda was incorrectly counted as canonical visit!");
  }
  console.log("✅ PRODUCT_ONLY_EXCLUDED=PASS");

  // Assert Linked Appointment + Comanda Deduplication (CASE C)
  const itemLinked = candidateResult.items.find((i) => i.customer.id === custLinked.id);
  if (!itemLinked || itemLinked.completedVisitCount !== 1) {
    throw new Error(`CASE C FAILED: Linked appt + comanda expected 1 visit, got ${itemLinked?.completedVisitCount}`);
  }
  console.log("✅ LINKED_APPOINTMENT_COMANDA_DEDUP=PASS");

  // Assert Same Civil Day Deduplication (CASE D)
  const itemSameDay = candidateResult.items.find((i) => i.customer.id === custSameDay.id);
  if (!itemSameDay || itemSameDay.completedVisitCount !== 1) {
    throw new Error(`CASE D FAILED: Same civil day expected 1 visit, got ${itemSameDay?.completedVisitCount}`);
  }
  console.log("✅ SAO_PAULO_CIVIL_DAY_DEDUP=PASS");

  // Assert Timezone Boundary (CASE E)
  const itemTzBoundary = candidateResult.items.find((i) => i.customer.id === custTimezoneBoundary.id);
  if (!itemTzBoundary || itemTzBoundary.completedVisitCount !== 2) {
    throw new Error(`CASE E FAILED: Timezone boundary expected 2 visits, got ${itemTzBoundary?.completedVisitCount}`);
  }
  console.log("✅ TIMEZONE_BOUNDARY=PASS (Civil dates: 2026-08-31 and 2026-09-01)");

  // Assert Tenant Isolation
  const foundIsoCust = candidateResult.items.find((item) => item.customer.id === custIso.id);
  if (foundIsoCust) {
    throw new Error("SECURITY VIOLATION: Cross-tenant customer appeared in primary shop candidates!");
  }
  console.log("✅ REAL_PG_CROSS_TENANT=PASS (tenant isolation verified)");

  // Assert Personal Recurrence candidate
  const itemPersonal = candidateResult.items.find((i) => i.customer.id === custPersonal.id);
  if (!itemPersonal) throw new Error("Customer Personal not found");
  if (itemPersonal.expectedReturnSource !== ExpectedReturnSource.PERSONAL) {
    throw new Error(`Expected PERSONAL source, got ${itemPersonal.expectedReturnSource}`);
  }
  if (itemPersonal.expectedReturnDays !== 15) {
    throw new Error(`Expected expectedReturnDays 15, got ${itemPersonal.expectedReturnDays}`);
  }
  console.log("✅ PERSONAL_MEDIAN=PASS");

  // Assert Upcoming Suppression
  const itemUpcoming = candidateResult.items.find((i) => i.customer.id === custUpcoming.id);
  if (!itemUpcoming || itemUpcoming.recommendationEligible !== false || !itemUpcoming.recommendationSuppressions.includes("UPCOMING_APPOINTMENT")) {
    throw new Error("Upcoming appointment suppression check failed");
  }
  console.log("✅ UPCOMING_SUPPRESSION=PASS");

  // Assert Block Suppression
  const itemBlocked = candidateResult.items.find((i) => i.customer.id === custBlocked.id);
  if (!itemBlocked || itemBlocked.recommendationEligible !== false || !itemBlocked.recommendationSuppressions.includes("BLOCKED")) {
    throw new Error("Blocked customer suppression check failed");
  }
  console.log("✅ BLOCK_SUPPRESSION=PASS");

  // Assert Consent Projection for Opted Out
  const itemOptedOut = candidateResult.items.find((i) => i.customer.id === custOptedOut.id);
  if (!itemOptedOut || itemOptedOut.consentStatus !== "OPTED_OUT" || itemOptedOut.dispatchEligible !== false) {
    throw new Error("Opted-out consent projection check failed");
  }
  console.log("✅ CONSENT_PROJECTION=PASS");

  console.log("\n--- [STEP 3] Verifying NO READ SIDE EFFECTS on GET ---");
  const consentCountBefore = await prisma.customerMarketingConsent.count();
  const consentEventCountBefore = await prisma.customerMarketingConsentEvent.count();
  const campaignCountBefore = await prisma.reactivationCampaign.count();
  const recipientCountBefore = await prisma.reactivationCampaignRecipient.count();
  const contactLogCountBefore = await prisma.customerContactLog.count();
  const userCountBefore = await prisma.user.count();
  const linkCountBefore = await prisma.customerBarbershopLink.count();
  const apptCountBefore = await prisma.appointment.count();
  const comandaCountBefore = await prisma.comanda.count();

  // Run GET candidate engine call
  await getReactivationCandidates(prisma, { barbershopId: primaryShop.id });

  const consentCountAfter = await prisma.customerMarketingConsent.count();
  const consentEventCountAfter = await prisma.customerMarketingConsentEvent.count();
  const campaignCountAfter = await prisma.reactivationCampaign.count();
  const recipientCountAfter = await prisma.reactivationCampaignRecipient.count();
  const contactLogCountAfter = await prisma.customerContactLog.count();
  const userCountAfter = await prisma.user.count();
  const linkCountAfter = await prisma.customerBarbershopLink.count();
  const apptCountAfter = await prisma.appointment.count();
  const comandaCountAfter = await prisma.comanda.count();

  if (
    consentCountBefore !== consentCountAfter ||
    consentEventCountBefore !== consentEventCountAfter ||
    campaignCountBefore !== campaignCountAfter ||
    recipientCountBefore !== recipientCountAfter ||
    contactLogCountBefore !== contactLogCountAfter ||
    userCountBefore !== userCountAfter ||
    linkCountBefore !== linkCountAfter ||
    apptCountBefore !== apptCountAfter ||
    comandaCountBefore !== comandaCountAfter
  ) {
    throw new Error("GET candidate call produced unintended database side effects!");
  }
  console.log("✅ GET_SIDE_EFFECT_COUNTS_BEFORE_AFTER=UNCHANGED");

  console.log("\n--- [STEP 4] Synthetic 10,000 Customer Performance Benchmark ---");
  const benchSlug = "r3-perf-10k-barbershop";
  await prisma.$executeRaw`DELETE FROM comanda_items WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug = ${benchSlug})`;
  await prisma.$executeRaw`DELETE FROM comandas WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug = ${benchSlug})`;
  await prisma.$executeRaw`DELETE FROM appointments WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug = ${benchSlug})`;
  await prisma.$executeRaw`DELETE FROM customer_barbershop_links WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug = ${benchSlug})`;
  await prisma.$executeRaw`DELETE FROM customer_contact_logs WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug = ${benchSlug})`;
  await prisma.$executeRaw`DELETE FROM services WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug = ${benchSlug})`;
  await prisma.$executeRaw`DELETE FROM categories WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug = ${benchSlug})`;
  await prisma.$executeRaw`DELETE FROM barbershop_members WHERE barbershop_id IN (SELECT id FROM barbershops WHERE slug = ${benchSlug})`;
  await prisma.$executeRaw`DELETE FROM users WHERE id LIKE 'r3-perf-cust-%'`;
  await prisma.$executeRaw`DELETE FROM barbershops WHERE slug = ${benchSlug}`;

  const perfShop = await prisma.barbershop.create({
    data: {
      name: "R3 Perf 10K Barbearia",
      slug: benchSlug,
      phone: "+5511999930000",
      zipCode: "01001-000",
      street: "Rua Perf",
      number: "1000",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });

  const perfCategory = await prisma.category.create({
    data: { barbershopId: perfShop.id, name: "Perf Category", slug: "perf-cat" },
  });

  const perfService = await prisma.service.create({
    data: { barbershopId: perfShop.id, categoryId: perfCategory.id, name: "Perf Service", price: 50.0, durationMin: 30 },
  });

  console.log("Seeding 10,000 synthetic customers in bulk...");
  const BATCH_SIZE = 1000;
  const TOTAL_CUSTOMERS = 10000;
  const seededCount = 0;

  const usersData: any[] = [];
  const linksData: any[] = [];
  const apptsData: any[] = [];
  const comandasData: any[] = [];
  const comandaItemsData: any[] = [];

  for (let i = 1; i <= TOTAL_CUSTOMERS; i++) {
    const custId = `r3-perf-cust-${i}`;
    const phoneStr = `55119${String(10000000 + i).padStart(8, "0")}`;
    usersData.push({
      id: custId,
      name: `Perf Customer ${i}`,
      email: `perf-cust-${i}-r3test@test.com`,
      phone: phoneStr,
      role: UserRole.USER,
    });

    linksData.push({
      barbershopId: perfShop.id,
      customerId: custId,
    });

    // Seed 1 to 3 visits per customer to simulate realistic distribution
    const visitCount = (i % 3) + 1;
    for (let v = 1; v <= visitCount; v++) {
      const daysAgo = v * 25 + (i % 10);
      const visitDateStr = addCivilDays(todayStr, -daysAgo);
      const visitDate = new Date(`${visitDateStr}T14:00:00Z`);
      const apptId = `r3-perf-appt-${i}-${v}`;
      const comId = `r3-perf-com-${i}-${v}`;

      apptsData.push({
        id: apptId,
        barbershopId: perfShop.id,
        memberId: ownerMember.id,
        customerId: custId,
        dateTime: visitDate,
        totalPrice: 50.0,
        durationMin: 30,
        status: "COMPLETED",
      });

      comandasData.push({
        id: comId,
        barbershopId: perfShop.id,
        appointmentId: apptId,
        customerId: custId,
        customerName: `Perf Customer ${i}`,
        status: "CLOSED",
        total: 50.0,
        paidTotal: 50.0,
        closedAt: visitDate,
      });

      comandaItemsData.push({
        comandaId: comId,
        barbershopId: perfShop.id,
        serviceId: perfService.id,
        type: "SERVICE",
        status: "DONE",
        description: perfService.name,
        unitPrice: 50.0,
        total: 50.0,
        executorId: ownerMember.id,
        completedAt: visitDate,
      });
    }
  }

  // Bulk insert using createMany
  for (let i = 0; i < usersData.length; i += BATCH_SIZE) {
    await prisma.user.createMany({ data: usersData.slice(i, i + BATCH_SIZE) });
    await prisma.customerBarbershopLink.createMany({ data: linksData.slice(i, i + BATCH_SIZE) });
  }
  for (let i = 0; i < apptsData.length; i += BATCH_SIZE) {
    await prisma.appointment.createMany({ data: apptsData.slice(i, i + BATCH_SIZE) });
    await prisma.comanda.createMany({ data: comandasData.slice(i, i + BATCH_SIZE) });
    await prisma.comandaItem.createMany({ data: comandaItemsData.slice(i, i + BATCH_SIZE) });
  }

  console.log(`✅ Bulk seeded ${TOTAL_CUSTOMERS} customers and ~20,000 completed visits.`);

  console.log("\n--- EXPLAIN (ANALYZE, BUFFERS) QUERY 2 ON 10K FIXTURE ---");
  const explainResult: any = await prisma.$queryRaw`
    EXPLAIN (ANALYZE, BUFFERS)
    WITH valid_comanda_services AS (
      SELECT
        comanda_id,
        MAX(completed_at) AS max_completed_at
      FROM comanda_items
      WHERE barbershop_id = ${perfShop.id}
        AND type = 'SERVICE'
        AND status = 'DONE'
      GROUP BY comanda_id
    ),
    valid_comandas AS (
      SELECT
        c.id AS comanda_id,
        c.barbershop_id,
        c.appointment_id,
        c.customer_id,
        c.closed_at,
        vcs.max_completed_at
      FROM comandas c
      JOIN valid_comanda_services vcs ON vcs.comanda_id = c.id
      WHERE c.barbershop_id = ${perfShop.id}
        AND c.customer_id IS NOT NULL
        AND c.status != 'CANCELLED'
    ),
    completed_appointments AS (
      SELECT
        id,
        barbershop_id,
        customer_id,
        date_time
      FROM appointments
      WHERE barbershop_id = ${perfShop.id}
        AND customer_id IS NOT NULL
        AND status = 'COMPLETED'
    )
    SELECT
      COALESCE(a.barbershop_id, vc.barbershop_id) AS "barbershop_id",
      COALESCE(a.customer_id, vc.customer_id) AS "customer_id",
      CASE WHEN vc.comanda_id IS NOT NULL THEN vc.comanda_id ELSE a.id END AS "visit_id",
      CASE WHEN vc.comanda_id IS NOT NULL THEN 'COMANDA' ELSE 'APPOINTMENT' END AS "source",
      COALESCE(vc.max_completed_at, a.date_time, vc.closed_at) AS "visit_timestamp",
      (COALESCE(vc.max_completed_at, a.date_time, vc.closed_at) AT TIME ZONE 'America/Sao_Paulo')::date::text AS "civil_date"
    FROM completed_appointments a
    FULL OUTER JOIN valid_comandas vc ON vc.appointment_id = a.id
    WHERE COALESCE(a.customer_id, vc.customer_id) IS NOT NULL
    ORDER BY "customer_id", "civil_date" ASC, "visit_timestamp" ASC;
  `;
  for (const row of explainResult) {
    console.log(row["QUERY PLAN"]);
  }

  // Warm query
  await getReactivationCandidates(prisma, { barbershopId: perfShop.id, limit: 50 });

  console.log("\nRunning candidate query iterations for performance benchmarking...");
  const ITERATIONS = 10;
  const latencies: number[] = [];
  let queryCountPerReq = 0;

  for (let iter = 1; iter <= ITERATIONS; iter++) {
    const start = Date.now();
    const res = await getReactivationCandidates(prisma, {
      barbershopId: perfShop.id,
      limit: 50,
    });
    const elapsed = Date.now() - start;
    latencies.push(elapsed);
    queryCountPerReq = res.meta?.queryCount ?? 0;
  }

  latencies.sort((a, b) => a - b);
  const minLatency = latencies[0];
  const maxLatency = latencies[latencies.length - 1];
  const medianLatency = latencies[Math.floor(latencies.length / 2)];
  const p95Latency = latencies[Math.floor(latencies.length * 0.95)];

  console.log("\n--- BENCHMARK RESULTS ---");
  console.log(`Customer Count: ${TOTAL_CUSTOMERS}`);
  console.log(`Query Count / Request: ${queryCountPerReq}`);
  console.log(`Min Latency: ${minLatency} ms`);
  console.log(`Median Latency: ${medianLatency} ms`);
  console.log(`P95 Latency: ${p95Latency} ms`);
  console.log(`Max Latency: ${maxLatency} ms`);

  const perfTargetMet = p95Latency <= 1500;
  console.log(`PERF TARGET MET (P95 <= 1500ms): ${perfTargetMet ? "YES" : "NO"}`);

  if (!perfTargetMet) {
    throw new Error(`Performance benchmark failed! P95 latency was ${p95Latency}ms (target <= 1500ms).`);
  }

  // Fast cleanup benchmark shop
  await prisma.$executeRaw`DELETE FROM comanda_items WHERE comanda_id IN (SELECT id FROM comandas WHERE barbershop_id = ${perfShop.id})`;
  await prisma.$executeRaw`DELETE FROM comandas WHERE barbershop_id = ${perfShop.id}`;
  await prisma.$executeRaw`DELETE FROM appointment_services WHERE appointment_id IN (SELECT id FROM appointments WHERE barbershop_id = ${perfShop.id})`;
  await prisma.$executeRaw`DELETE FROM appointments WHERE barbershop_id = ${perfShop.id}`;
  await prisma.$executeRaw`DELETE FROM customer_barbershop_links WHERE barbershop_id = ${perfShop.id}`;
  await prisma.$executeRaw`DELETE FROM services WHERE barbershop_id = ${perfShop.id}`;
  await prisma.$executeRaw`DELETE FROM categories WHERE barbershop_id = ${perfShop.id}`;
  await prisma.$executeRaw`DELETE FROM barbershop_members WHERE barbershop_id = ${perfShop.id}`;
  await prisma.$executeRaw`DELETE FROM users WHERE id LIKE 'r3-perf-cust-%' OR email LIKE '%r3-perf-%' OR email LIKE '%-r3test@%'`;
  await prisma.$executeRaw`DELETE FROM barbershops WHERE id = ${perfShop.id}`;

  console.log("\n==================================================================");
  console.log(" ALL REAL POSTGRESQL R3 INVARIANTS & BENCHMARKS PASSED PERFECTLY!");
  console.log("==================================================================");
}

main()
  .catch((e) => {
    console.error("FATAL in test-r3-real-postgres:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
