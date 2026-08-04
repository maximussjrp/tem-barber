import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../lib/prisma";
import {
  registerManualClubSubscriptionPayment,
  getActiveCustomerClubSubscription,
  getClubBenefitsBalance,
} from "../lib/operations/club";
import { ensureComandaForAppointment } from "../lib/operations/comandas";
import { closeComanda } from "../lib/operations/payments";
import { ClubSubscriptionStatus, PaymentMethod } from "@prisma/client";

const RUN_INTEGRATION = process.env.RUN_INTEGRATION_TESTS === "true";

describe.runIf(RUN_INTEGRATION)("P0 Bugfixes — Club Subscription Lifecycle & Operational Benefits", () => {
  let barbershopId: string;
  let customerId: string;
  let memberId: string;
  let serviceId: string;
  let clubPlanId: string;

  beforeEach(async () => {
    // Setup test tenant
    const barbershop = await prisma.barbershop.create({
      data: {
        name: "Test Barbershop P0",
        slug: `test-p0-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        phone: "17999999999",
        zipCode: "15000000",
        street: "Rua Teste",
        number: "100",
        neighborhood: "Centro",
        city: "São José do Rio Preto",
        state: "SP",
      },
    });
    barbershopId = barbershop.id;

    // Customer
    const customer = await prisma.user.create({
      data: {
        name: "Cliente Teste P0",
        phone: `1798${Math.floor(1000000 + Math.random() * 9000000)}`,
        role: "USER",
      },
    });
    customerId = customer.id;

    // Barber / Staff
    const barberUser = await prisma.user.create({
      data: {
        name: "Barbeiro Teste P0",
        phone: `1797${Math.floor(1000000 + Math.random() * 9000000)}`,
        role: "USER",
      },
    });
    const barberMember = await prisma.barbershopMember.create({
      data: {
        barbershopId,
        userId: barberUser.id,
        role: "BARBER",
      },
    });
    memberId = barberMember.id;

    // Category
    const category = await prisma.category.create({
      data: {
        barbershop: { connect: { id: barbershopId } },
        name: "Serviços Teste",
        slug: `servicos-teste-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      },
    });

    // Service
    const service = await prisma.service.create({
      data: {
        barbershop: { connect: { id: barbershopId } },
        category: { connect: { id: category.id } },
        name: "Barba Teste P0",
        price: 35.0,
        durationMin: 30,
      },
    });
    serviceId = service.id;

    // Club Plan
    const clubPlan = await prisma.clubPlan.create({
      data: {
        barbershop: { connect: { id: barbershopId } },
        name: "Plano Barba P0",
        monthlyPrice: 70.0,
        shopSharePercent: 50.0,
        barberPoolPercent: 50.0,
        benefits: {
          create: [
            {
              benefitType: "INCLUDED_SERVICE",
              serviceId: service.id,
              benefitLimitMode: "UNLIMITED",
            },
          ],
        },
      },
    });
    clubPlanId = clubPlan.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("1. Assinatura vinculada sem pagamento deve nascer com status PAST_DUE (ou PENDING_PAYMENT) e NÃO liberar benefício", async () => {
    const now = new Date();
    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId,
        customerId,
        clubPlanId,
        status: ClubSubscriptionStatus.PAST_DUE,
        currentPeriodStart: now,
        currentPeriodEnd: now,
        gracePeriodEnd: now,
      },
    });

    expect(sub.status).toBe("PAST_DUE");

    // Tentar buscar assinatura ativa
    const activeSub = await getActiveCustomerClubSubscription({
      barbershopId,
      customerId,
      atDate: now,
    });

    expect(activeSub).toBeNull();
  });

  it("2. Primeiro pagamento ativa a assinatura, iniciando o ciclo na data do pagamento (paidAt)", async () => {
    const paidAt = new Date("2026-08-04T12:00:00Z");

    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId,
        customerId,
        clubPlanId,
        status: ClubSubscriptionStatus.PAST_DUE,
        currentPeriodStart: paidAt,
        currentPeriodEnd: paidAt,
        gracePeriodEnd: paidAt,
      },
    });

    const result = await registerManualClubSubscriptionPayment({
      barbershopId,
      subscriptionId: sub.id,
      paymentMethod: PaymentMethod.PIX,
      paidAt,
    });

    expect(result.subscription.status).toBe("ACTIVE");
    expect(result.subscription.currentPeriodStart.toISOString()).toBe(paidAt.toISOString());

    const expectedEnd = new Date(paidAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(result.subscription.currentPeriodEnd.toISOString()).toBe(expectedEnd.toISOString());

    // Consultar assinatura ativa na data do pagamento (2026-08-04)
    const activeSub = await getActiveCustomerClubSubscription({
      barbershopId,
      customerId,
      atDate: paidAt,
    });

    expect(activeSub).not.toBeNull();
    expect(activeSub?.id).toBe(sub.id);
  });

  it("3. Agendamento e Comanda de cliente com assinatura paga zeram o total da comanda e fecham com benefício do clube", async () => {
    const paidAt = new Date();

    const sub = await prisma.customerClubSubscription.create({
      data: {
        barbershopId,
        customerId,
        clubPlanId,
        status: ClubSubscriptionStatus.PAST_DUE,
        currentPeriodStart: paidAt,
        currentPeriodEnd: paidAt,
        gracePeriodEnd: paidAt,
      },
    });

    await registerManualClubSubscriptionPayment({
      barbershopId,
      subscriptionId: sub.id,
      paymentMethod: PaymentMethod.PIX,
      paidAt,
    });

    // Criar agendamento
    const appointment = await prisma.appointment.create({
      data: {
        barbershopId,
        customerId,
        memberId,
        dateTime: paidAt,
        status: "CONFIRMED",
        totalPrice: 35.0,
        durationMin: 30,
        services: {
          create: [
            {
              serviceId,
              priceApplied: 35.0,
            },
          ],
        },
      },
    });

    // Gerar comanda
    const comanda = await prisma.$transaction(async (tx) => {
      return ensureComandaForAppointment(tx, {
        barbershopId,
        appointmentId: appointment.id,
      });
    });

    expect(comanda.items[0].clubBenefitRequested).toBe(true);
    expect(Number(comanda.total)).toBe(0);
    expect(Number(comanda.remainingTotal)).toBe(0);

    // Confirm ClubBenefitUsage and ClubPointEntry are NOT created during comanda creation
    const usageBeforeClose = await prisma.clubBenefitUsage.findFirst({
      where: { subscriptionId: sub.id, comandaItemId: comanda.items[0].id },
    });
    expect(usageBeforeClose).toBeNull();

    const pointsBeforeClose = await prisma.clubPointEntry.findFirst({
      where: { barbershopId, subscriptionId: sub.id },
    });
    expect(pointsBeforeClose).toBeNull();

    // Finalizar comanda zerada sem pagamentos adicionais
    const finalized = await prisma.$transaction(async (tx) => {
      return closeComanda(tx, barbershopId, comanda.id);
    });

    expect(finalized.status).toBe("CLOSED");

    // Verificar se ClubBenefitUsage foi registrado
    const usage = await prisma.clubBenefitUsage.findFirst({
      where: { subscriptionId: sub.id, comandaItemId: comanda.items[0].id },
    });
    expect(usage).not.toBeNull();
    expect(usage?.status).toBe("APPLIED");
  });
});
