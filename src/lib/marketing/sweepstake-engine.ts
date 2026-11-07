import {
  Prisma,
  SweepstakeStatus,
  SweepstakeParticipationMode,
  SweepstakeCustomerSegment,
  SweepstakeDrawMethod,
} from "@prisma/client";
import crypto from "crypto";
import {
  localDateToUTCBoundary,
  shiftDateISO,
  formatTimestampToCivilDateBR,
} from "@/lib/time-utils";

export interface SweepstakeEligibilityFilter {
  barbershopId: string;
  startDateCivil: string; // "YYYY-MM-DD"
  endDateCivil: string;   // "YYYY-MM-DD"
  participationMode: SweepstakeParticipationMode;
  targetSegment: SweepstakeCustomerSegment;
  serviceIds?: string[] | null;
}

export interface ChanceOriginItem {
  performedAt: Date;
  appointmentId?: string | null;
  comandaId?: string | null;
  comandaItemId?: string | null;
  serviceId?: string | null;
  serviceName: string;
  chancesGranted: number;
  justification: string;
}

export interface CalculatedParticipant {
  customerId: string;
  customerName: string;
  customerPhone: string;
  isClubMember: boolean;
  chancesCount: number;
  eligibleVisitsCount: number;
  eligibleServicesCount: number;
  chanceOrigins: ChanceOriginItem[];
}

export interface SweepstakePreviewResult {
  totalEligibleCustomers: number;
  totalEligibleVisits: number;
  totalEligibleServices: number;
  totalChances: number;
  participants: CalculatedParticipant[];
}

/**
 * Converte data civil de agendamento (que é salva em componentes UTC locais)
 * para objeto Date de início inclusivo e fim exclusivo.
 */
function getAppointmentCivilBoundaries(startDateCivil: string, endDateCivil: string) {
  const [ys, ms, ds] = startDateCivil.split("-").map(Number);
  const gteApp = new Date(Date.UTC(ys, ms - 1, ds, 0, 0, 0, 0));

  const nextDayStr = shiftDateISO(endDateCivil, 1);
  const [ye, me, de] = nextDayStr.split("-").map(Number);
  const ltApp = new Date(Date.UTC(ye, me - 1, de, 0, 0, 0, 0));

  return { gteApp, ltApp };
}

/**
 * Avalia se um cliente tinha assinatura ativa ou comprovada do clube no período avaliado.
 * Não confia exclusivamente em status atual mutável nem na flag clubBenefitRequested.
 */
export async function isCustomerClubMemberInPeriod(
  tx: Prisma.TransactionClient,
  params: {
    barbershopId: string;
    customerId: string;
    startInclusiveUtc: Date;
    endExclusiveUtc: Date;
    startMonthCompetence: string; // Ex: "2026-10"
    endMonthCompetence: string;   // Ex: "2026-10"
  }
): Promise<boolean> {
  const { barbershopId, customerId, startInclusiveUtc, endExclusiveUtc, startMonthCompetence, endMonthCompetence } = params;

  // 1. Pagamento aprovado de assinatura cobrindo a competência ou pago na vigência
  const validPayment = await tx.clubSubscriptionPayment.findFirst({
    where: {
      barbershopId,
      customerId,
      status: "PAID",
      OR: [
        { competence: { gte: startMonthCompetence, lte: endMonthCompetence } },
        { paidAt: { gte: startInclusiveUtc, lt: endExclusiveUtc } },
      ],
    },
    select: { id: true },
  });
  if (validPayment) return true;

  // 2. Uso efetivo e comprovado de benefício do clube no período (não apenas solicitação)
  const validUsage = await tx.clubBenefitUsage.findFirst({
    where: {
      barbershopId,
      status: "APPLIED",
      reversedAt: null,
      usedAt: { gte: startInclusiveUtc, lt: endExclusiveUtc },
      subscription: { customerId },
    },
    select: { id: true },
  });
  if (validUsage) return true;

  // 3. Assinatura cujo período/carência cobria o intervalo da campanha.
  // Fallback restrito a status vigentes (ACTIVE / GRACE_PERIOD): o schema não registra a data de
  // cancelamento, portanto uma assinatura CANCELED/EXPIRED/SUSPENDED/PAST_DUE NÃO é considerada ativa
  // apenas porque suas datas se sobrepõem ao período. Para essas, valem somente as evidências históricas
  // confiáveis acima (pagamento PAID ou uso APPLIED no período).
  // Exceção documentada: assinante cancelado após o período, sem pagamento/uso registrado no período,
  // não é classificado como membro do clube (comportamento conservador).
  const activeSub = await tx.customerClubSubscription.findFirst({
    where: {
      barbershopId,
      customerId,
      status: { in: ["ACTIVE", "GRACE_PERIOD"] },
      createdAt: { lt: endExclusiveUtc },
      currentPeriodStart: { lt: endExclusiveUtc },
      OR: [
        { currentPeriodEnd: { gte: startInclusiveUtc } },
        { gracePeriodEnd: { gte: startInclusiveUtc } },
      ],
    },
    select: { id: true, status: true },
  });

  return Boolean(activeSub);
}

