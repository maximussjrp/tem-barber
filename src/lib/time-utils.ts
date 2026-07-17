/**
 * Utilitários para manipulação centralizada de datas e fuso horário.
 * O sistema opera fundamentalmente no fuso horário do Brasil (America/Sao_Paulo).
 */

/**
 * Retorna a data/hora atual deslocada para refletir a hora de Brasília.
 * ATENÇÃO: Isso cria uma data onde os métodos `.getUTC*` retornarão os valores locais do Brasil.
 * Isso é útil quando não se pode confiar no fuso do servidor (ex: Vercel).
 */
export function nowBR(): Date {
  const now = new Date();
  return new Date(now.getTime() - 3 * 3600 * 1000); // UTC-3
}

/**
 * Desloca uma data existente para o fuso horário de Brasília.
 */
export function toBR(date: Date): Date {
  return new Date(date.getTime() - 3 * 3600 * 1000);
}

/**
 * Retorna o início do dia (00:00:00) UTC para um ano, mês e dia específicos.
 * Ideal para consultas no banco de dados.
 */
export function startOfDayUTC(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

/**
 * Retorna o fim do dia (23:59:59.999) UTC para um ano, mês e dia específicos.
 * Ideal para consultas no banco de dados.
 */
export function endOfDayUTC(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
}

/**
 * Retorna uma data correspondente ao hoje (BR) no formato YYYY-MM-DD.
 */
export function todayIsoBR(): string {
  const br = nowBR();
  const y = br.getUTCFullYear();
  const m = String(br.getUTCMonth() + 1).padStart(2, "0");
  const d = String(br.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Formata uma data nativa do JS no padrão brasileiro (DD/MM/YYYY).
 */
export function formatDateBR(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/**
 * Formata a hora de uma data nativa do JS no padrão brasileiro (HH:mm).
 */
export function formatTimeBR(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Retorna uma string "Dia da semana, DD de mês de YYYY" com base em uma string "YYYY-MM-DD".
 * Corrige o index zero-based do mês (ex: 2026-06-18 vira 18 de junho, não 18 de julho).
 */
export function formatHeaderDate(dateString: string): string {
  if (!dateString || typeof dateString !== "string") return "";
  const parts = dateString.split("-");
  if (parts.length !== 3) return "";
  
  const [year, month, day] = parts.map(Number);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return "";
  
  const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return dateObj.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

/**
 * Converte uma data no formato local YYYY-MM-DD para uma data UTC (início do dia local no fuso America/Sao_Paulo, que é UTC-3).
 * Exemplo: "2026-06-25" -> 2026-06-25T03:00:00.000Z
 */
export function localDateToUTCBoundary(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));
}

/**
 * Desloca uma string de data ISO "YYYY-MM-DD" por N dias.
 * Usado para calcular o início do dia seguinte (endExclusive).
 */
export function shiftDateISO(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Formata a data e hora de um agendamento para a mensagem do WhatsApp no fuso horário do negócio.
 * Como o banco armazena a data/hora local mapeada literalmente como UTC (ex: 10:30 vira 10:30Z),
 * precisamos ajustar o timestamp para que, ao formatar com o fuso desejado (ex: America/Sao_Paulo),
 * a data e a hora correspondam exatamente aos valores originais do banco (sem deslocamento).
 */
export function formatAppointmentDateTimeForMessage(
  dateInput: Date | string,
  timeZone: string = "America/Sao_Paulo"
): { date: string; time: string } {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;

  // 1. Extrair os componentes UTC (que guardam a hora local literal)
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const dateVal = d.getUTCDate();
  const h = d.getUTCHours();
  const min = d.getUTCMinutes();

  // 2. Criar data base com esses componentes locais representados em UTC
  const baseDate = new Date(Date.UTC(y, m, dateVal, h, min));

  // 3. Obter a diferença de milissegundos entre o fuso desejado e o UTC
  const utcStr = baseDate.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = baseDate.toLocaleString("en-US", { timeZone });
  const utcTime = new Date(utcStr).getTime();
  const tzTime = new Date(tzStr).getTime();
  const offsetMs = tzTime - utcTime;

  // 4. Compensar o offset na data que será formatada com a timezone final
  const adjustedDate = new Date(baseDate.getTime() - offsetMs);

  const date = adjustedDate.toLocaleDateString("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const time = adjustedDate.toLocaleTimeString("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });

  return { date, time };
}
