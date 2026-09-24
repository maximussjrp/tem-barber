import { URL } from "url";
import crypto from "crypto";

const DEFAULT_TEST_DATABASE_URL =
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;

const rawDbUrl = process.env.DATABASE_URL || "";
try {
  const parsedDbUrl = new URL(rawDbUrl.replace("postgresql://", "http://"));
  const allowedHosts = ["localhost", "127.0.0.1"];
  if (
    !allowedHosts.includes(parsedDbUrl.hostname) ||
    parsedDbUrl.port !== "55439" ||
    !parsedDbUrl.pathname.includes("match_barber_test")
  ) {
    console.error("❌ ERRO DE SEGURANÇA: O script só pode rodar em localhost:55439/match_barber_test!");
    process.exit(1);
  }
} catch (e) {
  console.error("❌ Erro ao validar DATABASE_URL:", e);
  process.exit(1);
}

async function runTenantAccessGrantsRealPgTests() {
  const { default: prisma } = await import("../src/lib/prisma");
  const {
    createTenantAccessGrant,
    revokeTenantAccessGrant,
  } = await import("../src/lib/billing/access-grants");
  const { createTrialSubscription } = await import("../src/lib/subscription-utils");

  console.log("=== INICIANDO SUITE REAL-PG TENANT ACCESS GRANTS (ETAPA 2) ===");

  const timestamp = Date.now();

  // 1. Validar constraints no pg_constraint
  console.log("-> 1. Verificando Check Constraints no PostgreSQL...");
  const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'tenant_access_grants'::regclass
      AND contype = 'c';
  `;
  const constraintNames = constraints.map((c) => c.conname);
  console.log("Constraints encontradas:", constraintNames);

  const hasDaysCheck = constraintNames.includes("tenant_access_grants_days_granted_check");
  const hasWindowCheck = constraintNames.includes("tenant_access_grants_window_check");
  const hasReasonCheck = constraintNames.includes("tenant_access_grants_reason_not_blank_check");

  if (!hasDaysCheck || !hasWindowCheck || !hasReasonCheck) {
    throw new Error(
      `❌ Constraints ausentes no banco real: days=${hasDaysCheck}, window=${hasWindowCheck}, reason=${hasReasonCheck}`
    );
  }
  console.log("✔ Constraints de integridade confirmadas no PostgreSQL!");

  // Fixtures: Garantir plano e criar Tenant A e Tenant B com assinaturas
  await prisma.plan.upsert({
    where: { code: "pro_monthly" },
    update: { name: "Plano Tem Barber", price: "49.90", period: "MONTHLY", maxMembers: 20, isActive: true },
    create: { code: "pro_monthly", name: "Plano Tem Barber", price: "49.90", period: "MONTHLY", maxMembers: 20, isActive: true },
  });

  const barbershopA = await prisma.barbershop.create({
    data: {
      name: `Barbearia Grants A ${timestamp}`,
      slug: `barbearia-grants-a-${timestamp}`,
      phone: `119888${timestamp.toString().slice(-5)}`,
      street: "Rua A",
      number: "100",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zipCode: "01310-100",
    },
  });

  const barbershopB = await prisma.barbershop.create({
    data: {
      name: `Barbearia Grants B ${timestamp}`,
      slug: `barbearia-grants-b-${timestamp}`,
      phone: `119777${timestamp.toString().slice(-5)}`,
      street: "Rua B",
      number: "200",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zipCode: "01310-200",
    },
  });

  await createTrialSubscription(barbershopA.id, "owner-a@test.com");
  await createTrialSubscription(barbershopB.id, "owner-b@test.com");

  // Capturar snapshot financeiro inicial de TenantSubscription
  const subBefore = await prisma.tenantSubscription.findUniqueOrThrow({
    where: { barbershopId: barbershopA.id },
  });
  const financialSnapshotBefore = {
    status: subBefore.status,
    planId: subBefore.planId,
    planName: subBefore.planName,
    monthlyPrice: subBefore.monthlyPrice?.toString(),
    trialEndsAt: subBefore.trialEndsAt?.toISOString(),
    currentPeriodStart: subBefore.currentPeriodStart?.toISOString(),
    currentPeriodEnd: subBefore.currentPeriodEnd?.toISOString(),
    gracePeriodEndsAt: subBefore.gracePeriodEndsAt?.toISOString(),
    paymentMethod: subBefore.paymentMethod,
    lastPaymentAt: subBefore.lastPaymentAt?.toISOString(),
    lastAccessPaymentId: subBefore.lastAccessPaymentId,
  };

  // 2. Testar que o banco rejeita violações de check constraints
  console.log("-> 2. Testando rejeição de CHECK constraints no banco real...");
  const actorId = "user-test-real-pg";

  // days_granted = 0
  try {
    await prisma.$executeRaw`
      INSERT INTO tenant_access_grants (id, barbershop_id, starts_at, ends_at, days_granted, reason, idempotency_key, request_hash, created_by_user_id, updated_at)
      VALUES (${crypto.randomUUID()}, ${barbershopA.id}, NOW(), NOW() + interval '1 day', 0, 'Teste', ${crypto.randomUUID()}, 'hash', ${actorId}, NOW())
    `;
    throw new Error("Deveria ter falhado com days_granted = 0");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("tenant_access_grants_days_granted_check") && !msg.includes("check constraint")) {
      throw err;
    }
    console.log("✔ Rejeitou days_granted = 0 com constraint violation!");
  }

  // days_granted = 3651
  try {
    await prisma.$executeRaw`
      INSERT INTO tenant_access_grants (id, barbershop_id, starts_at, ends_at, days_granted, reason, idempotency_key, request_hash, created_by_user_id, updated_at)
      VALUES (${crypto.randomUUID()}, ${barbershopA.id}, NOW(), NOW() + interval '3651 day', 3651, 'Teste', ${crypto.randomUUID()}, 'hash', ${actorId}, NOW())
    `;
    throw new Error("Deveria ter falhado com days_granted = 3651");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("tenant_access_grants_days_granted_check") && !msg.includes("check constraint")) {
      throw err;
    }
    console.log("✔ Rejeitou days_granted = 3651 com constraint violation!");
  }

  // ends_at <= starts_at
  try {
    await prisma.$executeRaw`
      INSERT INTO tenant_access_grants (id, barbershop_id, starts_at, ends_at, days_granted, reason, idempotency_key, request_hash, created_by_user_id, updated_at)
      VALUES (${crypto.randomUUID()}, ${barbershopA.id}, NOW(), NOW() - interval '1 hour', 1, 'Teste', ${crypto.randomUUID()}, 'hash', ${actorId}, NOW())
    `;
    throw new Error("Deveria ter falhado com ends_at <= starts_at");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("tenant_access_grants_window_check") && !msg.includes("check constraint")) {
      throw err;
    }
    console.log("✔ Rejeitou ends_at <= starts_at com constraint violation!");
  }

  // reason = '   '
  try {
    await prisma.$executeRaw`
      INSERT INTO tenant_access_grants (id, barbershop_id, starts_at, ends_at, days_granted, reason, idempotency_key, request_hash, created_by_user_id, updated_at)
      VALUES (${crypto.randomUUID()}, ${barbershopA.id}, NOW(), NOW() + interval '1 day', 1, '   ', ${crypto.randomUUID()}, 'hash', ${actorId}, NOW())
    `;
    throw new Error("Deveria ter falhado com reason em branco");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("tenant_access_grants_reason_not_blank_check") && !msg.includes("check constraint")) {
      throw err;
    }
    console.log("✔ Rejeitou reason em branco com constraint violation!");
  }

  // 3. Same-key concorrente
  console.log("-> 3. Testando concorrência same-key...");
  const sameKey = `same-key-${timestamp}`;
  const [res1, res2] = await Promise.all([
    createTenantAccessGrant({
      barbershopId: barbershopA.id,
      daysGranted: 15,
      reason: "Cortesia de teste concorrente",
      idempotencyKey: sameKey,
      actorUserId: actorId,
    }),
    createTenantAccessGrant({
      barbershopId: barbershopA.id,
      daysGranted: 15,
      reason: "Cortesia de teste concorrente",
      idempotencyKey: sameKey,
      actorUserId: actorId,
    }),
  ]);

  const countSameKey = await prisma.tenantAccessGrant.count({
    where: { barbershopId: barbershopA.id, idempotencyKey: sameKey },
  });
  if (countSameKey !== 1) {
    throw new Error(`❌ Esperado ROW_COUNT=1, obtido: ${countSameKey}`);
  }
  const alreadyExistedFlags = [res1.alreadyExisted, res2.alreadyExisted];
  if (!alreadyExistedFlags.includes(false) || !alreadyExistedFlags.includes(true)) {
    throw new Error(`❌ Esperado um false e um true em alreadyExisted, obtido: ${JSON.stringify(alreadyExistedFlags)}`);
  }
  console.log("✔ Concorrência same-key validada: ROW_COUNT=1, replay consistente!");
  console.log("✔ SAME_KEY_CONCURRENCY=PASS");

  // 4. Different-key mesmo tenant (Sem sobreposição / empilhamento)
  console.log("-> 4. Testando concorrência different-key no mesmo tenant...");
  const keyX = `diff-key-x-${timestamp}`;
  const keyY = `diff-key-y-${timestamp}`;

  const [resX, resY] = await Promise.all([
    createTenantAccessGrant({
      barbershopId: barbershopA.id,
      daysGranted: 10,
      reason: "Grant X 10 dias",
      idempotencyKey: keyX,
      actorUserId: actorId,
    }),
    createTenantAccessGrant({
      barbershopId: barbershopA.id,
      daysGranted: 20,
      reason: "Grant Y 20 dias",
      idempotencyKey: keyY,
      actorUserId: actorId,
    }),
  ]);

  const grantX = await prisma.tenantAccessGrant.findUniqueOrThrow({ where: { id: resX.grant.id } });
  const grantY = await prisma.tenantAccessGrant.findUniqueOrThrow({ where: { id: resY.grant.id } });

  const firstGrant = grantX.startsAt.getTime() < grantY.startsAt.getTime() ? grantX : grantY;
  const secondGrant = firstGrant.id === grantX.id ? grantY : grantX;

  if (secondGrant.startsAt.getTime() < firstGrant.endsAt.getTime()) {
    throw new Error(
      `❌ Sobreposição detectada! first.endsAt=${firstGrant.endsAt.toISOString()}, second.startsAt=${secondGrant.startsAt.toISOString()}`
    );
  }
  console.log("✔ Concorrência different-key validada: ROW_COUNT=2, sem sobreposição (segundo começa após fim do primeiro)!");
  console.log("✔ DIFFERENT_KEY_NO_OVERLAP=PASS");

  // 5. Tenant isolation
  console.log("-> 5. Testando isolamento entre tenants A e B...");
  const keyTenantB = `tenant-b-grant-${timestamp}`;
  const resTenantB = await createTenantAccessGrant({
    barbershopId: barbershopB.id,
    daysGranted: 30,
    reason: "Grant exclusivo do Tenant B",
    idempotencyKey: keyTenantB,
    actorUserId: actorId,
  });

  const grantsA = await prisma.tenantAccessGrant.findMany({ where: { barbershopId: barbershopA.id } });
  const grantsB = await prisma.tenantAccessGrant.findMany({ where: { barbershopId: barbershopB.id } });

  if (grantsA.some((g) => g.barbershopId === barbershopB.id) || grantsB.some((g) => g.barbershopId === barbershopA.id)) {
    throw new Error("❌ Vazamento de grants entre tenants!");
  }
  if (!grantsB.some((g) => g.id === resTenantB.grant.id)) {
    throw new Error("❌ Grant de Tenant B não localizado!");
  }
  console.log("✔ Isolamento entre tenants confirmado: nenhum leak de dados!");
  console.log("✔ TENANT_ISOLATION=PASS");

  // 6. Sequential Revocation and Replay
  console.log("-> 6. Testando revogação sequencial e replay no banco real...");
  const revokeRes = await revokeTenantAccessGrant({
    grantId: resX.grant.id,
    reason: "Revogado comercialmente",
    actorUserId: actorId,
  });
  if (revokeRes.alreadyRevoked) {
    throw new Error("❌ Esperado alreadyRevoked=false na primeira revogação");
  }

  const grantXAfterRevoke = await prisma.tenantAccessGrant.findUniqueOrThrow({
    where: { id: resX.grant.id },
  });
  if (!grantXAfterRevoke.revokedAt || grantXAfterRevoke.revocationReason !== "Revogado comercialmente") {
    throw new Error("❌ Auditoria de revogação não gravada corretamente!");
  }

  // Tenant B continua intacto
  const grantBAfterRevoke = await prisma.tenantAccessGrant.findUniqueOrThrow({
    where: { id: resTenantB.grant.id },
  });
  if (grantBAfterRevoke.revokedAt) {
    throw new Error("❌ Grant de Tenant B foi indevidamente revogado!");
  }

  // Replay de revogação sequencial
  const replayRevokeRes = await revokeTenantAccessGrant({
    grantId: resX.grant.id,
    reason: "Outro motivo qualquer",
    actorUserId: actorId,
  });
  if (!replayRevokeRes.alreadyRevoked) {
    throw new Error("❌ Esperado alreadyRevoked=true no replay de revogação");
  }
  const grantXReplay = await prisma.tenantAccessGrant.findUniqueOrThrow({
    where: { id: resX.grant.id },
  });
  if (grantXReplay.revocationReason !== "Revogado comercialmente") {
    throw new Error("❌ Replay de revogação sobrescreveu auditoria original!");
  }
  console.log("✔ Revogação e replay no banco real validados com sucesso!");
  console.log("✔ SEQUENTIAL_REVOKE_REPLAY=PASS");

  // 7. Concurrent Revocation
  console.log("-> 7. Testando concorrência de revogação simultânea (CONCURRENT_REVOKE)...");
  const concurrentGrantKey = `concurrent-revoke-grant-${timestamp}`;
  const concurrentGrantRes = await createTenantAccessGrant({
    barbershopId: barbershopA.id,
    daysGranted: 15,
    reason: "Grant vigente exclusivo para teste concorrente de revogação",
    idempotencyKey: concurrentGrantKey,
    actorUserId: actorId,
  });

  const concurrentGrantId = concurrentGrantRes.grant.id;

  const actorA = "actor-concurrent-a";
  const emailA = "actor-a@test.com";
  const reasonA = "Motivo concorrente A";

  const actorB = "actor-concurrent-b";
  const emailB = "actor-b@test.com";
  const reasonB = "Motivo concorrente B";

  const [resA, resB] = await Promise.all([
    revokeTenantAccessGrant({
      grantId: concurrentGrantId,
      reason: reasonA,
      actorUserId: actorA,
      actorEmail: emailA,
    }),
    revokeTenantAccessGrant({
      grantId: concurrentGrantId,
      reason: reasonB,
      actorUserId: actorB,
      actorEmail: emailB,
    }),
  ]);

  const winnersCount = (resA.alreadyRevoked === false ? 1 : 0) + (resB.alreadyRevoked === false ? 1 : 0);
  const replaysCount = (resA.alreadyRevoked === true ? 1 : 0) + (resB.alreadyRevoked === true ? 1 : 0);

  if (winnersCount !== 1 || replaysCount !== 1) {
    throw new Error(
      `❌ Concorrência de revogação falhou! winners=${winnersCount}, replays=${replaysCount} (resA.alreadyRevoked=${resA.alreadyRevoked}, resB.alreadyRevoked=${resB.alreadyRevoked})`
    );
  }

  console.log("✔ CONCURRENT_REVOKE_WINNERS=1");
  console.log("✔ CONCURRENT_REVOKE_REPLAYS=1");

  // Identificar vencedor e perdedor dinamicamente
  const winner = resA.alreadyRevoked === false
    ? { res: resA, actor: actorA, email: emailA, reason: reasonA }
    : { res: resB, actor: actorB, email: emailB, reason: reasonB };

  const loser = resA.alreadyRevoked === true
    ? { res: resA, actor: actorA, email: emailA, reason: reasonA }
    : { res: resB, actor: actorB, email: emailB, reason: reasonB };

  // Consultar banco novamente
  const finalGrantRow = await prisma.tenantAccessGrant.findUniqueOrThrow({
    where: { id: concurrentGrantId },
  });

  if (!finalGrantRow.revokedAt) {
    throw new Error("❌ finalGrantRow.revokedAt está nulo após revogação!");
  }

  if (
    finalGrantRow.revocationReason !== winner.reason ||
    finalGrantRow.revokedByUserId !== winner.actor ||
    finalGrantRow.revokedByEmail !== winner.email
  ) {
    throw new Error(
      `❌ Auditoria final não corresponde ao vencedor! Esperado actor=${winner.actor}, reason=${winner.reason}, obtido actor=${finalGrantRow.revokedByUserId}, reason=${finalGrantRow.revocationReason}`
    );
  }

  if (
    finalGrantRow.revocationReason === loser.reason ||
    finalGrantRow.revokedByUserId === loser.actor ||
    finalGrantRow.revokedByEmail === loser.email
  ) {
    throw new Error("❌ Auditoria do perdedor sobrescreveu o vencedor!");
  }
  console.log("✔ LOSER_OVERWROTE_AUDIT=NO");

  if (
    !winner.res.grant.revokedAt ||
    finalGrantRow.revokedAt.getTime() !== winner.res.grant.revokedAt.getTime()
  ) {
    throw new Error(
      `❌ Timestamp de revogação divergente! final=${finalGrantRow.revokedAt.toISOString()}, winner=${winner.res.grant.revokedAt?.toISOString()}`
    );
  }
  console.log("✔ REVOCATION_TIMESTAMP_PRESERVED=YES");
  console.log("✔ CONCURRENT_REVOKE=PASS");

  // 8. Financial Snapshot Immutability
  console.log("-> 8. Verificando imutabilidade dos campos financeiros de TenantSubscription...");
  const subAfter = await prisma.tenantSubscription.findUniqueOrThrow({
    where: { barbershopId: barbershopA.id },
  });
  const financialSnapshotAfter = {
    status: subAfter.status,
    planId: subAfter.planId,
    planName: subAfter.planName,
    monthlyPrice: subAfter.monthlyPrice?.toString(),
    trialEndsAt: subAfter.trialEndsAt?.toISOString(),
    currentPeriodStart: subAfter.currentPeriodStart?.toISOString(),
    currentPeriodEnd: subAfter.currentPeriodEnd?.toISOString(),
    gracePeriodEndsAt: subAfter.gracePeriodEndsAt?.toISOString(),
    paymentMethod: subAfter.paymentMethod,
    lastPaymentAt: subAfter.lastPaymentAt?.toISOString(),
    lastAccessPaymentId: subAfter.lastAccessPaymentId,
  };

  const beforeStr = JSON.stringify(financialSnapshotBefore);
  const afterStr = JSON.stringify(financialSnapshotAfter);

  if (beforeStr !== afterStr) {
    throw new Error(`❌ TenantSubscription foi alterado! Antes: ${beforeStr}, Depois: ${afterStr}`);
  }
  console.log("✔ TENANT_SUBSCRIPTION_FINANCIAL_SNAPSHOT=UNCHANGED");
  console.log("✔ FINANCIAL_SNAPSHOT=PASS");
  console.log("✔ REAL_PG=PASS");

  console.log("=== TODAS AS PROVAS REAL-PG DA ETAPA 2 PASSARAM COM SUCESSO! ===");
}

runTenantAccessGrantsRealPgTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Falha na suite Real PG:", err);
    process.exit(1);
  });
