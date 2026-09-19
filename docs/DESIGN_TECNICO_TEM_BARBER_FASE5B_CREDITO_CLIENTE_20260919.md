# DESIGN TÉCNICO — TEM BARBER FASE 5B: CRÉDITO DO CLIENTE (V2)

**Data:** 2026-09-19
**Versão:** 2.0 (Revisão Pós-Human Design Review)
**Base de Código:** Produção SHA `aabae9b6c536b3c1aa3de16dcd0a6060287276f6`
**Status do Documento:** PROPOSTA TÉCNICA E AUDITORIA V2 (SEM ALTERAÇÃO DE CÓDIGO)

---

## REVISÃO V2 — CORREÇÕES APÓS HUMAN DESIGN REVIEW

Esta versão V2 incorpora os ajustes requeridos na revisão humana sobre o design do crédito de cliente para o Tem Barber, refinando conceitos contábeis, de identidade de tenant, prevenção de dupla contagem de receita, isolamento de métodos de pagamento, idempotência e permissões (RBAC).

---

## 1. IDENTIDADE TENANT DO CLIENTE E VÍNCULO

O schema Prisma atual estabelece:
- `User`: Entidade global na plataforma Match Barber (identificada por `phone` / `email` / `cpf` únicos).
- `CustomerBarbershopLink`: Vínculo escopado por tenant (`@@unique([barbershopId, customerId])`).

### Estrutura e Isolamento de Crédito:
O crédito do cliente **NUNCA** pertence ao `User` global isoladamente. Ele pertence estritamente ao vínculo do cliente com um estabelecimento específico (`barbershopId + customerId`).

```prisma
model CustomerCreditAccount {
  id           String   @id @default(uuid())
  barbershopId String   @map("barbershop_id")
  customerId   String   @map("customer_id")
  balance      Decimal  @default(0) @db.Decimal(10, 2)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  barbershop Barbershop             @relation(fields: [barbershopId], references: [id], onDelete: Cascade)
  customer   User                   @relation(fields: [customerId], references: [id], onDelete: Cascade)
  link       CustomerBarbershopLink @relation(fields: [barbershopId, customerId], references: [barbershopId, customerId], onDelete: Cascade)
  entries    CustomerCreditEntry[]

  @@unique([barbershopId, customerId])
  @@index([barbershopId, customerId])
  @@map("customer_credit_accounts")
}
```

### Regras de Integridade de Vínculo, Exclusão e Fusão:

- **`CUSTOMER_UNLINK_RULE`**:
  - Se `CustomerCreditAccount.balance > 0`: O rompimento do vínculo (`CustomerBarbershopLink`) é **rejeitado** com o erro `CUSTOMER_HAS_ACTIVE_CREDIT` (HTTP 422). O saldo precisa ser liquidado ou estornado antes de desvincular.
  - Se `balance == 0`: O vínculo pode ser desativado, mantendo a `CustomerCreditAccount` e seu ledger intactos para histórico de auditoria.

- **`CUSTOMER_DELETE_RULE`**:
  - Se o `User` possuir qualquer `CustomerCreditAccount` com `balance > 0` em qualquer tenant: A exclusão do usuário é **bloqueada** (HTTP 422).
  - Se `balance == 0`: A exclusão física do `User` é bloqueada se houver histórico contábil no ledger (`onDelete: Restrict` no `CustomerCreditEntry.createdByUserId`). O cliente pode ser desativado/anonimizado (LGPD), mas os registros financeiros permanecem preservados.

- **`CUSTOMER_MERGE_RULE`**:
  - A mesclagem/deduplicação de dois clientes é **bloqueada** se ambos possuírem contas de crédito ativas na mesma barbearia. É necessária conciliação ou transferência manual de saldo prévia autorizada por `OWNER`.

---

## 2. SEPARAÇÃO ENTRE CRÉDITO DO CLIENTE E CARTÃO DE CRÉDITO

O enum `PaymentMethod` do sistema já possui o valor `CREDIT`, que é utilizado historicamente para pagamentos via **Cartão de Crédito** (máquina/adquirente).

```text
CUSTOMER_CREDIT_PAYMENT_REPRESENTATION = CUSTOMER_CREDIT
```

