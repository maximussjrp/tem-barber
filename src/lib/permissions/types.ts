export const ALL_PERMISSION_KEYS = [
  "AGENDA_VIEW_ALL",
  "AGENDA_CREATE_OWN",
  "AGENDA_CREATE_ALL",
  "AGENDA_EDIT_OWN",
  "AGENDA_EDIT_ALL",
  "AGENDA_BLOCK_OWN",
  "AGENDA_BLOCK_ALL",
  "CLIENTS_VIEW",
  "CLIENTS_MANAGE",
  "COMANDAS_OWN",
  "COMANDAS_ALL",
  "DISCOUNT_APPLY",
  "CASH_MANAGE",
  "FINANCIAL_VIEW",
  "COMMISSIONS_MANAGE",
  "TIPS_MANAGE",
  "WAITLIST_MANAGE",
  "TEAM_MANAGE",
  "SERVICES_MANAGE",
  "SETTINGS_MANAGE",
] as const;

export type PermissionKey = (typeof ALL_PERMISSION_KEYS)[number];

export type PermissionMap = Record<PermissionKey, boolean>;

export type PermissionCategory =
  | "agenda"
  | "clientes"
  | "comandas"
  | "financeiro"
  | "gestao";

export interface PermissionDefinition {
  key: PermissionKey;
  label: string;
  category: PermissionCategory;
  description: string;
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  // Agenda
  {
    key: "AGENDA_VIEW_ALL",
    label: "Ver agenda de todos",
    category: "agenda",
    description: "Visualizar a grade e horários de todos os profissionais da barbearia",
  },
  {
    key: "AGENDA_CREATE_OWN",
    label: "Criar agendamentos próprios",
    category: "agenda",
    description: "Agendar novos clientes na própria agenda",
  },
  {
    key: "AGENDA_CREATE_ALL",
    label: "Criar agendamentos para outros",
    category: "agenda",
    description: "Agendar clientes na grade de qualquer profissional",
  },
  {
    key: "AGENDA_EDIT_OWN",
    label: "Editar próprios agendamentos",
    category: "agenda",
    description: "Remarcar, alterar serviços ou cancelar agendamentos próprios",
  },
  {
    key: "AGENDA_EDIT_ALL",
    label: "Editar agendamentos de todos",
    category: "agenda",
    description: "Remarcar, alterar serviços ou cancelar agendamentos de outros profissionais",
  },
  {
    key: "AGENDA_BLOCK_OWN",
    label: "Bloquear horários próprios",
    category: "agenda",
    description: "Criar pausas e bloqueios de horário na própria agenda",
  },
  {
    key: "AGENDA_BLOCK_ALL",
    label: "Bloquear horários de todos",
    category: "agenda",
    description: "Criar pausas e bloqueios na agenda de qualquer profissional",
  },
  // Clientes
  {
    key: "CLIENTS_VIEW",
    label: "Visualizar clientes",
    category: "clientes",
    description: "Acessar a lista e histórico de clientes cadastrados",
  },
  {
    key: "CLIENTS_MANAGE",
    label: "Gerenciar clientes",
    category: "clientes",
    description: "Cadastrar novos clientes e editar dados cadastrais",
  },
  // Comandas
  {
    key: "COMANDAS_OWN",
    label: "Gerenciar próprias comandas",
    category: "comandas",
    description: "Abrir e gerenciar comandas dos seus atendimentos",
  },
  {
    key: "COMANDAS_ALL",
    label: "Gerenciar todas as comandas",
    category: "comandas",
    description: "Abrir, editar e cobrar comandas de qualquer profissional",
  },
  {
    key: "DISCOUNT_APPLY",
    label: "Aplicar descontos",
    category: "comandas",
    description: "Conceder descontos manuais no fechamento de comandas",
  },
  // Financeiro
  {
    key: "CASH_MANAGE",
    label: "Gerenciar caixa",
    category: "financeiro",
    description: "Abrir, sangrar, suprir e fechar turnos de caixa",
  },
  {
    key: "FINANCIAL_VIEW",
    label: "Ver financeiro",
    category: "financeiro",
    description: "Visualizar faturamento, relatórios de receitas e despesas",
  },
  {
    key: "COMMISSIONS_MANAGE",
    label: "Gerenciar comissões",
    category: "financeiro",
    description: "Configurar regras de comissão, adiantamentos e realizar fechamento de repasses",
  },
  {
    key: "TIPS_MANAGE",
    label: "Gerenciar gorjetas",
    category: "financeiro",
    description: "Visualizar repasses de gorjetas e realizar pagamentos aos colaboradores",
  },
  // Gestão
  {
    key: "WAITLIST_MANAGE",
    label: "Gerenciar fila de espera",
    category: "gestao",
    description: "Chamar, adicionar e finalizar clientes na fila de espera online e presencial",
  },
  {
    key: "TEAM_MANAGE",
    label: "Gerenciar equipe",
    category: "gestao",
    description: "Convidar colaboradores, editar perfis, resetar acessos e gerenciar permissões",
  },
  {
    key: "SERVICES_MANAGE",
    label: "Gerenciar serviços",
    category: "gestao",
    description: "Criar, alterar preços e ativar/desativar serviços e categorias",
  },
  {
    key: "SETTINGS_MANAGE",
    label: "Configurações da barbearia",
    category: "gestao",
    description: "Alterar horários de funcionamento, dados da barbearia e integrações",
  },
];