/**
 * Calcula a elegibilidade de clientes, atendimentos e serviços com desduplicação canônica estrita.
 */
export async function calculateSweepstakeEligibility(
  tx: Prisma.TransactionClient,
  filter: SweepstakeEligibilityFilter
): Promise<SweepstakePreviewResult> {
  const { barbershopId, startDateCivil, endDateCivil, participationMode, targetSegment, serviceIds } = filter;

  const startInclusiveUtc = localDateToUTCBoundary(startDateCivil);
  const endExclusiveUtc = localDateToUTCBoundary(shiftDateISO(endDateCivil, 1));
  const { gteApp, ltApp } = getAppointmentCivilBoundaries(startDateCivil, endDateCivil);

  const startMonthCompetence = startDateCivil.slice(0, 7);
  const endMonthCompetence = endDateCivil.slice(0, 7);

  const serviceFilterSet = serviceIds && serviceIds.length > 0 ? new Set(serviceIds) : null;

  // 1. Buscar agendamentos: (a) com data agendada no período OU (b) com serviço concluído em comanda
  // vinculada cuja data real de execução (completedAt) cai no período (intervalo semiaberto, America/Sao_Paulo).
  const appointments = await tx.appointment.findMany({
    where: {
      barbershopId,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      OR: [
        { dateTime: { gte: gteApp, lt: ltApp } },
        {
          comandas: {
            some: {
              status: { not: "CANCELLED" },
              items: {
                some: {
                  type: "SERVICE",
                  status: "DONE",
                  completedAt: { gte: startInclusiveUtc, lt: endExclusiveUtc },
                },
              },
            },
          },
        },
      ],
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      services: { include: { service: true } },
      comandas: {
        where: { status: { not: "CANCELLED" } },
        include: {
          items: {
            where: {
              type: "SERVICE",
              status: "DONE",
            },
            include: { service: true },
          },
        },
      },
    },
    orderBy: { dateTime: "asc" },
  });

  // 2. Buscar comandas avulsas no período
  const standaloneComandas = await tx.comanda.findMany({
    where: {
      barbershopId,
      appointmentId: null,
      status: { not: "CANCELLED" },
      items: {
        some: {
          type: "SERVICE",
          status: "DONE",
          completedAt: { gte: startInclusiveUtc, lt: endExclusiveUtc },
        },
      },
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      items: {
        where: {
          type: "SERVICE",
          status: "DONE",
          completedAt: { gte: startInclusiveUtc, lt: endExclusiveUtc },
        },
        include: { service: true },
      },
    },
    orderBy: { openedAt: "asc" },
  });

  // Mapa de agregações por cliente
  interface CustomerBucket {
    customer: { id: string; name: string; phone: string };
    isClubMember: boolean;
    visitsCount: number;
    servicesCount: number;
    origins: ChanceOriginItem[];
  }

  const customerMap = new Map<string, CustomerBucket>();

  const getOrCreateBucket = async (cust: { id: string; name: string; phone: string }) => {
    let bucket = customerMap.get(cust.id);
    if (!bucket) {
      const isClub = await isCustomerClubMemberInPeriod(tx, {
        barbershopId,
        customerId: cust.id,
        startInclusiveUtc,
        endExclusiveUtc,
        startMonthCompetence,
        endMonthCompetence,
      });
      bucket = {
        customer: cust,
        isClubMember: isClub,
        visitsCount: 0,
        servicesCount: 0,
        origins: [],
      };
      customerMap.set(cust.id, bucket);
    }
    return bucket;
  };

  // Processar Agendamentos (com ou sem comanda vinculada)
  for (const app of appointments) {
    if (!app.customerId || !app.customer) continue;

    const bucket = await getOrCreateBucket({
      id: app.customerId,
      name: app.customer.name,
      phone: app.customer.phone,
    });

    const activeComanda = app.comandas && app.comandas.length > 0 ? app.comandas[0] : null;
    const hasComandaDoneServices = activeComanda && activeComanda.items && activeComanda.items.length > 0;
    const appDateInPeriod = app.dateTime >= gteApp && app.dateTime < ltApp;

    let appEligibleServicesCount = 0;
    let countsAsVisit = false;
    const currentOrigins: ChanceOriginItem[] = [];

    if (hasComandaDoneServices && activeComanda) {
      // Prioridade Canônica: Serviços da Comanda com status DONE, avaliados pela data REAL de execução.
      for (const item of activeComanda.items) {
        // Filtro de serviços: item sem serviceId NÃO entra quando a campanha restringe serviços.
        if (serviceFilterSet && (!item.serviceId || !serviceFilterSet.has(item.serviceId))) {
          continue;
        }
        // Data real: completedAt (UTC real) -> closedAt da comanda -> fallback dateTime do agendamento
        // (somente quando não há evidência de execução pela comanda).
        const executedAt = item.completedAt || activeComanda.closedAt || null;
        const inPeriod = executedAt
          ? executedAt >= startInclusiveUtc && executedAt < endExclusiveUtc
          : appDateInPeriod;
        if (!inPeriod) continue;

        const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
        appEligibleServicesCount += qty;
        currentOrigins.push({
          performedAt: executedAt || app.dateTime,
          appointmentId: app.id,
          comandaId: activeComanda.id,
          comandaItemId: item.id,
          serviceId: item.serviceId,
          serviceName: item.service?.name || item.description || "Serviço",
          chancesGranted: qty,
          justification: `Serviço concluído na comanda vinculada (${app.status})`,
        });
      }
      countsAsVisit = appEligibleServicesCount > 0;
    } else if (app.status === "COMPLETED" && appDateInPeriod) {
      // Sem evidência de execução pela comanda: preserva a semântica própria de Appointment.dateTime.
      for (const s of app.services) {
        if (serviceFilterSet && !serviceFilterSet.has(s.serviceId)) {
          continue;
        }
        appEligibleServicesCount += 1;
        currentOrigins.push({
          performedAt: app.dateTime,
          appointmentId: app.id,
          comandaId: activeComanda?.id || null,
          comandaItemId: null,
          serviceId: s.serviceId,
          serviceName: s.service?.name || "Serviço",
          chancesGranted: 1,
          justification: `Agendamento concluído (Appointment COMPLETED)`,
        });
      }
      countsAsVisit = appEligibleServicesCount > 0 || !serviceFilterSet;
    }

    if (countsAsVisit) {
      bucket.visitsCount += 1;
      bucket.servicesCount += appEligibleServicesCount;
      bucket.origins.push(...currentOrigins);
    }
  }

  // Processar Comandas Avulsas (appointmentId = null)
  for (const cmd of standaloneComandas) {
    if (!cmd.customerId || !cmd.customer) continue;

    const bucket = await getOrCreateBucket({
      id: cmd.customerId,
      name: cmd.customer.name,
      phone: cmd.customer.phone,
    });

    let cmdEligibleServicesCount = 0;
    const currentOrigins: ChanceOriginItem[] = [];

    for (const item of cmd.items) {
      // Filtro de serviços: item sem serviceId NÃO entra quando a campanha restringe serviços.
      if (serviceFilterSet && (!item.serviceId || !serviceFilterSet.has(item.serviceId))) {
        continue;
      }
      const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
      cmdEligibleServicesCount += qty;
      currentOrigins.push({
        performedAt: item.completedAt || cmd.closedAt || cmd.openedAt,
        appointmentId: null,
        comandaId: cmd.id,
        comandaItemId: item.id,
        serviceId: item.serviceId,
        serviceName: item.service?.name || item.description || "Serviço",
        chancesGranted: qty,
        justification: `Serviço concluído em comanda avulsa (${cmd.status})`,
      });
    }

    if (cmdEligibleServicesCount > 0) {
      bucket.visitsCount += 1;
      bucket.servicesCount += cmdEligibleServicesCount;
      bucket.origins.push(...currentOrigins);
    }
  }

  // Filtrar pelo segmento desejado (ALL, CLUB_ONLY, REGULAR_ONLY)
  const eligibleParticipants: CalculatedParticipant[] = [];
  let totalVisits = 0;
  let totalServices = 0;
  let totalChances = 0;

  for (const bucket of customerMap.values()) {
    if (bucket.visitsCount === 0 && bucket.servicesCount === 0) continue;

    if (targetSegment === "CLUB_ONLY" && !bucket.isClubMember) continue;
    if (targetSegment === "REGULAR_ONLY" && bucket.isClubMember) continue;

    let chances = 0;
    if (participationMode === "ONE_PER_CUSTOMER") {
      chances = 1;
    } else if (participationMode === "ONE_PER_APPOINTMENT") {
      chances = bucket.visitsCount;
    } else if (participationMode === "ONE_PER_SERVICE") {
      chances = bucket.servicesCount;
    }

    if (chances <= 0) continue;

    totalVisits += bucket.visitsCount;
    totalServices += bucket.servicesCount;
    totalChances += chances;

    eligibleParticipants.push({
      customerId: bucket.customer.id,
      customerName: bucket.customer.name,
      customerPhone: bucket.customer.phone,
      isClubMember: bucket.isClubMember,
      chancesCount: chances,
      eligibleVisitsCount: bucket.visitsCount,
      eligibleServicesCount: bucket.servicesCount,
      chanceOrigins: bucket.origins,
    });
  }

  // Ordenar por nome
  eligibleParticipants.sort((a, b) => a.customerName.localeCompare(b.customerName, "pt-BR"));

  return {
    totalEligibleCustomers: eligibleParticipants.length,
    totalEligibleVisits: totalVisits,
    totalEligibleServices: totalServices,
    totalChances,
    participants: eligibleParticipants,
  };
}

