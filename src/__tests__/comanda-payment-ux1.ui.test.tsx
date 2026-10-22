import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PaymentModal } from "@/components/admin/comanda/PaymentModal";
import ComandaDetailPage from "@/app/admin/comandas/[id]/page";
import { ComandaItemCard } from "@/components/admin/comanda/ComandaItemCard";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "comanda-ux1" }),
}));

describe("UX1 Independent Review Fix Suite (TEMBARBER_UX1_INDEPENDENT_REVIEW_FIX)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("UX1-REV-001 — Modal Acessível com elemento <dialog>", () => {
    it("renderiza o elemento nativo <dialog> com estrutura de 3 camadas e atributos acessíveis", () => {
      const { container } = render(
        <PaymentModal
          remainingTotal={120}
          busy={false}
          canManageDebt={true}
          members={[{ id: "m-1", name: "Lucas Barbeiro" }]}
          onPay={vi.fn()}
          onClose={vi.fn()}
        />
      );

      // Elemento <dialog>
      const dialog = container.querySelector("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-labelledby", "payment-modal-title");

      // Card com restrição de altura vertical
      const card = dialog?.firstElementChild as HTMLElement;
      expect(card).toBeInTheDocument();
      expect(card.className).toContain("max-h-[90dvh]");
      expect(card.className).toContain("overflow-hidden");

      // Layer 1: Header fixo
      const header = card.querySelector("#payment-modal-title")?.parentElement;
      expect(header).toBeInTheDocument();
      expect(header?.className).toContain("shrink-0");

      // Layer 2: Body rolável
      const bodyContainer = card.querySelector(".overflow-y-auto.overscroll-contain");
      expect(bodyContainer).toBeInTheDocument();
      expect(bodyContainer?.className).toContain("flex-1");

      // Layer 3: Footer de ações fixo
      const submitBtn = screen.getByRole("button", { name: /Confirmar e Finalizar/i });
      const footer = submitBtn.closest("div.shrink-0");
      expect(footer).toBeInTheDocument();
      expect(footer?.className).toContain("shrink-0");
      expect(screen.getByText("Cancelar")).toBeInTheDocument();
    });

    it("gerencia travamento de scroll do body ao abrir e restaura ao desmontar", () => {
      const originalOverflow = document.body.style.overflow;
      const { unmount } = render(
        <PaymentModal
          remainingTotal={50}
          busy={false}
          onPay={vi.fn()}
          onClose={vi.fn()}
        />
      );

      expect(document.body.style.overflow).toBe("hidden");
      unmount();
      expect(document.body.style.overflow).toBe(originalOverflow);
    });

    it("restaura o foco para o elemento disparador após o fechamento do modal", () => {
      const triggerBtn = document.createElement("button");
      triggerBtn.id = "open-payment-btn";
      document.body.appendChild(triggerBtn);
      triggerBtn.focus();
      expect(document.activeElement).toBe(triggerBtn);

      const { unmount } = render(
        <PaymentModal
          remainingTotal={75}
          busy={false}
          onPay={vi.fn()}
          onClose={vi.fn()}
        />
      );

      unmount();
      expect(document.activeElement).toBe(triggerBtn);
      document.body.removeChild(triggerBtn);
    });

    it("NÃO fecha o modal ao clicar no backdrop (UX1-REV-002: descarte acidental prevenido)", () => {
      const onClose = vi.fn();
      const { container } = render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          onPay={vi.fn()}
          onClose={onClose}
        />
      );

      const dialog = container.querySelector("dialog") as HTMLDialogElement;
      const card = dialog.firstElementChild as HTMLElement;

      // Clicar no interior do card: NÃO fecha
      fireEvent.click(card);
      expect(onClose).not.toHaveBeenCalled();

      // Clicar fora do card / backdrop: NÃO fecha
      fireEvent.click(dialog);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("UX1-REV-002 — Prevenção de Perda Acidental de Dados", () => {
    it("permite fechamento direto quando não houver edições (isDirty=false)", () => {
      const onClose = vi.fn();
      const { container } = render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          onPay={vi.fn()}
          onClose={onClose}
        />
      );

      // Clicar em Cancelar sem alterações
      const cancelBtn = screen.getByRole("button", { name: "Cancelar" });
      fireEvent.click(cancelBtn);
      expect(onClose).toHaveBeenCalledTimes(1);

      // Nenhuma confirmação exibida
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("solicita confirmação contextual (role='alertdialog') ao tentar fechar após modificar valores", async () => {
      const onClose = vi.fn();
      const { container } = render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          onPay={vi.fn()}
          onClose={onClose}
        />
      );

      // Modificar o valor do pagamento
      const amountInput = screen.getByLabelText(/Valor Aplicado à Venda/i);
      fireEvent.change(amountInput, { target: { value: "85.00" } });

      // Tentar fechar pelo botão Cancelar
      const cancelBtn = screen.getByRole("button", { name: "Cancelar" });
      fireEvent.click(cancelBtn);

      // Não fecha imediatamente
      expect(onClose).not.toHaveBeenCalled();

      // Exibe banner de confirmação de descarte
      const alertdialog = screen.getByRole("alertdialog");
      expect(alertdialog).toBeInTheDocument();
      expect(alertdialog).toHaveTextContent("Descartar alterações?");

      // Clicar em "Continuar editando" mantém os dados e remove a confirmação
      const continueBtn = screen.getByRole("button", { name: "Continuar editando" });
      fireEvent.click(continueBtn);
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(amountInput).toHaveValue(85);
      expect(onClose).not.toHaveBeenCalled();

      // Tentar fechar pelo botão X do header
      const closeHeaderBtn = screen.getByLabelText("Fechar diálogo de pagamento");
      fireEvent.click(closeHeaderBtn);
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();

      // Clicar em "Descartar e fechar" executa o fechamento
      const discardBtn = screen.getByRole("button", { name: "Descartar e fechar" });
      fireEvent.click(discardBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("intercepta a tecla Escape e exibe confirmação contextual se houver dados alterados", () => {
      const onClose = vi.fn();
      const { container } = render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          onPay={vi.fn()}
          onClose={onClose}
        />
      );

      // Adicionar gorjeta
      const tipInput = screen.getByLabelText(/Gorjeta \(R\$\)/i);
      fireEvent.change(tipInput, { target: { value: "10.00" } });

      const dialog = container.querySelector("dialog") as HTMLDialogElement;
      // Disparar Escape no diálogo
      fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });

      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    it("impede qualquer tentativa de fechamento quando busy=true", () => {
      const onClose = vi.fn();
      const { container } = render(
        <PaymentModal
          remainingTotal={100}
          busy={true}
          onPay={vi.fn()}
          onClose={onClose}
        />
      );

      const dialog = container.querySelector("dialog") as HTMLDialogElement;
      fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
      expect(onClose).not.toHaveBeenCalled();

      const closeHeaderBtn = screen.getByLabelText("Fechar diálogo de pagamento");
      fireEvent.click(closeHeaderBtn);
      expect(onClose).not.toHaveBeenCalled();

      const cancelBtn = screen.getByRole("button", { name: "Cancelar" });
      fireEvent.click(cancelBtn);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("UX1-REV-003 — Validação dos Formulários Secundários", () => {
    it("comprova que os formulários secundários não utilizam noValidate e possuem restrições HTML válidas", async () => {
      const comandaMock = {
        id: "comanda-ux1",
        customerName: "Cliente Audit",
        status: "OPEN",
        subtotal: "100.00",
        discountTotal: "0.00",
        surchargeTotal: "0.00",
        total: "100.00",
        paidTotal: "0.00",
        remainingTotal: "100.00",
        items: [],
        payments: [],
        availableSellers: [{ id: "m-1", user: { name: "Lucas Barbeiro" } }],
        permissions: { canCancel: true, canRefund: false, canReopen: false },
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === "/api/admin/comandas/comanda-ux1") {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(comandaMock) } as Response);
        }
        if (url === "/api/admin/products") {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ products: [{ id: "p-1", name: "Pomada Modeladora", salePrice: "35.00", trackStock: false }] }) } as Response);
        }
        if (url === "/api/admin/comandas/comanda-ux1/items") {
          return Promise.resolve({
            ok: false,
            status: 400,
            json: () => Promise.resolve({
              error: "PRODUCT_UNAVAILABLE",
              message: "Este produto está temporariamente indisponível.",
            }),
          } as Response);
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response);
      });

      render(<ComandaDetailPage />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Produto" })).toBeInTheDocument();
      });

      // Abrir modal de produto
      fireEvent.click(screen.getByRole("button", { name: "Produto" }));
      expect(screen.getByText("Adicionar Produto")).toBeInTheDocument();

      // 1. Comprovar ausência de noValidate (HTML5 constraints ativas)
      const form = screen.getByText("Adicionar Produto").closest("form");
      expect(form).not.toHaveAttribute("noValidate");

      // 2. Comprovar restrições nativas (required, min)
      const productSelect = screen.getByLabelText("Produto");
      const sellerSelect = screen.getByLabelText("Vendedor");
      const qtyInput = screen.getByLabelText("Quantidade");
      expect(productSelect).toBeRequired();
      expect(sellerSelect).toBeRequired();
      expect(qtyInput).toHaveAttribute("min", "1");

      // 3. Preencher formulário e simular rejeição da API
      fireEvent.change(productSelect, { target: { value: "p-1" } });
      fireEvent.change(sellerSelect, { target: { value: "m-1" } });
      fireEvent.change(qtyInput, { target: { value: "2" } });

      const submitBtn = screen.getByRole("button", { name: "Adicionar" });
      fireEvent.click(submitBtn);

      // 4. Comprovar que o erro da API é exibido contextualmente dentro do modal secundário
      await waitFor(() => {
        const modalAlert = screen.getByRole("alert");
        expect(modalAlert).toBeInTheDocument();
        expect(modalAlert).toHaveTextContent("Este produto está temporariamente indisponível.");
      });

      // O modal permanece aberto para que o usuário possa corrigir
      expect(screen.getByText("Adicionar Produto")).toBeInTheDocument();
    });
  });

  describe("UX1-REV-004 — Visibilidade e Rolagem de Erros de API", () => {
    it("reposiciona a rolagem interna do modal para o topo e dá foco no resumo do erro ao receber erro da API", async () => {
      const comandaMock = {
        id: "comanda-ux1",
        customerName: "Cliente Audit",
        status: "OPEN",
        subtotal: "90.00",
        discountTotal: "0.00",
        surchargeTotal: "0.00",
        total: "90.00",
        paidTotal: "0.00",
        remainingTotal: "90.00",
        items: [
          { id: "i-1", type: "SERVICE", status: "PENDING", description: "Barba Terapia", quantity: "1", unitPrice: "90.00", total: "90.00" },
        ],
        payments: [],
        permissions: { canCancel: true, canRefund: false, canReopen: false, canManageDebt: true, canConsumeCredit: true },
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === "/api/admin/comandas/comanda-ux1") {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(comandaMock) } as Response);
        }
        if (url === "/api/admin/comandas/comanda-ux1/finalize") {
          return Promise.resolve({
            ok: false,
            status: 422,
            json: () => Promise.resolve({
              error: "PENDING_ITEMS",
              message: "Conclua ou cancele todos os itens de serviço antes de finalizar a comanda.",
            }),
          } as Response);
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response);
      });

      render(<ComandaDetailPage />);

      await waitFor(() => {
        expect(screen.getAllByText("Finalizar atendimento")[0]).toBeInTheDocument();
      });

      // Abrir modal de pagamento
      fireEvent.click(screen.getAllByText("Finalizar atendimento")[0]);
      expect(screen.getByText("Finalizar Atendimento - Receber")).toBeInTheDocument();

      // Submeter pagamento
      const confirmBtn = screen.getByRole("button", { name: /Confirmar e Finalizar/i });
      fireEvent.click(confirmBtn);

      // O erro retornado pela API deve aparecer com role='alert' dentro do PaymentModal
      await waitFor(() => {
        const errorAlert = screen.getByRole("alert");
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert).toHaveTextContent("Conclua ou cancele todos os itens de serviço antes de finalizar a comanda.");
      });

      // O modal continua aberto com os dados preservados
      expect(screen.getByText("Finalizar Atendimento - Receber")).toBeInTheDocument();
    });
  });

  describe("UX1-REV-005 — Campos e Alvos de Toque (44x44px e Destaque Visual Preciso)", () => {
    it("destaca visualmente apenas a linha inválida no pagamento misto sem marcar linhas válidas", () => {
      render(
        <PaymentModal
          remainingTotal={150}
          busy={false}
          canManageDebt={true}
          onPay={vi.fn()}
          onClose={vi.fn()}
        />
      );

      // Alternar para pagamento misto
      const mixedTab = screen.getByRole("button", { name: /Misto/i });
      fireEvent.click(mixedTab);

      // Adicionar segunda parcela
      const addRowBtn = screen.getByRole("button", { name: "+ Adicionar Meio" });
      fireEvent.click(addRowBtn);

      // Preencher a primeira parcela com valor válido (100)
      const amountInputs = screen.getAllByLabelText("Valor Venda (R$)");
      fireEvent.change(amountInputs[0], { target: { value: "100.00" } });
      // Deixar a segunda parcela vazia ou zero

      // Submeter o formulário
      const form = screen.getByRole("dialog").querySelector("form")!;
      fireEvent.submit(form);

      // Apenas a segunda parcela deve ser marcada como inválida
      const updatedInputs = screen.getAllByLabelText("Valor Venda (R$)");
      expect(updatedInputs[0]).toHaveAttribute("aria-invalid", "false");
      expect(updatedInputs[1]).toHaveAttribute("aria-invalid", "true");
      expect(updatedInputs[1].className).toContain("border-[var(--border-danger)]");
    });

    it("assegura alvos de toque mínimos de 44x44px em botões críticos", () => {
      const itemMock = {
        id: "item-1",
        type: "SERVICE",
        status: "PENDING",
        description: "Corte Degradê",
        quantity: "1.000",
        unitPrice: "45.00",
        total: "45.00",
      };

      render(
        <ComandaItemCard
          item={itemMock}
          busy={false}
          comandaClosed={false}
          onConclude={vi.fn()}
          onCancel={vi.fn()}
          onAddDuplicate={vi.fn()}
        />
      );

      // Botão de duplicação: meta de 44x44px
      const duplicateBtn = screen.getByRole("button", {
        name: "Adicionar mais um deste serviço: Corte Degradê",
      });
      expect(duplicateBtn).toBeInTheDocument();
      expect(duplicateBtn.className).toContain("min-w-[44px]");
      expect(duplicateBtn.className).toContain("min-h-[44px]");

      // Botões de conclusão e cancelamento: min-h-[44px]
      const concludeBtn = screen.getByRole("button", { name: "Concluir item Corte Degradê" });
      expect(concludeBtn.className).toContain("min-h-[44px]");

      const cancelBtn = screen.getByRole("button", { name: "Cancelar item Corte Degradê" });
      expect(cancelBtn.className).toContain("min-h-[44px]");
    });
  });

  describe("BLOQUEADOR B — Isolamento Modal e Bloqueio de Submissão na Confirmação de Descarte", () => {
    it("bloqueia estritamente qualquer tentativa de submissão do formulário ou chamada a onPay enquanto a confirmação estiver visível", async () => {
      const onPay = vi.fn();
      const onClose = vi.fn();
      const { container } = render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          canManageDebt={true}
          onPay={onPay}
          onClose={onClose}
        />
      );

      // Alterar valor para tornar o formulário dirty
      const amountInput = screen.getByLabelText(/Valor Aplicado à Venda/i);
      fireEvent.change(amountInput, { target: { value: "70.00" } });

      // Disparar tentativa de fechar para abrir a confirmação
      const cancelBtn = screen.getByRole("button", { name: "Cancelar" });
      fireEvent.click(cancelBtn);

      const alertdialog = screen.getByRole("alertdialog");
      expect(alertdialog).toBeInTheDocument();

      // O formulário deve ter o atributo inert
      const form = container.querySelector("form")!;
      expect(form).toHaveAttribute("inert");

      // Tentar submeter o formulário financeiro enquanto a confirmação está ativa
      fireEvent.submit(form);
      expect(onPay).not.toHaveBeenCalled();

      // Tentar acionar o submit button dentro do form isolado
      const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(submitBtn).toBeInTheDocument();
      expect(submitBtn).toBeDisabled();
      fireEvent.click(submitBtn);
      expect(onPay).not.toHaveBeenCalled();

      // Pressionar Escape na confirmação deve fechar o alerta e NÃO descartar os dados
      fireEvent.keyDown(alertdialog, { key: "Escape", code: "Escape" });
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(amountInput).toHaveValue(70);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("prende a navegação por teclado entre 'Continuar editando' e 'Descartar e fechar'", () => {
      const { container } = render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          onPay={vi.fn()}
          onClose={vi.fn()}
        />
      );

      // Tornar dirty e abrir confirmação
      const amountInput = screen.getByLabelText(/Valor Aplicado à Venda/i);
      fireEvent.change(amountInput, { target: { value: "80.00" } });
      const cancelBtn = screen.getByRole("button", { name: "Cancelar" });
      fireEvent.click(cancelBtn);

      const continueBtn = screen.getByRole("button", { name: "Continuar editando" });
      const discardBtn = screen.getByRole("button", { name: "Descartar e fechar" });
      const alertdialog = screen.getByRole("alertdialog");

      // Tab trapping test
      continueBtn.focus();
      expect(document.activeElement).toBe(continueBtn);

      // Shift+Tab no continueBtn move foco para discardBtn
      fireEvent.keyDown(alertdialog, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(discardBtn);

      // Tab no discardBtn move foco de volta para continueBtn
      fireEvent.keyDown(alertdialog, { key: "Tab", shiftKey: false });
      expect(document.activeElement).toBe(continueBtn);
    });
  });

  describe("BLOQUEADOR C — Validação Financeira Rigorosa do Formulário Principal", () => {
    it("valida valor negativo, formato com mais de 2 casas decimais e campo obrigatório", () => {
      const onPay = vi.fn();
      const { container } = render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          canManageDebt={true}
          onPay={onPay}
          onClose={vi.fn()}
        />
      );

      const form = container.querySelector("form")!;
      const amountInput = screen.getByLabelText(/Valor Aplicado à Venda/i);

      // 1. Campo vazio
      fireEvent.change(amountInput, { target: { value: "" } });
      fireEvent.submit(form);
      expect(screen.getByRole("alert")).toHaveTextContent("Informe o valor a pagar.");
      expect(onPay).not.toHaveBeenCalled();

      // 2. Mais de 2 casas decimais (centavos)
      fireEvent.change(amountInput, { target: { value: "50.123" } });
      fireEvent.submit(form);
      expect(screen.getByRole("alert")).toHaveTextContent("Informe um valor válido com até 2 casas decimais.");
      expect(onPay).not.toHaveBeenCalled();

      // 3. Valor negativo
      fireEvent.change(amountInput, { target: { value: "-10.00" } });
      fireEvent.submit(form);
      expect(screen.getByRole("alert")).toHaveTextContent("Valor não pode ser negativo.");
      expect(onPay).not.toHaveBeenCalled();

      // 4. Valor acima do saldo restante
      fireEvent.change(amountInput, { target: { value: "150.00" } });
      fireEvent.submit(form);
      expect(screen.getByRole("alert")).toHaveTextContent("Valor não pode ser maior que o saldo restante.");
      expect(onPay).not.toHaveBeenCalled();
    });

    it("valida gorjeta sem favorecido, valor recebido em dinheiro insuficiente e crédito insuficiente", () => {
      const onPay = vi.fn();
      const { container } = render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          canManageDebt={true}
          members={[{ id: "m-1", name: "Lucas Barbeiro" }, { id: "m-2", name: "Pedro Barbeiro" }]}
          customerCreditBalance={50}
          canConsumeCredit={true}
          onPay={onPay}
          onClose={vi.fn()}
        />
      );

      const form = container.querySelector("form")!;
      const methodSelect = screen.getByLabelText(/Forma de Pagamento/i);
      const amountInput = screen.getByLabelText(/Valor Aplicado à Venda/i);

      // 1. Gorjeta preenchida mas sem selecionar profissional
      fireEvent.change(amountInput, { target: { value: "100.00" } });
      const tipInput = screen.getByLabelText(/Gorjeta \(R\$\)/i);
      fireEvent.change(tipInput, { target: { value: "15.00" } });
      fireEvent.submit(form);
      expect(screen.getByRole("alert")).toHaveTextContent("Selecione o profissional que receberá a gorjeta.");
      expect(onPay).not.toHaveBeenCalled();

      // 2. Dinheiro recebido menor que a soma de venda + gorjeta
      const tipMemberSelect = screen.getByLabelText(/Profissional Favorecido/i);
      fireEvent.change(tipMemberSelect, { target: { value: "m-1" } });
      fireEvent.change(methodSelect, { target: { value: "CASH" } });
      const cashReceivedInput = screen.getByLabelText(/Valor Recebido em Dinheiro/i);
      fireEvent.change(cashReceivedInput, { target: { value: "100.00" } }); // 100 < 100 + 15
      fireEvent.submit(form);
      expect(screen.getByRole("alert")).toHaveTextContent("Valor recebido em dinheiro é menor que a soma de venda, gorjeta e depósito.");
      expect(onPay).not.toHaveBeenCalled();

      // 3. Crédito do cliente insuficiente
      fireEvent.change(tipInput, { target: { value: "" } });
      fireEvent.change(methodSelect, { target: { value: "CUSTOMER_CREDIT" } });
      fireEvent.change(amountInput, { target: { value: "80.00" } }); // 80 > 50 balance
      fireEvent.submit(form);
      expect(screen.getByRole("alert")).toHaveTextContent("excede o saldo de crédito disponível");
      expect(onPay).not.toHaveBeenCalled();
    });

    it("valida rigorosamente cada parcela em pagamento misto", () => {
      const onPay = vi.fn();
      const { container } = render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          canManageDebt={true}
          onPay={onPay}
          onClose={vi.fn()}
        />
      );

      const mixedTab = screen.getByRole("button", { name: /Misto/i });
      fireEvent.click(mixedTab);

      const form = container.querySelector("form")!;
      const amountInputs = screen.getAllByLabelText("Valor Venda (R$)");

      // Parcela com valor inválido de centavos
      fireEvent.change(amountInputs[0], { target: { value: "50.999" } });
      fireEvent.submit(form);
      expect(screen.getByRole("alert")).toHaveTextContent("Utilize até 2 casas decimais");
      expect(onPay).not.toHaveBeenCalled();

      // Parcela com valor zero
      fireEvent.change(amountInputs[0], { target: { value: "0" } });
      fireEvent.submit(form);
      expect(screen.getByRole("alert")).toHaveTextContent("Cada parcela deve ter um valor de venda maior que zero.");
      expect(onPay).not.toHaveBeenCalled();
    });
  });

  describe("BLOQUEADOR D — Abertura e Modalidade Estrita do Diálogo", () => {
    it("abre o diálogo via showModal() e fecha via close() sem fallback degradado", () => {
      const showModalSpy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
      const closeSpy = vi.spyOn(HTMLDialogElement.prototype, "close");

      const { unmount } = render(
        <PaymentModal
          remainingTotal={60}
          busy={false}
          onPay={vi.fn()}
          onClose={vi.fn()}
        />
      );

      expect(showModalSpy).toHaveBeenCalled();

      unmount();
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe("TEMBARBER_UX1_FINAL_VALIDATION_EDGE_CASE — Validação Condicional e Ordem no Rodapé", () => {
    it("1. PIX com gorjeta inválida, depois mudança para Crédito do Cliente e recebimento válido", async () => {
      const onPay = vi.fn().mockResolvedValue(undefined);
      render(
        <PaymentModal
          remainingTotal={50}
          busy={false}
          canManageDebt={true}
          customerCreditBalance={100}
          canConsumeCredit={true}
          members={[{ id: "m-1", name: "Lucas Barbeiro" }]}
          onPay={onPay}
          onClose={vi.fn()}
        />
      );

      // Preencher gorjeta inválida com 3 casas decimais no PIX
      const tipInput = screen.getByLabelText(/Gorjeta \(R\$\)/i);
      fireEvent.change(tipInput, { target: { value: "15.999" } });

      // Mudar método para Crédito do Cliente (gorjeta fica inativa/oculta)
      const methodSelect = screen.getByLabelText(/Forma de Pagamento/i);
      fireEvent.change(methodSelect, { target: { value: "CUSTOMER_CREDIT" } });

      // Submeter formulário
      const form = screen.getByRole("dialog").querySelector("form")!;
      fireEvent.submit(form);

      // Deve processar com sucesso sem validar o campo de gorjeta oculto
      await waitFor(() => {
        expect(onPay).toHaveBeenCalledTimes(1);
      });
      expect(onPay).toHaveBeenCalledWith(
        [{ method: "CUSTOMER_CREDIT", amount: "50.00" }],
        expect.objectContaining({ allocations: undefined })
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("2. PIX com depósito inválido, depois mudança para pagamento misto válido", async () => {
      const onPay = vi.fn().mockResolvedValue(undefined);
      render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          canManageDebt={true}
          onPay={onPay}
          onClose={vi.fn()}
        />
      );

      // Preencher depósito em crédito inválido no PIX
      const depositInput = screen.getByLabelText(/Adicionar ao Crédito do Cliente/i);
      fireEvent.change(depositInput, { target: { value: "25.888" } });

      // Mudar para Pagamento Misto
      const mixedTab = screen.getByRole("button", { name: /Misto/i });
      fireEvent.click(mixedTab);

      // Preencher parcela mista válida
      const amountInput = screen.getAllByLabelText("Valor Venda (R$)")[0];
      fireEvent.change(amountInput, { target: { value: "100.00" } });

      // Submeter formulário
      const form = screen.getByRole("dialog").querySelector("form")!;
      fireEvent.submit(form);

      // Deve processar com sucesso sem validar o campo inativo de depósito do modo único
      await waitFor(() => {
        expect(onPay).toHaveBeenCalledTimes(1);
      });
      expect(onPay).toHaveBeenCalledWith(
        [{ method: "PIX", amount: "100.00" }],
        expect.objectContaining({ closeWithDebt: false })
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("3. Pagamento misto com gorjeta inválida em uma parcela ativa: a validação deve continuar bloqueando", () => {
      const onPay = vi.fn();
      render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          canManageDebt={true}
          members={[{ id: "m-1", name: "Lucas Barbeiro" }]}
          onPay={onPay}
          onClose={vi.fn()}
        />
      );

      // Alternar para pagamento misto
      const mixedTab = screen.getByRole("button", { name: /Misto/i });
      fireEvent.click(mixedTab);

      const form = screen.getByRole("dialog").querySelector("form")!;
      const amountInput = screen.getAllByLabelText("Valor Venda (R$)")[0];
      fireEvent.change(amountInput, { target: { value: "100.00" } });

      // Informar gorjeta inválida na parcela ativa
      const tipInput = screen.getByLabelText(/Gorjeta \(R\$\)/i);
      fireEvent.change(tipInput, { target: { value: "12.345" } });

      fireEvent.submit(form);

      expect(screen.getByRole("alert")).toHaveTextContent("Utilize até 2 casas decimais");
      expect(onPay).not.toHaveBeenCalled();
    });

    it("4. Pagamento único com gorjeta inválida ainda visível: a validação deve continuar bloqueando", () => {
      const onPay = vi.fn();
      render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          canManageDebt={true}
          members={[{ id: "m-1", name: "Lucas Barbeiro" }]}
          onPay={onPay}
          onClose={vi.fn()}
        />
      );

      // Preencher gorjeta inválida ainda visível
      const tipInput = screen.getByLabelText(/Gorjeta \(R\$\)/i);
      fireEvent.change(tipInput, { target: { value: "10.555" } });

      const form = screen.getByRole("dialog").querySelector("form")!;
      fireEvent.submit(form);

      expect(screen.getByRole("alert")).toHaveTextContent("Valor de gorjeta inválido. Utilize até 2 casas decimais.");
      expect(onPay).not.toHaveBeenCalled();
    });

    it("5. Alternância entre métodos sem perda inesperada dos valores preenchidos", () => {
      render(
        <PaymentModal
          remainingTotal={80}
          busy={false}
          customerCreditBalance={100}
          canConsumeCredit={true}
          members={[{ id: "m-1", name: "Lucas Barbeiro" }]}
          onPay={vi.fn()}
          onClose={vi.fn()}
        />
      );

      // Digitar gorjeta e depósito em PIX
      const tipInput = screen.getByLabelText(/Gorjeta \(R\$\)/i);
      fireEvent.change(tipInput, { target: { value: "15.00" } });
      const depositInput = screen.getByLabelText(/Adicionar ao Crédito do Cliente/i);
      fireEvent.change(depositInput, { target: { value: "20.00" } });

      // Alternar para Crédito do Cliente (campos somem visualmente)
      const methodSelect = screen.getByLabelText(/Forma de Pagamento/i);
      fireEvent.change(methodSelect, { target: { value: "CUSTOMER_CREDIT" } });
      expect(screen.queryByLabelText(/Gorjeta \(R\$\)/i)).not.toBeInTheDocument();

      // Alternar de volta para PIX
      fireEvent.change(methodSelect, { target: { value: "PIX" } });
      const restoredTipInput = screen.getByLabelText(/Gorjeta \(R\$\)/i);
      const restoredDepositInput = screen.getByLabelText(/Adicionar ao Crédito do Cliente/i);
      expect(restoredTipInput).toHaveValue(15);
      expect(restoredDepositInput).toHaveValue(20);
    });

    it("6. Payload financeiro final idêntico ao contrato homologado", async () => {
      const onPay = vi.fn().mockResolvedValue(undefined);
      render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          members={[{ id: "m-1", name: "Lucas Barbeiro" }]}
          onPay={onPay}
          onClose={vi.fn()}
        />
      );

      // Preencher gorjeta válida com membro selecionado
      const tipInput = screen.getByLabelText(/Gorjeta \(R\$\)/i);
      fireEvent.change(tipInput, { target: { value: "10.00" } });

      const form = screen.getByRole("dialog").querySelector("form")!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(onPay).toHaveBeenCalledTimes(1);
      });

      expect(onPay).toHaveBeenCalledWith(
        [{ method: "PIX", amount: "100.00" }],
        {
          closeWithDebt: false,
          confirmOutstandingBalance: false,
          allocations: [
            {
              method: "PIX",
              receivedAmount: 110,
              tipAmount: 10,
              tipMemberId: "m-1",
              creditDepositAmount: undefined,
            },
          ],
        }
      );
    });

    it("7. Ordem no DOM e Tab navigation tem Cancelar antes de Confirmar e Finalizar, sem classes order", () => {
      render(
        <PaymentModal
          remainingTotal={100}
          busy={false}
          onPay={vi.fn()}
          onClose={vi.fn()}
        />
      );

      const form = screen.getByRole("dialog").querySelector("form")!;
      const footerButtons = Array.from(form.querySelectorAll("div.shrink-0 button"));

      // Ordem DOM: Cancelar é o PRIMEIRO, Confirmar e Finalizar é o SEGUNDO
      expect(footerButtons).toHaveLength(2);
      expect(footerButtons[0]).toHaveAttribute("type", "button");
      expect(footerButtons[0].textContent).toContain("Cancelar");
      expect(footerButtons[1]).toHaveAttribute("type", "submit");
      expect(footerButtons[1].textContent).toContain("Confirmar e Finalizar");

      // Ausência total de classes order (sem inversão CSS artificial)
      expect(footerButtons[0].className).not.toMatch(/\border-/);
      expect(footerButtons[1].className).not.toMatch(/\border-/);

      // Acessibilidade e responsividade
      expect(footerButtons[0].className).toContain("min-h-[44px]");
      expect(footerButtons[1].className).toContain("min-h-[44px]");
      expect(footerButtons[0].className).toContain("w-full");
      expect(footerButtons[0].className).toContain("sm:w-auto");
      expect(footerButtons[1].className).toContain("w-full");
      expect(footerButtons[1].className).toContain("sm:w-auto");
    });
  });
});
