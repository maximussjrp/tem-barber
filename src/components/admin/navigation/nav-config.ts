export interface NavChildItem {
  label: string;
  href: string;
  iconName?: string;
  roles?: string[];
}

export interface NavItemConfig {
  label: string;
  href: string;
  iconName:
    | "dashboard"
    | "calendar"
    | "comandas"
    | "fila"
    | "clients"
    | "products"
    | "scissors"
    | "cash"
    | "financial"
    | "accounts"
    | "reports"
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
    label: "Comandas",
    href: "/admin/comandas",
    iconName: "comandas",
    children: [],
    ownerOnly: false,
  },
  {
    label: "Fila Online",
    href: "/admin/fila",
    iconName: "fila",
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
    label: "Financeiro",
    href: "/admin/financeiro",
    iconName: "financial",
    ownerOnly: true,
    children: [
      {
        label: "Contas a Pagar",
        href: "/admin/financeiro/contas?kind=PAYABLE",
        iconName: "payable",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
      {
        label: "Contas a Receber",
        href: "/admin/financeiro/contas?kind=RECEIVABLE",
        iconName: "receivable",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
      {
        label: "Visão Geral",
        href: "/admin/financeiro",
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
        label: "Configurações",
        href: "/admin/financeiro/configuracoes",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
    ],
  },
  {
    label: "Contas a Pagar / Receber",
    href: "/admin/financeiro/contas",
    iconName: "accounts",
    ownerOnly: true,
    children: [],
  },
  {
    label: "Caixa",
    href: "/admin/caixa",
    iconName: "cash",
    children: [],
    ownerOnly: false,
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
    label: "Produtos",
    href: "/admin/produtos",
    iconName: "products",
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
    label: "Relatórios",
    href: "/admin/financeiro/relatorio-gerencial",
    iconName: "reports",
    ownerOnly: true,
    children: [
      {
        label: "Relatório Gerencial",
        href: "/admin/financeiro/relatorio-gerencial",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
      {
        label: "Relatórios do Clube",
        href: "/admin/clube/relatorios",
        roles: ["OWNER", "MANAGER", "SUPER_ADMIN"],
      },
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
    userRole === "OWNER" ||
    userRole === "MANAGER" ||
    userRole === "SUPER_ADMIN" ||
    isPlatformAdmin;

  const filtered = ADMIN_NAV_CONFIG.filter((item) => {
    if (isReceptionist) {
      return [
        "/admin/agendamentos",
        "/admin/fila",
        "/admin/comandas",
        "/admin/clientes",
      ].includes(item.href);
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
  const byHref = new Map(items.map((item) => [item.href, item]));

  const pick = (hrefs: string[]): NavItemConfig[] =>
    hrefs.map((h) => byHref.get(h)).filter((x): x is NavItemConfig => Boolean(x));

  const principalItems = [
    ...(byHref.has("/admin/platform") ? [byHref.get("/admin/platform")!] : []),
    ...pick([
      "/admin/dashboard",
      "/admin/agendamentos",
      "/admin/comandas",
      "/admin/fila",
    ]),
  ];

  const clientesProdutosItems = pick(["/admin/clientes", "/admin/produtos"]);

  const financeiroItems = pick([
    "/admin/caixa",
    "/admin/financeiro",
    "/admin/financeiro/contas",
    "/admin/comissoes",
    "/admin/gorjetas",
  ]);

  const servicosGestaoItems = pick([
    "/admin/servicos",
    "/admin/clube",
    "/admin/marketing",
    "/admin/configuracoes",
    "/admin/financeiro/relatorio-gerencial",
  ]);

  const groups: NavGroupConfig[] = [
    { id: "principal", title: "Principal", items: principalItems },
    {
      id: "clientes_produtos",
      title: "Clientes e produtos",
      items: clientesProdutosItems,
    },
    { id: "financeiro", title: "Financeiro", items: financeiroItems },
    {
      id: "servicos_gestao",
      title: "Serviços e gestão",
      items: servicosGestaoItems,
    },
  ];

  return groups.filter((g) => g.items.length > 0);
}
