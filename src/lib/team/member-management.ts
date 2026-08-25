export type TenantMemberRole = "OWNER" | "MANAGER" | "BARBER";

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
 * Structural safety rules for the legacy role model.
 * This is intentionally small and must not evolve into the permission engine.
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

  if (target.role === "OWNER") {
    if (actor.role !== "OWNER" || changesRole || deactivatesTarget) {
      throw new MemberManagementError(
        "OWNER_PROTECTED",
        "O proprietário da barbearia não pode ser alterado ou desativado por esta operação."
      );
    }
  }

  if (mutation.requestedRole === "OWNER" && target.role !== "OWNER") {
    throw new MemberManagementError(
      actor.role === "MANAGER" ? "ROLE_ESCALATION_FORBIDDEN" : "OWNER_PROTECTED",
      "A transferência de propriedade não está disponível nesta operação."
    );
  }
}