/**
 * Congela a campanha, salva os participantes com rastreabilidade forense,
 * emite os bilhetes sequenciais de 1 a N e grava os hashes imutáveis.
 */
export async function freezeCustomerSweepstake(
  tx: Prisma.TransactionClient,
  sweepstakeId: string,
  barbershopId: string,
  userId: string
) {
  const sweepstake = await tx.customerSweepstake.findUnique({
    where: { id_barbershopId: { id: sweepstakeId, barbershopId } },
    include: { prizes: true },
  });

  if (!sweepstake) {
    throw new Error("Campanha de sorteio não encontrada.");
  }

  if (sweepstake.status !== "DRAFT" && sweepstake.status !== "ACTIVE" && sweepstake.status !== "REGULATION_PENDING") {
    throw new Error(`Não é possível congelar uma campanha com status ${sweepstake.status}.`);
  }

  if (sweepstake.prizes.length === 0) {
    throw new Error("A campanha precisa ter pelo menos um prêmio cadastrado para ser congelada.");
  }

  // Validação regulatória quando a campanha for pública/regulada
  if (sweepstake.isRegulatedPromotion) {
    if (!sweepstake.authorizationCode || sweepstake.authorizationCode.trim().length === 0) {
      throw new Error("Campanhas com promoção regulamentada exigem o preenchimento do Certificado de Autorização (SPA/MF).");
    }
    if (!sweepstake.regulationsSummary || sweepstake.regulationsSummary.trim().length === 0) {
      throw new Error("Campanhas com promoção regulamentada exigem o resumo do regulamento oficial.");
    }
  }

  // 1. Calcular elegibilidade
  const eligibility = await calculateSweepstakeEligibility(tx, {
    barbershopId,
    startDateCivil: sweepstake.startDateCivil,
    endDateCivil: sweepstake.endDateCivil,
    participationMode: sweepstake.participationMode,
    targetSegment: sweepstake.targetSegment,
    serviceIds: sweepstake.serviceIds as string[] | null,
  });

  if (eligibility.totalChances === 0 || eligibility.participants.length === 0) {
    throw new Error("Nenhum cliente elegível encontrado para os filtros e período selecionados.");
  }

  // Limpar snapshots antigos se houver
  await tx.customerSweepstakeTicket.deleteMany({ where: { sweepstakeId, barbershopId } });
  await tx.customerSweepstakeChanceOrigin.deleteMany({ where: { sweepstakeId, barbershopId } });
  await tx.customerSweepstakeParticipant.deleteMany({ where: { sweepstakeId, barbershopId } });

  // 2. Persistir Participantes, Origins e Tickets
  let currentTicketNumber = 1;
  const ticketsToHash: Array<{ ticketNumber: number; participantId: string; customerId: string }> = [];

  for (const part of eligibility.participants) {
    const createdParticipant = await tx.customerSweepstakeParticipant.create({
      data: {
        sweepstakeId,
        barbershopId,
        customerId: part.customerId,
        isClubMemberSnapshot: part.isClubMember,
        chancesCount: part.chancesCount,
        eligibleVisitsCount: part.eligibleVisitsCount,
        eligibleServicesCount: part.eligibleServicesCount,
      },
    });

    // Registrar rastreabilidade forense das chances
    for (const origin of part.chanceOrigins) {
      await tx.customerSweepstakeChanceOrigin.create({
        data: {
          sweepstakeId,
          barbershopId,
          participantId: createdParticipant.id,
          customerId: part.customerId,
          appointmentId: origin.appointmentId || null,
          comandaId: origin.comandaId || null,
          comandaItemId: origin.comandaItemId || null,
          serviceId: origin.serviceId || null,
          performedAt: origin.performedAt,
          chancesGranted: origin.chancesGranted,
          justification: origin.justification,
        },
      });
    }

    // Gerar tickets sequenciais de 1 a N
    for (let c = 0; c < part.chancesCount; c++) {
      const ticketNum = currentTicketNumber++;
      await tx.customerSweepstakeTicket.create({
        data: {
          sweepstakeId,
          barbershopId,
          participantId: createdParticipant.id,
          ticketNumber: ticketNum,
        },
      });
      ticketsToHash.push({
        ticketNumber: ticketNum,
        participantId: createdParticipant.id,
        customerId: part.customerId,
      });
    }
  }

  // 3. Gerar Hashes Criptográficos Imutáveis
  ticketsToHash.sort((a, b) => a.ticketNumber - b.ticketNumber);
  const ticketsJson = JSON.stringify(ticketsToHash);
  const ticketsSha256Digest = crypto.createHash("sha256").update(ticketsJson).digest("hex");

  const frozenAt = new Date();
  const precommittedSeed = crypto
    .createHash("sha256")
    .update(`${ticketsSha256Digest}:${sweepstakeId}:${frozenAt.toISOString()}:${barbershopId}`)
    .digest("hex");

  // 4. Atualizar Campanha para FROZEN
  const updated = await tx.customerSweepstake.update({
    where: { id_barbershopId: { id: sweepstakeId, barbershopId } },
    data: {
      status: "FROZEN",
      totalEligibleCustomers: eligibility.totalEligibleCustomers,
      totalEligibleVisits: eligibility.totalEligibleVisits,
      totalEligibleServices: eligibility.totalEligibleServices,
      totalChancesAssigned: eligibility.totalChances,
      ticketsSha256Digest,
      precommittedSeed,
      frozenAt,
    },
    include: {
      prizes: { orderBy: { position: "asc" } },
      participants: { include: { customer: { select: { id: true, name: true, phone: true } } } },
    },
  });

  return updated;
}