É terminantemente proibido reutilizar `PaymentMethod.CREDIT` para consumo de saldo de cliente. No futuro schema, o enum será estendido:

```prisma
enum PaymentMethod {
  CASH
  PIX
  DEBIT
  CREDIT          // Cartão de Crédito (Adquirente/Máquina)
  CUSTOMER_CREDIT // Saldo interno de crédito do cliente
  OTHER
}
```

---

## 3. SEPARAÇÃO QUADRIPARTIDA DAS FINANÇAS

O design contábil da Fase 5B separa explicitamente quatro dimensões financeiras em cada transação:

1. **`SALE_REVENUE`**: Receita da venda de serviços/produtos (reconhecida no fechamento da comanda, independente da forma de pagamento/crédito).
2. **`COMANDA_SETTLEMENT`**: Montante total abatido do valor devedor da comanda.
3. **`NEW_CASH_INFLOW`**: Aporte novo e real de recursos em dinheiro, Pix ou cartão no caixa/banco da barbearia.
4. **`CUSTOMER_CREDIT_LIABILITY`**: Utilização ou criação de passivo de adiantamento de cliente.

### Exemplo Prático:
Comanda de R$ 70,00. Cliente utiliza R$ 40,00 de crédito acumulado e paga R$ 30,00 via PIX.

```text
COMANDA_SETTLEMENT = R$ 70,00  (Comanda quitada: status CLOSED, remainingTotal = 0)
SALE_REVENUE       = R$ 70,00  (Reconhecimento da venda nos relatórios de DRE)
NEW_CASH_INFLOW    = R$ 30,00  (Entrada real no caixa/banco via PIX)
CREDIT_CONSUMED    = R$ 40,00  (Baixa do passivo de crédito do cliente)
```

```text
CUSTOMER_CREDIT_PAYMENT_EXCLUDED_FROM_NEW_CASH_RECEIVED = YES
```

O valor pago via `CUSTOMER_CREDIT` (R$ 40,00) é **estritamente excluído** dos relatórios de novo fluxo de caixa recebido (`commandCashReceived` ou `cashInflow`).

---

## 4. MATRIZ OPERACIONAL E FINANCEIRA POR ORIGEM DE CRÉDITO (`CreditSourceKind`)

| Origem (`sourceKind`) | `CASH_IN` | `CASH_OUT` | Efeito em `SALE_REVENUE` | Efeito no Crédito | `FinancialEntryType` | `CashMovement` |
| :--- | :---: | :---: | :--- | :--- | :--- | :--- |
| **`OVERPAYMENT`** *(Checkout)* | **YES** | **NO** | Nenhum na criação (apenas o valor da venda) | **+ amount** | `CUSTOMER_CREDIT_DEPOSIT` (Passivo) | **+ excedente** |
| **`MANUAL_GRANT`** *(Cortesia)* | **NO** | **NO** | Nulo na criação (despesa de cortesia em relatório) | **+ amount** | `CUSTOMER_CREDIT_PROMOTION` | **NENHUM** |
| **`ADJUSTMENT`** *(Ajuste)* | **NO** | **NO** | Ajuste administrativo contábil | **+/- amount** | `CUSTOMER_CREDIT_ADJUSTMENT` | **NENHUM** |
| **`REFUND_TO_CREDIT`** *(Estorno)* | **NO** | **NO** | Reverte venda original (gera REFUND) | **+ amount** | `REFUND` (Conversão em crédito) | **NENHUM** |
| **`COMANDA_PAYMENT`** *(Consumo)* | **NO** | **NO** | Reconhece `SALE_REVENUE` da nova comanda | **- amount** | `NENHUM` (Baixa de passivo) | **NENHUM** |

---

## 5. FRONTEIRA CLARA COM A FASE 5D (CHECKOUT ALLOCATION)

```text
FASE_5B_OVERPAYMENT_CHECKOUT_IMPLEMENTATION = DEFER_TO_5D
```

