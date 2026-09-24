export type TenantMemberRole = "OWNER" | "MANAGER" | "BARBER" | "RECEPTIONIST";

interface MemberActor {
  memberId: string | null;
  role: string;
  barbershopId: string;
}

interface MemberTarget {
  id: string;
  role: TenantMemberRole;
  barbershopId: string;
  isActive: boolean;
}

interface MemberMutation {
  requestedRole?: TenantMemberRole;
  requestedIsActive?: boolean;
}

export class MemberManagementError extends Error {
  constructor(
    public readonly code: "OWNER_PROTECTED" | "ROLE_ESCALATION_FORBIDDEN",
    message: string
  ) {
    super(message);
    this.name = "MemberManagementError";
  }
}

/**
 * Structural safety rules for team member management.
 * Enforces strict hierarchy between OWNER, MANAGER, BARBER, RECEPTIONIST.
 */
export function assertCanManageMember(
  actor: MemberActor,
  target: MemberTarget,
  mutation: MemberMutation
) {
  if (actor.barbershopId !== target.barbershopId) {
    throw new MemberManagementError("OWNER_PROTECTED", "Colaborador não encontrado.");
  }

  const changesRole =
    mutation.requestedRole !== undefined && mutation.requestedRole !== target.role;
  const deactivatesTarget = mutation.requestedIsActive === false && target.isActive;

  // 1. Proteger OWNER incondicionalmente contra demotion, deativação ou edição por terceiros
  if (target.role === "OWNER") {
    if (actor.role !== "OWNER" || changesRole || deactivatesTarget) {
      throw new MemberManagementError(
        "OWNER_PROTECTED",
        "O proprietário da barbearia não pode ser alterado ou desativado por esta operação."
      );
    }
  }

  // 2. Não permitir promoção para OWNER através de edição de membro
  if (mutation.requestedRole === "OWNER" && target.role !== "OWNER") {
    throw new MemberManagementError(
      actor.role === "MANAGER" ? "ROLE_ESCALATION_FORBIDDEN" : "OWNER_PROTECTED",
      "A transferência de propriedade não está disponível nesta operação."
    );
  }

  // 3. Hierarquia do MANAGER: não pode gerenciar outro MANAGER nem OWNER
  if (actor.role === "MANAGER") {
    if (target.role === "MANAGER" && actor.memberId !== target.id) {
      throw new MemberManagementError(
        "ROLE_ESCALATION_FORBIDDEN",
        "Gerentes não possuem permissão para alterar outros gerentes."
      );
    }

    if (mutation.requestedRole === "MANAGER" && target.role !== "MANAGER") {
      throw new MemberManagementError(
        "ROLE_ESCALATION_FORBIDDEN",
        "Gerentes não possuem permissão para promover colaboradores a Gerente."
      );
    }
  }
}
