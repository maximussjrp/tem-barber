/**
 * Utilitários para integração manual com o WhatsApp (links wa.me).
 */

/**
 * Normaliza um número de telefone brasileiro para o formato internacional aceito pelo WhatsApp.
 * Regras:
 * - Remove todos os caracteres não numéricos.
 * - Se o número tiver 10 ou 11 dígitos (ex: 17991234567), adiciona o DDI 55 (Brasil).
 * - Se tiver 12 ou 13 dígitos e começar com 55, mantém como está.
 * - Qualquer outro formato é considerado inválido e retorna null.
 */
export function formatWhatsAppPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  
  // Remove tudo que não for dígito
  const cleaned = phone.replace(/\D/g, "");
  
  // Se tiver DDD + número (10 ou 11 dígitos)
  if (cleaned.length === 10 || cleaned.length === 11) {
    return `55${cleaned}`;
  }
  
  // Se já tiver DDI 55 + DDD + número (12 ou 13 dígitos)
  if ((cleaned.length === 12 || cleaned.length === 13) && cleaned.startsWith("55")) {
    return cleaned;
  }
  
  return null;
}

/**
 * Gera a mensagem padrão para o lembrete de agendamento.
 */
export function generateWhatsAppMessage(
  customerName: string,
  barbershopName: string,
  time: string,
  serviceNames: string
): string {
  return `Olá, ${customerName}! Passando para lembrar do seu agendamento na ${barbershopName} hoje às ${time} para ${serviceNames}. Te esperamos no horário combinado. ✂️`;
}

/**
 * Cria o link wa.me direto com o número formatado e a mensagem codificada.
 */
export function generateWhatsAppLink(phone: string, message: string): string | null {
  const formattedPhone = formatWhatsAppPhone(phone);
  if (!formattedPhone) return null;
  
  return `https://wa.me/${formattedPhone}?text=${encodeURIComponent(message)}`;
}
