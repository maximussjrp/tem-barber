import { describe, expect, it } from "vitest";
import {
  parseAndValidatePaymentDate,
  validateCashPaymentBackdating,
} from "@/lib/operations/payment-dates";
import { canBackdatePayment } from "@/lib/operations/permissions";
import { computeCheckoutFingerprint } from "@/lib/operations/checkout";
import { formatTimestampToCivilDateBR, todayIsoBR, shiftDateISO } from "@/lib/time-utils";

describe("UX1.2 Payment Effective Date Unit Tests", () => {
  const today = todayIsoBR();
  const yesterday = shiftDateISO(today, -1);
  const tomorrow = shiftDateISO(today, 1);

  describe("1. parseAndValidatePaymentDate", () => {
    it("retorna data atual quando data não é informada (undefined, null ou vazio)", () => {
      const resNull = parseAndValidatePaymentDate(null);
      expect(resNull.civilDate).toBe(today);
      expect(resNull.isBackdated).toBe(false);
      expect(resNull.effectivePaidAt).toBeInstanceOf(Date);

      const resEmpty = parseAndValidatePaymentDate("");
      expect(resEmpty.civilDate).toBe(today);
      expect(resEmpty.isBackdated).toBe(false);

      const resUndefined = parseAndValidatePaymentDate(undefined);
      expect(resUndefined.civilDate).toBe(today);
      expect(resUndefined.isBackdated).toBe(false);
    });

    it("aceita data de hoje e marca como não retroativa", () => {
      const res = parseAndValidatePaymentDate(today);
      expect(res.civilDate).toBe(today);
      expect(res.isBackdated).toBe(false);
      expect(res.effectivePaidAt).toBeInstanceOf(Date);
    });

    it("aceita data no passado e marca como retroativa com horário seguro às 12h BRT", () => {
      const res = parseAndValidatePaymentDate(yesterday);
      expect(res.civilDate).toBe(yesterday);
      expect(res.isBackdated).toBe(true);
      expect(res.effectivePaidAt).toBeInstanceOf(Date);

      // Garante que a data civil formatada permaneça exatamente o dia civil de ontem
      expect(formatTimestampToCivilDateBR(res.effectivePaidAt)).toBe(yesterday);
    });

    it("rejeita data no futuro com INVALID_PAYMENT_DATE (422)", () => {
      expect(() => parseAndValidatePaymentDate(tomorrow)).toThrowError(
        /A data do pagamento não pode ser no futuro/
      );
    });

    it("rejeita data malformada ou inválida com INVALID_PAYMENT_DATE (400)", () => {
      expect(() => parseAndValidatePaymentDate("data-invalida")).toThrowError(
        /Data de pagamento inválida/
      );
      // Mês 13
      expect(() => parseAndValidatePaymentDate("2026-13-10")).toThrowError(
        /Data de pagamento inválida/
      );
      // Dia 32
      expect(() => parseAndValidatePaymentDate("2026-05-32")).toThrowError(
        /Data de pagamento inválida/
      );
      // 30 de Fevereiro
      expect(() => parseAndValidatePaymentDate("2026-02-30")).toThrowError(
        /Data de pagamento inválida/
      );
    });

    it("aceita objeto Date válido e converte adequadamente", () => {
      const pastDate = new Date(Date.now() - 24 * 3600 * 1000);
      const res = parseAndValidatePaymentDate(pastDate);
      expect(res.isBackdated).toBe(true);
      expect(res.civilDate).toBe(formatTimestampToCivilDateBR(pastDate));
    });

    it("rejeita objeto Date inválido (NaN)", () => {
      expect(() => parseAndValidatePaymentDate(new Date("invalid"))).toThrowError(
        /Data de pagamento inválida/
      );
    });

    it("preserva a data civil brasileira próxima da meia-noite (sem deslocamento UTC off-by-one)", () => {
      // 23:50 BRT = 02:50Z do dia seguinte
      const lateNightUTC = new Date("2026-10-24T02:50:00.000Z");
      const civil = formatTimestampToCivilDateBR(lateNightUTC);
      expect(civil).toBe("2026-10-23");
    });
  });

  describe("2. validateCashPaymentBackdating (Regra Especial de Caixa Diário)", () => {
    it("bloqueia pagamento em dinheiro retroativo com CASH_BACKDATING_NOT_SUPPORTED (422)", () => {
      expect(() => validateCashPaymentBackdating("CASH", true)).toThrowError(
        /Pagamentos em dinheiro retroativos não são permitidos para preservar a integridade do fechamento de caixa físico/
      );
    });

    it("permite pagamento em dinheiro na data atual (não retroativa)", () => {
      expect(() => validateCashPaymentBackdating("CASH", false)).not.toThrow();
    });

    it("permite outros meios de pagamento (PIX, CREDIT_CARD, DEBIT_CARD) em datas retroativas", () => {
      expect(() => validateCashPaymentBackdating("PIX", true)).not.toThrow();
      expect(() => validateCashPaymentBackdating("CREDIT_CARD", true)).not.toThrow();
      expect(() => validateCashPaymentBackdating("DEBIT_CARD", true)).not.toThrow();
    });
  });

  describe("3. canBackdatePayment RBAC", () => {
    it("permite retrodatação apenas para papéis gerenciais e administrativos", () => {
      expect(canBackdatePayment("OWNER")).toBe(true);
      expect(canBackdatePayment("MANAGER")).toBe(true);
      expect(canBackdatePayment("SUPER_ADMIN")).toBe(true);
    });

    it("proíbe retrodatação para BARBER e RECEPTIONIST", () => {
      expect(canBackdatePayment("BARBER")).toBe(false);
      expect(canBackdatePayment("RECEPTIONIST")).toBe(false);
      expect(canBackdatePayment("CLIENT")).toBe(false);
    });
  });

  describe("4. computeCheckoutFingerprint e Idempotência com paidAt", () => {
    it("gera o mesmo fingerprint para requisições idênticas com mesma data", () => {
      const base = {
        barbershopId: "b-1",
        comandaId: "c-1",
        tenders: [{ method: "PIX" as const, receivedAmount: "100.00" }],
        paidAt: yesterday,
      };

      const fp1 = computeCheckoutFingerprint(base);
      const fp2 = computeCheckoutFingerprint(base);
      expect(fp1).toBe(fp2);
    });

    it("gera fingerprints diferentes para a mesma chave/valor quando a data de pagamento muda", () => {
      const fpYesterday = computeCheckoutFingerprint({
        barbershopId: "b-1",
        comandaId: "c-1",
        tenders: [{ method: "PIX" as const, receivedAmount: "100.00" }],
        paidAt: yesterday,
      });

      const fpToday = computeCheckoutFingerprint({
        barbershopId: "b-1",
        comandaId: "c-1",
        tenders: [{ method: "PIX" as const, receivedAmount: "100.00" }],
        paidAt: today,
      });

      expect(fpYesterday).not.toBe(fpToday);
    });

    it("gera fingerprints diferentes quando a segunda chamada omite paidAt (default hoje) comparada a uma retroativa", () => {
      const fpYesterday = computeCheckoutFingerprint({
        barbershopId: "b-1",
        comandaId: "c-1",
        tenders: [{ method: "PIX" as const, receivedAmount: "100.00" }],
        paidAt: yesterday,
      });

      const fpOmitted = computeCheckoutFingerprint({
        barbershopId: "b-1",
        comandaId: "c-1",
        tenders: [{ method: "PIX" as const, receivedAmount: "100.00" }],
      });

      expect(fpYesterday).not.toBe(fpOmitted);
    });
  });

  describe("5. Idempotência estrita: tratamento de ausência de paidAt como data atual", () => {
    it("detecta conflito de data quando a primeira chamada foi retroativa e a retentativa omitiu paidAt", () => {
      // Simula existing payment gravado com data de ontem
      const existingPaidAt = new Date(`${yesterday}T12:00:00.000Z`);
      const existingCivil = formatTimestampToCivilDateBR(existingPaidAt);
      expect(existingCivil).toBe(yesterday);

      // Segunda chamada omite paidAt (undefined)
      const secondCallPaidAt = undefined;
      const { civilDate: secondCivil } = parseAndValidatePaymentDate(secondCallPaidAt);
      expect(secondCivil).toBe(today);

      // Verificação estrita: existingCivil !== secondCivil deve ser true (conflito 409)
      const hasConflict = existingCivil !== secondCivil;
      expect(hasConflict).toBe(true);
    });

    it("não gera conflito quando ambas as chamadas omitem paidAt (ambas são tratadas como data atual)", () => {
      const firstCall = parseAndValidatePaymentDate(undefined);
      const secondCall = parseAndValidatePaymentDate(undefined);

      expect(firstCall.civilDate).toBe(today);
      expect(secondCall.civilDate).toBe(today);
      expect(firstCall.civilDate !== secondCall.civilDate).toBe(false);
    });

    it("não gera conflito quando ambas as chamadas utilizam a mesma data retroativa", () => {
      const firstCall = parseAndValidatePaymentDate(yesterday);
      const secondCall = parseAndValidatePaymentDate(yesterday);

      expect(firstCall.civilDate).toBe(yesterday);
      expect(secondCall.civilDate).toBe(yesterday);
      expect(firstCall.civilDate !== secondCall.civilDate).toBe(false);
    });
  });
});
