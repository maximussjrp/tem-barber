export interface NavChildItem {
  label: string;
  href: string;
  roles?: string[];
}

export interface NavItemConfig {
  label: string;
  href: string;
  iconName:
    | "dashboard"
    | "calendar"
    | "clients"
    | "scissors"
    | "cash"
    | "financial"
    | "commissions"
    | "tips"
    | "club"
    | "marketing"
    | "settings"
    | "platform";
  ownerOnly: boolean;
  children: NavChildItem[];
}

export interface NavGroupConfig {
  id: string;
  title: string;
  items: NavItemConfig[];
}

export const ADMIN_NAV_CONFIG: NavItemConfig[] = [
  {
    label: "Dashboard",
    href: "/admin/dashboard",
    iconName: "dashboard",
    children: [],
    ownerOnly: false,
  },
  {
    label: "Agendamentos",
    href: "/admin/agendamentos",
    iconName: "calendar",
    children: [],
    ownerOnly: false,
  },
  {
    label: "Fila Online",
    href: "/admin/fila",
    iconName: "calendar",
    children: [],
    ownerOnly: false,
  },
  {
    label: "Comandas",
    href: "/admin/comandas",
    iconName: "calendar",
    children: [],
    ownerOnly: false,
  },
  {
    label: "Clientes",
    href: "/admin/clientes",
    iconName: "clients",
    ownerOnly: false,
    children: [
      { label: "Base de clientes", href: "/admin/clientes" },
      {
        label: "Reativação",
        href: "/admin/clientes/reativacao",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
    ],
  },
  {
    label: "Produtos",
    href: "/admin/produtos",
    iconName: "scissors",
    children: [],
    ownerOnly: false,
  },
  {
    label: "Caixa",
    href: "/admin/caixa",
    iconName: "cash",
    children: [],
    ownerOnly: false,
  },
  {
    label: "Financeiro",
    href: "/admin/financeiro",
    iconName: "financial",
    ownerOnly: true,
    children: [
      {
        label: "Visão Geral",
        href: "/admin/financeiro",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
      {
        label: "Contas",
        href: "/admin/financeiro/contas",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
      {
        label: "Movimentações",
        href: "/admin/financeiro/movimentacoes",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
      {
        label: "Fluxo de Caixa",
        href: "/admin/financeiro/fluxo-caixa",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
      {
        label: "Contas Recorrentes",
        href: "/admin/financeiro/recorrentes",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
      {
        label: "Categorias",
        href: "/admin/financeiro/categorias",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
      {
        label: "Relatório Gerencial",
        href: "/admin/financeiro/relatorio-gerencial",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
      {
        label: "Configurações",
        href: "/admin/financeiro/configuracoes",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
    ],
  },
  {
    label: "Comissões",
    href: "/admin/comissoes",
    iconName: "commissions",
    children: [],
    ownerOnly: false,
  },
  {
    label: "Gorjetas",
    href: "/admin/gorjetas",
    iconName: "tips",
    children: [],
    ownerOnly: false,
  },
  {
    label: "Serviços",
    href: "/admin/servicos",
    iconName: "scissors",
    ownerOnly: false,
    children: [
      { label: "Catálogo", href: "/admin/servicos" },
      { label: "Categorias", href: "/admin/servicos/categorias" },
    ],
  },
  {
    label: "Clube",
    href: "/admin/clube",
    iconName: "club",
    ownerOnly: true,
    children: [
      { label: "Visão Geral", href: "/admin/clube" },
      { label: "Planos", href: "/admin/clube/planos" },
      { label: "Assinantes", href: "/admin/clube/assinantes" },
      { label: "Fechamentos", href: "/admin/clube/fechamentos" },
      { label: "Relatórios", href: "/admin/clube/relatorios" },
    ],
  },
  {
    label: "Marketing",
    href: "/admin/marketing",
    iconName: "marketing",
    ownerOnly: true,
    children: [
      { label: "Vitrine pública", href: "/admin/marketing/vitrine" },
    ],
  },
  {
    label: "Configurações",
    href: "/admin/configuracoes",
    iconName: "settings",
    ownerOnly: false,
    children: [
      { label: "Geral", href: "/admin/configuracoes" },
      {
        label: "Plano e cobrança",
        href: "/admin/configuracoes/plano-cobranca",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
      {
        label: "WhatsApp",
        href: "/admin/configuracoes/whatsapp",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
      { label: "Horários", href: "/admin/configuracoes/horarios" },
      {
        label: "Equipe",
        href: "/admin/equipe",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
    ],
  },
];

export function getVisibleNavItems(params: {
  userRole?: string | null;
  isPlatformAdmin?: boolean;
}): NavItemConfig[] {
  const { userRole, isPlatformAdmin } = params;
  const isReceptionist = userRole === "RECEPTIONIST";
  const canSeeOwnerRoutes =
    userRole === "OWNER" || userRole === "MANAGER" || userRole === "SUPER_ADMIN" || isPlatformAdmin;

  const filtered = ADMIN_NAV_CONFIG.filter((item) => {
    if (isReceptionist) {
      return ["/admin/agendamentos", "/admin/fila", "/admin/comandas", "/admin/clientes"].includes(
        item.href
      );
    }
    return !item.ownerOnly || canSeeOwnerRoutes;
  }).map((item) => {
    if (isReceptionist && item.children.length > 0) {
      return {
        ...item,
        children: item.children.filter((c) => c.href === "/admin/clientes"),
      };
    }
    return item;
  });

  if (isPlatformAdmin) {
    filtered.unshift({
      label: "Plataforma",
      href: "/admin/platform",
      iconName: "platform",
      children: [],
      ownerOnly: false,
    });
  }

  return filtered;
}

export function groupNavItems(items: NavItemConfig[]): NavGroupConfig[] {
  const groups: Record<string, { title: string; items: NavItemConfig[] }> = {
    principal: {
      title: "Principal",
      items: [],
    },
    clientes_produtos: {
      title: "Clientes e produtos",
      items: [],
    },
    financeiro: {
      title: "Financeiro",
      items: [],
    },
    servicos_gestao: {
      title: "Serviços e gestão",
      items: [],
    },
  };

  for (const item of items) {
    if (item.href === "/admin/platform") {
      groups.principal.items.unshift(item);
    } else if (
      ["/admin/dashboard", "/admin/agendamentos", "/admin/fila", "/admin/comandas"].includes(
        item.href
      )
    ) {
      groups.principal.items.push(item);
    } else if (["/admin/clientes", "/admin/produtos"].includes(item.href)) {
      groups.clientes_produtos.items.push(item);
    } else if (
      ["/admin/caixa", "/admin/financeiro", "/admin/comissoes", "/admin/gorjetas"].includes(
        item.href
      )
    ) {
      groups.financeiro.items.push(item);
    } else {
      groups.servicos_gestao.items.push(item);
    }
  }

  return Object.entries(groups)
    .filter((entry) => entry[1].items.length > 0)
    .map(([id, g]) => ({
      id,
      title: g.title,
      items: g.items,
    }));
}
