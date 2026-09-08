import { NextResponse } from "next/server";
import { requireOperationalSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getMetaReadiness } from "@/lib/meta/config";

export async function GET() {
  const { error, data } = await requireOperationalSession();
  if (error) return error;

  const { barbershopId, role } = data;

  if (role !== "OWNER" && role !== "MANAGER") {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  try {
    const metaReadiness = getMetaReadiness();

    const connection = await prisma.metaConnection.findUnique({
      where: { barbershopId },
    });

    if (!connection) {
      return NextResponse.json({
        configured: false,
        status: "NOT_CONFIGURED",
        connection: null,
        systemReadiness: {
          ready: metaReadiness.ready,
          activeKeyVersion: metaReadiness.activeKeyVersion,
        },
      });
    }

    return NextResponse.json({
      configured: true,
      status: connection.status,
      connection: {
        id: connection.id,
        businessId: connection.businessId,
        wabaId: connection.wabaId,
        phoneNumberId: connection.phoneNumberId,
        displayPhoneNumber: connection.displayPhoneNumber,
        verifiedName: connection.verifiedName,
        qualityRating: connection.qualityRating,
        wabaReviewStatus: connection.wabaReviewStatus,
        status: connection.status,
        connectedAt: connection.connectedAt,
        systemUserAssignedAt: connection.systemUserAssignedAt,
        webhookSubscribedAt: connection.webhookSubscribedAt,
        phoneRegisteredAt: connection.phoneRegisteredAt,
        lastHealthCheckAt: connection.lastHealthCheckAt,
        lastErrorCode: connection.lastErrorCode,
        lastErrorMessage: connection.lastErrorMessage,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      },
      systemReadiness: {
        ready: metaReadiness.ready,
        activeKeyVersion: metaReadiness.activeKeyVersion,
      },
    });
  } catch (err: unknown) {
    console.error("[META_STATUS_ERROR]", err);
    return NextResponse.json(
      { error: "Erro ao consultar status da integração Meta." },
      { status: 500 }
    );
  }
}
