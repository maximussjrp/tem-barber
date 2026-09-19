# DESIGN TÉCNICO — TEM BARBER FASE 5B: CRÉDITO DO CLIENTE (V2.1)

**Data:** 2026-09-19
**Versão:** 2.1 (Pós-Release & Pós-Hardening Code Review)
**Base de Código:** SHA `501eef4e96dfb317489097e48f43895d0b33e61d` (Com correções locais de integridade)
**Status do Documento:** IMPLEMENTAÇÃO CONCLUÍDA E VALIDADA COM HARDENING DE INTEGRIDADE

---

## REVISÃO V2.1 — AJUSTES E HARDENING CONFORMES AO CÓDIGO REAL

Esta versão V2.1 atualiza formalmente o documento técnico para refletir com exatidão a implementação real e as correções pós-code-review:

1. **RBAC de Ajustes**: `OWNER` e `MANAGER` possuem permissão para realizar ajustes de crédito (`adjustCustomerCredit`).
2. **Hardening de Deleção (Sem Cascade-Delete)**: Relações de `User`, `CustomerBarbershopLink` e `CustomerCreditAccount` possuem `onDelete: Restrict`, preservando a imutabilidade do ledger contábil.
3. **Idempotência Tenant-Scoped Real**: `CustomerCreditEntry` possui `@@unique([barbershopId, idempotencyKey])`. Replays validam obrigatoriamente o payload econômico completo (retornando HTTP 409 `IDEMPOTENCY_KEY_CONFLICT` se a mesma chave for reutilizada com parâmetros divergentes).
4. **Isolamento Estrito de Tenant**: `getCustomerCreditAccount()` aceita vínculos existentes (`CustomerBarbershopLink`) ou cria o vínculo somente se houver evidência de relacionamento prévio no tenant (`Appointment`, `Comanda`, `CustomerClubSubscription`). Sem evidências, retorna HTTP 404 `CUSTOMER_NOT_FOUND` sem criar link ou conta.
5. **Diferenciação de Estornos (`COMANDA_REFUND` vs `REFUND_TO_CREDIT`)**:
   - `COMANDA_REFUND`: Restauração de saldo decorrente de estorno/cancelamento de pagamento realizado com `CUSTOMER_CREDIT`.
   - `REFUND_TO_CREDIT`: Conversão voluntária de estorno em dinheiro para crédito (mantido como DEFERRED / Fase 5D).
6. **Integridade de Caixa em Estornos de Crédito**:
   - Estornos de `CUSTOMER_CREDIT` **não geram** `FinancialEntry(type: "REFUND")` de caixa nem movimentação de caixa.
   - Os relatórios de resumo financeiro (`summary` e `daily-summary`) segregam `cashRefunds` de `customerCreditRefunds`, garantindo que estornos de saldo em loja não reduzam o fluxo de caixa líquido recebido (`CUSTOMER_CREDIT_REFUND_REDUCES_CASH=NO`).

---

## 1. IDENTIDADE TENANT DO CLIENTE E VÍNCULO

O schema Prisma estabelece:
- `User`: Entidade global na plataforma Match Barber.
- `CustomerBarbershopLink`: Vínculo escopado por tenant (`@@unique([barbershopId, customerId])`).

### Estrutura e Isolamento de Crédito:
O crédito do cliente pertence estritamente ao vínculo com a barbearia (`barbershopId + customerId`).

```prisma
model CustomerCreditAccount {
  id           String   @id @default(uuid())
  barbershopId String   @map("barbershop_id")
  customerId   String   @map("customer_id")
  balance      Decimal  @default(0) @db.Decimal(10, 2)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  barbershop Barbershop             @relation(fields: [barbershopId], references: [id], onDelete: Cascade)
  customer   User                   @relation(fields: [customerId], references: [id], onDelete: Restrict)
  link       CustomerBarbershopLink @relation(fields: [barbershopId, customerId], references: [barbershopId, customerId], onDelete: Restrict)
  entries    CustomerCreditEntry[]

  @@unique([barbershopId, customerId])
  @@index([barbershopId, customerId])
  @@map("customer_credit_accounts")
}
```

---

## 2. REGRAS DE IDEMPOTÊNCIA E VALIDAÇÃO DE REPLAY

1. **Constraint no Banco de Dados**:
   - `CustomerCreditEntry`: `@@unique([barbershopId, idempotencyKey])`.

2. **Validação de Payload de Replay**:
   - **GRANT**: Valida `customerId`, `amount`, `type === CREDIT`, `sourceKind`.
   - **ADJUST**: Valida `customerId`, `amount`, `type` (`CREDIT` | `DEBIT`), `sourceKind === ADJUSTMENT`.
   - **CONSUME**: Valida `customerId`, `amount`, `type === DEBIT`, `sourceKind === COMANDA_PAYMENT`, `comandaId`, `paymentId`.
   - **REFUND**: Valida `customerId`, `amount`, `type === CREDIT`, `sourceKind === COMANDA_REFUND`, `paymentId`, `comandaId`.

Qualquer divergência entre a chave e o payload dispara HTTP 409 `IDEMPOTENCY_KEY_CONFLICT`.

---

## 3. GARANTIAS DE INTEGRIDADE CONTÁBIL E CAIXA

- **`APPLICATION_CODE_CHANGED = YES`**
- **`PRISMA_SCHEMA_CHANGED = YES`**
- **`HARDENING_MIGRATION_CREATED = YES`**
- **`CUSTOMER_CREDIT_REFUND_REDUCES_CASH = NO`**
- **`CUSTOMER_CREDIT_REFUND_CASH_MOVEMENT = NO`**
