import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { asaasFetch } from "@/lib/asaas/client";

interface AsaasPixQrCodeResponse {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

export async function GET() {
  const session = await getAdminSession();
  if (session.error) {
    return session.error;
  }

  const { barbershopId, role } = session.data;

  if (!barbershopId) {
    return NextResponse.json(
      { error: "NO_BARBERSHOP", message: "Nenhuma barbearia associada à sessão." },
      { status: 400 }
    );
  }

  if (role !== "OWNER" && role !== "MANAGER") {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Apenas proprietários e gerentes têm acesso ao Pix." },
      { status: 403 }
    );
  }

  const latestPayment = await prisma.asaasBillingPayment.findFirst({
    where: { barbershopId },
    orderBy: { createdAt: "desc" },
  });

  if (!latestPayment || !latestPayment.asaasPaymentId) {
    return NextResponse.json(
      { error: "NO_PAYMENT", message: "Nenhuma cobrança encontrada para obter o Pix QR Code." },
      { status: 404 }
    );
  }

  if (latestPayment.billingType !== "PIX") {
    return NextResponse.json(
      { error: "NOT_PIX_PAYMENT", message: "A cobrança atual não é do tipo PIX." },
      { status: 400 }
    );
  }

  try {
    const pixData = await asaasFetch<AsaasPixQrCodeResponse>(
      `/payments/${latestPayment.asaasPaymentId}/pixQrCode`
    );

    return NextResponse.json({
      encodedImage: pixData.encodedImage,
      payload: pixData.payload,
      expirationDate: pixData.expirationDate,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Erro ao carregar Pix QR Code.";
    console.error("[billing/pix] Erro ao buscar Pix QR Code no Asaas:", errorMsg);
    return NextResponse.json(
      { error: "ASAAS_PIX_ERROR", message: "Não foi possível gerar ou recuperar o QR Code Pix no momento." },
      { status: 502 }
    );
  }
}
