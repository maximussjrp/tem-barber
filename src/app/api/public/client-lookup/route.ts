import { NextResponse } from "next/server";
import { normalizePhone } from "@/lib/customers";
import { consumeRateLimit, resolveClientIp } from "@/lib/public-rate-limit";
import { validateBrazilianMobilePhone } from "@/lib/phone/br-phone";


export async function POST(request: Request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Corpo da requisicao invalido." }, { status: 400 });
    }

    const { phone } = body || {};

    if (!phone) {
      return NextResponse.json({ error: "Telefone e obrigatorio." }, { status: 400 });
    }

    const cleanPhone = normalizePhone(phone);
    if (!validateBrazilianMobilePhone(cleanPhone)) {
      return NextResponse.json({ error: "Informe um WhatsApp válido com DDD." }, { status: 400 });
    }

    const ip = resolveClientIp(request);
    const rateLimit = consumeRateLimit({
      bucket: "public-client-lookup",
      key: `${ip}:${cleanPhone}`,
      max: 15,
      windowMs: 60_000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Muitas tentativas. Tente novamente em instantes." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    // A valid phone is only a booking identifier, never proof of identity.
    // Keep the response constant and avoid querying private customer data.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro ao buscar vinculos do cliente:", error);
    return NextResponse.json({ error: "Erro interno do servidor." }, { status: 500 });
  }
}