/**
 * Gerador Determinístico Criptograficamente Seguro (CSPRNG baseado em HMAC-SHA256 / NIST SP 800-90A).
 * Substitui geradores lineares congruenciais (LCG), garantindo ausência de correlações lineares,
 * imprevisibilidade estatística e eliminação de viés de módulo através de amostragem por rejeição (rejection sampling).
 *
 * NOTA DE SEGURANÇA E CONFORMIDADE JURÍDICA:
 * A semente combinada e o algoritmo determinístico permitem a auditoria e verificação matemática da apuração,
 * mas NENHUM gerador de software local, isoladamente, garante imparcialidade pública ou substitui os requisitos
 * da Lei 5.768/71 e Ministério da Fazenda (SPA/MF). O uso em ambiente de produção requer homologação em laboratório
 * acreditado ou vinculação aos sorteios oficiais da Loteria Federal da Caixa Econômica Federal.
 */
export class HmacDeterministicRNG {
  private k: Buffer;
  private v: Buffer;
  private reseedCounter: number;

  constructor(seed: string | Buffer) {
    const seedBuf = Buffer.isBuffer(seed) ? seed : Buffer.from(seed, "utf-8");
    // NIST SP 800-90A Section 10.1.2.3: Instantiate
    this.k = Buffer.alloc(32, 0x00);
    this.v = Buffer.alloc(32, 0x01);
    this.reseedCounter = 1;
    this.update(seedBuf);
  }

