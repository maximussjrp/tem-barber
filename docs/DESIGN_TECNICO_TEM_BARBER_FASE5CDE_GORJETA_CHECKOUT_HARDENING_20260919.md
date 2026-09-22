# Design Técnico — Fases 5C + 5D + 5E (Gorjetas, Checkout Allocation Engine, Hardening e Reconciliação)

**Versão**: 1.0
**Data**: 19/09/2026
**Status**: IMPLEMENTADO E VALIDADO
**Base Canônica**: `50a79a4647e5a362af885278473d189499f47ed9`

---

## 1. Visão Geral da Arquitetura

Este documento especifica a implementação conjunta das **Fases 5C (Gorjetas)**, **5D (Checkout / Allocation Engine)** e **5E (Hardening + Reconciliação + Testes)** do Tem Barber.

### Princípios e Invariantes Econômicos

1. **`Payment.amount` = SOMENTE VENDA**: O modelo `Payment` registra exclusivamente a quitação da venda da comanda. Gorjetas, depósitos de crédito por troco/overpayment e troco em espécie **NÃO** entram em `Payment.amount`.
2. **Gorjeta é Passivo do Profissional**: A gorjeta pertence ao profissional (`memberId`). Não é receita operacional da barbearia (`TIP_IS_SALE_REVENUE=NO`), não altera o total da comanda (`TIP_CHANGES_COMANDA_TOTAL=NO`) e não afeta a base de cálculo de comissão (`TIP_IS_COMMISSION=NO`, `TIP_CHANGES_COMMISSION_BASE=NO`).
3. **Checkout Transaction & Allocation Atomicidade**: Todo checkout com gorjeta ou overpayment é intermediado por `CheckoutTransaction` e `CheckoutAllocation`, validando a equação econômica autoritativa:
   $$\text{receivedAmount} = \text{saleAmount} + \text{tipAmount} + \text{creditDepositAmount} + \text{changeAmount}$$
4. **Isolamento Tenant Absoluto**: Toda consulta e mutação valida `barbershopId` como primeiro critério de busca em queries e transações pessimistas.

---

## 2. Modelo de Dados (Prisma Schema)

### Novos Modelos e Enums

- **`TipEntry`**: Registro individual de gorjeta.
  - `status`: `CONFIRMED`, `PARTIALLY_REFUNDED`, `REFUNDED`
  - `amount`: valor total da gorjeta
  - `refundedAmount`: valor acumulado estornado ao cliente
  - `paidOutAmount`: valor acumulado repassado ao profissional
  - Constraint de integridade: `refundedAmount + paidOutAmount <= amount`
- **`TipRefund`**: Registro de estorno de gorjeta ao cliente.
- **`TipPayout`**: Registro de repasse em lote de gorjetas para o profissional.
  - `status`: `CONFIRMED`, `REVERSED`
- **`TipPayoutAllocation`**: Relação FIFO entre um payout e as gorjetas quitadas (`TipEntry`).
- **`TipPayoutReversal`**: Registro de reversão de repasse de gorjeta.
- **`CheckoutTransaction`**: Raiz transacional do checkout multi-tender.
  - `idempotencyKey` + `payloadFingerprint` (SHA-256 da carga econômica normalizada).
  - Mode: `FINALIZE`, `DEBT_PAYMENT`.
- **`CheckoutAllocation`**: Desmembramento por forma de pagamento (`method`) de cada valor recebido.
- **`CustomerCreditEntry`**: Estendido com `sourceKind = OVERPAYMENT` e `OVERPAYMENT_REVERSAL`, além de relacionamentos com `CheckoutAllocation`.

---

## 3. Allocation Engine & Regras de Checkout

| Método | Recebido | Venda | Gorjeta | Depósito Crédito | Troco Permite |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **CASH** | $\ge 0$ | $\ge 0$ | $\ge 0$ | $\ge 0$ | **SIM** (Troco = received - sale - tip - credit) |
| **PIX** | $\ge 0$ | $\ge 0$ | $\ge 0$ | $\ge 0$ | **NÃO** (changeAmount = 0) |
| **DEBIT** | $\ge 0$ | $\ge 0$ | $\ge 0$ | $\ge 0$ | **NÃO** (changeAmount = 0) |
| **CREDIT** | $\ge 0$ | $\ge 0$ | $\ge 0$ | $\ge 0$ | **NÃO** (changeAmount = 0) |
| **CUSTOMER_CREDIT** | $= \text{venda}$ | $> 0$ | **0** | **0** | **NÃO** (changeAmount = 0) |

---

## 4. Matriz de Direcionamento Financeiro & Caixa

- **Venda em Dinheiro (`CASH`)**: Gera `Payment`, `FinancialEntry(COMMAND_REVENUE)`, `CashMovement(+)`.
- **Gorjeta em Dinheiro (`CASH`)**: Gera `TipEntry`, `FinancialEntry(TIP_RECEIVED)`, `CashMovement(+)`.
- **Overpayment em Dinheiro (`CASH`)**: Gera `CustomerCreditEntry(CREDIT, OVERPAYMENT)`, `FinancialEntry(CUSTOMER_CREDIT_DEPOSIT)`, `CashMovement(+)`.
- **Troco (`changeAmount`)**: **NÃO** gera `Payment`, `FinancialEntry` ou `CashMovement`. O dinheiro é devolvido na hora ao cliente.

---

## 5. RBAC & Permissões

- **OWNER / MANAGER**:
  - Visualizar todas as gorjetas, saldos e histórico.
  - Realizar estorno de gorjeta (`refundTip`).
  - Executar repasse de gorjetas (`executeTipPayout`).
  - Reverter repasse de gorjetas (`reverseTipPayout`).
- **BARBER**:
  - Visualizar apenas suas próprias gorjetas e saldos via `/api/member/tips`.
  - Receber gorjetas em comandas onde é executor.
  - Bloqueado para estornar, repassar ou reverter repasses de gorjeta.
- **SUPER_ADMIN**:
  - Sem acesso financeiro implícito no tenant sem sessão operacional explícita.

---

## 6. Cancelamento Atômico da Comanda

O cancelamento com `refundAll=true` realiza a pré-validação atômica e estorno de todos os componentes:
1. Estorno de pagamentos da venda via `refundPayment()`.
2. Estorno de gorjetas via `refundTip()`. Se a gorjeta já tiver sido repassada ao profissional (`paidOutAmount > 0`), o cancelamento falha antes de mutar com o erro **`TIP_PAYOUT_REVERSAL_REQUIRED`**.
3. Reversão de créditos gerados no checkout via `reverseCheckoutCreditDeposit()`. Se o cliente já tiver consumido o crédito acumulado, o cancelamento falha atomicamente com o erro **`CUSTOMER_CREDIT_DEPOSIT_ALREADY_CONSUMED`**.

---

## 7. Reconciliação & Anti-Drift

Invariante do Ledger de Gorjetas:
$$\text{Gorjetas Recebidas} - \text{Estornos de Gorjeta} - \text{Repasses Ativos} = \text{Saldo a Repassar}$$

Helpers de auditoria tenant-safe implementados:
- `reconcileTipLedger(barbershopId, memberId)`
- `reconcileCheckoutTransaction(checkoutId)`
- `reconcileCustomerCreditBalance(barbershopId, customerId)`
