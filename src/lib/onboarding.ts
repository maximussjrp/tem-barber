export type OnboardingInput = {
  barbershop: {
    name?: string | null;
    slug?: string | null;
    city?: string | null;
    phone?: string | null;
    logoUrl?: string | null;
    coverUrl?: string | null;
  } | null;
  activeServicesCount: number;
  activeWorkingHoursCount: number;
  schedulableProfessionalsCount: number;
};

export type OnboardingStep = {
  id: "barbershop" | "brand" | "professionals" | "services" | "hours" | "public-link";
  title: string;
  description: string;
  actionLabel: string;
  href: string;
  done: boolean;
  feedback: string;
};

export function buildOnboardingSteps(input: OnboardingInput): OnboardingStep[] {
  const barbershop = input.barbershop;
  const hasPublicData = Boolean(
    barbershop?.name?.trim() &&
      barbershop.slug?.trim() &&
      (barbershop.city?.trim() || barbershop.phone?.trim())
  );
  const hasBrand = Boolean(barbershop?.logoUrl?.trim() || barbershop?.coverUrl?.trim());
  const hasProfessionals = input.schedulableProfessionalsCount > 0;
  const hasServices = input.activeServicesCount > 0;
  const hasHours = input.activeWorkingHoursCount > 0;
  const hasPublicLink = Boolean(barbershop?.slug?.trim());

  return [
    {
      id: "barbershop",
      title: "Dados da barbearia",
      description: "Revise nome, cidade, telefone e informacoes publicas.",
      actionLabel: "Editar dados",
      href: "/admin/configuracoes",
      done: hasPublicData,
      feedback: hasPublicData ? "Dados essenciais preenchidos." : "Complete nome, contato e cidade.",
    },
    {
      id: "brand",
      title: "Marca visual",
      description: "Adicione logo ou capa para reforcar a identidade da barbearia.",
      actionLabel: "Editar marca",
      href: "/admin/configuracoes",
      done: hasBrand,
      feedback: hasBrand ? "Marca visual configurada." : "Adicione logo ou foto de capa.",
    },
    {
      id: "professionals",
      title: "Profissionais",
      description: "Cadastre quem atende e vincule servicos aos profissionais.",
      actionLabel: "Gerenciar equipe",
      href: "/admin/equipe",
      done: hasProfessionals,
      feedback: hasProfessionals
        ? "Ha profissional ativo pronto para agenda."
        : "Vincule servicos a pelo menos um profissional ativo.",
    },
    {
      id: "services",
      title: "Servicos",
      description: "Cadastre os servicos que seus clientes podem agendar.",
      actionLabel: "Gerenciar servicos",
      href: "/admin/servicos",
      done: hasServices,
      feedback: hasServices ? "Catalogo com servicos ativos." : "Crie pelo menos um servico ativo.",
    },
    {
      id: "hours",
      title: "Horarios",
      description:
        "Configure primeiro o horario da barbearia. Depois ajuste horarios individuais dos profissionais na equipe, se necessario.",
      actionLabel: "Configurar horarios",
      href: "/admin/configuracoes/horarios",
      done: hasHours,
      feedback: hasHours ? "Horarios ativos configurados." : "Defina os horarios de atendimento.",
    },
    {
      id: "public-link",
      title: "Link publico",
      description: "Compartilhe o link de agendamento com seus clientes.",
      actionLabel: "Revisar link",
      href: "/admin/onboarding#link-publico",
      done: hasPublicLink,
      feedback: hasPublicLink ? "Link publico disponivel." : "O link sera criado com o cadastro da barbearia.",
    },
  ];
}

export function countCompletedOnboardingSteps(steps: OnboardingStep[]) {
  return steps.filter((step) => step.done).length;
}
