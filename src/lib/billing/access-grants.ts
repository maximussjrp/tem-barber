import crypto from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  BILLING_TIME_ZONE,
  calculateRemainingDays,
  deriveTenantSubscriptionAccess,
  parseAsaasDateOnly,
  SubscriptionInput,
  TenantSubscriptionAccessResult,
} from "@/lib/billing/subscription-access";

export interface AccessGrantRecord {
  id: string;
  barbershopId: string;
  startsAt: Date;
  endsAt: Date;
  daysGranted: number;
  reason: string;
  idempotencyKey: string;
  requestHash: string;
  createdByUserId: string;
  createdByEmail: string | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  revokedByEmail: string | null;
  revocationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AccessGrantInput = Partial<AccessGrantRecord> & {
  barbershopId: string;
  startsAt: Date | string;
  endsAt: Date | string;
  daysGranted: number;
  reason: string;
  idempotencyKey?: string;
  requestHash?: string;
  createdByUserId?: string;
};

export interface ComplimentaryAccessMetadata {
  active: boolean;
  queued: boolean;
  activeGrantId: string | null;
  currentStartsAt: Date | null;
  currentEndsAt: Date | null;
  coverageEndsAt: Date | null;
  nextStartsAt: Date | null;
  latestEndsAt: Date | null;
  grantCount: number;
}

export interface TenantEffectiveAccessResult extends TenantSubscriptionAccessResult {
  isComplimentary: boolean;
  complimentary: ComplimentaryAccessMetadata;
}

export class AccessGrantError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AccessGrantError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function normalizeReason(reason: string): string {
  return reason.trim().replace(/\s+/g, " ");
}

export function computeGrantRequestHash(params: {
  barbershopId: string;
  daysGranted: number;
  normalizedReason: string;
  actorUserId: string;
}): string {
  const canonical = JSON.stringify({
    actorUserId: params.actorUserId,
    barbershopId: params.barbershopId,
    daysGranted: params.daysGranted,
    reason: params.normalizedReason,
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function calculateGrantWindow(params: {
  subscription?: SubscriptionInput | null;
  existingGrants: Array<{ endsAt: Date | string; revokedAt?: Date | string | null }>;
  daysGranted: number;
  now?: Date;
  timeZone?: string;
}): { startsAt: Date; endsAt: Date } {
  const now = params.now ?? new Date();
  const baseAccess = deriveTenantSubscriptionAccess(params.subscription, {
    now,
    timeZone: params.timeZone,
  });

  let anchorMs = now.getTime();

  if (baseAccess.accessAllowed && baseAccess.validUntil && baseAccess.validUntil.getTime() > anchorMs) {
    anchorMs = Math.max(anchorMs, baseAccess.validUntil.getTime());
  }

  for (const grant of params.existingGrants) {
    if (grant.revokedAt) continue;
    const grantEnd = parseAsaasDateOnly(grant.endsAt) || new Date(grant.endsAt);
    if (grantEnd.getTime() > anchorMs) {
      anchorMs = Math.max(anchorMs, grantEnd.getTime());
    }
  }

  const startsAt = new Date(anchorMs);
  const endsAt = new Date(startsAt.getTime() + params.daysGranted * 24 * 60 * 60 * 1000);

  return { startsAt, endsAt };
}

export function deriveTenantEffectiveAccess(
  subscription?: SubscriptionInput | null,
  accessGrants: AccessGrantInput[] = [],
  options?: { now?: Date; timeZone?: string }
): TenantEffectiveAccessResult {
  const now = options?.now ?? new Date();
  const timeZone = options?.timeZone ?? BILLING_TIME_ZONE;

  const baseAccess = deriveTenantSubscriptionAccess(subscription, { now, timeZone });

  // 1. Processar grants não revogados que terminam no futuro ou estão vigentes
  const validGrants = accessGrants
    .filter((g) => !g.revokedAt)
    .map((g) => ({
      ...g,
      startsAtDate: parseAsaasDateOnly(g.startsAt) || new Date(g.startsAt),
      endsAtDate: parseAsaasDateOnly(g.endsAt) || new Date(g.endsAt),
    }))
    .filter((g) => g.endsAtDate.getTime() > now.getTime())
    .sort((a, b) => a.startsAtDate.getTime() - b.startsAtDate.getTime() || a.endsAtDate.getTime() - b.endsAtDate.getTime());

  const activeGrants = validGrants.filter(
    (g) => g.startsAtDate.getTime() <= now.getTime() && g.endsAtDate.getTime() > now.getTime()
  );
  const queuedGrants = validGrants.filter((g) => g.startsAtDate.getTime() > now.getTime());

  const active = activeGrants.length > 0;
  const queued = queuedGrants.length > 0;
  const grantCount = validGrants.length;

  let activeGrantId: string | null = null;
  let currentStartsAt: Date | null = null;
  let currentEndsAt: Date | null = null;
  let coverageEndsAt: Date | null = null;

  if (active) {
    const primaryActive = activeGrants[0];
    activeGrantId = primaryActive.id ?? null;
    currentStartsAt = primaryActive.startsAtDate;
    currentEndsAt = primaryActive.endsAtDate;

    // Calcular cobertura contínua contígua
    let runningEndMs = primaryActive.endsAtDate.getTime();
    for (let i = 1; i < validGrants.length; i++) {
      const nextGrant = validGrants[i];
      if (nextGrant.startsAtDate.getTime() <= runningEndMs) {
        runningEndMs = Math.max(runningEndMs, nextGrant.endsAtDate.getTime());
      } else {
        // Gap encontrado: não atravessar gap
        break;
      }
    }
    coverageEndsAt = new Date(runningEndMs);
  }

  const nextStartsAt = queuedGrants.length > 0 ? queuedGrants[0].startsAtDate : null;
  const latestEndsAt =
    validGrants.length > 0
      ? new Date(Math.max(...validGrants.map((g) => g.endsAtDate.getTime())))
      : null;

  const complimentary: ComplimentaryAccessMetadata = {
    active,
    queued,
    activeGrantId,
    currentStartsAt,
    currentEndsAt,
    coverageEndsAt,
    nextStartsAt,
    latestEndsAt,
    grantCount,
  };

  // REGRA DE OURO:
  // Se baseAccess.accessAllowed === true, manter status financeiro base intacto.
  // Cortesia permanece apenas como metadata agregada.
  if (baseAccess.accessAllowed) {
    return {
      ...baseAccess,
      isComplimentary: false,
      complimentary,
    };
  }

  // Se baseAccess.accessAllowed === false, avaliar se há grant ativo
  if (active && coverageEndsAt) {
    const remainingDays = calculateRemainingDays(coverageEndsAt, now, timeZone);
    let remainingLabel = "";
    if (remainingDays === 0) {
      remainingLabel = "Cortesia termina hoje";
    } else if (remainingDays === 1) {
      remainingLabel = "Restam 1 dia de cortesia";
    } else {
      remainingLabel = `Restam ${remainingDays} dias de cortesia`;
    }

    return {
      ...baseAccess,
      effectiveStatus: "COMPLIMENTARY",
      accessAllowed: true,
      accessType: "COMPLIMENTARY",
      validUntil: coverageEndsAt,
      remainingDays,
      remainingLabel,
      isComplimentary: true,
      complimentary,
    };
  }

  // Sem acesso liberado
  return {
    ...baseAccess,
    isComplimentary: false,
    complimentary,
  };
}

export async function createTenantAccessGrantInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    barbershopId: string;
    daysGranted: number;
    reason: string;
    idempotencyKey: string;
    actorUserId: string;
    actorEmail?: string | null;
    now?: Date;
  }
): Promise<{ grant: AccessGrantRecord; alreadyExisted: boolean }> {
  const now = params.now ?? new Date();

  // Validações
  if (
    !Number.isInteger(params.daysGranted) ||
    params.daysGranted < 1 ||
    params.daysGranted > 3650
  ) {
    throw new AccessGrantError(
      "ACCESS_GRANT_INVALID_DAYS",
      "O número de dias concedidos deve ser um inteiro entre 1 e 3650.",
      400
    );
  }

  const normalizedReason = normalizeReason(params.reason || "");
  if (!normalizedReason || normalizedReason.length > 500) {
    throw new AccessGrantError(
      "ACCESS_GRANT_REASON_REQUIRED",
      "O motivo da concessão é obrigatório (máximo 500 caracteres).",
      400
    );
  }

  const idempotencyKey = (params.idempotencyKey || "").trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw new AccessGrantError(
      "ACCESS_GRANT_IDEMPOTENCY_KEY_REQUIRED",
      "A chave de idempotência é obrigatória (máximo 128 caracteres).",
      400
    );
  }

  // Advisory lock tenant-scoped
  const lockKey = `tenant-access-grant:${params.barbershopId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  // Checar barbershop
  const barbershop = await tx.barbershop.findUnique({
    where: { id: params.barbershopId },
    select: { id: true },
  });
  if (!barbershop) {
    throw new AccessGrantError("BARBERSHOP_NOT_FOUND", "Barbearia não encontrada.", 404);
  }

  // Checar TenantSubscription existente
  const subscription = await tx.tenantSubscription.findUnique({
    where: { barbershopId: params.barbershopId },
  });
  if (!subscription) {
    throw new AccessGrantError(
      "SUBSCRIPTION_NOT_INITIALIZED",
      "Não é possível conceder cortesia para barbearia sem assinatura inicializada.",
      409
    );
  }

  const requestHash = computeGrantRequestHash({
    barbershopId: params.barbershopId,
    daysGranted: params.daysGranted,
    normalizedReason,
    actorUserId: params.actorUserId,
  });

  // Idempotência
  const existing = await tx.tenantAccessGrant.findUnique({
    where: {
      barbershopId_idempotencyKey: {
        barbershopId: params.barbershopId,
        idempotencyKey,
      },
    },
  });

  if (existing) {
    if (existing.requestHash === requestHash) {
      return { grant: existing as AccessGrantRecord, alreadyExisted: true };
    }
    throw new AccessGrantError(
      "ACCESS_GRANT_IDEMPOTENCY_CONFLICT",
      "Chave de idempotência já utilizada com parâmetros diferentes.",
      409
    );
  }

  // Buscar grants existentes vigentes/futuros para stacking
  const existingGrants = await tx.tenantAccessGrant.findMany({
    where: {
      barbershopId: params.barbershopId,
      revokedAt: null,
      endsAt: { gt: now },
    },
    select: { endsAt: true, revokedAt: true },
    orderBy: { endsAt: "asc" },
  });

  const { startsAt, endsAt } = calculateGrantWindow({
    subscription,
    existingGrants,
    daysGranted: params.daysGranted,
    now,
  });

  const created = await tx.tenantAccessGrant.create({
    data: {
      barbershopId: params.barbershopId,
      startsAt,
      endsAt,
      daysGranted: params.daysGranted,
      reason: normalizedReason,
      idempotencyKey,
      requestHash,
      createdByUserId: params.actorUserId,
      createdByEmail: params.actorEmail ?? null,
    },
  });

  return { grant: created as AccessGrantRecord, alreadyExisted: false };
}

export async function createTenantAccessGrant(params: {
  barbershopId: string;
  daysGranted: number;
  reason: string;
  idempotencyKey: string;
  actorUserId: string;
  actorEmail?: string | null;
  now?: Date;
}): Promise<{ grant: AccessGrantRecord; alreadyExisted: boolean }> {
  return prisma.$transaction(async (tx) => {
    return createTenantAccessGrantInTransaction(tx, params);
  });
}

export async function revokeTenantAccessGrantInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    grantId: string;
    reason: string;
    actorUserId: string;
    actorEmail?: string | null;
    now?: Date;
  }
): Promise<{ grant: AccessGrantRecord; alreadyRevoked: boolean }> {
  const initialGrant = await tx.tenantAccessGrant.findUnique({
    where: { id: params.grantId },
  });

  if (!initialGrant) {
    throw new AccessGrantError("ACCESS_GRANT_NOT_FOUND", "Acesso cortesia não encontrado.", 404);
  }

  // Advisory lock no tenant do grant (leitura inicial para descoberta do lock)
  const lockKey = `tenant-access-grant:${initialGrant.barbershopId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  // Releitura obrigatória pós-lock para garantir snapshot atualizado
  const freshGrant = await tx.tenantAccessGrant.findUnique({
    where: { id: params.grantId },
  });

  if (!freshGrant) {
    throw new AccessGrantError("ACCESS_GRANT_NOT_FOUND", "Acesso cortesia não encontrado.", 404);
  }

  // Se já revogado: replay seguro sem sobrescrever auditoria original
  if (freshGrant.revokedAt) {
    return { grant: freshGrant as AccessGrantRecord, alreadyRevoked: true };
  }

  // Timestamp de expiração calculado DEPOIS do lock e da releitura (se não fornecido explicitamente)
  const effectiveNow = params.now ?? new Date();

  // Se grant já encerrou naturalmente e não estava revogado: erro 409
  if (freshGrant.endsAt.getTime() <= effectiveNow.getTime()) {
    throw new AccessGrantError(
      "ACCESS_GRANT_ALREADY_ENDED",
      "Não é possível revogar uma cortesia cujo período já foi encerrado.",
      409
    );
  }

  const revocationReason = normalizeReason(params.reason || "");
  if (!revocationReason) {
    throw new AccessGrantError(
      "ACCESS_GRANT_REASON_REQUIRED",
      "O motivo da revogação é obrigatório.",
      400
    );
  }

  const updated = await tx.tenantAccessGrant.update({
    where: { id: freshGrant.id },
    data: {
      revokedAt: effectiveNow,
      revokedByUserId: params.actorUserId,
      revokedByEmail: params.actorEmail ?? null,
      revocationReason,
    },
  });

  return { grant: updated as AccessGrantRecord, alreadyRevoked: false };
}

export async function revokeTenantAccessGrant(params: {
  grantId: string;
  reason: string;
  actorUserId: string;
  actorEmail?: string | null;
  now?: Date;
}): Promise<{ grant: AccessGrantRecord; alreadyRevoked: boolean }> {
  return prisma.$transaction(async (tx) => {
    return revokeTenantAccessGrantInTransaction(tx, params);
  });
}
