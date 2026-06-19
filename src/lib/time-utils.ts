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
