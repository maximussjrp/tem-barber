/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  PrismaClient,
  MetaConnectionStatus,
  MetaOnboardingSessionStatus,
  MetaConnectionEventType,
  WebhookProcessingStatus,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  encryptMetaCredential,
  decryptMetaCredential,
  generateRegistrationPin,
  generateOnboardingNonce,
  hashOnboardingNonce,
} from "../src/lib/meta/crypto";

const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

const pool = new Pool({ connectionString: testDbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("==================================================================");
  console.log(" TEM BARBER — PHASE R6.1A REAL POSTGRESQL INTEGRATION & MIGRATION TEST");
  console.log("==================================================================");

  const [versionRow]: any = await prisma.$queryRaw`SELECT version();`;
  console.log("DB Version:", versionRow.version);

  // 1. Run Migration SQL if needed
  console.log("\n1. Applying R6.1A Migration SQL...");
  const migrationPath = path.join(
    process.cwd(),
    "prisma/migrations/20260908210000_add_meta_connection_security_foundation/migration.sql"
  );
  const migrationSql = fs.readFileSync(migrationPath, "utf8");

  try {
    await pool.query(migrationSql);
    console.log("-> Migration SQL executed successfully (all tables/enums/indices/FKs applied).");
  } catch (err: any) {
    if (err.message && (err.message.includes("already exists") || err.code === "42710" || err.code === "42P07")) {
      console.log("-> Objects already exist in test DB (idempotent verification).");
      await pool.query('ALTER TYPE "WebhookProcessingStatus" ADD VALUE IF NOT EXISTS \'IGNORED\';');
    } else {
      throw err;
    }
  }

  // 2. Setup Test Barbershops & Users
  console.log("\n2. Setting up test fixtures...");
  const rand = Math.floor(1000 + Math.random() * 9000);
  const barbershopA = await prisma.barbershop.create({
    data: {
      name: `Barbearia Meta R6.1A Tenant A ${rand}`,
      slug: `r6-1a-test-a-${Date.now()}-${rand}`,
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
      name: `Barbearia Meta R6.1A Tenant B ${rand}`,
      slug: `r6-1a-test-b-${Date.now()}-${rand}`,
      phone: `1199120${rand}`,
      zipCode: "01001-000",
      street: "Rua B",
      number: "200",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
    },
  });

  const ownerUser = await prisma.user.create({
    data: {
      name: "Owner User",
      email: `owner-${Date.now()}-${rand}@example.test`,
      phone: `1198888${rand}`,
      passwordHash: "hash",
      role: "USER",
    },
  });

  console.log(`Created Barbershop A: ${barbershopA.id}, Barbershop B: ${barbershopB.id}, Owner: ${ownerUser.id}`);

  // 3. Test MetaOnboardingSession Lifecycle & Nonce Hashing
  console.log("\n3. Testing MetaOnboardingSession creation and nonce hashing...");
  const rawNonce = generateOnboardingNonce();
  const nonceHash = hashOnboardingNonce(rawNonce);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  const session = await prisma.metaOnboardingSession.create({
    data: {
      barbershopId: barbershopA.id,
      createdByUserId: ownerUser.id,
      nonceHash,
      status: MetaOnboardingSessionStatus.INITIATED,
      expiresAt,
    },
  });

  console.log(`Session created: ${session.id}, status: ${session.status}`);
  if (session.nonceHash !== nonceHash) {
    throw new Error("Nonce hash mismatch in database");
  }
  if (session.nonceHash === rawNonce) {
    throw new Error("SECURITY VIOLATION: Raw nonce was stored in database!");
  }

  // 4. Test MetaConnection & AES-256-GCM Secrets
  console.log("\n4. Testing MetaConnection creation and AES-256-GCM PIN encryption/decryption...");
  const phoneIdA = `phone_id_${Date.now()}_${rand}`;
  const wabaIdA = `waba_id_${Date.now()}_${rand}`;
  const plainPin = generateRegistrationPin();
  console.log("Generated registration PIN: [REDACTED]");

  // Create Connection
  const connectionA = await prisma.metaConnection.create({
    data: {
      barbershopId: barbershopA.id,
      createdByUserId: ownerUser.id,
      wabaId: wabaIdA,
      phoneNumberId: phoneIdA,
      displayPhoneNumber: "+55 11 99999-9999",
      verifiedName: "Barbearia Teste Oficial",
      status: MetaConnectionStatus.CONNECTED,
      connectedAt: new Date(),
    },
  });
  console.log(`MetaConnection created: ${connectionA.id}`);

  // Encrypt Secret with AAD
  process.env.META_CREDENTIAL_ENCRYPTION_ACTIVE_VERSION = "v1";
  process.env.META_CREDENTIAL_ENCRYPTION_KEY_V1 =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const encryptedPin = encryptMetaCredential({
    plaintext: plainPin,
    barbershopId: barbershopA.id,
    metaConnectionId: connectionA.id,
    credentialType: "REGISTRATION_PIN",
  });

  const secretRecord = await prisma.metaConnectionSecret.create({
    data: {
      metaConnectionId: connectionA.id,
      registrationPinCiphertext: encryptedPin.ciphertext,
      registrationPinIv: encryptedPin.iv,
      registrationPinAuthTag: encryptedPin.authTag,
      encryptionKeyVersion: encryptedPin.keyVersion,
    },
  });
  console.log(`MetaConnectionSecret created: ${secretRecord.id}`);

  // Decrypt with matching AAD
  const decryptedPin = decryptMetaCredential({
    ciphertext: secretRecord.registrationPinCiphertext,
    iv: secretRecord.registrationPinIv,
    authTag: secretRecord.registrationPinAuthTag,
    keyVersion: secretRecord.encryptionKeyVersion,
    barbershopId: barbershopA.id,
    metaConnectionId: connectionA.id,
    credentialType: "REGISTRATION_PIN",
  });

  if (decryptedPin !== plainPin) {
    throw new Error(`Decrypted PIN (${decryptedPin}) does not match original (${plainPin})`);
  }
  console.log("-> PIN decryption with valid AAD verified successfully.");

  // Decrypt attempt with Mismatched Tenant AAD -> MUST FAIL
  let crossTenantPrevented = false;
  try {
    decryptMetaCredential({
      ciphertext: secretRecord.registrationPinCiphertext,
      iv: secretRecord.registrationPinIv,
      authTag: secretRecord.registrationPinAuthTag,
      keyVersion: secretRecord.encryptionKeyVersion,
      barbershopId: barbershopB.id, // Wrong tenant
      metaConnectionId: connectionA.id,
      credentialType: "REGISTRATION_PIN",
    });
  } catch (err: any) {
    crossTenantPrevented = true;
    console.log("-> Cross-tenant AAD mismatch correctly threw error:", err.message);
  }

  if (!crossTenantPrevented) {
    throw new Error("SECURITY FAILURE: Cross-tenant decryption did not fail!");
  }

  // 5. Test MetaConnectionEvent Audit Trail
  console.log("\n5. Testing MetaConnectionEvent audit trail...");
  const event = await prisma.metaConnectionEvent.create({
    data: {
      barbershopId: barbershopA.id,
      metaConnectionId: connectionA.id,
      actorUserId: ownerUser.id,
      type: MetaConnectionEventType.CONNECTED,
      metadata: {
        wabaId: wabaIdA,
        phoneNumberId: phoneIdA,
      },
    },
  });
  console.log(`Audit event created: ${event.id}, type: ${event.type}`);

  // 6. Test WebhookInbox Fan-out, Tenant Resolution, and Idempotency
  console.log("\n6. Testing WebhookInbox ingestion and idempotency...");
  const eventKey1 = `message:${phoneIdA}:wamid.HBgLTESTMSG_${Date.now()}`;
  const payload1 = {
    entry_id: wabaIdA,
    field: "messages",
    message: { id: "wamid.HBgLTESTMSG", text: { body: "Teste de webhook" } },
  };
  const payloadHash1 = crypto.createHash("sha256").update(JSON.stringify(payload1)).digest("hex");

  // Ingest Webhook 1 (Tenant Mapped)
  const webhook1 = await prisma.webhookInbox.upsert({
    where: {
      provider_eventKey: {
        provider: "meta",
        eventKey: eventKey1,
      },
    },
    create: {
      provider: "meta",
      eventKey: eventKey1,
      eventType: "messages",
      wabaId: wabaIdA,
      phoneNumberId: phoneIdA,
      providerMessageId: "wamid.HBgLTESTMSG",
      metaConnectionId: connectionA.id,
      barbershopId: barbershopA.id,
      payload: payload1,
      payloadHash: payloadHash1,
      processingStatus: WebhookProcessingStatus.PENDING,
      signatureVerifiedAt: new Date(),
    },
    update: {},
  });
  console.log(`WebhookInbox 1 created: ${webhook1.id}, barbershopId: ${webhook1.barbershopId}`);

  if (webhook1.barbershopId !== barbershopA.id || webhook1.metaConnectionId !== connectionA.id) {
    throw new Error("Webhook tenant resolution failed");
  }

  // Ingest Webhook 2 (Tenant Unmapped / Phone Null Policy)
  const eventKey2 = `message:unmapped_phone_${Date.now()}:wamid.HBgLUNMAPPED_${Date.now()}`;
  const webhook2 = await prisma.webhookInbox.upsert({
    where: {
      provider_eventKey: {
        provider: "meta",
        eventKey: eventKey2,
      },
    },
    create: {
      provider: "meta",
      eventKey: eventKey2,
      eventType: "messages",
      wabaId: null,
      phoneNumberId: "unmapped_phone",
      providerMessageId: "wamid.HBgLUNMAPPED",
      metaConnectionId: null,
      barbershopId: null, // Null tenant policy
      payload: { text: "unmapped" },
      payloadHash: "hash2",
      processingStatus: WebhookProcessingStatus.IGNORED,
      processingError: "UNKNOWN_PHONE_NUMBER_ID",
      signatureVerifiedAt: new Date(),
    },
    update: {},
  });
  console.log(`WebhookInbox 2 (Unmapped) created: ${webhook2.id}, barbershopId: ${webhook2.barbershopId}, status: ${webhook2.processingStatus}`);
  if (webhook2.barbershopId !== null || webhook2.metaConnectionId !== null) {
    throw new Error("Unmapped phone should have null barbershopId and null metaConnectionId");
  }
  if (webhook2.processingStatus !== WebhookProcessingStatus.IGNORED) {
    throw new Error("Unmapped phone should have IGNORED processing status");
  }

  // Idempotency: duplicate upsert should not throw and should retain original record
  const webhook1Duplicate = await prisma.webhookInbox.upsert({
    where: {
      provider_eventKey: {
        provider: "meta",
        eventKey: eventKey1,
      },
    },
    create: {
      provider: "meta",
      eventKey: eventKey1,
      eventType: "messages",
      payload: payload1,
      payloadHash: payloadHash1,
      processingStatus: WebhookProcessingStatus.PENDING,
      signatureVerifiedAt: new Date(),
    },
    update: {},
  });
  if (webhook1Duplicate.id !== webhook1.id) {
    throw new Error("Idempotency failed: duplicate eventKey created different record");
  }
  console.log("-> Idempotency duplicate eventKey verified successfully.");

  // 7. Cleanup
  console.log("\n7. Cleaning up test data...");
  await prisma.webhookInbox.deleteMany({
    where: { id: { in: [webhook1.id, webhook2.id] } },
  });
  await prisma.metaConnectionEvent.deleteMany({
    where: { barbershopId: { in: [barbershopA.id, barbershopB.id] } },
  });
  await prisma.metaConnectionSecret.deleteMany({
    where: { metaConnectionId: connectionA.id },
  });
  await prisma.metaConnection.deleteMany({
    where: { id: connectionA.id },
  });
  await prisma.metaOnboardingSession.deleteMany({
    where: { barbershopId: barbershopA.id },
  });
  await prisma.barbershop.deleteMany({
    where: { id: { in: [barbershopA.id, barbershopB.id] } },
  });
  await prisma.user.delete({
    where: { id: ownerUser.id },
  });

  console.log("==================================================================");
  console.log(" ALL R6.1A REAL POSTGRESQL TESTS PASSED SUCCESSFULLY!");
  console.log("==================================================================");
}

main()
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
