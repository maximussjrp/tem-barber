import crypto from "crypto";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { StaffAccessTokenPurpose } from "@prisma/client";

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
 */
export async function createStaffAccessToken(
  params: CreateStaffTokenParams
): Promise<CreatedStaffTokenResult> {
  const { barbershopId, userId, purpose, createdByUserId } = params;

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);

  const durationHours =
    purpose === StaffAccessTokenPurpose.INVITE
      ? INVITE_EXPIRATION_HOURS
      : RESET_EXPIRATION_HOURS;

  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

  // Invalidate previous unused tokens for the same user and purpose
  await prisma.staffAccessToken.updateMany({
    where: {
      userId,
      purpose,
      usedAt: null,
    },
    data: {
      usedAt: new Date(),
    },
  });

  await prisma.staffAccessToken.create({
    data: {
      barbershopId,
      userId,
      tokenHash,
      purpose,
      expiresAt,
      createdByUserId: createdByUserId ?? null,
    },
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
        userId: string;
        purpose: StaffAccessTokenPurpose;
        expiresAt: Date;
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
      error: "TOKEN_NOT_FOUND" | "TOKEN_ALREADY_USED" | "TOKEN_EXPIRED";
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

  return {
    valid: true,
    token: tokenRecord,
  };
}

/**
 * Activates an account or resets password using a valid raw token.
 */
export async function consumeStaffAccessToken(
  rawToken: string,
  newPassword: string
): Promise<{ success: true; userId: string; role: string; barbershopSlug: string }> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error("A senha deve ter no mínimo 8 caracteres.");
  }

  const validation = await validateStaffAccessToken(rawToken);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const { token } = validation;
  const passwordHash = await bcrypt.hash(newPassword, 10);

  return await prisma.$transaction(async (tx) => {
    // Re-verify inside transaction to prevent race conditions
    const currentToken = await tx.staffAccessToken.findUnique({
      where: { id: token.id },
    });

    if (!currentToken || currentToken.usedAt !== null || currentToken.expiresAt < new Date()) {
      throw new Error("Token não é mais válido.");
    }

    // Mark token as used
    await tx.staffAccessToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    // Update user password
    await tx.user.update({
      where: { id: token.userId },
      data: { passwordHash },
    });

    // Find member to determine role and redirect
    const member = await tx.barbershopMember.findUnique({
      where: {
        barbershopId_userId: {
          barbershopId: token.barbershopId,
          userId: token.userId,
        },
      },
    });

    return {
      success: true,
      userId: token.userId,
      role: member?.role ?? "BARBER",
      barbershopSlug: token.barbershop.slug,
    };
  });
}
