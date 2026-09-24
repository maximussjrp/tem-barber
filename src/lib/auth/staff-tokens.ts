import crypto from "crypto";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { StaffAccessTokenPurpose } from "@prisma/client";

export class StaffTokenError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "StaffTokenError";
    this.code = code;
    this.status = status;
  }
}

export const INVITE_EXPIRATION_HOURS = 48;
export const RESET_EXPIRATION_HOURS = 24;

export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function generateRawToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export interface CreateStaffTokenParams {
  barbershopId: string;
  memberId: string;
  userId: string;
  purpose: StaffAccessTokenPurpose;
  createdByUserId?: string | null;
}

export interface CreatedStaffTokenResult {
  rawToken: string;
  tokenHash: string;
  purpose: StaffAccessTokenPurpose;
  expiresAt: Date;
  activationUrl: string;
}

/**
 * Creates a new staff access token (INVITE or PASSWORD_RESET) and returns the raw unhashed token
 * alongside the activation URL. Only the hash is stored in the database.
 * Atomic under transaction with lock on memberId + purpose.
 */
export async function createStaffAccessToken(
  params: CreateStaffTokenParams
): Promise<CreatedStaffTokenResult> {
  const { barbershopId, memberId, userId, purpose, createdByUserId } = params;

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);

  const durationHours =
    purpose === StaffAccessTokenPurpose.INVITE
      ? INVITE_EXPIRATION_HOURS
      : RESET_EXPIRATION_HOURS;

  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    // 1. Advisory lock serializes token issuance for this member + purpose
    const lockKey = `staff_token_issue:${memberId}:${purpose}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    // 2. Validate membership is active and belongs to this tenant and user
    const member = await tx.barbershopMember.findUnique({
      where: { id: memberId },
      select: { id: true, barbershopId: true, userId: true, isActive: true },
    });

    if (!member) {
      throw new StaffTokenError("Colaborador não encontrado.", "MEMBER_NOT_FOUND", 404);
    }

    if (member.barbershopId !== barbershopId) {
      throw new StaffTokenError("Colaborador não pertence à barbearia especificada.", "TENANT_MISMATCH", 403);
    }

    if (member.userId !== userId) {
      throw new StaffTokenError("Identidade de usuário inconsistente.", "USER_MISMATCH", 400);
    }

    if (!member.isActive) {
      throw new StaffTokenError("Não é possível gerar link de acesso para colaborador inativo.", "MEMBER_INACTIVE", 409);
    }

    // 3. Atomically invalidate previous unused tokens for the same member and purpose
    await tx.staffAccessToken.updateMany({
      where: {
        memberId,
        purpose,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    // 4. Create new token
    await tx.staffAccessToken.create({
      data: {
        barbershopId,
        memberId,
        userId,
        tokenHash,
        purpose,
        expiresAt,
        createdByUserId: createdByUserId ?? null,
      },
    });
  });

  const baseUrl = process.env.NEXTAUTH_URL || "";
  const activationUrl = `${baseUrl}/ativar-acesso?token=${rawToken}`;

  return {
    rawToken,
    tokenHash,
    purpose,
    expiresAt,
    activationUrl,
  };
}

export type ValidateTokenResult =
  | {
      valid: true;
      token: {
        id: string;
        barbershopId: string;
        memberId: string;
        userId: string;
        purpose: StaffAccessTokenPurpose;
        expiresAt: Date;
        member: {
          id: string;
          role: string;
          isActive: boolean;
        };
        user: {
          id: string;
          name: string;
          email: string | null;
          phone: string;
        };
        barbershop: {
          id: string;
          name: string;
          slug: string;
          logoUrl: string | null;
        };
      };
    }
  | {
      valid: false;
      error: "TOKEN_NOT_FOUND" | "TOKEN_ALREADY_USED" | "TOKEN_EXPIRED" | "MEMBER_INACTIVE";
      message: string;
    };

/**
 * Validates a raw token from the query string.
 */
export async function validateStaffAccessToken(
  rawToken: string
): Promise<ValidateTokenResult> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim().length === 0) {
    return {
      valid: false,
      error: "TOKEN_NOT_FOUND",
      message: "Token inválido ou ausente.",
    };
  }

  const tokenHash = hashToken(rawToken.trim());

  const tokenRecord = await prisma.staffAccessToken.findUnique({
    where: { tokenHash },
    include: {
      member: {
        select: { id: true, role: true, isActive: true },
      },
      user: {
        select: { id: true, name: true, email: true, phone: true },
      },
      barbershop: {
        select: { id: true, name: true, slug: true, logoUrl: true },
      },
    },
  });

  if (!tokenRecord) {
    return {
      valid: false,
      error: "TOKEN_NOT_FOUND",
      message: "Link de acesso inválido ou não encontrado.",
    };
  }

  if (tokenRecord.usedAt !== null) {
    return {
      valid: false,
      error: "TOKEN_ALREADY_USED",
      message: "Este link de acesso já foi utilizado.",
    };
  }

  if (tokenRecord.expiresAt < new Date()) {
    return {
      valid: false,
      error: "TOKEN_EXPIRED",
      message: "Este link de acesso expirou. Solicite um novo link ao administrador.",
    };
  }

  if (tokenRecord.member && !tokenRecord.member.isActive) {
    return {
      valid: false,
      error: "MEMBER_INACTIVE",
      message: "O vínculo deste colaborador não está ativo.",
    };
  }

  return {
    valid: true,
    token: tokenRecord,
  };
}

/**
 * Activates an account or resets password using a valid raw token.
 * Single-use atomic consumption under transaction.
 */
export async function consumeStaffAccessToken(
  rawToken: string,
  newPassword: string
): Promise<{ success: true; userId: string; role: string; barbershopSlug: string }> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error("A senha deve ter no mínimo 8 caracteres.");
  }

  if (!rawToken || typeof rawToken !== "string" || rawToken.trim().length === 0) {
    throw new Error("Token inválido ou ausente.");
  }

  const tokenHash = hashToken(rawToken.trim());
  const passwordHash = await bcrypt.hash(newPassword, 10);

  return await prisma.$transaction(async (tx) => {
    // 1. Atomic consumption with count guarantee
    const updated = await tx.staffAccessToken.updateMany({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        usedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      throw new Error("Token inválido, já utilizado ou expirado.");
    }

    // 2. Fetch fresh token record with member
    const currentToken = await tx.staffAccessToken.findUnique({
      where: { tokenHash },
      include: {
        member: {
          select: { id: true, role: true, isActive: true, barbershopId: true, userId: true },
        },
        barbershop: {
          select: { slug: true },
        },
      },
    });

    if (!currentToken || !currentToken.member) {
      throw new Error("Vínculo do colaborador não encontrado.");
    }

    if (!currentToken.member.isActive) {
      throw new Error("Vínculo do colaborador não está ativo. Não é possível alterar a senha.");
    }

    if (
      currentToken.member.barbershopId !== currentToken.barbershopId ||
      currentToken.member.userId !== currentToken.userId
    ) {
      throw new Error("Inconsistência de segurança entre token e vínculo.");
    }

    // 3. Update user password
    await tx.user.update({
      where: { id: currentToken.userId },
      data: { passwordHash },
    });

    return {
      success: true,
      userId: currentToken.userId,
      role: currentToken.member.role,
      barbershopSlug: currentToken.barbershop.slug,
    };
  });
}
