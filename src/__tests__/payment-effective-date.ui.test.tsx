import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PaymentModal } from "@/components/admin/comanda/PaymentModal";
import { todayIsoBR, shiftDateISO, formatDateBR } from "@/lib/time-utils";

describe("UX1.2 PaymentModal Effective Date UI Tests", () => {
  const today = todayIsoBR();
  const yesterday = shiftDateISO(today, -1);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exibe a pergunta de data efetiva quando a comanda é de um dia anterior", () => {
    render(
      <PaymentModal
        remainingTotal={100}
        busy={false}
        canBackdatePayment={true}
        serviceDate={yesterday}
        onPay={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Quando o cliente realmente pagou?")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Atendimento: ${formatDateBR(yesterday)}`))).toBeInTheDocument();
    expect(screen.getByLabelText(/Recebi hoje/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Recebi em outra data/i)).toBeInTheDocument();
  });

  it("seleciona 'Recebi hoje' por padrão e exibe a data atual no resumo", () => {
    render(
      <PaymentModal
        remainingTotal={100}
        busy={false}
        canBackdatePayment={true}
        serviceDate={yesterday}
        onPay={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const radioToday = screen.getByLabelText(/Recebi hoje/i) as HTMLInputElement;
    expect(radioToday.checked).toBe(true);

    const summary = screen.getByText(new RegExp(`Hoje \\(${formatDateBR(today)}\\)`));
    expect(summary).toBeInTheDocument();
  });

  it("ao selecionar 'Recebi em outra data', exibe campo de data com valor inicial de ontem", async () => {
    render(
      <PaymentModal
        remainingTotal={100}
        busy={false}
        canBackdatePayment={true}
        serviceDate={yesterday}
        onPay={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const radioCustom = screen.getByLabelText(/Recebi em outra data/i);
    fireEvent.click(radioCustom);

    const dateInput = screen.getByLabelText(/Data efetiva do pagamento/i) as HTMLInputElement;
    expect(dateInput).toBeInTheDocument();
    expect(dateInput.value).toBe(yesterday);
    expect(dateInput.max).toBe(today);

    // Resumo atualizado com indicador de retroativo
    expect(screen.getByText(new RegExp(`${formatDateBR(yesterday)} \\(Retroativo\\)`))).toBeInTheDocument();
  });

  it("para comanda do mesmo dia, não exibe pergunta invasiva, mas permite alteração opcional", () => {
    render(
      <PaymentModal
        remainingTotal={100}
        busy={false}
        canBackdatePayment={true}
        serviceDate={today}
        onPay={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Não deve poluir com a pergunta invasiva
    expect(screen.queryByText("Quando o cliente realmente pagou?")).not.toBeInTheDocument();

    // Deve exibir indicação de pagamento hoje com botão de alterar
    expect(screen.getByText("Alterar data do recebimento")).toBeInTheDocument();

    // Clicar em alterar abre o seletor de data
    fireEvent.click(screen.getByText("Alterar data do recebimento"));
    expect(screen.getByLabelText(/Data efetiva do recebimento/i)).toBeInTheDocument();
  });

  it("não exibe seletor de data quando o valor pago for zero (ex: fechamento 100% dívida)", () => {
    render(
      <PaymentModal
        remainingTotal={100}
        busy={false}
        canManageDebt={true}
        canBackdatePayment={true}
        serviceDate={yesterday}
        onPay={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Altera o valor de pagamento para 0 (100% dívida)
    const amountInput = screen.getByLabelText(/Valor Aplicado à Venda/i);
    fireEvent.change(amountInput, { target: { value: "0" } });

    expect(screen.queryByTestId("payment-effective-date-section")).not.toBeInTheDocument();
  });

  it("bloqueia pagamento em DINHEIRO (CASH) retroativo com alerta contextual e desativa botão de confirmação", () => {
    render(
      <PaymentModal
        remainingTotal={100}
        busy={false}
        canBackdatePayment={true}
        serviceDate={yesterday}
        onPay={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Seleciona dinheiro
    const methodSelect = screen.getByLabelText(/Forma de Pagamento/i);
    fireEvent.change(methodSelect, { target: { value: "CASH" } });

    // Seleciona data retroativa
    fireEvent.click(screen.getByLabelText(/Recebi em outra data/i));

    // Alerta contextual de caixa deve estar visível
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Pagamentos em dinheiro não podem ser lançados em datas retroativas/i)).toBeInTheDocument();

    // Botão de envio desativado
    const submitBtn = screen.getByRole("button", { name: /Confirmar e Finalizar/i });
    expect(submitBtn).toBeDisabled();
  });

  it("desabilita escolha de data retroativa se usuário não tiver permissão gerencial", () => {
    render(
      <PaymentModal
        remainingTotal={100}
        busy={false}
        canBackdatePayment={false}
        serviceDate={yesterday}
        onPay={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const radioCustom = screen.getByLabelText(/Recebi em outra data/i) as HTMLInputElement;
    expect(radioCustom.disabled).toBe(true);
    expect(screen.getByText(/Apenas gerentes\/proprietários/i)).toBeInTheDocument();
  });

  it("envia paidAt corretamente no payload de onPay ao confirmar recebimento retroativo", async () => {
    const onPayMock = vi.fn().mockResolvedValue(undefined);

    render(
      <PaymentModal
        remainingTotal={100}
        busy={false}
        canBackdatePayment={true}
        serviceDate={yesterday}
        onPay={onPayMock}
        onClose={vi.fn()}
      />
    );

    // Escolhe PIX e data de ontem
    const methodSelect = screen.getByLabelText(/Forma de Pagamento/i);
    fireEvent.change(methodSelect, { target: { value: "PIX" } });
    fireEvent.click(screen.getByLabelText(/Recebi em outra data/i));

    const submitBtn = screen.getByRole("button", { name: /Confirmar e Finalizar/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onPayMock).toHaveBeenCalledTimes(1);
    });

    const [payload, options] = onPayMock.mock.calls[0];
    expect(payload).toEqual([
      { method: "PIX", amount: "100.00", paidAt: yesterday },
    ]);
    expect(options.paidAt).toBe(yesterday);
  });
});
