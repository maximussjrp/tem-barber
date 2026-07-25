import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/api-auth";
import { normalizeBillingPhone, serializeBillingProfile } from "@/lib/billing/profile";
import { validateBillingDocument } from "@/lib/billing/documents";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function forbidden(message = "Acesso negado.") {
  return NextResponse.json({ error: "FORBIDDEN", message }, { status: 403 });
}

export async function GET() {
  const session = await getAdminSession();
  if (session.error) return session.error;

  const { barbershopId, role } = session.data;

  if (!barbershopId) {
    return NextResponse.json(
      { error: "NO_BARBERSHOP", message: "Nenhuma barbearia associada a sessao." },
      { status: 400 }
    );
  }

  if (role !== "OWNER" && role !== "MANAGER") {
    return forbidden("Apenas proprietarios e gerentes podem visualizar dados de faturamento.");
  }

  const profile = await prisma.barbershopBillingProfile.findUnique({
    where: { barbershopId },
  });

  return NextResponse.json(serializeBillingProfile(profile));
}

export async function PUT(request: NextRequest) {
  const session = await getAdminSession();
  if (session.error) return session.error;

  const { barbershopId, role } = session.data;

  if (!barbershopId) {
    return NextResponse.json(
      { error: "NO_BARBERSHOP", message: "Nenhuma barbearia associada a sessao." },
      { status: 400 }
    );
  }

  if (role !== "OWNER") {
    return forbidden("Apenas o proprietario pode alterar dados de faturamento.");
  }

  let body: {
    personType?: unknown;
    legalName?: unknown;
    cpfCnpj?: unknown;
    billingEmail?: unknown;
    billingPhone?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_BODY", message: "Corpo da requisicao invalido." },
      { status: 400 }
    );
  }

  const personType = typeof body.personType === "string" ? body.personType : "";
  const legalName = typeof body.legalName === "string" ? body.legalName.trim() : "";
  const cpfCnpj = typeof body.cpfCnpj === "string" ? body.cpfCnpj : "";
  const billingEmail = typeof body.billingEmail === "string" ? body.billingEmail.trim().toLowerCase() : "";
  const billingPhone = typeof body.billingPhone === "string" ? normalizeBillingPhone(body.billingPhone) : null;

  if (personType !== "INDIVIDUAL" && personType !== "COMPANY") {
    return NextResponse.json(
      { error: "INVALID_PERSON_TYPE", message: "Tipo de pessoa invalido." },
      { status: 400 }
    );
  }

  if (legalName.length < 2) {
    return NextResponse.json(
      { error: "INVALID_LEGAL_NAME", message: "Informe o nome completo ou razao social." },
      { status: 400 }
    );
  }

  const existing = await prisma.barbershopBillingProfile.findUnique({
    where: { barbershopId },
  });

  let normalizedDocument = existing?.cpfCnpj ?? null;
  const shouldChangeDocument = cpfCnpj.trim().length > 0;

  if (!shouldChangeDocument && existing?.personType !== personType) {
    normalizedDocument = null;
  }

  if (shouldChangeDocument) {
    const documentValidation = validateBillingDocument(personType, cpfCnpj);
    if (!documentValidation.ok || !documentValidation.normalized) {
      return NextResponse.json(
        { error: documentValidation.error, message: "CPF ou CNPJ invalido para o tipo de pessoa selecionado." },
        { status: 400 }
      );
    }
    normalizedDocument = documentValidation.normalized;
  }

  if (!normalizedDocument) {
    return NextResponse.json(
      { error: "MISSING_DOCUMENT", message: "Informe CPF ou CNPJ valido." },
      { status: 400 }
    );
  }

  if (!EMAIL_RE.test(billingEmail)) {
    return NextResponse.json(
      { error: "INVALID_BILLING_EMAIL", message: "E-mail financeiro invalido." },
      { status: 400 }
    );
  }

  const saved = await prisma.barbershopBillingProfile.upsert({
    where: { barbershopId },
    create: {
      barbershopId,
      personType,
      legalName,
      cpfCnpj: normalizedDocument,
      billingEmail,
      billingPhone,
    },
    update: {
      personType,
      legalName,
      cpfCnpj: normalizedDocument,
      billingEmail,
      billingPhone,
    },
  });

  return NextResponse.json(serializeBillingProfile(saved));
}