  /**
   * NIST SP 800-90A Section 10.1.2.2: HMAC_DRBG_Update
   */
  private update(providedData?: Buffer): void {
    const hmac1 = crypto.createHmac("sha256", this.k);
    hmac1.update(this.v);
    hmac1.update(Buffer.from([0x00]));
    if (providedData) hmac1.update(providedData);
    this.k = hmac1.digest();

    const hmac2 = crypto.createHmac("sha256", this.k);
    hmac2.update(this.v);
    this.v = hmac2.digest();

    if (providedData) {
      const hmac3 = crypto.createHmac("sha256", this.k);
      hmac3.update(this.v);
      hmac3.update(Buffer.from([0x01]));
      hmac3.update(providedData);
      this.k = hmac3.digest();

      const hmac4 = crypto.createHmac("sha256", this.k);
      hmac4.update(this.v);
      this.v = hmac4.digest();
    }
  }

  /**
   * NIST SP 800-90A Section 10.1.2.5: HMAC_DRBG_Generate
   */
  generateBytes(numBytes: number): Buffer {
    const result = Buffer.alloc(numBytes);
    let bytesFilled = 0;

    while (bytesFilled < numBytes) {
      const hmac = crypto.createHmac("sha256", this.k);
      hmac.update(this.v);
      this.v = hmac.digest();

      const toCopy = Math.min(this.v.length, numBytes - bytesFilled);
      this.v.copy(result, bytesFilled, 0, toCopy);
      bytesFilled += toCopy;
    }

    this.update();
    this.reseedCounter++;
    return result;
  }

  nextUint32(): number {
    const bytes = this.generateBytes(4);
    return bytes.readUInt32BE(0);
  }

  nextInt(min: number, max: number): number {
    if (min >= max) return min;
    const range = max - min + 1;
    // Amostragem por rejeição para eliminar viés de módulo
    const limit = Math.floor(0x100000000 / range) * range;
    let val: number;
    do {
      val = this.nextUint32();
    } while (val >= limit);
    return min + (val % range);
  }
}

/**
 * Bilhete mínimo necessário para a seleção de ganhadores (independente do Prisma).
 */
export interface DrawableTicket {
  ticketNumber: number;
  participantId: string;
  customerId: string;
}

export interface WinnerSelectionInput {
  tickets: DrawableTicket[];
  prizePositions: number[];
  allowMultiplePrizesPerUser: boolean;
  method:
    | { kind: "ELECTRONIC_DETERMINISTIC"; rng: { nextInt(min: number, max: number): number } }
    | { kind: "FEDERAL_LOTTERY"; premios: string[] | null };
}

