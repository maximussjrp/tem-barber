/**
 * Meta WhatsApp Provider Orchestrator
 * Phase R6.1B - Coexistence Provider Onboarding Orchestrator
 */

import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getMetaConfig, MetaWabaSystemUserTask } from "../config";
import { hashOnboardingNonce } from "../crypto";
import { MetaApiError, redactSensitiveString } from "../errors";
import {
  exchangeEmbeddedSignupCode,
  debugOAuthToken,
  discoverSharedWabas,
  discoverWabaPhoneNumbers,
  assignSystemUserToWaba,
  subscribeAppToWaba,
  DiscoveredWaba,
  DiscoveredPhoneNumber,
} from "./adapters";

export const COEXISTENCE_REGISTER_POLICY = "LIVE_REVALIDATION_REQUIRED";

export interface CompleteCoexistenceOnboardingParams {
  barbershopId: string;
  userId: string;
  sessionId: string;
  nonce: string;
  code: string;
  wabaIdHint?: string;
  phoneNumberIdHint?: string;
  completionMetadata?: Record<string, unknown>;
}

export interface CompleteCoexistenceOnboardingResult {
  success: boolean;
  connectionId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName?: string | null;
  status: "CONNECTED";
  connectionMode: "COEXISTENCE";
}

/**
 * Orchestrates complete Coexistence onboarding with server-side authority,
 * anti-replay session consumption, step reconciliation, and zero /register calls.
 */
