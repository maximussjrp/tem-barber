# Relatório de Auditoria Técnica: Reversão de Estoque em Cancelamentos

## 1. Resumo Executivo
* **Bug Confirmado**: **SIM** (O estoque não é revertido em nenhum fluxo de cancelamento de comandas ou de itens de comanda).
* **Severidade**: **P1** (Estoque incorreto em operação real, causando inconsistências graves de inventário físico vs. sistema).
* **Impacto Comercial**: Quando uma comanda anteriormente fechada/paga (CLOSED) é cancelada ou reaberta por estornos e tem seus produtos excluídos ou cancelados, a quantidade de produto correspondente **não é devolvida ao estoque**. Isso gera furos de estoque persistentes, perda de controle de inventário físico e impede que produtos que voltaram à prateleira fiquem disponíveis para novos agendamentos/vendas.

---

## 2. Arquitetura Atual de Estoque
* **Product (`products`)**:
  * `currentStock` (`Decimal(10, 3)`): Armazena diretamente a quantidade física restante do produto.
  * `trackStock` (`Boolean`): Flag que define se o produto sofre controle de estoque.
* **StockMovement (`stock_movements`)**:
  * Relação direta com `Product` e `ComandaItem` (`comandaItemId` - nullable, com `onDelete: SetNull`).
  * Tipo de movimento `type`: `StockMovementType` (`SALE`, `REFUND`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`).

---

## 3. Momento Exato da Baixa de Estoque
A baixa de estoque ocorre **exclusivamente na finalização da comanda** dentro da função `closeComanda` (localizada em `src/lib/operations/payments.ts`):
1. **Trigger**: Quando todos os pagamentos da comanda são efetuados e ela é marcada como `CLOSED`.
2. **Camada**: Dentro de uma transação serializável do Prisma (`prisma.$transaction`).
3. **Prevenção de Duplicidade**: Verifica se já existe um `StockMovement` de tipo `SALE` associado ao `comandaItemId`. Caso exista, ignora (evita baixas duplicadas em re-execução de fechamento).
4. **Estoque Insuficiente**: Lança `INSUFFICIENT_STOCK` e aborta/faz rollback de toda a transação se o saldo final for menor que zero.

---

## 4. Fluxos de Cancelamento e Reversão

O sistema possui 3 fluxos de cancelamento que deveriam impactar o estoque, mas atualmente não o fazem:

### A. Cancelamento de Comanda Inteira
* **Arquivo**: [src/app/api/admin/comandas/[id]/route.ts](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/comandas/%5Bid%5D/route.ts#L97-L122)
* **Status antes/depois**: `PENDING_PAYMENT` / `OPEN` -> `CANCELLED`
* **Transação**: `prisma.$transaction`
* **Comportamento atual**: Realiza o estorno de benefícios do clube (`reverseClubBenefitUsage`), marca todos os itens como `CANCELLED` e desativa comissões. **Não há qualquer código para restaurar a quantidade física em `Product.currentStock` ou criar movimentos de `REFUND`**.

### B. Cancelamento / Exclusão de Item Individual
* **Arquivo**: [src/app/api/admin/comandas/[id]/items/[itemId]/route.ts](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/comandas/%5Bid%5D/items/%5BitemId%5D/route.ts)
* **Status antes/depois**: `PENDING` / `DONE` -> `CANCELLED`
* **Transação**: `prisma.$transaction`
* **Comportamento atual**: Lógica análoga ao cancelamento da comanda, apenas marca o item como `CANCELLED`. Se o item pertencia a uma comanda que já havia sido fechada (e consequentemente já baixado do estoque), a quantidade **não retorna ao estoque**.

### C. Reabertura por Estorno de Pagamento
* **Arquivo**: [src/lib/operations/payments.ts](file:///d:/Projetos%20AI/Match%20Barber/src/lib/operations/payments.ts#L96-L176)
* **Status antes/depois**: `CLOSED` -> `PENDING_PAYMENT` (se o estorno deixar saldo em aberto)
* **Transação**: Não-transacionada diretamente (ou repassada por rota).
* **Comportamento atual**: O estorno do pagamento reabre a comanda para `PENDING_PAYMENT` e zera `closedAt`. O estoque **permanece baixado**. Se o usuário subsequentemente remover o produto da comanda reaberta e fechá-la novamente, o estoque do produto não retorna e tampouco será baixado novamente (graças à trava de `existingMovement`), consolidando o furo.

---

## 5. Matriz de Efeitos Secundários em Cancelamentos

| Fluxo | Estoque reverte? | Pagamento reverte? | Comissão reverte? | Clube reverte? | Atômico? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Cancelar comanda inteira** | **NÃO** | **NÃO** (Requer estorno manual) | **SIM** (Desmarca lançamento) | **SIM** (Chama `reverse`) | **SIM** (Transação) |
| **Cancelar/Excluir item** | **NÃO** | **NÃO** | **SIM** (Recalcula comissão) | **SIM** (Chama `reverse`) | **SIM** (Transação) |
| **Estornar Pagamento** | **NÃO** | **SIM** (Gera movimento movimento negativo) | **SIM** (Recalcula liberação) | **NÃO** | **NÃO** (Parcial) |

---

## 6. Evidência do Bug (`payments.ts`)
O trecho de código em [src/lib/operations/payments.ts](file:///d:/Projetos%20AI/Match%20Barber/src/lib/operations/payments.ts#L293-L327) realiza a baixa corretamente ao ler o array `items` e decrementar `Product.currentStock` para movimentos do tipo `SALE`.
No entanto, no arquivo [src/app/api/admin/comandas/[id]/route.ts](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/comandas/%5Bid%5D/route.ts#L97-L122), ao receber `body.status === "CANCELLED"`, o código apenas realiza o update em banco:
```typescript
await tx.comandaItem.updateMany({
  where: { comandaId: id, status: { not: "CANCELLED" } },
  data: { status: "CANCELLED", cancelledAt: new Date() },
});
```
Nenhum incremento ao estoque de `Product` ou criação de registro de `StockMovement` (tipo `REFUND`) é disparado. A evidência do bug continua **100% ativa** no HEAD atual da master.

---

## 7. Análise Detalhada dos Desafios Operacionais

### A. Idempotência e Registro de REFUND Exatamente uma Vez
* **O Risco**: Se o fluxo de cancelamento for executado múltiplas vezes concorrente ou sequencialmente (ex: retentativa de requisição lenta), o estoque pode subir indevidamente (+1, +1, +1) caso não existam checagens de estado anteriores.
* **Garantia de Unicidade**:
  * Cada `ComandaItem` que gerou uma movimentação `SALE` deve gerar **exatamente um** `REFUND` no cancelamento.
  * Antes de reverter o estoque, a transação deve verificar a existência de um `StockMovement` de tipo `REFUND` referenciando o `comandaItemId`:
    ```typescript
    const hasRefund = await tx.stockMovement.findFirst({
      where: { comandaItemId: item.id, type: StockMovementType.REFUND },
    });
    if (hasRefund) continue; // Ignora se já revertido
    ```

### B. Reabertura e Refechamento (Estorno Parcial/Total)
* **O Fluxo**:
  1. A comanda é fechada (`CLOSED`), dando baixa de 1 unidade do Produto A (`SALE`).
  2. O cliente pede estorno de um pagamento parcial. A comanda reabre para `PENDING_PAYMENT`.
  3. O estoque **não** deve ser revertido imediatamente ao reabrir, mantendo o controle físico da mercadoria que já saiu.
  4. **Se o item for removido ou cancelado enquanto aberta**: A remoção/cancelamento do item dispara a reversão (`REFUND` e incremento no estoque).
  5. **Se a comanda for fechada novamente**: A trava de `existingMovement` em `closeComanda` garante que produtos inalterados não sofram nova baixa.

### C. Cancelamento Concorrente
* **O Risco**: Duas finalizações simultâneas ou cancelamentos paralelos lendo a mesma quantidade em banco, gerando condições de corrida (Race Conditions) e estoque inconsistente ou negativo.
* **Garantia**: Toda a lógica de estorno/cancelamento deve rodar dentro de uma transação serializada do Prisma (`runSerializableTransaction` ou `prisma.$transaction` com controle de repetição), permitindo que o banco de dados trate concorrência no nível de linha (Row-level Locking) e relance transações conflitantes para retry limpo.

### D. Remoção de Item Após Baixa (Comanda Reaberta)
* **O Risco**: Com a comanda reaberta (status `PENDING_PAYMENT`), o operador remove um item de produto para reduzir o valor.
* **Comportamento Atual**: O item é marcado como `CANCELLED` no banco, mas a baixa de estoque gerada na finalização anterior permanece ativa, resultando em perda física sem registro correspondente de retorno.
* **Garantia**: A lógica de `DELETE` de `ComandaItem` deve identificar se o item possui um `StockMovement` do tipo `SALE` sem `REFUND` ativo, disparando o estorno do estoque e criando o `REFUND` imediatamente na transação.

### E. Necessidade Real de Migration
* **Análise**: Os modelos `Product` (com `currentStock` e `trackStock`) e `StockMovement` (com `comandaItemId` e `type` contendo `SALE` e `REFUND` enums) já contêm a modelagem de dados completa necessária para suportar a reversão lógica.
* **Conclusão**: **NÃO é necessária nenhuma migration de banco de dados**. Toda a correção de reversão de estoque será efetuada estritamente via lógica de aplicação em nível de backend (TypeScript).

### F. Atomicidade com Comissão e Clube
* **Comissão (`CommissionEntry`)**: As chamadas a `syncCommissionReleaseForComanda` já estão acopladas aos fluxos de cancelamento e recalculam as comissões. A reversão de estoque deve ser transacionada em conjunto, garantindo que o cancelamento de comissão e a devolução de estoque ocorram de forma atômica (tudo ou nada).
* **Clube (`ClubBenefitUsage`)**: O estorno do uso de benefícios do clube (`reverseClubBenefitUsage`) já está implementado. A nova lógica de reversão de estoque deve rodar no mesmo escopo transacional das chamadas do clube para evitar inconsistência parcial.

---

## 8. Testes Existentes e Lacunas
* **Testes Atuais**:
  * [src/__tests__/cancel.test.ts](file:///d:/Projetos%20AI/Match%20Barber/src/__tests__/cancel.test.ts): Valida apenas cancelamento de agendamentos e validações de sessão.
  * [src/__tests__/comanda-finalize.integration.test.ts](file:///d:/Projetos%20AI/Match%20Barber/src/__tests__/comanda-finalize.integration.test.ts): Valida apenas o fluxo de baixa de estoque e rollback em falta de saldo.
* **Lacunas**:
  * Não existe nenhum teste unitário ou de integração que comprove que **"cancelar comanda finalizada com produto devolve o estoque exatamente uma vez"**.
  * Não há teste para exclusão de item em comanda reaberta.

---

## 9. Lista de Achados de Auditoria

### [P1] Falha de Reversão de Estoque no Cancelamento de Comandas
* **Severidade**: **P1**
* **Arquivo**: `src/app/api/admin/comandas/[id]/route.ts`
* **Função**: `PATCH` (bloco `body.status === "CANCELLED"`)
* **Impacto**: Deixa o estoque permanentemente incorreto ao cancelar comandas que já baixaram mercadorias.
* **Proposta**: Mapear todos os itens do tipo `PRODUCT` da comanda. Para cada item que possua movimento `SALE` e nenhum movimento `REFUND` correspondente, incrementar o estoque do produto e criar o respectivo `StockMovement` do tipo `REFUND`.

### [P1] Falha de Reversão de Estoque no Cancelamento/Exclusão de Itens
* **Severidade**: **P1**
* **Arquivo**: `src/app/api/admin/comandas/[id]/items/[itemId]/route.ts`
* **Função**: `PATCH` e `DELETE`
* **Impacto**: Itens de produtos removidos/cancelados individualmente de comandas reabertas não sofrem estorno de estoque.
* **Proposta**: Validar se o item possui um `StockMovement` do tipo `SALE` sem `REFUND`. Se sim, efetuar incremento no estoque do produto e registrar `REFUND`.

---

## 10. Recomendação Final
* **Recomendação**: **GO** para criação de blueprint de correção técnica e suíte de testes correspondente.

---

## 11. Confirmações de Diretrizes
* **Código alterado**: NÃO (Nenhuma linha de código foi modificada).
* **Commit / Push**: NÃO.
* **Deploy**: NÃO.
* **Migrations**: NÃO.
* **Produção**: Intacta e inalterada.
