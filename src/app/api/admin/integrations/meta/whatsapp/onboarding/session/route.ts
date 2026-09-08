import { NextResponse } from "next/server";
import { requireOperationalSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getMetaConfig } from "@/lib/meta/config";
import { generateOnboardingNonce, hashOnboardingNonce } from "@/lib/meta/crypto";

export async function POST() {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { barbershopId, userId, role } = data;

  // Strict RBAC: only OWNER can initiate onboarding
  if (role !== "OWNER") {
    return NextResponse.json(
      { error: "Apenas proprietários podem iniciar a conexão com o WhatsApp." },
      { status: 403 }
    );
  }

  const config = getMetaConfig();
  if (!config.appId || !config.embeddedSignupConfigId) {
    return NextResponse.json(
      {
        error: "Configuração do Meta WhatsApp incompleta no servidor.",
      },
      { status: 503 }
    );
  }

  try {
    const nonce = generateOnboardingNonce();
    const nonceHash = hashOnboardingNonce(nonce);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes TTL

    const session = await prisma.$transaction(async (tx) => {
      // Invalidate existing INITIATED sessions for this barbershop to maintain single active session
      await tx.metaOnboardingSession.updateMany({
        where: {
          barbershopId,
          status: "INITIATED",
        },
        data: {
          status: "CANCELLED",
        },
      });

      const newSession = await tx.metaOnboardingSession.create({
        data: {
          barbershopId,
          createdByUserId: userId,
          nonceHash,
          status: "INITIATED",
          expiresAt,
        },
      });

      await tx.metaConnectionEvent.create({
        data: {
          barbershopId,
          type: "ONBOARDING_STARTED",
          actorUserId: userId,
          metadata: {
            sessionId: newSession.id,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });

      return newSession;
    });

    return NextResponse.json({
      sessionId: session.id,
      nonce,
      appId: config.appId,
      configId: config.embeddedSignupConfigId,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err: unknown) {
    console.error("[META_ONBOARDING_SESSION_ERROR]", err);
    return NextResponse.json(
      { error: "Erro ao iniciar sessão de integração Meta WhatsApp." },
      { status: 500 }
    );
  }
}
