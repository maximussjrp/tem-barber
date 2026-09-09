import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { getMetaConfig } from "@/lib/meta/config";
import { verifyMetaWebhookSignature } from "@/lib/meta/crypto";

/**
 * GET /api/webhooks/meta/whatsapp
 * Webhook Verification Handshake
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const config = getMetaConfig();

  if (
    mode === "subscribe" &&
    token &&
    config.webhookVerifyToken &&
    token === config.webhookVerifyToken
  ) {
    return new Response(challenge || "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new Response("Forbidden", { status: 403 });
}

import { Prisma } from "@prisma/client";

interface WebhookItemToPersist {
  eventKey: string;
  eventType: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  providerMessageId: string | null;
  providerOccurredAt: Date | null;
  payload: Prisma.InputJsonValue;
}

/**
 * POST /api/webhooks/meta/whatsapp
 * Ingests Meta WhatsApp webhooks with cryptographic HMAC signature verification,
 * atomic idempotency fan-out, and tenant resolution.
 */
export async function POST(req: NextRequest) {
  const config = getMetaConfig();
  const signatureHeader = req.headers.get("x-hub-signature-256");

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json(
      { error: "Erro ao ler corpo do webhook." },
      { status: 400 }
    );
  }

  // Cryptographic signature validation
  const isValid = verifyMetaWebhookSignature(
    rawBody,
    signatureHeader,
    config.appSecret
  );

  if (!isValid) {
    return NextResponse.json(
      { error: "Assinatura do webhook inválida." },
      { status: 401 }
    );
  }

  const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  const signatureVerifiedAt = new Date();

  let payload: Prisma.InputJsonObject | null = null;
  try {
    payload = JSON.parse(rawBody) as Prisma.InputJsonObject;
  } catch {
    return NextResponse.json(
      { error: "Payload JSON inválido." },
      { status: 400 }
    );
  }

  try {
    const items: WebhookItemToPersist[] = [];

    if (
      payload?.object === "whatsapp_business_account" &&
      Array.isArray(payload?.entry)
    ) {
      for (const entry of payload.entry) {
        const wabaId = entry.id ? String(entry.id) : null;
        const changes = Array.isArray(entry.changes) ? entry.changes : [];

        for (const change of changes) {
          const field = change.field || "unknown";
          const val = change.value || {};
          const phoneNumberId = val.metadata?.phone_number_id
            ? String(val.metadata.phone_number_id)
            : val.phone_number_id
            ? String(val.phone_number_id)
            : change.phone_number_id
            ? String(change.phone_number_id)
            : null;

          // 1. Check messages array
          if (Array.isArray(val.messages) && val.messages.length > 0) {
            for (const msg of val.messages) {
              const msgId = msg.id ? String(msg.id) : `gen_${Date.now()}`;
              const occurredAt = msg.timestamp
                ? new Date(Number(msg.timestamp) * 1000)
                : null;

              items.push({
                eventKey: `message:${phoneNumberId || wabaId || "unknown"}:${msgId}`,
                eventType: "messages",
                wabaId,
                phoneNumberId,
                providerMessageId: msgId,
                providerOccurredAt: occurredAt,
                payload: {
                  entry_id: wabaId,
                  field,
                  metadata: val.metadata,
                  contacts: val.contacts,
                  message: msg,
                },
              });
            }
          }

          // 2. Check statuses array
          if (Array.isArray(val.statuses) && val.statuses.length > 0) {
            for (const st of val.statuses) {
              const msgId = st.id ? String(st.id) : `gen_${Date.now()}`;
              const statusStr = st.status || "unknown";
              const timestampStr = st.timestamp || "";
              const occurredAt = st.timestamp
                ? new Date(Number(st.timestamp) * 1000)
                : null;

              items.push({
                eventKey: `status:${phoneNumberId || wabaId || "unknown"}:${msgId}:${statusStr}:${timestampStr}`,
                eventType: "statuses",
                wabaId,
                phoneNumberId,
                providerMessageId: msgId,
                providerOccurredAt: occurredAt,
                payload: {
                  entry_id: wabaId,
                  field,
                  metadata: val.metadata,
                  status: st,
                },
              });
            }
          }

          // 3. If neither messages nor statuses were present, persist generic change event
          if (
            (!Array.isArray(val.messages) || val.messages.length === 0) &&
            (!Array.isArray(val.statuses) || val.statuses.length === 0)
          ) {
            const rawTimestamp =
              val.timestamp ||
              val.event_time ||
              val.date ||
              change.timestamp ||
              null;
            const occurredAt = rawTimestamp
              ? new Date(Number(rawTimestamp) * 1000)
              : null;

            const shortHash = crypto
              .createHash("sha256")
              .update(JSON.stringify(change))
              .digest("hex")
              .slice(0, 16);

            const timestampPart = occurredAt
              ? `${Math.floor(occurredAt.getTime() / 1000)}:`
              : "";

            items.push({
              eventKey: `change:${field}:${phoneNumberId || wabaId || "unknown"}:${timestampPart}${shortHash}`,
              eventType: field,
              wabaId,
              phoneNumberId,
              providerMessageId: null,
              providerOccurredAt: occurredAt,
              payload: {
                entry_id: wabaId,
                field,
                change,
              },
            });
          }
        }
      }
    }

    // Fallback if structure was non-standard
    if (items.length === 0) {
      items.push({
        eventKey: `raw:${payloadHash}`,
        eventType: "raw",
        wabaId: null,
        phoneNumberId: null,
        providerMessageId: null,
        providerOccurredAt: null,
        payload: (payload ?? {}) as Prisma.InputJsonValue,
      });
    }

    // Persist items into webhook_inbox with tenant resolution
    for (const item of items) {
      let barbershopId: string | null = null;
      let metaConnectionId: string | null = null;

      if (item.phoneNumberId) {
        const connection = await prisma.metaConnection.findUnique({
          where: { phoneNumberId: item.phoneNumberId },
          select: { id: true, barbershopId: true },
        });

        if (connection) {
          barbershopId = connection.barbershopId;
          metaConnectionId = connection.id;
        }
      }

      // Safe processing status & error for unknown phone numbers
      const isTenantKnown = Boolean(barbershopId);
      const processingStatus = isTenantKnown ? "PENDING" : "IGNORED";
      const processingError = isTenantKnown
        ? null
        : "UNKNOWN_PHONE_NUMBER_ID";

      await prisma.webhookInbox.upsert({
        where: {
          provider_eventKey: {
            provider: "meta",
            eventKey: item.eventKey,
          },
        },
        create: {
          provider: "meta",
          eventKey: item.eventKey,
          eventType: item.eventType,
          wabaId: item.wabaId,
          phoneNumberId: item.phoneNumberId,
          providerMessageId: item.providerMessageId,
          metaConnectionId,
          barbershopId,
          providerOccurredAt: item.providerOccurredAt,
          payload: item.payload,
          payloadHash,
          processingStatus,
          processingError,
          signatureVerifiedAt,
        },
        update: {
          // Idempotent: existing row is completely untouched
        },
      });
    }

    return NextResponse.json({
      received: true,
      count: items.length,
    });
  } catch (err: unknown) {
    console.error("[META_WEBHOOK_INGEST_ERROR]", err);
    return NextResponse.json(
      { error: "Erro interno ao processar webhook." },
      { status: 500 }
    );
  }
}