export interface WinnerSelection {
  prizePosition: number;
  ticketNumber: number;
  participantId: string;
  customerId: string;
}

/**
 * Seleciona os ganhadores de forma pura (sem I/O), garantindo:
 *  - Validação PRÉVIA de suficiência: se `allowMultiplePrizesPerUser = false`, exige ao menos
 *    tantos clientes DISTINTOS quanto prêmios; caso contrário, ao menos tantos bilhetes quanto prêmios.
 *    Insuficiência lança `INSUFFICIENT_ELIGIBLE_PARTICIPANTS` antes de qualquer gravação.
 *  - Nenhum bilhete é contemplado duas vezes.
 *  - Com `allowMultiplePrizesPerUser = false`, nenhum cliente é contemplado duas vezes em NENHUM caminho
 *    (não existe fallback que contorne a regra).
 *  - Terminação garantida: toda busca é limitada ao conjunto efetivamente disponível.
 *
 * Comportamento determinístico documentado:
 *  - ELECTRONIC_DETERMINISTIC: para cada prêmio (ordem crescente de posição), monta o conjunto de bilhetes
 *    ainda elegíveis em ordem crescente de número e escolhe o índice `rng.nextInt(0, n-1)`.
 *    Mesma semente => mesmo resultado.
 *  - FEDERAL_LOTTERY: número inicial = (prêmio federal da posição % totalBilhetes) + 1 (ou posição-base quando
 *    ausente); se o bilhete não for elegível, avança ciclicamente (aproximação superior) visitando no máximo
 *    `totalBilhetes` posições. Se nenhuma for elegível, lança erro (sem resultado parcial).
 */
export function selectSweepstakeWinners(input: WinnerSelectionInput): WinnerSelection[] {
  const { prizePositions, allowMultiplePrizesPerUser, method } = input;
  const tickets = [...input.tickets].sort((a, b) => a.ticketNumber - b.ticketNumber);
  const totalTickets = tickets.length;
  const requiredWinners = prizePositions.length;

  if (requiredWinners === 0) {
    throw new Error("Nenhum prêmio cadastrado para esta campanha.");
  }
  if (totalTickets === 0) {
    throw new Error("Nenhum bilhete encontrado no snapshot congelado.");
  }

  const distinctCustomers = new Set(tickets.map((t) => t.customerId)).size;
  const available = allowMultiplePrizesPerUser ? totalTickets : distinctCustomers;
  if (available < requiredWinners) {
    throw new Error(
      `INSUFFICIENT_ELIGIBLE_PARTICIPANTS: a campanha possui ${requiredWinners} prêmio(s), mas apenas ${available} ` +
        (allowMultiplePrizesPerUser ? "bilhete(s)" : "cliente(s) distinto(s)") +
        " elegível(is). Nenhum ganhador foi registrado."
    );
  }

  const ticketsByNumber = new Map(tickets.map((t) => [t.ticketNumber, t]));
  const awardedTickets = new Set<number>();
  const awardedCustomers = new Set<string>();
  const isEligible = (t: DrawableTicket) =>
    !awardedTickets.has(t.ticketNumber) && (allowMultiplePrizesPerUser || !awardedCustomers.has(t.customerId));

  const orderedPositions = [...prizePositions].sort((a, b) => a - b);
  const winners: WinnerSelection[] = [];

  orderedPositions.forEach((position, index) => {
    let chosen: DrawableTicket | null = null;

    if (method.kind === "ELECTRONIC_DETERMINISTIC") {
      const pool = tickets.filter(isEligible);
      if (pool.length === 0) {
        throw new Error(`INSUFFICIENT_ELIGIBLE_PARTICIPANTS: sem bilhetes elegíveis para o prêmio ${position}.`);
      }
      const idx = method.rng.nextInt(0, pool.length - 1);
      chosen = pool[idx] ?? null;
    } else {
      let start: number | null = null;
      const raw = method.premios && method.premios.length > index ? method.premios[index] : null;
      if (raw) {
        const num = parseInt(String(raw).replace(/\D/g, ""), 10);
        if (!isNaN(num) && num > 0) start = (num % totalTickets) + 1;
      }
      if (start === null) start = ((position + index) % totalTickets) + 1;

      // Busca cíclica limitada: no máximo totalTickets passos (sem loop infinito)
      let current = start;
      for (let step = 0; step < totalTickets; step++) {
        const candidate = ticketsByNumber.get(current);
        if (candidate && isEligible(candidate)) {
          chosen = candidate;
          break;
        }
        current = (current % totalTickets) + 1;
      }
    }

    if (!chosen) {
      throw new Error(
        `INCONSISTENT_DRAW_RESULT: não foi possível determinar ganhador elegível para o prêmio ${position}. Nenhum ganhador foi registrado.`
      );
    }

    awardedTickets.add(chosen.ticketNumber);
    awardedCustomers.add(chosen.customerId);
    winners.push({
      prizePosition: position,
      ticketNumber: chosen.ticketNumber,
      participantId: chosen.participantId,
      customerId: chosen.customerId,
    });
  });

  // Validação final de consistência antes de qualquer persistência
  if (winners.length !== requiredWinners) {
    throw new Error("INCONSISTENT_DRAW_RESULT: quantidade de ganhadores difere da quantidade de prêmios.");
  }
  if (new Set(winners.map((w) => w.ticketNumber)).size !== winners.length) {
    throw new Error("INCONSISTENT_DRAW_RESULT: bilhete contemplado mais de uma vez.");
  }
  if (!allowMultiplePrizesPerUser && new Set(winners.map((w) => w.customerId)).size !== winners.length) {
    throw new Error("INCONSISTENT_DRAW_RESULT: cliente contemplado mais de uma vez com allowMultiplePrizesPerUser = false.");
  }

  return winners;
}