export async function completeCoexistenceOnboarding(
  params: CompleteCoexistenceOnboardingParams
): Promise<CompleteCoexistenceOnboardingResult> {
  const {
    barbershopId,
    userId,
    sessionId,
    nonce,
    code,
    wabaIdHint,
    phoneNumberIdHint,
    completionMetadata,
  } = params;

  const config = getMetaConfig();
  if (
    !config.appId ||
    !config.appSecret ||
    !config.businessId ||
    !config.systemUserId ||
    !config.systemUserAccessToken ||
    !config.graphApiVersion ||
    !config.wabaSystemUserTask
  ) {
    throw new MetaApiError("Configuração da Meta Cloud API incompleta no servidor.", {
      isTransient: false,
    });
  }

  // 1. Transactional Session Validation & Single-Use Anti-Replay Consumption
  const nonceHash = hashOnboardingNonce(nonce);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const session = await tx.metaOnboardingSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new MetaApiError("Sessão de onboarding não encontrada.", {
        httpStatus: 404,
        isTransient: false,
      });
    }

    if (session.barbershopId !== barbershopId) {
      throw new MetaApiError("Sessão não pertence a esta barbearia.", {
        httpStatus: 403,
        isTransient: false,
      });
    }

    if (session.createdByUserId !== userId) {
      throw new MetaApiError("Sessão foi criada por outro usuário.", {
        httpStatus: 403,
        isTransient: false,
      });
    }

    if (session.status !== "INITIATED" || session.consumedAt !== null) {
      throw new MetaApiError("Sessão já utilizada ou inválida (anti-replay).", {
        httpStatus: 409,
        isTransient: false,
      });
    }

    if (session.expiresAt < now) {
      await tx.metaOnboardingSession.update({
        where: { id: sessionId },
        data: { status: "EXPIRED" },
      });
      throw new MetaApiError("Sessão de onboarding expirou.", {
        httpStatus: 400,
        isTransient: false,
      });
    }

    if (session.nonceHash !== nonceHash) {
      throw new MetaApiError("Nonce inválido.", {
        httpStatus: 403,
        isTransient: false,
      });
    }

    // Mark CONSUMED atomically before any external provider calls
    await tx.metaOnboardingSession.update({
      where: { id: sessionId },
      data: {
        status: "CONSUMED",
        consumedAt: now,
      },
    });
  });

  let currentStage = "CODE_EXCHANGE";
  try {
    // 2. Exchange transient authorization code for temporary OAuth token
    currentStage = "CODE_EXCHANGE";
    const tokenResult = await exchangeEmbeddedSignupCode(code);

    // 3. Debug OAuth Token & Verify App Authority and Scopes
    currentStage = "TOKEN_DEBUG_VALIDATION";
    await debugOAuthToken(tokenResult.accessToken, wabaIdHint);

    // 4. Server-Side Shared WABA Discovery (Server Authority with Pagination)
    currentStage = "WABA_DISCOVERY";
    const discoveredWabas = await discoverSharedWabas(
      config.businessId,
      wabaIdHint
    );

    let selectedWaba: DiscoveredWaba;
    if (wabaIdHint && wabaIdHint.trim() !== "") {
      const trimmedHint = wabaIdHint.trim();
      const match = discoveredWabas.find((w) => w.id === trimmedHint);
      if (!match) {
        throw new MetaApiError(
          `WABA fornecida (${trimmedHint}) não encontrada nas contas compartilhadas do servidor.`,
          { httpStatus: 400, isTransient: false }
        );
      }
      selectedWaba = match;
    } else {
      if (discoveredWabas.length === 1) {
        selectedWaba = discoveredWabas[0];
      } else if (discoveredWabas.length === 0) {
        throw new MetaApiError(
          "Nenhuma conta de WhatsApp Business (WABA) compartilhada foi encontrada.",
          { httpStatus: 400, isTransient: false }
        );
      } else {
        throw new MetaApiError(
          "Múltiplas contas WABA encontradas sem identificador de seleção inequívoco.",
          { httpStatus: 400, isTransient: false }
        );
      }
    }

    // 5. Server-Side Phone Number Discovery (Server Authority with Pagination)
    currentStage = "PHONE_DISCOVERY";
    const discoveredPhones = await discoverWabaPhoneNumbers(
      selectedWaba.id,
      phoneNumberIdHint
    );

    let selectedPhone: DiscoveredPhoneNumber;
    if (phoneNumberIdHint && phoneNumberIdHint.trim() !== "") {
      const trimmedPhoneHint = phoneNumberIdHint.trim();
      const match = discoveredPhones.find((p) => p.id === trimmedPhoneHint);
      if (!match) {
        throw new MetaApiError(
          `Telefone fornecido (${trimmedPhoneHint}) não pertence à conta WABA selecionada (${selectedWaba.id}).`,
          { httpStatus: 400, isTransient: false }
        );
      }
      selectedPhone = match;
    } else {
      if (discoveredPhones.length === 1) {
        selectedPhone = discoveredPhones[0];
      } else if (discoveredPhones.length === 0) {
        throw new MetaApiError(
          `Nenhum número de telefone encontrado na WABA ${selectedWaba.id}.`,
          { httpStatus: 400, isTransient: false }
        );
      } else {
        throw new MetaApiError(
          "Múltiplos números de telefone encontrados na WABA sem seletor inequívoco.",
          { httpStatus: 400, isTransient: false }
        );
      }
    }

    // 6. Cross-Tenant Uniqueness Check for phoneNumberId
    const existingWithPhone = await prisma.metaConnection.findUnique({
      where: { phoneNumberId: selectedPhone.id },
      select: { id: true, barbershopId: true },
    });

    if (existingWithPhone && existingWithPhone.barbershopId !== barbershopId) {
      throw new MetaApiError(
        "Este número de telefone já está vinculado a outra barbearia.",
        { httpStatus: 409, isTransient: false }
      );
    }

    // 7. System User Assignment (Reconciled before POST)
    currentStage = "SYSTEM_USER_ASSIGNMENT";
    await assignSystemUserToWaba(
      selectedWaba.id,
      config.systemUserId,
      config.wabaSystemUserTask as MetaWabaSystemUserTask
    );

    // 8. WABA Webhook Subscription (Reconciled before POST)
    currentStage = "WABA_SUBSCRIPTION";
    await subscribeAppToWaba(selectedWaba.id);

    // 9. Persist Connection & Write Audit Events
    currentStage = "PERSISTENCE";
    const connection = await prisma.$transaction(async (tx) => {
      const conn = await tx.metaConnection.upsert({
        where: { barbershopId },
        create: {
          barbershopId,
          connectionMode: "COEXISTENCE",
          businessId: config.businessId,
          wabaId: selectedWaba.id,
          phoneNumberId: selectedPhone.id,
          displayPhoneNumber: selectedPhone.displayPhoneNumber,
          verifiedName: selectedPhone.verifiedName || null,
          qualityRating: selectedPhone.qualityRating || null,
          wabaReviewStatus: null,
          status: "CONNECTED",
          connectedAt: now,
          systemUserAssignedAt: now,
          webhookSubscribedAt: now,
          phoneRegisteredAt: null, // Zero register calls under Coexistence
          lastErrorCode: null,
          lastErrorMessage: null,
          createdByUserId: userId,
        },
        update: {
          connectionMode: "COEXISTENCE",
          businessId: config.businessId,
          wabaId: selectedWaba.id,
          phoneNumberId: selectedPhone.id,
          displayPhoneNumber: selectedPhone.displayPhoneNumber,
          verifiedName: selectedPhone.verifiedName || null,
          qualityRating: selectedPhone.qualityRating || null,
          wabaReviewStatus: null,
          status: "CONNECTED",
          connectedAt: now,
          systemUserAssignedAt: now,
          webhookSubscribedAt: now,
          disconnectedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: now,
        },
      });

      // Append lifecycle audit events
      await tx.metaConnectionEvent.createMany({
        data: [
          {
            barbershopId,
            metaConnectionId: conn.id,
            type: "ASSETS_DISCOVERED",
            actorUserId: userId,
            metadata: {
              wabaId: selectedWaba.id,
              phoneNumberId: selectedPhone.id,
              displayPhoneNumber: selectedPhone.displayPhoneNumber,
            },
          },
          {
            barbershopId,
            metaConnectionId: conn.id,
            type: "SYSTEM_USER_ASSIGNED",
            actorUserId: userId,
            metadata: {
              wabaId: selectedWaba.id,
              systemUserId: config.systemUserId,
              task: config.wabaSystemUserTask,
            },
          },
          {
            barbershopId,
            metaConnectionId: conn.id,
            type: "WEBHOOK_SUBSCRIBED",
            actorUserId: userId,
            metadata: {
              wabaId: selectedWaba.id,
            },
          },
          {
            barbershopId,
            metaConnectionId: conn.id,
            type: "ONBOARDING_COMPLETED",
            actorUserId: userId,
            metadata: {
              wabaId: selectedWaba.id,
              phoneNumberId: selectedPhone.id,
              connectionMode: "COEXISTENCE",
              completionMetadata: (completionMetadata as Prisma.InputJsonValue) || null,
            },
          },
          {
            barbershopId,
            metaConnectionId: conn.id,
            type: "CONNECTED",
            actorUserId: userId,
            metadata: {
              status: "CONNECTED",
              connectedAt: now.toISOString(),
            },
          },
        ],
      });

      return conn;
    });

    return {
      success: true,
      connectionId: connection.id,
      wabaId: selectedWaba.id,
      phoneNumberId: selectedPhone.id,
      displayPhoneNumber: selectedPhone.displayPhoneNumber,
      verifiedName: selectedPhone.verifiedName,
      status: "CONNECTED",
      connectionMode: "COEXISTENCE",
    };
  } catch (err: unknown) {
    const errorObj = err as Error | MetaApiError;
    const isMetaApiErr = errorObj instanceof MetaApiError;
    const safeMessage = redactSensitiveString(
      errorObj?.message || "Falha na conexão do WhatsApp com a Meta."
    );
    const graphCode = isMetaApiErr ? errorObj.code : undefined;
    const graphSubcode = isMetaApiErr ? errorObj.subcode : undefined;
    const fbtraceId = isMetaApiErr ? errorObj.fbtrace_id : undefined;

    // Log safe ONBOARDING_FAILED audit event without persisting sensitive credentials
    try {
      await prisma.metaConnectionEvent.create({
        data: {
          barbershopId,
          type: "ONBOARDING_FAILED",
          actorUserId: userId,
          metadata: {
            stage: currentStage,
            graphCode: graphCode !== undefined ? String(graphCode) : null,
            graphSubcode: graphSubcode !== undefined ? String(graphSubcode) : null,
            fbtraceId: fbtraceId || null,
            safeMessage,
          },
        },
      });
    } catch {
      // Best-effort event logging
    }

    if (err instanceof MetaApiError) {
      throw err;
    }

    throw new MetaApiError(safeMessage, {
      isTransient: false,
    });
  }
}
