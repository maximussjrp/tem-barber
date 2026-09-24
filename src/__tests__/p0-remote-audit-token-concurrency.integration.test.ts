import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createStaffAccessToken, consumeStaffAccessToken } from "@/lib/auth/staff-tokens";
import { lockComandaRow, OperationalError } from "@/lib/operations/comandas";
import { registerPayment } from "@/lib/operations/payments";
import bcrypt from "bcryptjs";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://match_barber_test_user:match_barber_test_password@localhost:55439/match_barber_test?schema=public";

const canRunIntegration =
  testDatabaseUrl &&
  /match_barber_test|localhost|127\.0\.0\.1|55439/.test(testDatabaseUrl) &&
  !/prod|production|app\.tembarber\.com\.br/i.test(testDatabaseUrl);

const describeIf = canRunIntegration ? describe : describe.skip;

let prisma: PrismaClient;
let barbershopId: string;
let userId: string;
let memberId: string;

describeIf("P0 Remote Audit - Token Real PostgreSQL Concurrency Tests", () => {
  beforeAll(async () => {
    try {
      const prismaModule = await import("@/lib/prisma");
      prisma = prismaModule.default as PrismaClient;

      // Create unique tenant and user for concurrency test
      const timestamp = Date.now();
      const barbershop = await prisma.barbershop.create({
        data: {
          name: "Token Concurrency Shop",
          slug: `token-conc-${timestamp}`,
          phone: `11999${String(timestamp).slice(-6)}`,
          zipCode: "00000-000",
          street: "Rua Teste",
          number: "100",
          neighborhood: "Centro",
          city: "São Paulo",
          state: "SP",
        },
      });
      barbershopId = barbershop.id;

      const initialHash = await bcrypt.hash("InitialPass@123", 10);
      const user = await prisma.user.create({
        data: {
          name: "Colaborador Concorrente",
          phone: `11988${String(timestamp).slice(-6)}`,
          email: `colab.${timestamp}@teste.com`,
          passwordHash: initialHash,
        },
      });
      userId = user.id;

      const member = await prisma.barbershopMember.create({
        data: {
          barbershopId,
          userId,
          role: "BARBER",
          isActive: true,
        },
      });
      memberId = member.id;
    } catch (err) {
      console.error("DEBUG BEFORE ALL ERROR:", err);
      throw err;
    }
  });

  afterAll(async () => {
    if (prisma && barbershopId) {
      await prisma.payment.deleteMany({ where: { barbershopId } });
      await prisma.comanda.deleteMany({ where: { barbershopId } });
      await prisma.appointment.deleteMany({ where: { barbershopId } });
      await prisma.staffAccessToken.deleteMany({ where: { memberId } });
      await prisma.barbershopMember.deleteMany({ where: { barbershopId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.barbershop.delete({ where: { id: barbershopId } });
      await prisma.$disconnect();
    }
  });

  it("Emissão concorrente sob advisory lock: duas emissões simultâneas deixam apenas 1 token ativo/utilizável", async () => {
    // Disparar duas emissões simultâneas com Promise.all
    const [res1, res2] = await Promise.all([
      createStaffAccessToken({
        memberId,
        barbershopId,
        userId,
        purpose: "PASSWORD_RESET",
      }),
      createStaffAccessToken({
        memberId,
        barbershopId,
        userId,
        purpose: "PASSWORD_RESET",
      }),
    ]);

    expect(res1.rawToken).toBeDefined();
    expect(res2.rawToken).toBeDefined();

    // Consultar tokens ativos e não usados no banco
    const activeTokens = await prisma.staffAccessToken.findMany({
      where: {
        memberId,
        purpose: "PASSWORD_RESET",
        usedAt: null,
      },
    });

    // Sob advisory lock e invalidação atômica, apenas 1 token pode permanecer não usado
    expect(activeTokens.length).toBe(1);
  });

  it("Consumo concorrente single-use sob PostgreSQL real: de 2 chamadas paralelas com o mesmo token, exatamente 1 passa", async () => {
    // 1. Emitir token novo
    const { rawToken } = await createStaffAccessToken({
      memberId,
      barbershopId,
      userId,
      purpose: "PASSWORD_RESET",
    });

    // 2. Disparar duas chamadas simultâneas consumindo o mesmo token
    const [outcome1, outcome2] = await Promise.allSettled([
      consumeStaffAccessToken(rawToken, "NewPassWinner1@123"),
      consumeStaffAccessToken(rawToken, "NewPassWinner2@123"),
    ]);

    const successes = [outcome1, outcome2].filter((o) => o.status === "fulfilled");
    const failures = [outcome1, outcome2].filter((o) => o.status === "rejected");

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    // 3. Confirmar que o token agora está marcado como usado (usedAt != null)
    const storedToken = await prisma.staffAccessToken.findFirst({
      where: { memberId, purpose: "PASSWORD_RESET" },
      orderBy: { createdAt: "desc" },
    });
    expect(storedToken?.usedAt).not.toBeNull();
  });

  it("Cancelamento concorrente vs registro de pagamento: atomicidade sob lock garante que nunca há comanda CANCELLED com pagamento", async () => {
    // 1. Criar agendamento e comanda aberta
    const appt = await prisma.appointment.create({
      data: {
        barbershopId,
        memberId,
        customerId: userId,
        dateTime: new Date("2026-09-30T14:00:00Z"),
        totalPrice: 50.0,
        durationMin: 30,
        status: "CONFIRMED",
      },
    });

    const comanda = await prisma.comanda.create({
      data: {
        barbershopId,
        appointmentId: appt.id,
        customerName: "Cliente Teste",
        status: "OPEN",
        total: 50.0,
        remainingTotal: 50.0,
        paidTotal: 0.0,
      },
    });

    // 2. Disparar concorrentemente:
    // Req A: Cancelamento da comanda com lockComandaRow sob transaction (mesmo fluxo de status/route)
    // Req B: Registro de pagamento com lockComandaRow sob transaction (mesmo fluxo de registerPayment)
    const opCancel = prisma.$transaction(async (tx) => {
      const targetComanda = await tx.comanda.findFirst({
        where: { appointmentId: appt.id, barbershopId, status: { not: "CANCELLED" } },
        select: { id: true },
      });

      if (targetComanda) {
        await lockComandaRow(tx, barbershopId, targetComanda.id);

        const lockedComanda = await tx.comanda.findUnique({
          where: { id: targetComanda.id },
          include: {
            payments: { where: { status: "CONFIRMED" } },
            items: {
              include: {
                stockMovements: true,
                commissionEntries: true,
              },
            },
          },
        });

        if (!lockedComanda || lockedComanda.status !== "OPEN") {
          throw new OperationalError(
            "COMANDA_NOT_OPEN",
            "Não é possível cancelar o agendamento pois a comanda associada já avançou.",
            422
          );
        }

        const hasPayments = lockedComanda.payments.length > 0;
        const hasFinancial = (await tx.financialEntry.count({ where: { comandaId: lockedComanda.id } })) > 0;
        const hasStock = lockedComanda.items.some((i) => i.stockMovements.length > 0);
        const hasCommissions = lockedComanda.items.some((i) => i.commissionEntries.length > 0);

        if (hasPayments || hasFinancial || hasStock || hasCommissions) {
          throw new OperationalError(
            "COMANDA_HAS_FINANCIAL_EFFECTS",
            "A comanda possui efeitos financeiros, comissões ou estoque baixado.",
            422
          );
        }

        await tx.comanda.update({
          where: { id: lockedComanda.id },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });
      }

      return tx.appointment.update({
        where: { id: appt.id },
        data: { status: "CANCELLED" },
      });
    });

    const opPayment = prisma.$transaction(async (tx) => {
      return registerPayment(tx, {
        barbershopId,
        comandaId: comanda.id,
        amount: "50.00",
        method: "PIX",
        userId,
      });
    });

    const [resCancel, resPayment] = await Promise.allSettled([opCancel, opPayment]);

    // 3. Inspecionar o estado final no banco de dados real
    const finalComanda = await prisma.comanda.findUnique({
      where: { id: comanda.id },
      include: { payments: true },
    });
    const finalAppt = await prisma.appointment.findUnique({
      where: { id: appt.id },
    });

    // Invariante de integridade:
    // NUNCA pode existir comanda CANCELLED com pagamentos confirmados!
    if (finalComanda?.status === "CANCELLED") {
      expect(finalComanda.payments.length).toBe(0);
      expect(finalAppt?.status).toBe("CANCELLED");
      expect(resCancel.status).toBe("fulfilled");
      expect(resPayment.status).toBe("rejected");
    } else {
      expect(finalComanda?.payments.length).toBeGreaterThan(0);
      expect(finalAppt?.status).not.toBe("CANCELLED");
      expect(resPayment.status).toBe("fulfilled");
      expect(resCancel.status).toBe("rejected");
    }
  });
});