- **Fase 5B**: Disponibiliza a estrutura de `CustomerCreditAccount`, `CustomerCreditEntry`, mutações manuais (`MANUAL_GRANT`, `ADJUSTMENT`), consumo de crédito na comanda (`CUSTOMER_CREDIT`) e estorno para crédito (`REFUND_TO_CREDIT`).
- **Fase 5D**: Implementará o motor completo de alocação no checkout (separação automática de `venda + troco em espécie + gorjeta + excedente alocado ao crédito`).

---

## 6. TRATAMENTO DE CRÉDITOS CASH-BACKED VS. PROMOCIONAL VS. REFUND-BACKED

O histórico no ledger `CustomerCreditEntry` registra a origem exata em `sourceKind`.

### Regra de Consumo (Conta Única com Ordenação FIFO):
Para simplificar a experiência do cliente mantendo a precisão contábil:
- Mantém-se uma **única conta por tenant** (`CustomerCreditAccount`).
- O consumo do crédito segue a regra **FIFO (First-In, First-Out)** baseada nos lançamentos pendentes no ledger, priorizando a baixa de créditos com expiração ou promocionais primeiro (`PROMOTIONAL` > `REFUND_BACKED` > `CASH_BACKED`).
- Isso preserva o saldo com lastro real em dinheiro pelo maior tempo possível.

---

## 7. CONCORRÊNCIA E IDEMPOTÊNCIA DE 5 ETAPAS

### A. Controle de Concorrência (Lock Pessimista):
Para evitar saldo negativo em requisições simultâneas:

```sql
SELECT id, balance
FROM customer_credit_accounts
WHERE barbershop_id = $1 AND customer_id = $2
FOR UPDATE;
```

Cenário: Cliente possui R$ 40,00 de saldo. Requisição A (R$ 30,00) e Requisição B (R$ 30,00) chegam simultaneamente.
- Requisição A obtém a trava `FOR UPDATE`, valida o saldo (R$ 40 >= R$ 30), deduz R$ 30,00 (saldo vira R$ 10,00) e libera a trava.
- Requisição B obtém a trava em seguida, re-valida o saldo sob a trava (R$ 10 < R$ 30), e é rejeitada com HTTP 422 `INSUFFICIENT_CREDIT_BALANCE`. Saldo nunca fica menor que zero.

### B. Protocolo de Idempotência em 5 Etapas:
1. **`Pre-check`**: Consulta se a `idempotencyKey` existe no cache/DB para o tenant.
2. **`Lock`**: Adquire a trava `FOR UPDATE` na `CustomerCreditAccount` e na `Comanda`.
3. **`Post-lock re-check`**: Re-verifica idempotência e saldo restante após adquirir as travas.
4. **`Payload validation`**: Se a chave de idempotência já existir e o hash do payload for diferente, rejeita com HTTP 409 `IDEMPOTENCY_KEY_CONFLICT`. Se o payload for idêntico, retorna o resultado salvo sem reprocessar.
5. **`Mutation`**: Executa o débito/crédito, grava no ledger e armazena o resultado na chave de idempotência.

---

## 8. PERMISSÕES E ANÁLISE DE RISCO DO RBAC

### Comparativo de Alternativas para `CREDIT_CONSUME`:
- **Opção A (Apenas OWNER/MANAGER)**: Reduz risco de fraude, mas impede o barbeiro autonomamente de encerrar o atendimento do cliente na cadeira quando este deseja pagar com seu saldo.
- **Opção B Recomendada (OWNER / MANAGER / BARBER com restrições operacionais)**:

| Permissão | OWNER | MANAGER | BARBER | SUPER_ADMIN | Restrições / Regras |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `CREDIT_VIEW` | **ALLOW** | **ALLOW** | **ALLOW** | **DENY** | Exibir saldo do cliente |
| `CREDIT_CONSUME` | **ALLOW** | **ALLOW** | **ALLOW** | **DENY** | **BARBER** só pode consumir crédito na comanda em que é o executor (`isLegacyOwnComanda`) |
| `CREDIT_MANUAL_GRANT` | **ALLOW** | **ALLOW** | **DENY** | **DENY** | Concessão de cortesia |
| `CREDIT_ADJUST` | **ALLOW** | **DENY** | **DENY** | **DENY** | Ajustes administrativos de saldo |
| `CREDIT_REVERSE` | **ALLOW** | **ALLOW** | **DENY** | **DENY** | Estornos de crédito |

