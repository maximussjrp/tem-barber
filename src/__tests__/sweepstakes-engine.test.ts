import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  calculateSweepstakeEligibility,
  freezeCustomerSweepstake,
  executeSweepstakeDraw,
} from "@/lib/marketing/sweepstake-engine";
import { Prisma } from "@prisma/client";

describe("Sweepstake Engine — Elegibilidade, Desduplicação e Apuração Auditável", () => {
  let mockTx: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTx = {
      appointment: {
        findMany: vi.fn(),
      },
      comanda: {
        findMany: vi.fn(),
      },
      clubSubscriptionPayment: {
        findFirst: vi.fn(),
      },
      clubBenefitUsage: {
        findFirst: vi.fn(),
      },
      customerClubSubscription: {
        findFirst: vi.fn(),
      },
      customerSweepstake: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        update: vi.fn(),
      },
      customerSweepstakeTicket: {
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
      customerSweepstakeChanceOrigin: {
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
      customerSweepstakeParticipant: {
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
      customerSweepstakeWinner: {
        create: vi.fn(),
      },
      customerSweepstakeDrawAudit: {
        create: vi.fn(),
      },
      $queryRaw: vi.fn(),
    };
  });

  describe("Desduplicação Canônica (Appointment vs. Comanda)", () => {
    it("não duplica visita nem serviço quando agendamento possui comanda vinculada com itens DONE", async () => {
      // Cliente realizou 1 agendamento que gerou 1 comanda com 1 item DONE
      mockTx.appointment.findMany.mockResolvedValue([
        {
          id: "app-1",
          barbershopId: "shop-1",
          customerId: "user-1",
          dateTime: new Date(Date.UTC(2026, 9, 15, 14, 0, 0)),
          status: "CONFIRMED", // Ainda não COMPLETED na agenda
          customer: { id: "user-1", name: "Carlos Silva", phone: "11999998888" },
          services: [{ serviceId: "srv-corte", service: { name: "Corte Cabelo" } }],
          comandas: [
            {
              id: "cmd-1",
              status: "IN_SERVICE", // Comanda ABERTA!
              closedAt: null,
              items: [
                {
                  id: "item-1",
                  serviceId: "srv-corte",
                  type: "SERVICE",
                  status: "DONE", // Serviço executado
                  completedAt: new Date("2026-10-15T14:30:00Z"),
                  quantity: new Prisma.Decimal(1),
                  service: { name: "Corte Cabelo" },
                },
              ],
            },
          ],
        },
      ]);

      mockTx.comanda.findMany.mockResolvedValue([]); // Nenhuma comanda avulsa

      // Modo B: 1 chance por atendimento
      const resultModoB = await calculateSweepstakeEligibility(mockTx, {
        barbershopId: "shop-1",
        startDateCivil: "2026-10-01",
        endDateCivil: "2026-10-31",
        participationMode: "ONE_PER_APPOINTMENT",
        targetSegment: "ALL_CUSTOMERS",
      });

      expect(resultModoB.totalEligibleCustomers).toBe(1);
      expect(resultModoB.totalEligibleVisits).toBe(1); // Exatamente 1 visita, NUNCA 2
      expect(resultModoB.totalEligibleServices).toBe(1);
      expect(resultModoB.totalChances).toBe(1);
      expect(resultModoB.participants[0].chanceOrigins.length).toBe(1);
      expect(resultModoB.participants[0].chanceOrigins[0].justification).toContain("comanda vinculada");
    });

    it("computa comanda avulsa sem vínculo de agendamento (appointmentId = null)", async () => {
      mockTx.appointment.findMany.mockResolvedValue([]);
      mockTx.comanda.findMany.mockResolvedValue([
        {
          id: "cmd-avulsa-1",
          barbershopId: "shop-1",
          customerId: "user-2",
          appointmentId: null,
          status: "OPEN",
          openedAt: new Date("2026-10-10T10:00:00Z"),
          closedAt: null,
          customer: { id: "user-2", name: "Marcos Souza", phone: "11988887777" },
          items: [
            {
              id: "item-avulso-1",
              serviceId: "srv-barba",
              type: "SERVICE",
              status: "DONE",
              completedAt: new Date("2026-10-10T10:25:00Z"),
              quantity: new Prisma.Decimal(1),
              service: { name: "Barba Terapia" },
            },
          ],
        },
      ]);

      const result = await calculateSweepstakeEligibility(mockTx, {
        barbershopId: "shop-1",
        startDateCivil: "2026-10-01",
        endDateCivil: "2026-10-31",
        participationMode: "ONE_PER_SERVICE",
        targetSegment: "ALL_CUSTOMERS",
      });

      expect(result.totalEligibleCustomers).toBe(1);
      expect(result.totalEligibleVisits).toBe(1);
      expect(result.totalEligibleServices).toBe(1);
      expect(result.totalChances).toBe(1);
      expect(result.participants[0].chanceOrigins[0].justification).toContain("comanda avulsa");
    });

    it("ignora agendamentos cancelados ou no-show", async () => {
      mockTx.appointment.findMany.mockResolvedValue([]);
      mockTx.comanda.findMany.mockResolvedValue([]);

      const result = await calculateSweepstakeEligibility(mockTx, {
        barbershopId: "shop-1",
        startDateCivil: "2026-10-01",
        endDateCivil: "2026-10-31",
        participationMode: "ONE_PER_CUSTOMER",
        targetSegment: "ALL_CUSTOMERS",
      });

      expect(result.totalEligibleCustomers).toBe(0);
      expect(result.totalChances).toBe(0);
    });
  });

  describe("Modos de Participação (A, B e C)", () => {
    const mockAppointments = [
      {
        id: "app-1",
        barbershopId: "shop-1",
        customerId: "user-1",
        dateTime: new Date(Date.UTC(2026, 9, 5, 10, 0, 0)),
        status: "COMPLETED",
        customer: { id: "user-1", name: "Lucas Mendes", phone: "11977776666" },
        services: [
          { serviceId: "srv-corte", service: { name: "Corte" } },
          { serviceId: "srv-barba", service: { name: "Barba" } },
        ],
        comandas: [],
      },
      {
        id: "app-2",
        barbershopId: "shop-1",
        customerId: "user-1",
        dateTime: new Date(Date.UTC(2026, 9, 20, 11, 0, 0)),
        status: "COMPLETED",
        customer: { id: "user-1", name: "Lucas Mendes", phone: "11977776666" },
        services: [{ serviceId: "srv-corte", service: { name: "Corte" } }],
        comandas: [],
      },
    ];

    it("Modo A: 1 chance por cliente único independentemente da quantidade de visitas", async () => {
      mockTx.appointment.findMany.mockResolvedValue(mockAppointments);
      mockTx.comanda.findMany.mockResolvedValue([]);

      const result = await calculateSweepstakeEligibility(mockTx, {
        barbershopId: "shop-1",
        startDateCivil: "2026-10-01",
        endDateCivil: "2026-10-31",
        participationMode: "ONE_PER_CUSTOMER",
        targetSegment: "ALL_CUSTOMERS",
      });

      expect(result.totalEligibleCustomers).toBe(1);
      expect(result.totalEligibleVisits).toBe(2);
      expect(result.totalEligibleServices).toBe(3);
      expect(result.totalChances).toBe(1); // Modo A: exatamente 1 chance
      expect(result.participants[0].chancesCount).toBe(1);
    });

    it("Modo B: 1 chance por atendimento concluído", async () => {
      mockTx.appointment.findMany.mockResolvedValue(mockAppointments);
      mockTx.comanda.findMany.mockResolvedValue([]);

      const result = await calculateSweepstakeEligibility(mockTx, {
        barbershopId: "shop-1",
        startDateCivil: "2026-10-01",
        endDateCivil: "2026-10-31",
        participationMode: "ONE_PER_APPOINTMENT",
        targetSegment: "ALL_CUSTOMERS",
      });

      expect(result.totalEligibleCustomers).toBe(1);
      expect(result.totalChances).toBe(2); // 2 visitas = 2 chances
      expect(result.participants[0].chancesCount).toBe(2);
    });

    it("Modo C: 1 chance por serviço concluído", async () => {
      mockTx.appointment.findMany.mockResolvedValue(mockAppointments);
      mockTx.comanda.findMany.mockResolvedValue([]);

      const result = await calculateSweepstakeEligibility(mockTx, {
        barbershopId: "shop-1",
        startDateCivil: "2026-10-01",
        endDateCivil: "2026-10-31",
        participationMode: "ONE_PER_SERVICE",
        targetSegment: "ALL_CUSTOMERS",
      });

      expect(result.totalEligibleCustomers).toBe(1);
      expect(result.totalChances).toBe(3); // 3 serviços = 3 chances
      expect(result.participants[0].chancesCount).toBe(3);
    });
  });

  describe("Reconstrução Histórica do Clube", () => {
    it("reconhece membro do clube via pagamento comprovado (ClubSubscriptionPayment)", async () => {
      mockTx.appointment.findMany.mockResolvedValue([
        {
          id: "app-1",
          barbershopId: "shop-1",
          customerId: "user-club",
          dateTime: new Date(Date.UTC(2026, 9, 10, 10, 0, 0)),
          status: "COMPLETED",
          customer: { id: "user-club", name: "Cliente Vip", phone: "11999990000" },
          services: [{ serviceId: "srv-corte", service: { name: "Corte" } }],
          comandas: [],
        },
      ]);
      mockTx.comanda.findMany.mockResolvedValue([]);

      // Simular pagamento de competência outubro/2026
      mockTx.clubSubscriptionPayment.findFirst.mockResolvedValue({ id: "pay-1" });

      const result = await calculateSweepstakeEligibility(mockTx, {
        barbershopId: "shop-1",
        startDateCivil: "2026-10-01",
        endDateCivil: "2026-10-31",
        participationMode: "ONE_PER_CUSTOMER",
        targetSegment: "CLUB_ONLY", // Apenas Clube
      });

      expect(result.totalEligibleCustomers).toBe(1);
      expect(result.participants[0].isClubMember).toBe(true);
    });

    it("exclui cliente comum quando filtro é CLUB_ONLY", async () => {
      mockTx.appointment.findMany.mockResolvedValue([
        {
          id: "app-1",
          barbershopId: "shop-1",
          customerId: "user-regular",
          dateTime: new Date(Date.UTC(2026, 9, 10, 10, 0, 0)),
          status: "COMPLETED",
          customer: { id: "user-regular", name: "Cliente Comum", phone: "11999990000" },
          services: [{ serviceId: "srv-corte", service: { name: "Corte" } }],
          comandas: [],
        },
      ]);
      mockTx.comanda.findMany.mockResolvedValue([]);

      // Sem pagamento, sem uso de benefício e sem assinatura ativa
      mockTx.clubSubscriptionPayment.findFirst.mockResolvedValue(null);
      mockTx.clubBenefitUsage.findFirst.mockResolvedValue(null);
      mockTx.customerClubSubscription.findFirst.mockResolvedValue(null);

      const result = await calculateSweepstakeEligibility(mockTx, {
        barbershopId: "shop-1",
        startDateCivil: "2026-10-01",
        endDateCivil: "2026-10-31",
        participationMode: "ONE_PER_CUSTOMER",
        targetSegment: "CLUB_ONLY",
      });

      expect(result.totalEligibleCustomers).toBe(0);
      expect(result.totalChances).toBe(0);
    });
  });

  describe("Apuração Determinística e Imparcialidade", () => {
    it("executa sorteio determinístico e rejeita execução duplicada", async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: "sw-1", status: "FROZEN" }]);

      mockTx.customerSweepstake.findUniqueOrThrow.mockResolvedValue({
        id: "sw-1",
        barbershopId: "shop-1",
        status: "FROZEN",
        drawMethod: "ELECTRONIC_DETERMINISTIC",
        precommittedSeed: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
        ticketsSha256Digest: "hash-sha256-tickets",
        endExclusiveUtc: new Date("2026-10-31T03:00:00Z"), // Passado
        isRegulatedPromotion: false,
        allowMultiplePrizesPerUser: false,
        prizes: [{ id: "pz-1", position: 1, title: "1º Prêmio: Pomada" }],
        tickets: [
          {
            id: "t-1",
            ticketNumber: 1,
            participantId: "part-1",
            participant: {
              customerId: "user-1",
              customer: { name: "Ganhador Um", phone: "11999991111" },
            },
          },
          {
            id: "t-2",
            ticketNumber: 2,
            participantId: "part-2",
            participant: {
              customerId: "user-2",
              customer: { name: "Ganhador Dois", phone: "11999992222" },
            },
          },
        ],
      });

      mockTx.customerSweepstakeWinner.create.mockResolvedValue({});
      mockTx.customerSweepstakeDrawAudit.create.mockResolvedValue({});
      mockTx.customerSweepstake.update.mockResolvedValue({
        id: "sw-1",
        status: "DRAWN",
      });

      const drawResult = await executeSweepstakeDraw(mockTx, {
        sweepstakeId: "sw-1",
        barbershopId: "shop-1",
        drawnByUserId: "admin-user",
        isTechnicalSimulation: true,
      });

      expect(drawResult.status).toBe("DRAWN");
      expect(mockTx.customerSweepstakeWinner.create).toHaveBeenCalledTimes(1);
      expect(mockTx.customerSweepstakeDrawAudit.create).toHaveBeenCalledTimes(1);
    });

    it("bloqueia estritamente apuração oficial em V1 se não for simulação técnica", async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: "sw-1", status: "FROZEN" }]);
      mockTx.customerSweepstake.findUniqueOrThrow.mockResolvedValue({
        id: "sw-1",
        barbershopId: "shop-1",
        status: "FROZEN",
        drawMethod: "ELECTRONIC_DETERMINISTIC",
        precommittedSeed: "seed123",
        ticketsSha256Digest: "hash123",
        endExclusiveUtc: new Date("2026-10-31T03:00:00Z"),
        isRegulatedPromotion: false,
        prizes: [{ id: "pz-1", position: 1, title: "Prêmio 1" }],
        tickets: [{ ticketNumber: 1, participantId: "part-1", participant: { customerId: "cust-1", customer: { name: "C1", phone: "1199" } } }],
      });

      await expect(
        executeSweepstakeDraw(mockTx, {
          sweepstakeId: "sw-1",
          barbershopId: "shop-1",
          drawnByUserId: "admin-user",
          isTechnicalSimulation: false,
        })
      ).rejects.toThrow(/APURACAO_OFICIAL_BLOQUEADA_V1/);
    });

    it("falha com erro de gate regulatório se isRegulatedPromotion for true mas authorizationCode estiver ausente", async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: "sw-reg", status: "FROZEN" }]);
      mockTx.customerSweepstake.findUniqueOrThrow.mockResolvedValue({
        id: "sw-reg",
        barbershopId: "shop-1",
        status: "FROZEN",
        drawMethod: "FEDERAL_LOTTERY",
        precommittedSeed: "seed123",
        ticketsSha256Digest: "hash123",
        endExclusiveUtc: new Date("2026-10-31T03:00:00Z"),
        isRegulatedPromotion: true,
        authorizationCode: null, // Ausente!
        prizes: [{ id: "pz-1", position: 1, title: "Prêmio 1" }],
        tickets: [{ id: "t-1", ticketNumber: 1, participantId: "p-1", participant: { customerId: "c-1", customer: { name: "A", phone: "1" } } }],
      });

      await expect(
        executeSweepstakeDraw(mockTx, {
          sweepstakeId: "sw-reg",
          barbershopId: "shop-1",
          drawnByUserId: "admin-user",
          federalLotteryConcurso: "5998",
        })
      ).rejects.toThrow("código do Certificado de Autorização SPA/MF é obrigatório");
    });

    it("falha com erro SWEEPSTAKE_ALREADY_DRAWN se a campanha já tiver sido apurada", async () => {
      mockTx.$queryRaw.mockResolvedValue([{ id: "sw-1", status: "DRAWN" }]);

      await expect(
        executeSweepstakeDraw(mockTx, {
          sweepstakeId: "sw-1",
          barbershopId: "shop-1",
          drawnByUserId: "admin-user",
        })
      ).rejects.toThrow("SWEEPSTAKE_ALREADY_DRAWN");
    });
  });
});
