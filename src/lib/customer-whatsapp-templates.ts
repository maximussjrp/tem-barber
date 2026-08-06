export function getClientFirstName(name: string | null | undefined): string | null {
  if (!name) return null;
  // Replace symbols/punctuation/separators/parentheses/brackets/hyphens with spaces
  let cleaned = name.replace(/[,\.\-\_\(\)\[\]\{\}\/\\~]/g, " ");
  // Remove numbers
  cleaned = cleaned.replace(/\d+/g, " ");
  
  // Split by whitespace
  const parts = cleaned.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  
  // Identify if first word is a generic suffix or placeholder
  const genericTerms = new Set(["cliente", "cl", "teste", "test", "admin", "barbeiro", "barbearia", "usuario", "usuário"]);
  let candidate = parts[0];
  if (genericTerms.has(candidate.toLowerCase())) {
    if (parts.length > 1) {
      const nextWord = parts[1];
      if (!genericTerms.has(nextWord.toLowerCase())) {
        candidate = nextWord;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  // Clean any remaining non-alphabetic characters (preserving Unicode accent letters)
  candidate = candidate.replace(/[^a-zA-ZáàâãäåæéèêëíìîïóòôõöøúùûüýÿñçÁÀÂÃÄÅÆÉÈÊËÍÌÎÏÓÒÔÕÖØÚÙÛÜÝŸÑÇ]/g, "");

  return candidate || null;
}

export interface WhatsappTemplate {
  key: string;
  label: string;
  category: string;
  trigger: string;
  buildMessage: (customerName: string, barbershopName: string, bookingUrl?: string | null) => string;
}

export const WHATSAPP_TEMPLATES: WhatsappTemplate[] = [
  {
    key: "APPOINTMENT_DIRECT",
    label: "Agendamento direto",
    category: "Agendamento",
    trigger: "praticidade + cuidado",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nVi que você ainda não tem horário marcado essa semana.\nSe quiser manter o corte em dia, já deixei o link de agendamento aqui:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nVi que você ainda não tem horário marcado essa semana.\nSe quiser manter o corte em dia, já deixei o link de agendamento aqui:\n\n${url}`;
    }
  },
  {
    key: "APPOINTMENT_BEST_TIMES",
    label: "Garantir melhores horários",
    category: "Agendamento",
    trigger: "escassez leve",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nA agenda já começou a preencher e os melhores horários costumam sair primeiro.\n\nSe quiser garantir um bom horário, agenda por aqui:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nA agenda já começou a preencher e os melhores horários costumam sair primeiro.\n\nSe quiser garantir um bom horário, agenda por aqui:\n\n${url}`;
    }
  },
  {
    key: "WEEK_OPEN",
    label: "Agenda da semana aberta",
    category: "Agenda da semana",
    trigger: "oportunidade",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nA agenda da semana já está aberta.\nSe quiser garantir seu horário antes de ficar em cima da hora, é só escolher pelo link:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nA agenda da semana já está aberta.\nSe quiser garantir seu horário antes de ficar em cima da hora, é só escolher pelo link:\n\n${url}`;
    }
  },
  {
    key: "WEEK_SCARCITY",
    label: "Poucos horários na semana",
    category: "Agenda da semana",
    trigger: "urgência controlada",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nAinda tenho alguns horários disponíveis essa semana, mas a agenda já começou a preencher.\n\nSe quiser garantir o seu, agenda por aqui:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nAinda tenho alguns horários disponíveis essa semana, mas a agenda já começou a preencher.\n\nSe quiser garantir o seu, agenda por aqui:\n\n${url}`;
    }
  },
  {
    key: "RETURN_REMINDER",
    label: "Lembrete de retorno",
    category: "Lembrete de retorno",
    trigger: "timing + necessidade estética",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Tudo certo?\n\nJá faz um tempo desde seu último atendimento aqui na ${barbershopName}.\nEsse é aquele momento ideal para renovar o corte antes de ele perder o formato.\n\nAgenda por aqui:\n\n${url}`
        : `Oi, tudo certo?\n\nJá faz um tempo desde seu último atendimento aqui na ${barbershopName}.\nEsse é aquele momento ideal para renovar o corte antes de ele perder o formato.\n\nAgenda por aqui:\n\n${url}`;
    }
  },
  {
    key: "RETURN_FREQUENCY",
    label: "Manter frequência",
    category: "Lembrete de retorno",
    trigger: "autoridade técnica",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nUm bom corte não depende só do dia que você faz, mas da frequência com que mantém.\nQuando o retorno é feito no tempo certo, o visual fica mais limpo e o acabamento dura melhor.\n\nAgende seu próximo horário:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nUm bom corte não depende só do dia que você faz, mas da frequência com que mantém.\nQuando o retorno é feito no tempo certo, o visual fica mais limpo e o acabamento dura melhor.\n\nAgende seu próximo horário:\n\n${url}`;
    }
  },
  {
    key: "INACTIVE_CLIENT",
    label: "Cliente parado",
    category: "Cliente parado",
    trigger: "reativação",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nFaz um tempo que você não aparece por aqui.\nSeu último atendimento ficou registrado com a gente, e seria bom manter a frequência para não deixar acumular.\n\nQuando quiser voltar, escolha o melhor horário:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nFaz um tempo que você não aparece por aqui.\nSeu último atendimento ficou registrado com a gente, e seria bom manter a frequência para não deixar acumular.\n\nQuando quiser voltar, escolha o melhor horário:\n\n${url}`;
    }
  },
  {
    key: "COMEBACK_LIGHT",
    label: "Volta leve",
    category: "Cliente parado",
    trigger: "relacionamento leve",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Tudo bem?\n\nPassando só para te lembrar que a agenda da ${barbershopName} está aberta.\nQuando quiser dar aquele talento no visual de novo, é só marcar por aqui:\n\n${url}`
        : `Oi, tudo bem?\n\nPassando só para lembrar que a agenda da ${barbershopName} está aberta.\nQuando quiser dar aquele talento no visual de novo, é só marcar por aqui:\n\n${url}`;
    }
  },
  {
    key: "POST_SERVICE_FEEDBACK",
    label: "Pós-atendimento/feedback",
    category: "Pós-atendimento",
    trigger: "cuidado + relacionamento",
    buildMessage: (customerName, barbershopName) => {
      const name = getClientFirstName(customerName);
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nPassando para saber se ficou tudo certo com seu atendimento.\nSua opinião ajuda a gente a manter o padrão e melhorar cada detalhe.\n\nSe puder, me responde aqui rapidinho.`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nPassando para saber se ficou tudo certo com seu atendimento.\nSua opinião ajuda a gente a manter o padrão e melhorar cada detalhe.\n\nSe puder, me responde aqui rapidinho.`;
    }
  },
  {
    key: "POST_SERVICE_NEXT",
    label: "Pós-atendimento com próximo horário",
    category: "Pós-atendimento",
    trigger: "recorrência",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nEspero que tenha curtido o resultado do atendimento.\nPara manter o corte sempre alinhado, o ideal é não deixar passar muito do ponto.\n\nQuando quiser, já pode deixar o próximo horário garantido:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nEspero que tenha curtido o resultado do atendimento.\nPara manter o corte sempre alinhado, o ideal é não deixar passar muito do ponto.\n\nQuando quiser, já pode deixar o próximo horário garantido:\n\n${url}`;
    }
  },
  {
    key: "CLUB_ACTIVE",
    label: "Cliente clube ativo",
    category: "Cliente clube",
    trigger: "benefício ativo",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nVocê tem benefício ativo no clube.\nAproveita para usar seu atendimento e manter o visual em dia.\n\nAgende por aqui:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nVocê tem benefício ativo no clube.\nAproveita para usar seu atendimento e manter o visual em dia.\n\nAgende por aqui:\n\n${url}`;
    }
  },
  {
    key: "CLUB_VALUE",
    label: "Reforço de benefício do clube",
    category: "Cliente clube",
    trigger: "valor percebido",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nSeu clube está ativo e esse benefício foi feito justamente para você manter a frequência sem deixar o visual passar do ponto.\n\nEscolha seu horário por aqui:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nSeu clube está ativo e esse benefício foi feito justamente para manter a frequência sem deixar o visual passar do ponto.\n\nEscolha seu horário por aqui:\n\n${url}`;
    }
  },
  {
    key: "AUTHORITY_CARE",
    label: "Cuidado profissional",
    category: "Autoridade/profissionalismo",
    trigger: "cuidado + técnica",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nCorte bem feito é detalhe, frequência e acabamento no tempo certo.\nQuando você mantém o cuidado em dia, o visual transmite mais presença.\n\nAgende seu horário:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nCorte bem feito é detalhe, frequência e acabamento no tempo certo.\nQuando o cuidado fica em dia, o visual transmite mais presença.\n\nAgende seu horário:\n\n${url}`;
    }
  },
  {
    key: "AUTHORITY_PRESENCE",
    label: "Presença e imagem",
    category: "Autoridade/profissionalismo",
    trigger: "imagem pessoal",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nUm corte alinhado muda a forma como você chega nos lugares.\nNão é só aparência, é presença.\n\nQuando quiser renovar o visual, agenda por aqui:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nUm corte alinhado muda a forma como você chega nos lugares.\nNão é só aparência, é presença.\n\nQuando quiser renovar o visual, agenda por aqui:\n\n${url}`;
    }
  },
  {
    key: "WEEKEND_READY",
    label: "Final de semana chegando",
    category: "Ocasiões especiais",
    trigger: "ocasião próxima",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nFinal de semana chegando e nada melhor do que estar com o visual em dia.\nSe quiser garantir seu horário, agenda por aqui:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nFinal de semana chegando e nada melhor do que estar com o visual em dia.\nSe quiser garantir seu horário, agenda por aqui:\n\n${url}`;
    }
  },
  {
    key: "SPECIAL_DATE",
    label: "Data especial",
    category: "Ocasiões especiais",
    trigger: "evento/compromisso",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nSe você tem compromisso, evento ou quer só chegar melhor nos próximos dias, vale garantir o horário antes.\n\nAgenda por aqui:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nSe você tem compromisso, evento ou quer só chegar melhor nos próximos dias, vale garantir o horário antes.\n\nAgenda por aqui:\n\n${url}`;
    }
  },
  {
    key: "CUSTOM_BASE",
    label: "Personalizado",
    category: "Personalizado",
    trigger: "flexibilidade",
    buildMessage: (customerName, barbershopName, bookingUrl) => {
      const name = getClientFirstName(customerName);
      const url = bookingUrl || "";
      return name
        ? `Oi, ${name}. Aqui é da ${barbershopName}.\n\nTenho uma mensagem personalizada para você.\n\nPara agendar, acesse:\n\n${url}`
        : `Oi, tudo bem? Aqui é da ${barbershopName}.\n\nTenho uma mensagem personalizada para você.\n\nPara agendar, acesse:\n\n${url}`;
    }
  }
];

export const LEGACY_TEMPLATE_KEYS = ["invite", "week", "return", "feedback"] as const;
export type LegacyTemplateKey = (typeof LEGACY_TEMPLATE_KEYS)[number];

export function buildClientWhatsappMessage(input: {
  template: string;
  customerName: string;
  barbershopName: string;
  bookingUrl?: string | null;
}) {
  const found = WHATSAPP_TEMPLATES.find(t => t.key === input.template);
  if (found) {
    return found.buildMessage(input.customerName, input.barbershopName, input.bookingUrl);
  }
  
  // Fallbacks for legacy keys
  if (input.template === "invite") {
    const direct = WHATSAPP_TEMPLATES.find(t => t.key === "APPOINTMENT_DIRECT")!;
    return direct.buildMessage(input.customerName, input.barbershopName, input.bookingUrl);
  }
  if (input.template === "week") {
    const weekOpen = WHATSAPP_TEMPLATES.find(t => t.key === "WEEK_OPEN")!;
    return weekOpen.buildMessage(input.customerName, input.barbershopName, input.bookingUrl);
  }
  if (input.template === "return") {
    const returnReminder = WHATSAPP_TEMPLATES.find(t => t.key === "RETURN_REMINDER")!;
    return returnReminder.buildMessage(input.customerName, input.barbershopName, input.bookingUrl);
  }
  if (input.template === "feedback") {
    const postServiceFeedback = WHATSAPP_TEMPLATES.find(t => t.key === "POST_SERVICE_FEEDBACK")!;
    return postServiceFeedback.buildMessage(input.customerName, input.barbershopName, input.bookingUrl);
  }

  // General fallback
  const name = getClientFirstName(input.customerName);
  const urlLine = input.bookingUrl ? `\n\nAgendamento: ${input.bookingUrl}` : "";
  return `Oi, ${name || "tudo bem"}? Aqui é da ${input.barbershopName}. Quer agendar seu horário?${urlLine}`;
}
