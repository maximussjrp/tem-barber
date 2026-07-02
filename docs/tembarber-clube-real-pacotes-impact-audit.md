# Auditoria de Impacto — Clube Real + Pacotes Separados

> **Data**: 02/07/2026
> **Status**: Auditoria concluída — Aguardando aprovação para implementação
> **Escopo**: Somente análise e plano técnico — NENHUMA alteração foi feita

---

## 1. Causa Conceitual do Problema Atual

O sistema atual trata **todos** os benefícios do tipo `INCLUDED_SERVICE` como **pacotes de crédito limitados** — com quantidade fixa por ciclo (`includedQty`), saldo decremental (`availableQty`) e UI que mostra "X/Y restantes".

Isso funciona bem para:
- ✅ Pacotes de créditos ("8 cortes por mês")
- ✅ Benefícios limitados por período

Mas **não representa corretamente**:
- ❌ Clube ilimitado ("corte ilimitado enquanto assinatura ativa")
- ❌ Benefícios sem teto numérico

### Pontos críticos no código atual

| Local | Problema | Severidade |
|-------|----------|------------|
| [club.ts:133](file:///d:/Projetos%20AI/Match%20Barber/src/lib/operations/club.ts#L133) | `includedQty ?? 0` — null vira 0, ilimitado seria tratado como esgotado | 🔴 CRÍTICO |
| [club.ts:265](file:///d:/Projetos%20AI/Match%20Barber/src/lib/operations/club.ts#L265) | `availableQty === 0` — bloquearia uso ilimitado | 🔴 CRÍTICO |
| [agendamentos/page.tsx:403](file:///d:/Projetos%20AI/Match%20Barber/src/app/admin/agendamentos/page.tsx#L403) | `availableQty -= 1` — com null produz NaN | 🔴 CRÍTICO |
| [agendamentos/page.tsx:497](file:///d:/Projetos%20AI/Match%20Barber/src/app/admin/agendamentos/page.tsx#L497) | `availableQty > 0` — null > 0 é falso, ilimitado seria "indisponível" | 🔴 CRÍTICO |
| [planos/page.tsx:101](file:///d:/Projetos%20AI/Match%20Barber/src/app/admin/clube/planos/page.tsx#L101) | `includedQty < 1` rejeita 0/null — impossível cadastrar ilimitado | 🟡 MÉDIO |
| [ComandaItemCard.tsx:118](file:///d:/Projetos%20AI/Match%20Barber/src/components/admin/comanda/ComandaItemCard.tsx#L118) | Label `"${availableQty} / ${includedQty} restantes"` — mostraria "null / null" | 🟡 MÉDIO |

> [!CAUTION]
> Se alguém definir `includedQty = null` hoje no banco, o sistema trataria o benefício como **esgotado** (0 disponíveis) e **bloquearia** o uso. A UI mostraria "null / null restantes".

---

## 2. Mapa de Arquivos Impactados

### 2.1 Models Prisma Impactados

| Model | Arquivo | Impacto |
|-------|---------|---------|
| `ClubPlanBenefit` | [schema.prisma:847-866](file:///d:/Projetos%20AI/Match%20Barber/prisma/schema.prisma#L847-L866) | 🔴 Precisa de novo campo `benefitLimitMode` |
| `ClubPlan` | [schema.prisma:825-845](file:///d:/Projetos%20AI/Match%20Barber/prisma/schema.prisma#L825-L845) | 🟢 Sem alteração |
| `CustomerClubSubscription` | [schema.prisma:868-889](file:///d:/Projetos%20AI/Match%20Barber/prisma/schema.prisma#L868-L889) | 🟢 Sem alteração |
| `ClubBenefitUsage` | [schema.prisma:918-952](file:///d:/Projetos%20AI/Match%20Barber/prisma/schema.prisma#L918-L952) | 🟢 Sem alteração (registra uso independente do modo) |
| `ClubPointEntry` | [schema.prisma:954-976](file:///d:/Projetos%20AI/Match%20Barber/prisma/schema.prisma#L954-L976) | 🟢 Sem alteração |
| `ClubSettlement` | [schema.prisma:978-1003](file:///d:/Projetos%20AI/Match%20Barber/prisma/schema.prisma#L978-L1003) | 🟢 Sem alteração |
| `ClubSettlementMember` | [schema.prisma:1005-1018](file:///d:/Projetos%20AI/Match%20Barber/prisma/schema.prisma#L1005-L1018) | 🟢 Sem alteração |
| `ClubSubscriptionPayment` | [schema.prisma:891-916](file:///d:/Projetos%20AI/Match%20Barber/prisma/schema.prisma#L891-L916) | 🟢 Sem alteração |
| `ComandaItem` | [schema.prisma:474-508](file:///d:/Projetos%20AI/Match%20Barber/prisma/schema.prisma#L474-L508) | 🟢 Sem alteração |
| `CommissionEntry` | [schema.prisma:698-726](file:///d:/Projetos%20AI/Match%20Barber/prisma/schema.prisma#L698-L726) | 🟢 Sem alteração |

### 2.2 Backend — Operações

| Arquivo | Funções Impactadas | Impacto |
|---------|-------------------|---------|
| [club.ts](file:///d:/Projetos%20AI/Match%20Barber/src/lib/operations/club.ts) | `getClubBenefitsBalance`, `resolveClubBenefitForComandaItem` | 🔴 Alto |
| [comandas.ts](file:///d:/Projetos%20AI/Match%20Barber/src/lib/operations/comandas.ts) | `recalculateComandaTotals` | 🟡 Médio |
| [payments.ts](file:///d:/Projetos%20AI/Match%20Barber/src/lib/operations/payments.ts) | `closeComanda` | 🟡 Médio |
| [commissions.ts](file:///d:/Projetos%20AI/Match%20Barber/src/lib/operations/commissions.ts) | `generateCommissionsForComanda` | 🟢 Baixo (já skip INCLUDED_SERVICE) |

### 2.3 APIs Impactadas

| Rota | Método | Impacto |
|------|--------|---------|
| [/clube/plans](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/clube/plans/route.ts) | POST | 🟡 Aceitar `benefitLimitMode` no body |
| [/clube/plans/[id]](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/clube/plans/%5Bid%5D/route.ts) | PATCH | 🟡 Aceitar `benefitLimitMode` no body |
| [/clube/plans/[id]/benefits](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/clube/plans/%5Bid%5D/benefits/route.ts) | POST | 🟡 Aceitar `benefitLimitMode` |
| [/clube/plans/[id]/benefits/[benefitId]](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/clube/plans/%5Bid%5D/benefits/%5BbenefitId%5D/route.ts) | PATCH | 🟡 Aceitar `benefitLimitMode` |
| [/clube/subscriptions/[id]/balance](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/clube/subscriptions/%5Bid%5D/balance/route.ts) | GET | 🔴 Retornar `limitMode`, `isUnlimited`, `label` |
| [/clube/subscriptions/customer/[customerId]/balance](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/clube/subscriptions/customer/%5BcustomerId%5D/balance/route.ts) | GET | 🔴 Idem |
| [/comandas](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/comandas/route.ts) | POST | 🟢 Já funciona (resolve via `resolveClubBenefitForComandaItem`) |
| [/comandas/[id]/items](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/comandas/%5Bid%5D/items/route.ts) | POST | 🟢 Já funciona (passa flags) |
| Demais rotas de comandas | PATCH/DELETE | 🟢 Sem alteração |
| Demais rotas de settlements | POST | 🟢 Sem alteração (pontos/rateio independem do modo) |

### 2.4 Telas Frontend Impactadas

| Tela | Arquivo | Impacto |
|------|---------|---------|
| Cadastro de Planos | [planos/page.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/app/admin/clube/planos/page.tsx) | 🔴 Alto — toggle "Ilimitado" |
| Edição de Plano | [planos/[id]/page.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/app/admin/clube/planos/%5Bid%5D/page.tsx) | 🔴 Alto — toggle "Ilimitado" |
| Assinantes | [assinantes/page.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/app/admin/clube/assinantes/page.tsx) | 🟡 Médio — label de saldo |
| Agendamentos | [agendamentos/page.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/app/admin/agendamentos/page.tsx) | 🔴 Alto — 6 pontos de checagem |
| Comanda Detalhe | [comandas/[id]/page.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/app/admin/comandas/%5Bid%5D/page.tsx) | 🟡 Médio — label do checkbox |
| ComandaItemCard | [ComandaItemCard.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/components/admin/comanda/ComandaItemCard.tsx) | 🟡 Médio — label do toggle |
| Fechamentos | [fechamentos/page.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/app/admin/clube/fechamentos/page.tsx) | 🟢 Sem alteração |
| Relatórios | [relatorios/page.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/app/admin/clube/relatorios/page.tsx) | 🟢 Sem alteração |

---

## 3. Proposta de Schema — Clube Real

### 3.1 Recomendação: Evoluir `ClubPlanBenefit` existente

Avaliação das opções:

| Opção | Descrição | Recomendação |
|-------|-----------|-------------|
| A) Evoluir `ClubPlanBenefit` | Adicionar campo `benefitLimitMode` + manter `includedQty` | ✅ **RECOMENDADO** |
| B) Nova tabela de regras | Criar `ClubBenefitRule` separado | ❌ Over-engineering |
| C) Enum novo sem campo | Inferir modo do valor de `includedQty` (null = ilimitado) | ❌ Semântica implícita, frágil |
| D) Campos existentes com adaptação | Usar `includedQty = 0` ou `-1` como sentinela para ilimitado | ❌ Hack, confuso |

**Justificativa**: A opção A é a mais limpa. O `ClubPlanBenefit` já concentra toda a lógica de configuração do benefício. Adicionar um campo explícito `benefitLimitMode` torna a semântica clara e determinística, sem criar tabelas desnecessárias.

### 3.2 Alterações no Schema Propostas

#### Novo Enum `ClubBenefitLimitMode`

```prisma
enum ClubBenefitLimitMode {
  UNLIMITED       // Uso ilimitado enquanto assinatura ativa
  MONTHLY_LIMIT   // Quantidade limitada por mês (ciclo de cobrança)
}
```

> [!NOTE]
> Os modos `WEEKLY_LIMIT` e `ONCE_PER_PERIOD` ficam reservados para futuro. Não implementar agora para evitar complexidade prematura. A modelagem com enum permite adição futura sem breaking change.

#### Alteração em `ClubPlanBenefit`

```diff
model ClubPlanBenefit {
  id              String                @id @default(uuid())
  clubPlanId      String                @map("club_plan_id")
  benefitType     ClubPlanBenefitType
+ benefitLimitMode ClubBenefitLimitMode  @default(MONTHLY_LIMIT) @map("benefit_limit_mode")
  serviceId       String?               @map("service_id")
  productId       String?               @map("product_id")
  includedQty     Int?                  @map("included_qty")
  discountPercent Decimal?              @db.Decimal(5, 2) @map("discount_percent")
  pointWeight     Decimal?              @db.Decimal(10, 4) @map("point_weight")
  // ... relations unchanged
}
```

**Regras de validação por combinação**:

| `benefitType` | `benefitLimitMode` | `includedQty` | `discountPercent` |
|---------------|-------------------|---------------|-------------------|
| `INCLUDED_SERVICE` | `UNLIMITED` | `null` (obrigatório) | `null` |
| `INCLUDED_SERVICE` | `MONTHLY_LIMIT` | `≥ 1` (obrigatório) | `null` |
| `SERVICE_DISCOUNT` | N/A (ignorado) | `null` | `> 0` (obrigatório) |
| `PRODUCT_DISCOUNT` | N/A (ignorado) | `null` | `> 0` (obrigatório) |

> [!IMPORTANT]
> Para benefícios de desconto (`SERVICE_DISCOUNT`, `PRODUCT_DISCOUNT`), o campo `benefitLimitMode` é ignorado. Descontos já são ilimitados por natureza no sistema atual (não há tracking de quantidade). Não alterar esse comportamento.

---

## 4. Regras de Negócio — Clube Real

### 4.1 Serviço Ilimitado (`UNLIMITED`)

| Etapa | Comportamento |
|-------|-------------|
| **Agenda** | Badge: "Coberto pelo Clube — Uso ilimitado" |
| | Preço previsto: R$ 0,00 com strikethrough do original |
| | Não mostra "X restantes" |
| **Comanda Aberta** | Toggle: "Usar pelo Clube — Ilimitado" |
| | Preview: R$ 0,00 |
| | Checkbox **nunca** desabilitado (não tem saldo numérico) |
| **Finalização** | Revalida: assinatura ACTIVE + benefício existe no plano |
| | **NÃO** valida saldo numérico |
| | Cria `ClubBenefitUsage` (status: APPLIED) |
| | Cria `ClubPointEntry` (se `pointWeight > 0`) |
| | **NÃO** cria `CommissionEntry` para o item |
| **Fechamento** | Pontos gerados entram no rateio normalmente |
| | Rateio proporcional por `pointWeight` |

### 4.2 Serviço Limitado (`MONTHLY_LIMIT`)

Comportamento **idêntico ao atual**. Nenhuma alteração:

| Etapa | Comportamento |
|-------|-------------|
| **Agenda** | Badge: "Coberto pelo Clube — X disponíveis" |
| **Comanda** | Toggle: "Usar pelo Clube — X restantes" |
| **Finalização** | Valida saldo (`availableQty > 0`) → bloqueia se esgotado |
| | Cria `ClubBenefitUsage` + `ClubPointEntry` |
| **Fechamento** | Pontos no rateio |

### 4.3 Desconto

Comportamento **idêntico ao atual**. Nenhuma alteração:

| Etapa | Comportamento |
|-------|-------------|
| **Agenda** | Badge: "-X% Clube" com preço líquido |
| **Comanda** | Desconto aplicado no preview |
| **Finalização** | `CommissionEntry` gerada sobre valor líquido |
| | `ClubBenefitUsage` registrada com `discountAmount` |
| | `ClubPointEntry` gerada se `pointWeight > 0` |
| **Fechamento** | Pontos no rateio |

### 4.4 Tabela Comparativa de Comportamento

| Aspecto | UNLIMITED | MONTHLY_LIMIT | DISCOUNT |
|---------|-----------|---------------|----------|
| Saldo numérico? | Não | Sim | Não |
| `availableQty` na API? | `null` | Número `≥ 0` | `null` |
| Bloqueia uso se esgotado? | Nunca | Sim | Nunca |
| Cria `ClubBenefitUsage`? | Sim | Sim | Sim |
| Cria `ClubPointEntry`? | Sim (se peso > 0) | Sim (se peso > 0) | Sim (se peso > 0) |
| Cria `CommissionEntry`? | Não | Não | Sim (sobre valor líquido) |
| Entra no rateio/fechamento? | Sim | Sim | Sim (via pontos) |
| Valor na comanda? | R$ 0,00 | R$ 0,00 | Original - desconto |
| Label na agenda | "Uso ilimitado" | "X disponíveis" | "-X% Clube" |
| Label na comanda | "Ilimitado" | "X restantes" | "Desconto X%" |

---

## 5. Proposta de Resposta da Balance API

### 5.1 Formato Seguro Proposto

Para cada benefício no array `benefits[]` da resposta:

**INCLUDED_SERVICE — Ilimitado:**
```json
{
  "id": "benefit-uuid",
  "benefitType": "INCLUDED_SERVICE",
  "limitMode": "UNLIMITED",
  "serviceId": "service-uuid",
  "service": { "id": "...", "name": "Corte Masculino", "price": "45.00" },
  "isUnlimited": true,
  "includedQty": null,
  "usedQty": 3,
  "availableQty": null,
  "canUse": true,
  "label": "Uso ilimitado",
  "pointWeight": 1.0
}
```

**INCLUDED_SERVICE — Limitado:**
```json
{
  "id": "benefit-uuid",
  "benefitType": "INCLUDED_SERVICE",
  "limitMode": "MONTHLY_LIMIT",
  "serviceId": "service-uuid",
  "service": { "id": "...", "name": "Corte Masculino", "price": "45.00" },
  "isUnlimited": false,
  "includedQty": 8,
  "usedQty": 2,
  "availableQty": 6,
  "canUse": true,
  "label": "6 de 8 disponíveis",
  "pointWeight": 1.0
}
```

**INCLUDED_SERVICE — Esgotado:**
```json
{
  "id": "benefit-uuid",
  "benefitType": "INCLUDED_SERVICE",
  "limitMode": "MONTHLY_LIMIT",
  "serviceId": "service-uuid",
  "service": { "id": "...", "name": "Corte Masculino", "price": "45.00" },
  "isUnlimited": false,
  "includedQty": 8,
  "usedQty": 8,
  "availableQty": 0,
  "canUse": false,
  "label": "Limite esgotado (8/8)",
  "pointWeight": 1.0
}
```

**SERVICE_DISCOUNT / PRODUCT_DISCOUNT:**
```json
{
  "id": "benefit-uuid",
  "benefitType": "SERVICE_DISCOUNT",
  "limitMode": null,
  "serviceId": "service-uuid",
  "service": { "id": "...", "name": "Barba", "price": "35.00" },
  "isUnlimited": true,
  "includedQty": null,
  "usedQty": 0,
  "availableQty": null,
  "canUse": true,
  "label": "Desconto de 20%",
  "discountPercent": 20,
  "pointWeight": 0.5
}
```

### 5.2 Campos Novos vs. Existentes

| Campo | Status | Descrição |
|-------|--------|-----------|
| `limitMode` | 🆕 NOVO | `"UNLIMITED"`, `"MONTHLY_LIMIT"`, ou `null` (descontos) |
| `isUnlimited` | 🆕 NOVO | `true` se ilimitado ou desconto, `false` se limitado |
| `canUse` | 🆕 NOVO | `true` se pode usar agora (tem saldo ou é ilimitado), `false` se esgotado |
| `label` | 🆕 NOVO | Label humanizado pronto para UI |
| `includedQty` | ♻️ EXISTENTE | Agora nullable — `null` para ilimitado |
| `usedQty` | ♻️ EXISTENTE | Mantém contagem (para ilimitado, mostra uso do ciclo para stats) |
| `availableQty` | ♻️ EXISTENTE | Agora nullable — `null` para ilimitado |

> [!TIP]
> Os campos `isUnlimited`, `canUse` e `label` são **derivados** em runtime, não armazenados no banco. Simplificam o frontend ao eliminar a necessidade de lógica condicional complexa no lado do cliente.

---

## 6. Alterações Detalhadas por Arquivo

### 6.1 Backend: `club.ts` — `getClubBenefitsBalance`

**Atual** (L128-165):
```typescript
// L133: const allowedQty = benefit.includedQty ?? 0;
// L134: const availableQty = Math.max(0, allowedQty - usedQty);
```

**Proposta**:
```typescript
if (benefit.benefitType === "INCLUDED_SERVICE") {
  const isUnlimited = benefit.benefitLimitMode === "UNLIMITED";
  if (isUnlimited) {
    return {
      ...commonFields,
      limitMode: "UNLIMITED",
      isUnlimited: true,
      includedQty: null,
      usedQty,
      availableQty: null,
      canUse: true,
      label: "Uso ilimitado",
    };
  } else {
    const allowedQty = benefit.includedQty ?? 0;
    const availableQty = Math.max(0, allowedQty - usedQty);
    return {
      ...commonFields,
      limitMode: "MONTHLY_LIMIT",
      isUnlimited: false,
      includedQty: allowedQty,
      usedQty,
      availableQty,
      canUse: availableQty > 0,
      label: availableQty > 0
        ? `${availableQty} de ${allowedQty} disponíveis`
        : `Limite esgotado (${allowedQty}/${allowedQty})`,
    };
  }
}
```

### 6.2 Backend: `club.ts` — `resolveClubBenefitForComandaItem`

**Atual** (L265):
```typescript
if (matchingBenefit.availableQty === 0) {
  return { applicable: false, blockedReason: "BENEFIT_LIMIT_REACHED" };
}
```

**Proposta**:
```typescript
if (!matchingBenefit.isUnlimited && matchingBenefit.availableQty === 0) {
  return { applicable: false, blockedReason: "BENEFIT_LIMIT_REACHED" };
}
```

### 6.3 Backend: `comandas.ts` — `recalculateComandaTotals`

**Atual** (L123-125):
```typescript
if (benefit.availableQty && benefit.availableQty > 0) {
  clubReductions += Number(item.total);
  benefit.availableQty--;
```

**Proposta**:
```typescript
const canUseBenefit = benefit.isUnlimited || (benefit.availableQty != null && benefit.availableQty > 0);
if (canUseBenefit) {
  clubReductions += Number(item.total);
  if (!benefit.isUnlimited && benefit.availableQty != null) {
    benefit.availableQty--;
  }
```

### 6.4 Frontend: Padrão Seguro para Checagem de Saldo

Em **todos** os pontos do frontend que checam `availableQty`, usar o campo `canUse` ou `isUnlimited`:

```typescript
// ❌ ANTES (frágil)
if (benefit.availableQty > 0) { ... }
benefit.availableQty -= 1;
label = `${b.availableQty} / ${b.includedQty} restantes`;

// ✅ DEPOIS (seguro)
if (benefit.canUse) { ... }
if (!benefit.isUnlimited && benefit.availableQty != null) {
  benefit.availableQty -= 1;
}
label = benefit.isUnlimited
  ? "Ilimitado"
  : `${b.availableQty} / ${b.includedQty} restantes`;
```

**Locais exatos**:

| Arquivo | Linhas | Padrão atual | Correção |
|---------|--------|-------------|----------|
| `agendamentos/page.tsx` | L400, L403 | `availableQty > 0`, `availableQty -= 1` | Usar `canUse`, skip decrement |
| `agendamentos/page.tsx` | L497, L502 | `availableQty > 0`, badge com count | Usar `canUse`, label dinâmico |
| `agendamentos/page.tsx` | L795, L798 | `availableQty > 0`, `availableQty -= 1` | Idem |
| `comandas/[id]/page.tsx` | L482, L484 | Label hardcoded, disable check | Usar `label`, `canUse` |
| `ComandaItemCard.tsx` | L118, L120 | Label hardcoded, disable check | Usar `label`, `canUse` |
| `assinantes/page.tsx` | L377 | `remaining / included restantes` | Usar `label` da API |

### 6.5 Frontend: Cadastro de Plano com Modo Ilimitado

No modal de Novo/Editar Plano ([planos/page.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/app/admin/clube/planos/page.tsx)):

**Proposta de UX**:
```
☑ Corte Masculino Tradicional (R$ 45,00)

  Modo do benefício:
  ○ Ilimitado — Cliente pode usar enquanto a assinatura estiver ativa
  ● Limitado por mês

  [Se Limitado]:
  Quantidade mensal: [ 8 ]

  Peso no rateio: [ 1.0 ]
  ℹ️ Pontos gerados por uso para rateio dos barbeiros
```

---

## 7. Comanda Aberta e Finalização — Adaptações

### 7.1 Comanda Aberta (Preview)

| Cenário | Comportamento atual | Comportamento proposto |
|---------|--------------------|-----------------------|
| Ilimitado + elegível | N/A (não existe) | R$ 0,00 + "Uso ilimitado" + checkbox sempre ativo |
| Limitado + saldo | R$ 0,00 + "X restantes" | Sem alteração |
| Limitado + esgotado | Preço normal + disabled | Sem alteração |
| Desconto | Preço líquido | Sem alteração |

**Na função `recalculateComandaTotals`**:
- Se `isUnlimited`: não decrementar `availableQty` em memória
- Se `isUnlimited`: sempre adicionar `clubReductions += Number(item.total)`
- Não criar `ClubBenefitUsage` antes da finalização (igual ao comportamento atual)

### 7.2 Finalização (`closeComanda`)

Na função [closeComanda](file:///d:/Projetos%20AI/Match%20Barber/src/lib/operations/payments.ts#L178):

**Alterações**:
1. Ao chamar `resolveClubBenefitForComandaItem`:
   - Se `isUnlimited`: NÃO validar saldo numérico
   - Validar: assinatura ACTIVE + benefício existe no plano + plano ativo
2. Criar `ClubBenefitUsage` normalmente (independente do modo)
3. Criar `ClubPointEntry` normalmente (se `pointWeight > 0`)
4. NÃO criar `CommissionEntry` para `INCLUDED_SERVICE` (já funciona assim)

---

## 8. Fechamento do Clube — Análise de Estado Atual

### 8.1 Funções Auditadas

| Função | Status | Observações |
|--------|--------|-------------|
| `calculateClubSettlement` | ✅ Pronto | Funciona com pontos de qualquer modo |
| `approveClubSettlement` | ✅ Pronto | Transição CALCULATED → APPROVED |
| `markClubSettlementPaid` | ✅ Pronto | Transição APPROVED → PAID |
| Carry-in/carry-out | ✅ Pronto | Se 0 pontos, tudo carrega para próximo mês |

### 8.2 Verificação de Cenários

| Cenário | Já funciona? | Notas |
|---------|-------------|-------|
| Serviços ilimitados gerando pontos | ✅ Sim | `registerClubBenefitUsage` já cria `ClubPointEntry` independente de modo |
| Serviços limitados gerando pontos | ✅ Sim | Comportamento atual |
| Mensalidades pagas compondo fundo | ✅ Sim | `ClubSubscriptionPayment` com `status: PAID` são somados |
| Competências congeladas | ✅ Sim | Pontos ficam `SETTLED` após approve |
| Rateio por pontos | ✅ Sim | Proporcional a `points`, round-robin para centavos |
| Inadimplente fica fora | ✅ Sim | Pagamentos não-PAID são excluídos |
| Alteração de peso não muda fechamento antigo | ✅ Sim | `pointWeightApplied` no `ClubBenefitUsage` é snapshot |
| Zero pontos com mensalidade = carry-over | ✅ Sim | `carryOutAmount = totalBarberPoolCents` quando `totalPoints === 0` |

### 8.3 Lacunas Identificadas

| Lacuna | Severidade | Detalhes |
|--------|-----------|---------|
| Pagamento manual não vincula competência automaticamente | 🟡 Baixo | O campo `competence` é enviado pelo frontend. Se não for informado, pode gerar inconsistência. Mas isso é uma lacuna existente, não é criada pela mudança para ilimitado. |
| `shopSharePercent` no settlement pode divergir dos snapshots individuais | 🟡 Baixo | O campo no settlement é informativo. O cálculo real usa `shopSharePercentSnapshot` por pagamento — correto. |

> [!TIP]
> O motor de fechamento/rateio está **totalmente pronto** para suportar benefícios ilimitados sem nenhuma alteração. Os pontos são gerados por uso (via `registerClubBenefitUsage`) e distribuídos por `pointWeight`, independente de haver ou não limite de quantidade.

---

## 9. Regras de Negócio — Pacotes Separados

### 9.1 Conceito

Pacote é uma **compra antecipada de créditos** para serviços, com regras financeiras distintas do clube:

| Aspecto | Clube | Pacote |
|---------|-------|--------|
| Modelo | Assinatura recorrente | Compra única |
| Saldo | Reseta por ciclo (ou ilimitado) | Decrementa até acabar |
| Validade | Enquanto assinatura ativa | Data de expiração fixa |
| Rateio | Sim (fechamento mensal) | Não |
| Comissão | Via pontos no rateio | Na venda e/ou na execução |
| `ClubPointEntry` | Sim | Não |
| `ClubSettlement` | Sim | Não |

### 9.2 Modelagem Proposta

```prisma
// ─── Pacotes ───────────────────────────────────────

enum PackageStatus {
  ACTIVE
  EXPIRED
  DEPLETED
  CANCELED
}

enum PackageExecutorMode {
  ANY_BARBER        // Qualquer barbeiro pode executar
  SELLER_ONLY       // Somente o vendedor
  SPECIFIC_BARBER   // Barbeiro específico (definido na venda)
}

model ServicePackage {
  id              String              @id @default(uuid())
  barbershopId    String              @map("barbershop_id")
  name            String              // ex: "Pacote 8 Cortes"
  description     String?
  serviceId       String              @map("service_id")
  totalCredits    Int                 @map("total_credits")    // Quantidade vendida
  price           Decimal             @db.Decimal(10, 2)       // Preço do pacote
  validityDays    Int?                @map("validity_days")    // Dias de validade após venda (null = sem expiração)
  executorMode    PackageExecutorMode @default(ANY_BARBER) @map("executor_mode")
  isActive        Boolean             @default(true)           @map("is_active")
  createdAt       DateTime            @default(now()) @map("created_at")
  updatedAt       DateTime            @updatedAt @map("updated_at")

  barbershop      Barbershop          @relation(fields: [barbershopId], references: [id], onDelete: Cascade)
  service         Service             @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  sales           PackageSale[]

  @@index([barbershopId, isActive])
  @@map("service_packages")
}

model PackageSale {
  id              String              @id @default(uuid())
  barbershopId    String              @map("barbershop_id")
  packageId       String              @map("package_id")
  customerId      String              @map("customer_id")
  sellerId        String?             @map("seller_id")        // BarbershopMember que vendeu
  executorId      String?             @map("executor_id")      // BarbershopMember executor fixo (se SPECIFIC_BARBER)
  totalCredits    Int                 @map("total_credits")     // Snapshot da compra
  usedCredits     Int                 @default(0) @map("used_credits")
  price           Decimal             @db.Decimal(10, 2)       // Preço pago
  paymentMethod   PaymentMethod?      @map("payment_method")
  status          PackageStatus       @default(ACTIVE)
  expiresAt       DateTime?           @map("expires_at")       // Data limite de uso
  soldAt          DateTime            @default(now()) @map("sold_at")
  createdAt       DateTime            @default(now()) @map("created_at")
  updatedAt       DateTime            @updatedAt @map("updated_at")

  barbershop      Barbershop          @relation(fields: [barbershopId], references: [id], onDelete: Cascade)
  package         ServicePackage      @relation(fields: [packageId], references: [id])
  customer        User                @relation(fields: [customerId], references: [id], onDelete: Cascade)
  seller          BarbershopMember?   @relation("packageSeller", fields: [sellerId], references: [id])
  executor        BarbershopMember?   @relation("packageExecutor", fields: [executorId], references: [id])
  usages          PackageUsage[]

  @@index([barbershopId, customerId])
  @@index([barbershopId, status])
  @@map("package_sales")
}

model PackageUsage {
  id              String              @id @default(uuid())
  barbershopId    String              @map("barbershop_id")
  saleId          String              @map("sale_id")
  comandaItemId   String              @unique @map("comanda_item_id")
  executorId      String              @map("executor_id")      // Quem executou
  originalAmount  Decimal?            @db.Decimal(10, 2)
  usedAt          DateTime            @default(now()) @map("used_at")
  reversedAt      DateTime?           @map("reversed_at")
  status          ClubBenefitUsageStatus @default(APPLIED)     // Reutiliza enum APPLIED/REVERSED
  createdAt       DateTime            @default(now()) @map("created_at")

  barbershop      Barbershop          @relation(fields: [barbershopId], references: [id], onDelete: Cascade)
  sale            PackageSale         @relation(fields: [saleId], references: [id])
  comandaItem     ComandaItem         @relation(fields: [comandaItemId], references: [id], onDelete: Cascade)

  @@index([barbershopId, saleId])
  @@map("package_usages")
}
```

### 9.3 O que Pode ser Reaproveitado do Motor Atual

| Componente | Reaproveitável? | Detalhes |
|------------|----------------|---------|
| Abatimento na comanda (`recalculateComandaTotals`) | ✅ Parcial | Lógica de subtração de `clubReductions` pode ser generalizada para `benefitReductions` |
| Checkbox/toggle na comanda | ✅ Sim | Mesmo padrão de `clubBenefitRequested` → novo campo `packageUsageRequested` |
| Preview R$ 0,00 | ✅ Sim | Mesma lógica visual |
| Consumo no fechamento | ❌ Não | Pacote é consumido no `closeComanda`, mas NÃO gera pontos/rateio |
| Validação de saldo | ✅ Parcial | `usedCredits < totalCredits` + verificar `expiresAt` |
| Histórico de uso | ✅ Sim | Mesmo padrão de `PackageUsage` com `status: APPLIED/REVERSED` |

### 9.4 Regras Financeiras do Pacote

| Regra | Detalhes |
|-------|---------|
| NÃO entra no rateio do clube | Pacote não cria `ClubPointEntry` |
| NÃO entra em `ClubSettlement` | Módulo completamente separado |
| Comissão na venda | Pode gerar `CommissionEntry` na `PackageSale` |
| Comissão na execução | Configurável: pode ou não gerar comissão quando o crédito é usado |
| Abatimento na comanda | Serviço coberto pelo pacote vai a R$ 0,00 |
| Executor permitido | Depende de `executorMode` do pacote |

---

## 10. Proposta de Migração

### 10.1 Migration Necessária

Sim, será necessária uma migration para:
1. Criar o enum `ClubBenefitLimitMode`
2. Adicionar o campo `benefitLimitMode` na tabela `club_plan_benefits`
3. Backfill dos registros existentes

### 10.2 Migration Segura Proposta

```sql
-- 1. Criar enum
CREATE TYPE "ClubBenefitLimitMode" AS ENUM ('UNLIMITED', 'MONTHLY_LIMIT');

-- 2. Adicionar campo com default compatível
ALTER TABLE "club_plan_benefits"
  ADD COLUMN "benefit_limit_mode" "ClubBenefitLimitMode"
  NOT NULL DEFAULT 'MONTHLY_LIMIT';

-- 3. Backfill: todos os INCLUDED_SERVICE existentes com includedQty viram MONTHLY_LIMIT
-- (o DEFAULT já faz isso, mas para deixar explícito):
UPDATE "club_plan_benefits"
SET "benefit_limit_mode" = 'MONTHLY_LIMIT'
WHERE "benefit_type" = 'INCLUDED_SERVICE'
  AND "included_qty" IS NOT NULL;
```

### 10.3 Regras de Compatibilidade

| Regra | Implementação |
|-------|-------------|
| Benefícios existentes com `includedQty` preenchido | Automatically `MONTHLY_LIMIT` via DEFAULT |
| Benefícios existentes sem `includedQty` (descontos) | `MONTHLY_LIMIT` no campo, mas ignorado na lógica (descontos não usam esse campo) |
| Assinaturas já criadas | Sem alteração (referência ao plano se mantém) |
| Histórico de `ClubBenefitUsage` | Sem alteração (registros já existentes não precisam do modo) |
| Planos inativos | Preservados integralmente |

> [!NOTE]
> A migration é **100% aditiva** — não remove nenhuma coluna, não altera tipos existentes, não deleta dados. O DEFAULT `MONTHLY_LIMIT` garante que todo registro existente continua funcionando identicamente.

### 10.4 Pacotes — Migration Separada

A criação das tabelas de pacotes (`service_packages`, `package_sales`, `package_usages`) deve ser feita em uma **migration separada e posterior**. Não misturar com a evolução do Clube.

---

## 11. Testes Obrigatórios

### 11.1 Backend — Clube Real

| # | Teste | Tipo |
|---|-------|------|
| 1 | Benefício UNLIMITED cobre serviço sem saldo numérico | Integração |
| 2 | Benefício MONTHLY_LIMIT respeita saldo (comportamento existente) | Integração |
| 3 | Benefício UNLIMITED não retorna `availableQty` numérico obrigatório | Integração |
| 4 | Balance API retorna `limitMode: "UNLIMITED"`, `isUnlimited: true`, `canUse: true` | Integração |
| 5 | Balance API retorna `limitMode: "MONTHLY_LIMIT"` com `availableQty` correto | Integração |
| 6 | Finalização de ilimitado cria `ClubBenefitUsage` com `status: APPLIED` | Integração |
| 7 | Finalização de ilimitado cria `ClubPointEntry` (se `pointWeight > 0`) | Integração |
| 8 | Ilimitado NÃO cria `CommissionEntry` tradicional | Integração |
| 9 | Limitado continua bloqueando quando saldo = 0 | Integração |
| 10 | Desconto continua funcionando normalmente | Integração |
| 11 | Cliente inadimplente não cobre (nem ilimitado) | Integração |
| 12 | Assinatura duplicada segue seleção determinística (existente) | Integração |
| 13 | Migration não altera comportamento de planos existentes | Integração |

### 11.2 Comanda

| # | Teste | Tipo |
|---|-------|------|
| 14 | Preview ilimitado mostra R$ 0,00 | Integração |
| 15 | Preview limitado mostra R$ 0,00 se saldo > 0 | Integração |
| 16 | Saldo esgotado cobra preço normal | Integração |
| 17 | Toggle funciona para ilimitado | Integração |
| 18 | Toggle funciona para limitado | Integração |
| 19 | Não cria `ClubBenefitUsage` antes da finalização | Integração |
| 20 | `recalculateComandaTotals` não decrementa `availableQty` para ilimitado | Unitário |

### 11.3 UI

| # | Teste | Tipo |
|---|-------|------|
| 21 | Cadastro de plano com benefício UNLIMITED | UI |
| 22 | Cadastro de plano com benefício MONTHLY_LIMIT | UI |
| 23 | Cadastro de desconto | UI |
| 24 | Agenda mostra "Coberto — Uso ilimitado" para UNLIMITED | UI |
| 25 | Agenda mostra "Coberto — X disponíveis" para MONTHLY_LIMIT | UI |
| 26 | Agenda mostra "-X% Clube" para desconto | UI |
| 27 | Comanda mostra "Usar pelo Clube — Ilimitado" | UI |
| 28 | Comanda mostra "Usar pelo Clube — X restantes" | UI |
| 29 | Checkbox nunca desabilitado para ilimitado | UI |
| 30 | Checkbox desabilitado quando esgotado para limitado | UI |

### 11.4 Pacotes (Planejar, NÃO Implementar Agora)

| # | Teste | Escopo |
|---|-------|--------|
| P1 | Criação de pacote e venda | Integração |
| P2 | Consumo de crédito na comanda | Integração |
| P3 | Bloqueio quando créditos esgotados | Integração |
| P4 | Bloqueio quando pacote expirado | Integração |
| P5 | Reversão de uso restaura crédito | Integração |
| P6 | Comissão na venda do pacote | Integração |
| P7 | Executor restrito (SELLER_ONLY, SPECIFIC_BARBER) | Integração |
| P8 | Pacote NÃO gera `ClubPointEntry` | Integração |
| P9 | Pacote NÃO entra em `ClubSettlement` | Integração |

---

## 12. Riscos

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|-------|--------------|---------|-----------|
| R1 | Migration quebrar planos existentes | 🟢 Baixa | 🔴 Alto | DEFAULT `MONTHLY_LIMIT` preserva comportamento. Backfill explícito. Backup pré-deploy. |
| R2 | Confusão entre clube e pacote no código | 🟡 Média | 🟡 Médio | Módulo de pacotes em namespace separado. Nenhuma tabela compartilhada. |
| R3 | Fechamento de rateio pagar errado com ilimitado | 🟢 Baixa | 🔴 Alto | Pontos são gerados por uso (não por saldo). Motor de rateio já independe de modo. |
| R4 | Benefício ilimitado gerar abuso | 🟡 Média | 🟡 Médio | `ClubBenefitUsage` registra todo uso. Relatório de uso por período disponível. O dono define o preço da mensalidade compatível. |
| R5 | Agenda pública expor dados do clube | 🟢 Baixa | 🟡 Médio | Dados de clube só retornam em rotas autenticadas `/api/admin/`. Rotas públicas não consultam clube. |
| R6 | Comanda abater sem validar assinatura | 🟢 Baixa | 🔴 Alto | `resolveClubBenefitForComandaItem` sempre revalida assinatura ativa. `closeComanda` revalida na finalização. |
| R7 | Comissão tradicional gerada indevidamente para INCLUDED_SERVICE | 🟢 Baixa | 🟡 Médio | `generateCommissionsForComanda` já verifica `isIncludedService` e skip. Teste existente cobre. |
| R8 | Frontend crashar com `null` em operações numéricas | 🟡 Média | 🟡 Médio | Campos `canUse`, `isUnlimited`, `label` eliminam necessidade de aritmética condicional no frontend. |

---

## 13. Sequência de Implementação em Fases

### Fase 1 — Clube Real (Ilimitado + Limitado)

**Estimativa**: 1-2 sessões de trabalho

| Passo | Escopo |
|-------|--------|
| 1.1 | Criar enum `ClubBenefitLimitMode` e adicionar campo `benefitLimitMode` no schema Prisma |
| 1.2 | Gerar migration segura com DEFAULT `MONTHLY_LIMIT` |
| 1.3 | Aktualizar `getClubBenefitsBalance` em `club.ts` — suportar `UNLIMITED` |
| 1.4 | Atualizar `resolveClubBenefitForComandaItem` — pular check de saldo para `UNLIMITED` |
| 1.5 | Atualizar `recalculateComandaTotals` em `comandas.ts` — suportar `isUnlimited` |
| 1.6 | Atualizar APIs de plans (POST, PATCH) — aceitar `benefitLimitMode` |
| 1.7 | Atualizar APIs de benefits (POST, PATCH) — aceitar `benefitLimitMode` |
| 1.8 | Atualizar Balance API — retornar `limitMode`, `isUnlimited`, `canUse`, `label` |
| 1.9 | Atualizar UI de cadastro de planos — toggle "Ilimitado" |
| 1.10 | Atualizar UI de agendamentos — labels dinâmicos |
| 1.11 | Atualizar UI de comanda — labels e checkbox dinâmicos |
| 1.12 | Atualizar UI de assinantes — label de saldo dinâmico |
| 1.13 | Adicionar/atualizar testes (integração + UI) |
| 1.14 | Gates: test:run, test:ui, prisma validate, typecheck, build |
| 1.15 | Deploy controlado com backup |

### Fase 2 — Pacotes (Módulo Separado)

**Estimativa**: 2-3 sessões de trabalho (após Fase 1 estabilizar)

| Passo | Escopo |
|-------|--------|
| 2.1 | Criar models Prisma para `ServicePackage`, `PackageSale`, `PackageUsage` |
| 2.2 | Gerar migration |
| 2.3 | Criar operações CRUD + consumo/reversão |
| 2.4 | Criar APIs REST para gerenciamento de pacotes |
| 2.5 | Integrar com comanda (toggle "Usar Pacote", preview, consumo na finalização) |
| 2.6 | Integrar com comissões (regra de venda + regra de execução) |
| 2.7 | Criar telas admin: listagem de pacotes, vendas, saldos |
| 2.8 | Testes completos |
| 2.9 | Deploy controlado |

---

## 14. Recomendação GO/NO-GO

### Fase 1 — Clube Real: ✅ **GO**

**Justificativa**:
- A alteração é **aditiva e retrocompatível** — nenhum dado existente é alterado
- O motor de fechamento/rateio **já está pronto** — não precisa de alteração
- A migration é simples (1 enum + 1 campo com DEFAULT)
- O impacto no código é **contido** — ~8 arquivos com alterações localizadas
- Os campos derivados (`isUnlimited`, `canUse`, `label`) simplificam drasticamente o frontend
- O risco principal (R1) é mitigado pelo DEFAULT + backup
- 30 testes cobrindo todos os cenários

### Fase 2 — Pacotes: ✅ **GO** (após Fase 1 estabilizar)

**Justificativa**:
- Módulo completamente independente — sem risco de interferir no Clube
- Pode reutilizar padrões do motor de comanda existente
- Necessidade real do negócio (venda de pacotes de créditos)
- Implementação incremental, sem dependência da Fase 1

> [!WARNING]
> **NÃO** implementar as duas fases simultaneamente. A Fase 1 deve ser validada em produção antes de iniciar a Fase 2, para garantir que o comportamento existente (limitado) não foi quebrado.