export interface DrawSweepstakeInput {
  sweepstakeId: string;
  barbershopId: string;
  drawnByUserId: string;
  federalLotteryConcurso?: string | null;
  federalLotteryPremios?: string[] | null;
  isTechnicalSimulation?: boolean;
}

/**
 * Executa a apuração oficial do sorteio com verificação estrita dos gates regulatórios,
 * bloqueio transacional e idempotência comprovada.
 */
export async function executeSweepstakeDraw(
  tx: Prisma.TransactionClient,
  input: DrawSweepstakeInput
) {
  const {
    sweepstakeId,
    barbershopId,
    drawnByUserId,
    federalLotteryConcurso,
    federalLotteryPremios,
    isTechnicalSimulation = false,
  } = input;

  // Bloqueio exclusivo de linha (FOR UPDATE)
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status FROM customer_sweepstakes
    WHERE id = ${sweepstakeId} AND barbershop_id = ${barbershopId}
    FOR UPDATE
  `;

  if (!rows || rows.length === 0) {
    throw new Error("Campanha de sorteio não encontrada.");
  }

  const current = rows[0];
  if (current.status === "DRAWN" || current.status === "AUDITED") {
    throw new Error("SWEEPSTAKE_ALREADY_DRAWN: Esta campanha já foi apurada oficialmente.");
  }

  if (current.status !== "FROZEN") {
    throw new Error(`A apuração só pode ser executada em campanhas com status FROZEN (atual: ${current.status}).`);
  }

  const sweepstake = await tx.customerSweepstake.findUniqueOrThrow({
    where: { id_barbershopId: { id: sweepstakeId, barbershopId } },
    include: {
      prizes: { orderBy: { position: "asc" } },
      tickets: {
        include: {
          participant: {
            include: {
              customer: { select: { id: true, name: true, phone: true } },
            },
          },
        },
        orderBy: { ticketNumber: "asc" },
      },
    },
  });

  if (sweepstake.tickets.length === 0) {
    throw new Error("Nenhum bilhete encontrado no snapshot congelado.");
  }

  if (sweepstake.prizes.length === 0) {
    throw new Error("Nenhum prêmio cadastrado para esta campanha.");
  }

  // Gate temporal: agora deve ser >= término exclusivo
  const now = new Date();
  if (now.getTime() < sweepstake.endExclusiveUtc.getTime()) {
    throw new Error(
      `Gate temporal não atingido: o período elegível da campanha se encerra apenas em ${sweepstake.endDateCivil} (fim exclusivo ${sweepstake.endExclusiveUtc.toISOString()}).`
    );
  }

  // Gate regulatório estrito (Lei 5.768/71 & Portaria SPA/MF)
  if (sweepstake.isRegulatedPromotion) {
    if (!sweepstake.authorizationCode || sweepstake.authorizationCode.trim().length < 6) {
      throw new Error("Gate regulatório: código do Certificado de Autorização SPA/MF é obrigatório para campanhas regulamentadas.");
    }
  }

  // TRAVA REGULATÓRIA ESTRITA V1:
  // A legislação brasileira (Lei 5.768/71 e normativas SPA/MF) exige que sorteios eletrônicos comerciais
  // com distribuição pública de prêmios sejam previamente certificados por laboratório de testes independente.
  // Na versão V1, a execução oficial pública permanece bloqueada pelo servidor até a validação da modalidade aplicável.
  // Nem o preenchimento de código de autorização nem a flag isRegulatedPromotion = false dispensam essa trava.
  if (!isTechnicalSimulation) {
    throw new Error(
      "APURACAO_OFICIAL_BLOQUEADA_V1: Na versão V1, a apuração oficial permanece bloqueada aguardando a validação jurídica e técnica da modalidade aplicável (Loteria Federal ou sistema homologado SPA/MF). Apenas simulações técnicas internas são permitidas."
    );
  }

  // Realizar apuração (seleção pura e validada ANTES de qualquer gravação;
  // qualquer erro aborta a transação sem ganhadores parciais)
  const ticketsByNumber = new Map(sweepstake.tickets.map((t) => [t.ticketNumber, t]));
  const drawableTickets: DrawableTicket[] = sweepstake.tickets.map((t) => ({
    ticketNumber: t.ticketNumber,
    participantId: t.participantId,
    customerId: t.participant.customerId,
  }));
  const prizePositions = sweepstake.prizes.map((p) => p.position);

  let seedUsedForAudit = sweepstake.precommittedSeed || "LOTERIA_FEDERAL";
  let selection: WinnerSelection[];
  let reasonText: string;

  if (sweepstake.drawMethod === "ELECTRONIC_DETERMINISTIC") {
    // Para impedir que o resultado seja antecipado ou calculado previamente a partir da precommittedSeed
    // do snapshot congelado, um salt criptográfico de execução de 32 bytes gerado pelo servidor em tempo de execução
    // é combinado à semente dentro da transação blindada.
    const executionEntropy = crypto.randomBytes(32).toString("hex");
    const effectiveSeed = crypto
      .createHash("sha256")
      .update(`${sweepstake.precommittedSeed || "seed"}:${executionEntropy}:${sweepstake.id}`)
      .digest("hex");

    seedUsedForAudit = `PRECOMMIT:${sweepstake.precommittedSeed || "none"}|EXEC_SALT:${executionEntropy}|EFFECTIVE:${effectiveSeed}`;

    selection = selectSweepstakeWinners({
      tickets: drawableTickets,
      prizePositions,
      allowMultiplePrizesPerUser: sweepstake.allowMultiplePrizesPerUser,
      method: { kind: "ELECTRONIC_DETERMINISTIC", rng: new HmacDeterministicRNG(effectiveSeed) },
    });
    reasonText = isTechnicalSimulation
      ? `Simulação técnica local via CSPRNG HMAC-SHA256 (NIST SP 800-90A) com semente pré-comprometida`
      : `Sorteio determinístico CSPRNG HMAC-SHA256 auditável com semente pré-comprometida`;
  } else if (sweepstake.drawMethod === "FEDERAL_LOTTERY") {
    if (!federalLotteryConcurso || federalLotteryConcurso.trim().length === 0) {
      throw new Error("Número do concurso da Loteria Federal é obrigatório para este método.");
    }
    selection = selectSweepstakeWinners({
      tickets: drawableTickets,
      prizePositions,
      allowMultiplePrizesPerUser: sweepstake.allowMultiplePrizesPerUser,
      method: { kind: "FEDERAL_LOTTERY", premios: federalLotteryPremios ?? null },
    });
    reasonText = `Mapeado pelo resultado do concurso ${federalLotteryConcurso} da Loteria Federal`;
  } else {
    throw new Error(`Método de apuração não suportado: ${String(sweepstake.drawMethod)}`);
  }

  const selectedWinners = selection.map((w) => {
    const ticket = ticketsByNumber.get(w.ticketNumber)!;
    return {
      prizePosition: w.prizePosition,
      winningTicketNumber: w.ticketNumber,
      participantId: w.participantId,
      customerId: w.customerId,
      customerName: ticket.participant.customer.name,
      customerPhone: ticket.participant.customer.phone,
    };
  });

  const auditLog = selection.map((w) => ({
    position: w.prizePosition,
    ticketNumber: w.ticketNumber,
    customerId: w.customerId,
    reason: reasonText,
  }));

  // Gravar Ganhadores
  for (const win of selectedWinners) {
    await tx.customerSweepstakeWinner.create({
      data: {
        sweepstakeId,
        barbershopId,
        participantId: win.participantId,
        winningTicketNumber: win.winningTicketNumber,
        prizePosition: win.prizePosition,
        customerNameSnapshot: win.customerName,
        customerPhoneSnapshot: win.customerPhone,
      },
    });
  }

  // Gravar Registro de Auditoria
  await tx.customerSweepstakeDrawAudit.create({
    data: {
      sweepstakeId,
      barbershopId,
      drawnById: drawnByUserId,
      drawnAt: now,
      drawMethod: sweepstake.drawMethod,
      seedUsed: seedUsedForAudit,
      ticketsSha256Snapshot: sweepstake.ticketsSha256Digest || "",
      auditLogJson: auditLog as unknown as Prisma.InputJsonValue,
    },
  });

  // Atualizar Campanha para DRAWN
  const drawnSweepstake = await tx.customerSweepstake.update({
    where: { id_barbershopId: { id: sweepstakeId, barbershopId } },
    data: {
      status: "DRAWN",
      drawnAt: now,
      federalLotteryContestNumber: federalLotteryConcurso || sweepstake.federalLotteryContestNumber,
    },
    include: {
      prizes: { orderBy: { position: "asc" } },
      winners: { orderBy: { prizePosition: "asc" } },
      drawAudit: true,
    },
  });

  return drawnSweepstake;
}
