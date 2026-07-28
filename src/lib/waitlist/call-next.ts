import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { ScheduleBlockConflictApptError } from "@/lib/appointments/errors";
import { createFitInAppointmentWithScheduleLock } from "@/lib/appointments/create-fit-in-appointment";
import { getCurrentSaoPauloDateTimeForAppointment } from "@/lib/time-utils";

export interface CallNextWaitlistEntryInput {
  barbershopId: string;
  memberId: string;
  calledByUserId: string;
  confirmPreferredMismatch?: boolean;
}

export interface PreferredMemberInfo {
  id: string;
  name: string;
}

export class CallNextWaitlistError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public preferredMember?: PreferredMemberInfo | null
  ) {
    super(message);
    this.name = "CallNextWaitlistError";
  }
}

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && !isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) return parsed;
  }
  return fallback;
}

export async function callNextWaitlistEntry(input: CallNextWaitlistEntryInput) {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    try {
      return await prisma.$transaction(
        async (tx) => {
          // 1. Verify barbershop member belongs to barbershop and is active
          const member = await tx.barbershopMember.findFirst({
            where: {
              id: input.memberId,
              barbershopId: input.barbershopId,
              isActive: true,
            },
            include: {
              user: { select: { id: true, name: true } },
            },
          });

          if (!member) {
            throw new CallNextWaitlistError(
              "MEMBER_NOT_FOUND",
              "Profissional não encontrado ou inativo nesta barbearia.",
              400
            );
          }

          // 2. Verify queue session is OPEN
          const session = await tx.onlineWaitlistSession.findFirst({
            where: {
              barbershopId: input.barbershopId,
              status: "OPEN",
            },
          });

          if (!session) {
            throw new CallNextWaitlistError(
              "WAITLIST_NOT_OPEN",
              "A fila online não está aberta nesta barbearia.",
              400
            );
          }

          // 3. Find first WAITING entry ordered by positionWeight asc, createdAt asc
          const entry = await tx.onlineWaitlistEntry.findFirst({
            where: {
              sessionId: session.id,
              status: "WAITING",
            },
            orderBy: [{ positionWeight: "asc" }, { createdAt: "asc" }],
            include: {
              service: true,
              customer: { select: { id: true, name: true, phone: true } },
              preferredMember: { include: { user: { select: { id: true, name: true } } } },
            },
          });

          if (!entry) {
            throw new CallNextWaitlistError(
              "EMPTY_WAITLIST",
              "Nenhum cliente aguardando na fila.",
              400
            );
          }

          // 4. Verify capability (BarberService)
          const capability = await tx.barberService.findUnique({
            where: {
              barberId_serviceId: {
                barberId: member.id,
                serviceId: entry.serviceId,
              },
            },
          });

          if (!capability) {
            throw new CallNextWaitlistError(
              "MEMBER_CANNOT_EXECUTE_SERVICE",
              `O profissional ${member.user.name || "selecionado"} não realiza o serviço "${entry.service.name}".`,
              400
            );
          }

          // 5. Lock check (lockBeforeAppointmentMinutes)
          const memberConfig = await tx.onlineWaitlistMemberConfig.findUnique({
            where: { memberId: member.id },
          });

          const lockMinutes =
            memberConfig?.lockBeforeAppointmentMinutes ??
            session.defaultLockBeforeAppointmentMinutes ??
            20;

          const now = new Date();
          const nextAppointment = await tx.appointment.findFirst({
            where: {
              memberId: member.id,
              barbershopId: input.barbershopId,
              status: { in: ["CONFIRMED", "PENDING"] },
              dateTime: { gt: now },
            },
            orderBy: { dateTime: "asc" },
            select: { dateTime: true },
          });

          if (nextAppointment) {
            const timeUntilNextAppointmentMs = nextAppointment.dateTime.getTime() - now.getTime();
            const lockMs = lockMinutes * 60 * 1000;
            if (timeUntilNextAppointmentMs <= lockMs) {
              throw new CallNextWaitlistError(
                "MEMBER_LOCKED_BY_UPCOMING_APPOINTMENT",
                "Este profissional tem um agendamento próximo e não pode chamar a fila agora.",
                400
              );
            }
          }

          // 6. Check customer preference mismatch
          const preferredMemberMismatch =
            entry.preferredMemberId !== null && entry.preferredMemberId !== member.id;

          if (preferredMemberMismatch && !input.confirmPreferredMismatch) {
            const preferredName =
              entry.preferredMember?.user?.name ?? "outro profissional";
            throw new CallNextWaitlistError(
              "PREFERRED_MEMBER_MISMATCH",
              `Este cliente indicou preferência por ${preferredName}.`,
              409,
              entry.preferredMemberId
                ? { id: entry.preferredMemberId, name: preferredName }
                : null
            );
          }

          // 7. Ensure customer record exists
          let customerId = entry.customerId;
          if (!customerId) {
            const user = await tx.user.findFirst({
              where: { phone: entry.customerPhone },
              select: { id: true },
            });

            if (user) {
              customerId = user.id;
            } else {
              const newUser = await tx.user.create({
                data: {
                  name: entry.customerName,
                  phone: entry.customerPhone,
                  role: "USER",
                },
              });
              customerId = newUser.id;
            }
          }

          // 8. Create FIT_IN appointment with local operational date/time (America/Sao_Paulo)
          const servicePrice = parseNumber(entry.service.price, 0);
          const appointmentDateTime = getCurrentSaoPauloDateTimeForAppointment(now);

          const { appointment } = await createFitInAppointmentWithScheduleLock(tx, {
            barbershopId: input.barbershopId,
            memberId: member.id,
            customerId: customerId,
            dateTime: appointmentDateTime,
            totalPrice: servicePrice,
            durationMin: entry.service.durationMin,
            services: [
              {
                id: entry.service.id,
                price: servicePrice,
                durationMin: entry.service.durationMin,
              },
            ],
            fitInReason: `Fila Online - Senha #${entry.queueNumber}`,
            fitInCreatedById: input.calledByUserId,
          });

          // 9. Atomic update of OnlineWaitlistEntry
          const updateResult = await tx.onlineWaitlistEntry.updateMany({
            where: {
              id: entry.id,
              status: "WAITING",
              fitInAppointmentId: null,
            },
            data: {
              status: "FIT_IN_CREATED",
              calledByMemberId: member.id,
              calledAt: now,
              fitInAppointmentId: appointment.id,
              updatedAt: now,
            },
          });

          if (updateResult.count === 0) {
            throw new CallNextWaitlistError(
              "WAITLIST_ENTRY_ALREADY_CALLED",
              "Esta senha já foi chamada por outro atendimento.",
              409
            );
          }

          // 10. Fetch updated entry
          const updatedEntry = await tx.onlineWaitlistEntry.findUnique({
            where: { id: entry.id },
            include: {
              service: { select: { id: true, name: true, durationMin: true, price: true } },
              calledByMember: { include: { user: { select: { id: true, name: true } } } },
              preferredMember: { include: { user: { select: { id: true, name: true } } } },
            },
          });

          return {
            entry: updatedEntry,
            appointment,
            preferredMemberMismatch,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        }
      );
    } catch (err) {
      if (err instanceof ScheduleBlockConflictApptError) {
        throw new CallNextWaitlistError(err.code, err.message, err.status);
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2034" &&
        attempt < maxRetries
      ) {
        continue;
      }
      throw err;
    }
  }

  throw new CallNextWaitlistError(
    "CONCURRENCY_ERROR",
    "Não foi possível processar a chamada devido à alta concorrência. Tente novamente.",
    409
  );
}