---

## 9. FLUXO DETALHADO DO ESTORNO PARA CRÉDITO (`REFUND_TO_CREDIT`)

Quando um pagamento da comanda é estornado e convertido em saldo de crédito para o cliente:

1. **`Payment` Original**: `refundedAmount` é incrementado pelo valor estornado.
2. **Registro de `Payment` de Estorno**: É criada uma linha em `Payment` com status `REFUNDED` e `refundOfId` apontando para o pagamento original.
3. **`Comanda.remainingTotal`**: **NÃO é alterada** (se a comanda estava `CLOSED`, permanece `CLOSED`).
4. **Receita de Venda**: É criada uma `FinancialEntry` do tipo `REFUND` para anular a receita da venda original.
5. **Movimento de Caixa (`CashMovement`)**: **NÃO é gerado** (não há saída de cédulas ou Pix da empresa).
6. **Ledger de Crédito**: É criada uma `CustomerCreditEntry` do tipo `CREDIT`, `sourceKind = REFUND_TO_CREDIT`, incrementando o saldo do cliente.

---

## 10. IMPACTO NO MOTOR DE COMISSÃO (`syncCommissionReleaseForComanda`)

- Ao quitar uma comanda via `CUSTOMER_CREDIT`, a função `syncCommissionReleaseForComanda` é acionada normalmente.
- A comissão do barbeiro é calculada e liberada com base na receita da venda (`SALE_REVENUE`), independente de a fonte ter sido crédito ou dinheiro.
- O consumo do crédito não altera a regra de cálculo da comissão nem gera aportes duplicados.

---

## 11. ASPECTOS CONTÁBEIS, JURÍDICOS E RECONCILIAÇÃO DE DRIFT

```text
LEGAL_ACCOUNTING_REVIEW_REQUIRED = YES
```

- **Revisão Fiscal/Jurídica Necessária**: Regras de expiração de crédito promocional, tributação de adiantamentos de clientes (passivo circulante) e conversão de estornos exigem validação contábil formal antes do lançamento comercial.
- **Reconciliação Anti-Drift**: Será criada uma rotina automatizada `reconcileCustomerCreditBalance(barbershopId, customerId)` que compara `CustomerCreditAccount.balance` contra a soma histórica do `CustomerCreditEntry` ledger:
  $$\text{balance} = \sum \text{CREDIT} - \sum \text{DEBIT}$$
  Qualquer divergência gera um alerta imediato no painel administrativo do `OWNER`.

---

## 12. SUBFASES PROPOSTAS PARA A FASE 5B

1. **`5B.1 — Schema + Core Account/Ledger`**: Criação de `CustomerCreditAccount`, `CustomerCreditEntry`, migrações e rotas de suporte a lock pessimista.
2. **`5B.2 — Balance/Read APIs + Manual Grant/Adjustment`**: Rotas de consulta e concessão manual de crédito com controle RBAC.
3. **`5B.3 — Consume Credit in Comanda`**: Suporte ao método `CUSTOMER_CREDIT` em `finalizePost` e `registerPayment` sem duplicação de receita.
4. **`5B.4 — Refund-to-Credit / Reversal`**: Fluxo de conversão de estorno de comanda em crédito de cliente.
5. **`5B.5 — Real PostgreSQL Concurrency + Hardening`**: Suíte de testes no banco real cobrindo concorrência, corrida de dados, idempotência de 5 etapas e isolamento de tenant.

---

## 13. GARANTIAS DE IMUTABILIDADE DA RODADA ATUAL

- **`APPLICATION_CODE_CHANGED = NO`**
- **`PRISMA_SCHEMA_CHANGED = NO`**
- **`MIGRATION_EXECUTED = NO`**
- **`GIT_ADD_EXECUTED = NO`**
- **`COMMIT_EXECUTED = NO`**
- **`PUSH_EXECUTED = NO`**
- **`PRE_DEPLOY_EXECUTED = NO`**
- **`DEPLOY_EXECUTED = NO`**

Este documento V2 atualiza formalmente as especificações de design para revisão humana e autorização futura pelo Max.
