# Match Barber — Especificação Funcional e Técnica Revisada v2.0

**Data de criação:** 2026-06-15
**Versão:** 2.0
**Status:** Aprovada para implementação
**Baseada em:** Auditoria do repositório + decisões do proprietário (2026-06-15)

---

## Sumário

- [A. Resumo Executivo](#a-resumo-executivo)
- [B. Escopo Funcional Final](#b-escopo-funcional-final)
- [C. O que será preservado](#c-o-que-será-preservado)
- [D. O que será corrigido](#d-o-que-será-corrigido)
- [E. O que será criado](#e-o-que-será-criado)
- [F. Regras de Negócio Consolidadas](#f-regras-de-negócio-consolidadas)
- [G. Modelo Conceitual de Dados](#g-modelo-conceitual-de-dados)
- [H. Fluxos Completos](#h-fluxos-completos)
- [I. Invariantes](#i-invariantes)
- [J. Roadmap por Fases](#j-roadmap-por-fases)
- [K. Decisões Pendentes](#k-decisões-pendentes)

---

## A. Resumo Executivo

### Estado atual (confirmado por auditoria em 2026-06-15)

O Match Barber é um SaaS funcional de agendamento online para barbearias com arquitetura multi-tenant, autenticação dual (cliente sem senha + admin com CPF/email+senha), agenda diária multiprofissional com colunas por barbeiro, link público de agendamento com validação real de disponibilidade, e gestão básica de equipe, serviços e configurações da barbearia.

Os seguintes módulos **não existem ou são insuficientes**: financeiro real, múltiplas formas de pagamento, comandas, comissões, Plano Clube, fidelidade, lembretes automáticos, lista de espera, relatórios gerenciais completos e histórico completo do cliente.

Existem riscos críticos: concorrência na criação de agendamentos (read-then-write sem lock), ausência de idempotência no endpoint público, zero cobertura de testes automatizados, e o modelo `Payment` atual vinculado 1:1 com `Appointment` (incompatível com múltiplos pagamentos).

### Estado desejado

Uma plataforma completa de gestão operacional e financeira para barbearias, com 11 módulos funcionais integrados e auditáveis: agenda, link público, lembretes, comandas, financeiro, comissões, fidelidade, lista de espera, relatórios, histórico do cliente e Plano Clube com rateio proporcional entre barbeiros por pontos de serviço.

### Gap e caminho

O sistema atual é um front de agendamento. O estado desejado é um sistema de gestão operacional e financeira completo. A distância é coberta por 9 fases (Fase 0 a Fase 8), sendo a Fase 0 obrigatória e bloqueante antes de qualquer evolução estrutural.

---

## B. Escopo Funcional Final

| # | Módulo | Responsabilidade principal |
|---|---|---|
| 1 | **Agenda multiprofissional** | Reservas de tempo por profissional, visualização diária, gestão de status, reagendamento |
| 2 | **Link público de agendamento** | Agendamento self-service pelo cliente, consulta de disponibilidade, criação de conta |
| 3 | **Lembretes automáticos** | Notificações via WhatsApp/e-mail/push, confirmação, cancelamento de lembrete |
| 4 | **Comandas** | Consumo de serviços e produtos, base para cobrança, comissão e fidelidade |
| 5 | **Financeiro** | Pagamentos, caixa, receitas, despesas, estornos, formas de pagamento múltiplas |
| 6 | **Comissões** | Configuração hierárquica, geração, liberação proporcional, fechamento, estorno |
| 7 | **Histórico do cliente** | Timeline unificada de todos os eventos relacionados ao cliente |
| 8 | **Fidelidade** | Pontos por atendimento pago, resgates, expiração configurável |
| 9 | **Lista de espera** | Solicitação de vaga, notificação, reserva temporária, conversão em agendamento |
| 10 | **Relatórios gerenciais** | Agenda, financeiro, comissões, clube, clientes — exportação CSV e PDF futuro |
| 11 | **Plano Clube** | Assinatura do cliente, serviços incluídos, mensalidades, rateio por pontos, fechamento mensal |

---

## C. O que será preservado

As seguintes funcionalidades estão confirmadas no código e serão **evoluídas sem reimplementação**:

| Funcionalidade | Localização confirmada | Evolução necessária |
|---|---|---|
| Arquitetura SaaS multi-tenant | `barbershopId` em todas as entidades | Auditoria dos guards, novos testes |
| NextAuth JWT dual | `src/lib/auth.ts` | Adicionar role RECEPTIONIST |
| Perfis OWNER, MANAGER, BARBER, USER | Enums `UserRole` + `MemberRole` | Adicionar RECEPTIONIST |
| Agenda diária com colunas por barbeiro | `admin/agendamentos/page.tsx` | Vista semanal/mensal futura, histórico de status |
| CRUD de agendamentos (admin) | `api/admin/appointments/*` | Conflito-check transacional, log de status |
| Link público de agendamento | `api/public/barbershop/[slug]/book` | Idempotência, rate limit |
| Consulta de disponibilidade | `api/public/barbershop/[slug]/availability` | Reserva temporária para lista de espera |
| CRUD de serviços e categorias | `api/admin/services`, `api/admin/categories` | Flag de clube, peso por plano |
| CRUD de equipe | `api/admin/team/*` | Role RECEPTIONIST, permissões granulares |
| Jornada de trabalho | `WorkingHour` + `api/admin/working-hours` | Múltiplos turnos no mesmo dia (fase futura) |
| Bloqueios e folgas | `TimeOff` + `api/admin/team/[id]/time-off` | Manter sem alteração |
| Área do cliente (`/minha-conta`) | `api/client/appointments` | Evoluir para timeline completa |
| Área do barbeiro (`/member/agenda`) | `api/member/agenda` | Evoluir com comissões e financeiro |
| Configurações da barbearia | `api/admin/barbershop` | Adicionar configurações financeiras e de clube |
| SaasPlan + TenantSaasSubscription | `Plan` + `TenantSubscription` no schema | Renomear conceitualmente; dados mantidos |
| Upload de arquivos | `api/admin/upload` | Migrar para armazenamento externo (Fase 8) |

> **Nota:** As entidades existentes `Plan` e `TenantSubscription` representam o plano comercial do SaaS (plataforma Match Barber), não o Plano Clube vendido ao cliente da barbearia. Neste documento, são referenciadas como `SaasPlan` e `TenantSaasSubscription` para eliminar ambiguidade conceitual. Renomeação física no banco é decisão a ser tomada oportunamente.

---

## D. O que será corrigido

### D.1 Concorrência da agenda (P0 — Crítico)

**Problema:** A criação de agendamento faz read-then-write sem lock. Dois clientes podem reservar o mesmo profissional no mesmo período simultaneamente.

**Solução:**
- Usar `prisma.$transaction` com `isolationLevel: "Serializable"` ou `RepeatableRead` em todas as operações de reserva.
- Alternativamente, `SELECT ... FOR UPDATE` via query raw no PostgreSQL para lockear o período do profissional.
- Não usar unique constraint simples em `(memberId, dateTime)` — ela não previne sobreposição de intervalos com durações diferentes.
- A verificação obrigatória: nenhum `Appointment` ativo (`PENDING`/`CONFIRMED`) pode ter intervalo `[dateTime, dateTime + durationMin)` sobreposto ao novo intervalo do mesmo `memberId`. Essa verificação deve ocorrer **dentro** da transação, não antes.

### D.2 Idempotência no agendamento público (P1)

**Problema:** Duplo-clique ou retry de rede cria dois agendamentos idênticos.

**Solução:**
- O endpoint `POST /api/public/barbershop/[slug]/book` aceitará `idempotencyKey` (UUID v4, gerado pelo cliente frontend).
- Backend armazena `(idempotencyKey, barbershopId)` na tabela `IdempotencyKey` com TTL de 24h.
- Chave já existente com operação bem-sucedida: retorna resultado anterior com HTTP 200.
- Chave já existente com operação falha: permite nova tentativa.

### D.3 Transação atômica incompleta (P1)

**Problema:** O endpoint `/book` cria `Appointment` e `AppointmentService[]` sem `$transaction` explícita.

**Solução:** Toda criação de agendamento envolverá `prisma.$transaction()` cobrindo:
1. Lock de disponibilidade
2. Criação do `Appointment`
3. Criação dos `AppointmentService[]`
4. Criação do `AppointmentStatusLog` inicial
5. Criação dos `ReminderJob[]` programados
6. Registro na `IdempotencyKey`

### D.4 Ausência de histórico de status (P1)

**Problema:** Mudanças de status sobrescrevem o valor anterior sem rastreio.

**Solução:** Criar `AppointmentStatusLog` (descrito na seção G).

### D.5 `Payment` atual com vínculo 1:1 exclusivo (P1)

**Problema:** `Payment.appointmentId @unique` impede múltiplas formas de pagamento e o modelo de rateio do Clube.

**Solução:** Criar novo modelo `Payment` (seção G) vinculado à `Comanda` ou à `ClubInvoice` — nunca aos dois ao mesmo tempo. A entidade atual será mantida até que a Fase 2 (financeiro) seja concluída, quando será descontinuada com migração de dados.

### D.6 Upload em filesystem local (P1)

**Problema:** Arquivos salvos em `/public/uploads` são perdidos em redeploys stateless.

**Solução:** Migrar para armazenamento externo (Fase 8). A API de upload terá implementação substituída por adapter configurável sem alterar a interface dos clientes.

### D.7 Ausência de rate limiting (P2)

**Solução:** Rate limiting por IP e por `customerPhone` nas rotas públicas usando Redis (já disponível no `docker-compose.yml`). Implementado na Fase 0.

### D.8 Falta de índice em `Appointment.customerId` (P2)

**Solução:** Adicionar `@@index([customerId])` na entidade `Appointment`. Implementado na Fase 0.

### D.9 Conflito-check ausente no endpoint admin-create (P1)

**Problema:** `POST /api/admin/appointments` não verifica sobreposição de horários.

**Solução:** Mesmo mecanismo de conflito-check transacional do endpoint público aplicado ao admin.

### D.10 `Notification.type` como string livre (P3)

**Solução:** Converter para enum `NotificationType`. Implementado na Fase 0.

### D.11 Ausência de testes (P0)

**Solução:** Criar suíte mínima cobrindo os fluxos descritos na seção H antes de qualquer mudança estrutural. Implementado na Fase 0.

---

## E. O que será criado

| Entidade / Módulo | Fase | Depende de |
|---|---|---|
| Testes automatizados | 0 | — |
| `AppointmentStatusLog` | 0 | — |
| `AuditLog` | 0 | — |
| `IdempotencyKey` | 0 | — |
| Índices e constraints de concorrência | 0 | — |
| Role `RECEPTIONIST` | 0 | — |
| `Comanda` + `ComandaItem` | 1 | Fase 0 |
| `Product` + `StockMovement` | 1 | Fase 0 |
| `Payment` (novo modelo) | 2 | Fase 1 |
| `PaymentAllocation` | 2 | Fase 2 |
| `CashSession` | 2 | Fase 2 |
| `FinancialEntry` | 2 | Fase 2 |
| `CommissionConfig` | 3 | Fase 2 |
| `CommissionEntry` | 3 | Fase 3 |
| `CommissionPeriod` | 3 | Fase 3 |
| `LoyaltyConfig` + `LoyaltyEntry` | 4 | Fase 3 |
| Timeline do cliente (view/aggregation) | 4 | Fases 1–3 |
| `ReminderJob` | 5 | Fase 0 |
| `WaitlistEntry` | 5 | Fase 0 |
| `ClubPlan` + `ClubPlanService` | 6 | Fases 2–3 |
| `ClubSubscription` + `ClubInvoice` | 6 | Fase 6 |
| `ClubUsage` + `ClubSettlement` | 6 | Fase 6 |
| `ClubSettlementBarber` + `ClubAdjustment` | 6 | Fase 6 |
| Relatórios completos | 7 | Fases 1–6 |
| Armazenamento externo, CI/CD, observabilidade | 8 | — |

---

## F. Regras de Negócio Consolidadas

### F.1 Agenda

- O agendamento representa exclusivamente **reserva de tempo** de um profissional para um cliente.
- Cada agendamento tem um único profissional (`memberId`), um único cliente (`customerId`) e um ou mais serviços (`AppointmentService[]`).
- O intervalo `[dateTime, dateTime + durationMin)` não pode se sobrepor a outro agendamento ativo (`PENDING`/`CONFIRMED`) do mesmo `memberId`.
- Status válidos: `PENDING`, `CONFIRMED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `NO_SHOW`.
- Toda mudança de status gera um `AppointmentStatusLog` imutável.
- Agendamentos `COMPLETED`, `CANCELLED` e `NO_SHOW` não podem ser editados. Somente podem receber ajuste auditado.
- O admin pode criar agendamentos retroativos; o link público não.

### F.2 Comandas

- A comanda representa **consumo, cobrança e efeitos financeiros**.
- Um agendamento pode gerar no máximo uma `Comanda` principal (`appointmentId` opcional em `Comanda`).
- A comanda pode existir sem agendamento (cliente de passagem).
- Itens da comanda: tipo `SERVICE`, `PRODUCT`, `ADDON`, `DISCOUNT`, `SURCHARGE`.
- Cada item de serviço tem: `serviceId`, `priceApplied` (snapshot), `durationMin`, `memberId` (executor) e `status` (`PENDING`, `DONE`, `CANCELLED`).
- Status da comanda: `OPEN`, `IN_SERVICE`, `PENDING_PAYMENT`, `CLOSED`, `CANCELLED`.
- Somente comandas `CLOSED` geram efeitos financeiros, comissões e pontos.
- Uma vez `CLOSED`, a comanda é imutável. Correções via `ComandaAdjustment` auditado.
- O profissional de um item pode ser alterado antes do fechamento.
- Após o fechamento, alteração do profissional exige `ComandaAdjustment` com `AuditLog`.

### F.3 Pagamentos

- Pagamentos são vinculados à `Comanda` **ou** à `ClubInvoice` — nunca aos dois simultaneamente.
- Uma comanda pode ter múltiplos `Payment[]`.
- O somatório dos pagamentos válidos deve ser `≤ totalComanda`. A comanda só fecha quando `≥ totalComanda`.
- Métodos padronizados por enum `PaymentMethod`: `CASH`, `PIX`, `DEBIT`, `CREDIT`, `WALLET`, `ONLINE`, `COURTESY`, `BARTER`, `OTHER`.
- `COURTESY`: tem `referenceValue` (valor de tabela), não gera `FinancialEntry` de receita, não gera comissão por padrão (configurável).
- `BARTER`: tem `referenceValue` e `description`, não gera `FinancialEntry` de receita em dinheiro, regra de comissão configurável.
- Estornos geram novo registro `Payment` com `type: REFUND` referenciando o pagamento original. O pagamento original não é deletado.
- Pagamentos on-line têm `gatewayTxId` e `gatewayProvider`.
- Todos os valores monetários usam `Decimal(12,2)` — **nunca `Float`**.

### F.4 Caixa

- `CashSession` representa abertura e fechamento do caixa físico.
- Apenas uma `CashSession` com `status = OPEN` por `barbershopId` por vez.
- Cada `FinancialEntry` pode referenciar a `CashSession` em que ocorreu.
- Abertura registra: operador, valor inicial, data/hora.
- Fechamento registra: operador, valor contado, valor esperado, diferença, data/hora.

### F.5 Comissões

**Hierarquia de regras (prioridade decrescente):**
1. `CommissionConfig` específico do profissional + serviço
2. `CommissionConfig` específico do profissional + categoria
3. `CommissionConfig` geral do serviço
4. `CommissionConfig` geral da categoria
5. `CommissionConfig` padrão da barbearia

**Tipos:** `PERCENTAGE` (sobre valor final do item) ou `FIXED_VALUE`.

**Base de cálculo:** valor final cobrado no item após descontos. Taxa de cartão não reduz a base automaticamente na v1.

**Ciclo da comissão:**
1. Item de serviço concluído (`ComandaItem.status = DONE`) → cria `CommissionEntry` com `status = GENERATED`.
2. Pagamento parcial recebido → `CommissionEntry.releasedAmount` aumenta proporcionalmente ao percentual pago da comanda. Status muda para `PARTIALLY_RELEASED`.
3. Pagamento integral → `releasedAmount = generatedAmount`. Status muda para `RELEASED`.
4. Fechamento do `CommissionPeriod` → comissão liberada pode participar. Status muda para `PAID`.
5. Comissão ainda não liberada (`GENERATED` ou `PARTIALLY_RELEASED`) não pode ser paga.
6. Estorno do pagamento → reduz ou reverte `releasedAmount` por registros auditados. Status regride proporcionalmente.

**Regras complementares:**
- Item `CANCELLED` ou estornado reverte a `CommissionEntry` — nova entrada com `status = REVERSED`.
- Serviço do Plano Clube incluído **não** gera `CommissionEntry`. **Invariante #1.**
- Cortesia não gera comissão por padrão. Configurável via `CommissionConfig.allowCourtesy`.
- Permuta: regra de comissão configurável separada (`CommissionConfig.barterCommissionType`).
- Gorjeta: registrada em `TipEntry`, vinculada ao profissional, não compõe o faturamento de serviços, não gera nova comissão, repassada integralmente ao profissional.
- Um item tem um único profissional principal. Para dois profissionais em serviços diferentes, dois itens separados com seus respectivos profissionais.

### F.6 Plano Clube

#### Distinção conceitual obrigatória

- **`SaasPlan` / `TenantSaasSubscription`:** plano comercial do Match Barber (plataforma). Entidades físicas atuais: `Plan` e `TenantSubscription`.
- **`ClubPlan` / `ClubSubscription`:** plano da barbearia vendido ao cliente. Entidades novas.

#### Configurações do ClubPlan

- Nome, descrição, preço mensal, status (`ACTIVE`, `DISCONTINUED`, `ARCHIVED`).
- `maxFutureAppointments`: limite de agendamentos futuros simultâneos.
- `minIntervalBetweenUsagesHours`: intervalo mínimo entre utilizações.
- `minCancellationHours`: prazo mínimo para cancelamento sem penalidade.
- `noshowPenaltyAmount`: valor da penalidade por falta.
- `gracePeriodDays`: dias de tolerância por inadimplência.
- `gracePeriodAllowNew`: se durante a tolerância são permitidos novos agendamentos.
- `barbershopSharePct`: percentual da receita destinado à barbearia.

#### Status da ClubSubscription

`PENDING` → `ACTIVE` → `GRACE_PERIOD` → `SUSPENDED` | `DEFAULTED` → `CANCELLED` | `ENDED`

#### Inadimplência

Após `gracePeriodDays` sem pagamento, status muda para `DEFAULTED`:
- Novos agendamentos do clube são bloqueados.
- Serviços incluídos não são liberados.
- Serviços comuns (fora do clube) continuam disponíveis normalmente.

#### Serviços incluídos (ClubPlanService)

- Referencia `ClubPlan` + `Service`.
- `isIncluded`: boolean.
- `weight`: Decimal — peso para rateio.
- `memberDiscountPct`: desconto quando não totalmente incluído.
- O mesmo serviço pode ter pesos diferentes em planos diferentes.
- `ClubPlanService` pode ser alterado para atendimentos futuros. Usos anteriores têm snapshot próprio.

#### Snapshot no uso (ClubUsage)

Estados: `PENDING`, `VALID`, `REVERSED`.

- Serviço incluído concluído cria `ClubUsage` em `PENDING`.
- Confirmação final do atendimento/fechamento da comanda muda para `VALID`.
- Somente usos `VALID` entram no rateio.
- Cancelamento ou estorno muda para `REVERSED`.
- Registros históricos nunca são apagados.
- Campos do snapshot: `planId`, `serviceId`, `weightSnapshot` (imutável), `memberId`, `concludedAt`, `usageCompetence` (YYYY-MM), `ruleSnapshot` (JSON).
- Mudanças futuras em `ClubPlanService.weight` **não** modificam `ClubUsage.weightSnapshot` existentes.

### F.7 Receita e Rateio do Plano Clube

#### Competências distintas

| Campo | Definição |
|---|---|
| `subscriptionCompetence` | Mês de referência da assinatura (YYYY-MM) |
| `dueDate` | Data de vencimento da mensalidade |
| `paidAt` | Data de compensação efetiva do pagamento |
| `financialCompetence` | YYYY-MM derivado de `paidAt` |
| `usageCompetence` | YYYY-MM derivado de `concludedAt` do atendimento |

Mensalidade paga em atraso entra na competência financeira da data de compensação (`paidAt`), não na competência de vencimento.

#### Fórmulas do ClubSettlement

```
receitaBruta =
  Σ ClubInvoice.amount
  onde:
    status = PAID
    barbershopId = tenant atual
    clubPlanId = plano do fechamento
    financialCompetence = competência X

ajusteReceitaLiquido =
  ajustesReceitaPositivos
  − chargebacks
  − devoluções
  − ajustesReceitaNegativos

receitaLiquida =
  receitaBruta
  + ajusteReceitaLiquido

parteBarbearia =
  receitaLiquida
  × percentualBarbeariaSnapshot

fundoBarbeiros =
  receitaLiquida
  − parteBarbearia

ajusteRateioLiquido =
  ajustesRateioPositivos
  − ajustesRateioNegativos

fundoDisponivel =
  fundoBarbeiros
  + saldoAcumuladoAnterior
  + ajusteRateioLiquido

pontosBarbeiro =
  Σ ClubUsage.weightSnapshot
  filtrado por:
    barbershopId
    clubPlanId
    memberId
    usageCompetence = competência X
    status = VALID

pontosTotais =
  Σ pontosBarbeiro (todos os membros do período)

participacaoBarbeiro =
  pontosBarbeiro ÷ pontosTotais

rateioBruto =
  fundoDisponivel × participacaoBarbeiro
```

**Se `pontosTotais = 0`:**
```
rateioBarbeiros = 0
saldoAcumuladoProximo = fundoDisponivel
```

**Se `fundoDisponivel < 0` (ajustes negativos excederam o fundo):**
```
rateioBarbeiros = 0
saldoNegativoProximo = fundoDisponivel
```

Nenhum barbeiro recebe valor negativo.

O fechamento é identificado por: `(barbershopId, clubPlanId, competence)` — unique.

#### Arredondamento (Largest Remainder Method)

Os cálculos usam alta precisão internamente. Os valores pagos são arredondados para centavos. Diferenças distribuídas pelo método dos maiores restos decimais. Garantia: `Σ finalAmount = fundoDisponivel − accumulatedForward`.

#### Fundo acumulado

Se `pontosTotais = 0`, o `fundoBarbeiros` do período é transportado para `saldoAcumuladoAnterior` do próximo `ClubSettlement`. Se o Plano Clube for encerrado definitivamente, a forma de encerramento do saldo acumulado é **decisão pendente**.

#### `ClubSettlement` aprovado é imutável

Correções via `ClubAdjustment` na próxima competência, com `AuditLog` obrigatório.

### F.8 Serviços — Regras do Clube

| Tipo | Gera pontos de rateio | Gera comissão normal | Gera pontos de fidelidade | Cobrança |
|---|---|---|---|---|
| Serviço incluído no Clube | ✅ (via ClubUsage) | ❌ **Invariante #1** | ❌ | R$ 0,00 |
| Serviço adicional (não incluído) | ❌ | ✅ | ✅ (sobre valor pago) | Preço normal ou com desconto de assinante |
| Produto | ❌ | ✅ (comissão de produto) | ✅ (sobre valor pago) | Preço normal ou com desconto |

### F.9 Barbeiro desligado

- Desligamento não elimina direitos já gerados.
- Barbeiro desligado recebe: pontos válidos acumulados até a data de desligamento, rateio correspondente no fechamento da competência, comissões já geradas e liberadas.
- Após o desligamento, não recebe novos atendimentos ou pontos.

### F.10 Transferência de atendimento

- Antes da conclusão da comanda: profissional do item pode ser alterado. Pontos pertencerão ao profissional que efetivamente concluir o serviço.
- Após o fechamento da comanda: mudança somente via `ComandaAdjustment` auditado. Nunca edição silenciosa do profissional histórico.

### F.11 Fidelidade

- Independente do Plano Clube.
- Pontos gerados sobre valor efetivamente pago após descontos.
- Serviço totalmente coberto pelo Clube: não gera pontos de fidelidade.
- Serviço adicional pago, produto pago: podem gerar pontos.
- `LoyaltyConfig` por barbearia: taxa de conversão (`pointsPerReal`), `expirationDays`, status.
- Estorno do pagamento reverte os pontos correspondentes.
- Ajustes manuais exigem permissão explícita e criam `AuditLog`.

### F.12 Lista de espera

- `WaitlistEntry` com: `customerId`, `serviceId`, `preferredMemberId?`, `requestedDate?`, faixa de horário, `priority`, `status`, `expiresAt`.
- Status: `WAITING`, `NOTIFIED`, `RESERVED`, `CONVERTED`, `EXPIRED`, `CANCELLED`.
- Quando surge uma vaga, sistema localiza entradas compatíveis e notifica em ordem de prioridade.
- Reserva temporária com TTL configurável (padrão: 15 min) via Redis.
- Conversão em `Appointment` usa mesma transação serializada do fluxo de agendamento.
- A criação da reserva é protegida contra concorrência.

### F.13 Lembretes automáticos

- Canais: `WHATSAPP`, `EMAIL`, `PUSH`, `SMS`.
- Implementação por adapter substituível (`NotificationAdapter`). Troca de provedor sem reescrita de regras.
- `ReminderJob` registra: `appointmentId`, canal, `scheduledAt`, `status`, `attempts`, `lastAttemptAt`, `failureReason?`.
- Reagendamento ou cancelamento cancela `ReminderJob` anteriores e cria novos.
- Canal principal e provedor: **decisão pendente** (seção K).

### F.14 Perfis e permissões

| Perfil | Acesso |
|---|---|
| `SUPER_ADMIN` | Acesso total à plataforma Match Barber |
| `OWNER` | Acesso total à barbearia |
| `MANAGER` | Acesso operacional e financeiro básico |
| `RECEPTIONIST` | Agenda, clientes, comandas, pagamentos, lista de espera — sem acesso a fechamentos, rateio, comissões da equipe, configurações financeiras sensíveis |
| `BARBER` | Própria agenda, próprio perfil, próprias comissões |
| `USER` | Área do cliente (minha conta, agendamentos, fidelidade) |

### F.15 Escopo da primeira versão — Limitações

- **Uma barbearia por tenant.** Sem filiais ou múltiplas unidades. Arquitetura não deve impedir expansão futura.
- **Plano Clube individual e intransferível.** Um cliente, uma assinatura ativa por barbearia. Sem dependentes. Sem plano familiar.
- **Um profissional por item de comanda.** Sem divisão de um único item entre dois profissionais nesta fase.

---

## G. Modelo Conceitual de Dados

> Esta seção é conceitual. Nenhuma migration foi gerada. A implementação seguirá a ordem das fases.

### G.1 Entidades da Fase 0

#### `AppointmentStatusLog`
Histórico imutável de mudanças de status de agendamentos.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `appointmentId` | UUID FK → Appointment | |
| `barbershopId` | UUID | Isolamento de tenant |
| `previousStatus` | Enum AppointmentStatus | Nullable para criação |
| `newStatus` | Enum AppointmentStatus | |
| `changedAt` | DateTime UTC | |
| `changedById` | UUID FK → User nullable | Null = sistema/automático |
| `origin` | Enum: ADMIN, CLIENT, SYSTEM, MEMBER | |
| `reason` | String nullable | |
| `notes` | String nullable | |

**Constraints:** Imutável após inserção — sem UPDATE, sem DELETE.
**Índices:** `(appointmentId)`, `(barbershopId, changedAt)`.

---

#### `AuditLog`
Registro de operações sensíveis para rastreabilidade.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `performedById` | UUID FK → User | |
| `action` | String | Ex: `CLOSE_SETTLEMENT`, `MANUAL_POINT_ADJUST` |
| `entityType` | String | Ex: `ClubSettlement`, `CommissionPeriod` |
| `entityId` | UUID | ID da entidade afetada |
| `payload` | JSON | Snapshot antes e depois |
| `ip` | String nullable | IP da requisição |
| `createdAt` | DateTime | Imutável |

**Constraints:** Sem UPDATE, sem DELETE, sem soft delete.
**Índices:** `(barbershopId, entityType, entityId)`, `(barbershopId, createdAt)`.

---

#### `IdempotencyKey`
Prevenção de criação duplicada de agendamentos.

| Campo | Tipo | Notas |
|---|---|---|
| `key` | String | UUID v4 enviado pelo cliente |
| `barbershopId` | UUID | Isolamento |
| `result` | JSON | Resposta armazenada |
| `createdAt` | DateTime | Para TTL de 24h |

**Constraints:** `UNIQUE(key, barbershopId)`.

---

### G.2 Entidades da Fase 1

#### `Comanda`
Representa um atendimento com consumo, base para cobrança e comissão.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `appointmentId` | UUID FK → Appointment nullable | Null = cliente de passagem |
| `customerId` | UUID FK → User | |
| `openedById` | UUID FK → User | Quem abriu |
| `closedById` | UUID FK → User nullable | |
| `status` | Enum: OPEN, IN_SERVICE, PENDING_PAYMENT, CLOSED, CANCELLED | |
| `subtotal` | Decimal(12,2) | Soma itens sem descontos |
| `discountTotal` | Decimal(12,2) | |
| `total` | Decimal(12,2) | Valor final |
| `paidTotal` | Decimal(12,2) | Pago até o momento |
| `notes` | String nullable | |
| `openedAt` | DateTime | |
| `closedAt` | DateTime nullable | Imutável após preenchimento |
| `createdAt` / `updatedAt` | DateTime | |

**Constraints:** `appointmentId` único quando não nulo. Status `CLOSED` torna a comanda imutável.
**Índices:** `(barbershopId, customerId)`, `(barbershopId, status)`, `(appointmentId)`.

---

#### `ComandaItem`
Item individual da comanda.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `comandaId` | UUID FK → Comanda | |
| `barbershopId` | UUID | Isolamento |
| `type` | Enum: SERVICE, PRODUCT, ADDON, DISCOUNT, SURCHARGE | |
| `serviceId` | UUID FK → Service nullable | |
| `productId` | UUID FK → Product nullable | |
| `memberId` | UUID FK → BarbershopMember nullable | Profissional executor |
| `description` | String | Nome snapshot do serviço/produto |
| `quantity` | Decimal(8,3) | Padrão 1 |
| `unitPrice` | Decimal(12,2) | Preço snapshot |
| `discountPct` | Decimal(5,2) | |
| `discountAmount` | Decimal(12,2) | |
| `total` | Decimal(12,2) | `(unitPrice × quantity) − discount` |
| `status` | Enum: PENDING, DONE, CANCELLED | |
| `isClubIncluded` | Boolean | Coberto pelo Plano Clube |
| `clubSubscriptionId` | UUID FK → ClubSubscription nullable | |
| `clubUsageId` | UUID FK → ClubUsage nullable | Criado na conclusão |
| `cancelledAt` | DateTime nullable | |
| `cancelledById` | UUID nullable | |

**Constraints:** `total ≥ 0`. Item `CANCELLED` não gera comissão nem pontos.
**Índices:** `(comandaId)`, `(barbershopId, memberId)`.

---

#### `Product`
Produto vendável.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `name` | String | |
| `description` | String nullable | |
| `price` | Decimal(12,2) | Preço de venda |
| `costPrice` | Decimal(12,2) nullable | Custo (opcional) |
| `unit` | String | Ex: UN, ML, G |
| `isActive` | Boolean | |
| `trackStock` | Boolean | Se controla estoque |
| `currentStock` | Decimal(10,3) | Estoque atual |

**Índices:** `(barbershopId, name)`.

---

#### `StockMovement`
Entrada e saída de estoque.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `productId` | UUID FK → Product | |
| `type` | Enum: IN, OUT, ADJUSTMENT | |
| `quantity` | Decimal(10,3) | |
| `reason` | String nullable | |
| `comandaItemId` | UUID FK → ComandaItem nullable | Para saídas por venda |
| `performedById` | UUID FK → User | |
| `createdAt` | DateTime | Imutável |

---

### G.3 Entidades da Fase 2

#### `Payment` (novo modelo)
Pagamento de comanda **ou** de mensalidade do Plano Clube.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `type` | Enum: PAYMENT, REFUND | |
| `method` | Enum PaymentMethod: CASH, PIX, DEBIT, CREDIT, WALLET, ONLINE, COURTESY, BARTER, OTHER | |
| `amount` | Decimal(12,2) | Sempre positivo; `type` define o sentido |
| `status` | Enum: PENDING, PAID, FAILED, CANCELLED | |
| `comandaId` | UUID FK → Comanda nullable | Origem: comanda |
| `clubInvoiceId` | UUID FK → ClubInvoice nullable | Origem: mensalidade |
| `gatewayTxId` | String nullable | |
| `gatewayProvider` | String nullable | |
| `referenceValue` | Decimal(12,2) nullable | Para COURTESY e BARTER |
| `referencePaymentId` | UUID FK → Payment nullable | Para REFUND |
| `receivedById` | UUID FK → User nullable | Quem recebeu |
| `cashSessionId` | UUID FK → CashSession nullable | |
| `paidAt` | DateTime nullable | |
| `notes` | String nullable | |
| `createdAt` / `updatedAt` | DateTime | |

**Constraints:**
- `amount > 0`.
- `referencePaymentId` obrigatório quando `type = REFUND`.
- **Constraint de origem exclusiva:** `(comandaId IS NULL) != (clubInvoiceId IS NULL)` — exatamente um deve estar preenchido.
- Pagamentos não são deletados; usar REFUND.

**Índices:** `(comandaId)`, `(clubInvoiceId)`, `(barbershopId, status, paidAt)`.

---

#### `PaymentAllocation`
Distribuição do pagamento entre itens da comanda (para cálculo proporcional de comissão).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `paymentId` | UUID FK → Payment | |
| `comandaItemId` | UUID FK → ComandaItem | |
| `amount` | Decimal(12,2) | |

**Constraints:** `Σ amount por paymentId = Payment.amount`.

---

#### `CashSession`
Sessão de caixa.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `openedById` | UUID FK → User | |
| `closedById` | UUID FK → User nullable | |
| `openingBalance` | Decimal(12,2) | Valor inicial |
| `closingBalance` | Decimal(12,2) nullable | Valor contado |
| `expectedBalance` | Decimal(12,2) nullable | Calculado no fechamento |
| `difference` | Decimal(12,2) nullable | |
| `status` | Enum: OPEN, CLOSED | |
| `openedAt` | DateTime | |
| `closedAt` | DateTime nullable | |

**Constraints:** Apenas uma `CashSession` com `status = OPEN` por `barbershopId` por vez.

---

#### `FinancialEntry`
Lançamento contábil.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `type` | Enum: INCOME, EXPENSE | |
| `category` | String | Categoria (enum futuro) |
| `amount` | Decimal(12,2) | |
| `description` | String | |
| `competence` | String | YYYY-MM |
| `paymentId` | UUID FK → Payment nullable | Para receitas de comandas |
| `cashSessionId` | UUID FK → CashSession nullable | |
| `performedById` | UUID FK → User | |
| `createdAt` | DateTime | Imutável |

---

### G.4 Entidades da Fase 3

#### `CommissionConfig`
Regra de comissão com hierarquia de prioridade.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `memberId` | UUID FK nullable | Null = regra geral |
| `serviceId` | UUID FK nullable | |
| `categoryId` | UUID FK nullable | |
| `type` | Enum: PERCENTAGE, FIXED_VALUE | |
| `value` | Decimal(8,4) | Percentual (0–100) ou valor fixo |
| `allowCourtesy` | Boolean | Padrão false |
| `barterCommissionType` | Enum nullable | Tipo para BARTER |
| `isActive` | Boolean | |

---

#### `CommissionEntry`
Comissão gerada por item de comanda.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `memberId` | UUID FK → BarbershopMember | |
| `comandaItemId` | UUID FK → ComandaItem | |
| `commissionConfigId` | UUID FK → CommissionConfig | Snapshot da regra |
| `ruleSnapshot` | JSON | Snapshot completo da regra |
| `baseAmount` | Decimal(12,2) | Base de cálculo |
| `generatedAmount` | Decimal(12,2) | Comissão total gerada |
| `releasedAmount` | Decimal(12,2) | Valor liberado |
| `paidAmount` | Decimal(12,2) | Valor pago |
| `status` | Enum: GENERATED, PARTIALLY_RELEASED, RELEASED, PAID, REVERSED | |
| `periodId` | UUID FK → CommissionPeriod nullable | |
| `competence` | String | YYYY-MM |
| `createdAt` | DateTime | |

**Constraints:** Imutável após `status = PAID`. Estorno cria nova entrada `REVERSED`.

---

#### `CommissionPeriod`
Fechamento de comissões por período.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `memberId` | UUID FK → BarbershopMember | |
| `competence` | String | YYYY-MM |
| `totalGenerated` | Decimal(12,2) | |
| `totalReleased` | Decimal(12,2) | |
| `totalPaid` | Decimal(12,2) | |
| `status` | Enum: OPEN, CLOSED, PAID | |
| `closedAt` | DateTime nullable | Imutável após preenchimento |
| `closedById` | UUID FK nullable | |

**Constraints:** `UNIQUE(barbershopId, memberId, competence)`. Uma vez `CLOSED`, não pode ser recalculado.

---

#### `TipEntry`
Gorjeta vinculada ao profissional.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `memberId` | UUID FK → BarbershopMember | |
| `comandaId` | UUID FK → Comanda | |
| `amount` | Decimal(12,2) | |
| `paymentId` | UUID FK → Payment nullable | |
| `createdAt` | DateTime | |

---

### G.5 Entidades da Fase 4

#### `LoyaltyConfig`
Configuração do programa de fidelidade por barbearia.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Único por barbearia |
| `pointsPerReal` | Decimal(8,4) | Pontos por R$ 1,00 pago |
| `expirationDays` | Int nullable | Null = não expira |
| `isActive` | Boolean | |

**Constraints:** `UNIQUE(barbershopId)`.

---

#### `LoyaltyEntry`
Extrato de pontos de fidelidade.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `customerId` | UUID FK → User | |
| `type` | Enum: EARN, REDEEM, EXPIRE, ADJUST, REVERSE | |
| `points` | Decimal(10,2) | Positivo = crédito, negativo = débito |
| `referenceId` | UUID nullable | FK para comanda, pagamento ou ajuste |
| `expiresAt` | DateTime nullable | |
| `createdAt` | DateTime | Imutável |
| `performedById` | UUID nullable | Obrigatório para ADJUST |

**Constraints:** `ADJUST` requer `AuditLog` e `performedById`. Imutável após inserção.

---

### G.6 Entidades da Fase 5

#### `WaitlistEntry`
Solicitação de vaga na agenda.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `customerId` | UUID FK → User | |
| `serviceId` | UUID FK → Service | |
| `preferredMemberId` | UUID FK nullable | Null = qualquer disponível |
| `requestedDate` | Date nullable | |
| `timeRangeStart` | Time nullable | |
| `timeRangeEnd` | Time nullable | |
| `priority` | Int | Menor = maior prioridade |
| `status` | Enum: WAITING, NOTIFIED, RESERVED, CONVERTED, EXPIRED, CANCELLED | |
| `notifiedAt` | DateTime nullable | |
| `reservedUntil` | DateTime nullable | TTL da reserva |
| `appointmentId` | UUID FK → Appointment nullable | Após conversão |
| `expiresAt` | DateTime | |
| `createdAt` | DateTime | |

**Índices:** `(barbershopId, status, requestedDate)`, `(barbershopId, serviceId, status)`.

---

#### `ReminderJob`
Job de lembrete a ser enviado pela fila.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `appointmentId` | UUID FK → Appointment | |
| `customerId` | UUID FK → User | |
| `channel` | Enum: WHATSAPP, EMAIL, PUSH, SMS | |
| `scheduledAt` | DateTime | Quando enviar |
| `status` | Enum: PENDING, SENT, DELIVERED, FAILED, CANCELLED | |
| `attempts` | Int | Padrão 0 |
| `lastAttemptAt` | DateTime nullable | |
| `sentAt` | DateTime nullable | |
| `deliveredAt` | DateTime nullable | |
| `failureReason` | String nullable | |
| `cancelledAt` | DateTime nullable | |
| `createdAt` | DateTime | |

**Índices:** `(barbershopId, scheduledAt, status)`, `(appointmentId)`.

---

### G.7 Entidades da Fase 6

#### `ClubPlan`
Plano Clube da barbearia vendido ao cliente.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `name` | String | |
| `description` | String nullable | |
| `monthlyPrice` | Decimal(12,2) | |
| `isUnlimited` | Boolean | v1: sempre true |
| `maxFutureAppointments` | Int nullable | |
| `minIntervalBetweenUsagesHours` | Int nullable | |
| `minCancellationHours` | Int nullable | |
| `noshowPenaltyAmount` | Decimal(12,2) nullable | |
| `gracePeriodDays` | Int | Padrão 0 |
| `gracePeriodAllowNew` | Boolean | |
| `barbershopSharePct` | Decimal(5,2) | Ex: 50.00 |
| `status` | Enum: ACTIVE, DISCONTINUED, ARCHIVED | |
| `createdAt` / `updatedAt` | DateTime | |

---

#### `ClubPlanService`
Associação entre plano e serviço com peso para rateio.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `clubPlanId` | UUID FK → ClubPlan | |
| `serviceId` | UUID FK → Service | |
| `barbershopId` | UUID | Isolamento |
| `isIncluded` | Boolean | |
| `weight` | Decimal(10,4) | Peso no rateio |
| `memberDiscountPct` | Decimal(5,2) nullable | Desconto quando não incluído |
| `rules` | JSON nullable | Regras especiais |

**Constraints:** `UNIQUE(clubPlanId, serviceId)`. Pode ser alterado para atendimentos futuros; snapshots existentes em `ClubUsage` permanecem imutáveis.

---

#### `ClubSubscription`
Assinatura de um cliente ao ClubPlan.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `customerId` | UUID FK → User | |
| `clubPlanId` | UUID FK → ClubPlan | |
| `status` | Enum: PENDING, ACTIVE, GRACE_PERIOD, SUSPENDED, DEFAULTED, CANCELLED, ENDED | |
| `startDate` | Date | |
| `endDate` | Date nullable | |
| `suspendedFrom` | Date nullable | |
| `suspendedUntil` | Date nullable | |
| `cancelledAt` | DateTime nullable | |
| `cancelledById` | UUID nullable | |
| `createdAt` / `updatedAt` | DateTime | |

**Constraints:** `UNIQUE(barbershopId, customerId)` para status ativos (exceto CANCELLED e ENDED).

---

#### `ClubInvoice`
Mensalidade gerada para a assinatura.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `subscriptionId` | UUID FK → ClubSubscription | |
| `subscriptionCompetence` | String | YYYY-MM (mês de referência) |
| `dueDate` | Date | |
| `amount` | Decimal(12,2) | |
| `status` | Enum: PENDING, PAID, OVERDUE, CANCELLED, REFUNDED | |
| `paidAt` | DateTime nullable | Data de compensação |
| `financialCompetence` | String nullable | YYYY-MM derivado de paidAt |
| `paymentId` | UUID FK → Payment nullable | |
| `createdAt` | DateTime | |

**Constraints:** Imutável após `status = PAID`. Estorno gera nova entrada `REFUNDED`.

---

#### `ClubUsage`
Registro imutável de cada utilização do clube.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `subscriptionId` | UUID FK → ClubSubscription | |
| `comandaItemId` | UUID FK → ComandaItem | |
| `memberId` | UUID FK → BarbershopMember | Executor |
| `serviceId` | UUID FK → Service | |
| `clubPlanServiceId` | UUID FK → ClubPlanService | |
| `weightSnapshot` | Decimal(10,4) | Peso no momento da conclusão — **imutável** |
| `ruleSnapshot` | JSON | |
| `concludedAt` | DateTime | |
| `usageCompetence` | String | YYYY-MM |
| `status` | Enum: PENDING, VALID, REVERSED | |

**Constraints:** `weightSnapshot` imutável após inserção.
**Índices:** `(barbershopId, memberId, usageCompetence)`, `(subscriptionId)`.

---

#### `ClubSettlement`
Fechamento mensal do rateio do Plano Clube.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `clubPlanId` | UUID FK → ClubPlan | |
| `competence` | String | YYYY-MM |
| `grossRevenue` | Decimal(12,2) | |
| `adjustReceita` | Decimal(12,2) | `ajusteReceitaLiquido` |
| `netRevenue` | Decimal(12,2) | |
| `barbershopSharePctSnapshot` | Decimal(5,2) | Snapshot do percentual |
| `barbershopShare` | Decimal(12,2) | |
| `barberFund` | Decimal(12,2) | |
| `previousAccumulatedFund` | Decimal(12,2) | Saldo anterior |
| `adjustRateio` | Decimal(12,2) | `ajusteRateioLiquido` |
| `availableFund` | Decimal(12,2) | |
| `totalPoints` | Decimal(12,4) | |
| `accumulatedForward` | Decimal(12,2) | Saldo para próximo mês |
| `status` | Enum: DRAFT, APPROVED, PAID | |
| `approvedAt` | DateTime nullable | Imutável após preenchimento |
| `approvedById` | UUID nullable | |

**Constraints:** `UNIQUE(barbershopId, clubPlanId, competence)`. Uma vez `APPROVED`, nenhum campo pode ser atualizado.

---

#### `ClubSettlementBarber`
Linha do rateio por barbeiro em um ClubSettlement.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `settlementId` | UUID FK → ClubSettlement | |
| `memberId` | UUID FK → BarbershopMember | |
| `barbershopId` | UUID | Isolamento |
| `points` | Decimal(12,4) | |
| `participationPct` | Decimal(8,6) | `points ÷ totalPoints` |
| `grossAmount` | Decimal(12,2) | Antes do arredondamento |
| `finalAmount` | Decimal(12,2) | Após LRM |
| `status` | Enum: PENDING, PAID | |
| `paidAt` | DateTime nullable | |

**Constraints:** `Σ finalAmount por settlementId = availableFund − accumulatedForward`. Imutável após `ClubSettlement.status = APPROVED`.

---

#### `ClubAdjustment`
Ajuste auditado em ClubSettlement já aprovado.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `barbershopId` | UUID | Isolamento |
| `settlementId` | UUID FK → ClubSettlement | Mês alvo |
| `appliedToSettlementId` | UUID FK → ClubSettlement | Mês em que é aplicado |
| `type` | Enum: POSITIVE, NEGATIVE | |
| `amount` | Decimal(12,2) | |
| `reason` | String | |
| `performedById` | UUID FK → User | |
| `createdAt` | DateTime | Imutável |

**Constraints:** Requer `AuditLog`. Imutável após inserção.

---

## H. Fluxos Completos

### H.1 — Cliente comum agendado (link público)

**Entidades:** `User`, `Appointment`, `AppointmentService`, `AppointmentStatusLog`, `ReminderJob`, `IdempotencyKey`

1. Cliente acessa `/{slug}/agendar`.
2. Sistema carrega serviços, barbeiros e disponibilidade via endpoints públicos.
3. Cliente seleciona serviços → duração calculada no frontend.
4. Cliente seleciona barbeiro e data/horário disponível.
5. Frontend gera `idempotencyKey` (UUID v4).
6. `POST /api/public/barbershop/{slug}/book` com `{ idempotencyKey, memberId, serviceIds, dateTime, customerPhone? }`.
7. Backend — `$transaction(Serializable)`:
   - Verifica `IdempotencyKey`; se já existe e foi sucesso, retorna resultado anterior.
   - Lock do período: verificação de sobreposição com `SELECT ... FOR UPDATE`.
   - Localiza ou cria `User` pelo telefone.
   - Cria `Appointment` (status: `CONFIRMED`).
   - Cria `AppointmentService[]`.
   - Cria `AppointmentStatusLog` (null → CONFIRMED, origin: SYSTEM).
   - Cria `ReminderJob[]` programados.
   - Registra `IdempotencyKey`.
8. Retorna `{ appointmentId }`.

**Lacunas corrigidas nesta versão:** idempotência, lock transacional, log de status, lembretes.

---

### H.2 — Cliente de passagem (comanda sem agendamento)

**Entidades:** `Comanda`, `ComandaItem`, `Payment`, `FinancialEntry`, `PaymentAllocation`, `CommissionEntry`, `LoyaltyEntry`

1. Recepcionista/admin cria comanda: `POST /api/admin/comandas` com `{ customerId }`.
2. `Comanda` criada com `appointmentId = null`, `status = OPEN`.
3. Adiciona itens de serviço com `memberId` do executor.
4. Sistema determina `CommissionConfig` aplicável (hierarquia de prioridade).
5. Conclui cada item: `ComandaItem.status = DONE`.
6. Altera comanda para `PENDING_PAYMENT`.
7. `POST /api/admin/comandas/{id}/payments` com método e valor.
8. Cria `Payment`, `FinancialEntry`, `PaymentAllocation`.
9. Se `paidTotal >= total`: `Comanda.status = CLOSED`.
10. Gera `CommissionEntry[]` para itens concluídos com `status = GENERATED`.
11. Libera comissão proporcionalmente ao pagamento: `releasedAmount` atualizado.
12. Gera `LoyaltyEntry` sobre valor pago (se `LoyaltyConfig` ativo).

---

### H.3 — Cliente do Plano Clube (serviço incluído)

**Entidades:** `Appointment`, `Comanda`, `ComandaItem`, `ClubUsage`, `ClubSubscription`

1. Verificação de `ClubSubscription.status = ACTIVE` no início do atendimento.
2. Agendamento criado normalmente (reserva de tempo).
3. Comanda aberta vinculada ao agendamento.
4. Para cada serviço: verificar `ClubPlanService.isIncluded`.
5. Se incluído: `ComandaItem.isIncluded = true`, `total = 0`, `clubSubscriptionId` preenchido.
6. Ao concluir item incluído: cria `ClubUsage` com `status = PENDING`.
7. No fechamento da comanda: `ClubUsage.status → VALID`. Não gera `CommissionEntry`. **Invariante #1.**
8. Sem cobrança financeira pelos itens incluídos.

---

### H.4 — Cliente do Clube com serviço adicional

1. Fluxo H.3 para serviços incluídos (sem cobrança, sem comissão, com `ClubUsage`).
2. Para serviço adicional na mesma comanda:
   - `ComandaItem.isIncluded = false`, preço de tabela (ou com `memberDiscountPct`).
   - Gera `CommissionEntry` normalmente.
   - Pode gerar `LoyaltyEntry` sobre o valor pago do adicional.
3. Pagamento cobre apenas os itens não incluídos.
4. Um único fechamento de comanda gera os dois tipos de efeitos separadamente.

---

### H.5 — Pagamento parcial com liberação proporcional de comissão

1. `Comanda.total = R$ 200,00`. `CommissionEntry` gerada com `generatedAmount = R$ 20,00` (10%).
2. Primeiro pagamento: `R$ 100,00` (50% da comanda).
3. `CommissionEntry.releasedAmount = R$ 10,00` (50% do gerado). Status: `PARTIALLY_RELEASED`.
4. `Comanda.status` permanece `PENDING_PAYMENT`.
5. Segundo pagamento: `R$ 100,00`.
6. `Comanda.status = CLOSED`. `CommissionEntry.releasedAmount = R$ 20,00`. Status: `RELEASED`.
7. `LoyaltyEntry` gerada sobre `R$ 200,00` total pago.

**Regra:** comissão não liberada não pode ser incluída em `CommissionPeriod`.

---

### H.6 — Cancelamento de agendamento

**Entidades:** `Appointment`, `AppointmentStatusLog`, `ReminderJob`, `Comanda`

1. `PATCH /api/admin/appointments/{id}` com `{ status: CANCELLED }`.
2. `$transaction`:
   - Atualiza `Appointment.status = CANCELLED`.
   - Cria `AppointmentStatusLog` (CONFIRMED → CANCELLED, `changedById`, `reason`, `origin: ADMIN`).
   - Cancela `ReminderJob[]` associados.
   - Se comanda vinculada existir e `status IN (OPEN, IN_SERVICE)`: cancela a comanda.
   - Se comanda já `CLOSED`: não reverte automaticamente; requer estorno separado.
3. Retorna agendamento atualizado.

---

### H.7 — Estorno de pagamento

**Entidades:** `Payment`, `FinancialEntry`, `LoyaltyEntry`, `CommissionEntry`, `AuditLog`

1. `POST /api/admin/comandas/{id}/payments` com `{ type: REFUND, referencePaymentId, amount, reason }`.
2. Cria `Payment` com `type = REFUND`.
3. Cria `FinancialEntry` de saída.
4. Reverte `LoyaltyEntry` proporcional (nova entrada `REVERSE`).
5. Reverte `CommissionEntry` proporcional (nova entrada `REVERSED`).
6. Se `paidTotal < total`: `Comanda.status → PENDING_PAYMENT`.
7. Cria `AuditLog` com snapshot.

**Invariante #15:** pagamento original não é deletado.

---

### H.8 — Fechamento de comissão

**Entidades:** `CommissionEntry`, `CommissionPeriod`, `AuditLog`

1. Admin seleciona competência e profissional(is).
2. GET retorna `CommissionEntry[]` com `status = RELEASED`.
3. Admin revisa e confirma.
4. `POST /api/admin/commissions/close` com `{ competence, memberIds[] }`.
5. `$transaction`: cria `CommissionPeriod`, vincula `CommissionEntry[]`, muda status para `CLOSED`. Cria `AuditLog`.
6. Para marcar como pago: `PATCH /api/admin/commission-periods/{id}` com `{ status: PAID }`.
7. `CommissionPeriod` fechado é imutável.

---

### H.9 — Fechamento do Plano Clube

**Entidades:** `ClubSettlement`, `ClubSettlementBarber`, `ClubUsage`, `ClubInvoice`, `AuditLog`

1. Admin solicita rascunho: `POST /api/admin/club/settlements/draft` com `{ clubPlanId, competence }`.
2. `$transaction`:
   - Agrega `grossRevenue` de `ClubInvoice` com `financialCompetence = X` e `status = PAID`.
   - Aplica `ajusteReceitaLiquido`.
   - Calcula `receitaLiquida`, `parteBarbearia`, `fundoBarbeiros`.
   - Busca `previousAccumulatedFund` do settlement anterior.
   - Aplica `ajusteRateioLiquido`.
   - Calcula `availableFund`.
   - Agrega `ClubUsage` por `memberId` com `usageCompetence = X` e `status = VALID`.
   - Calcula `participacaoBarbeiro` e `rateioBruto`.
   - Aplica Largest Remainder Method.
   - Cria `ClubSettlement` com `status = DRAFT` + `ClubSettlementBarber[]`.
3. Admin revisa e aprova: `PATCH ... { status: APPROVED }`. Cria `AuditLog`. Imutável a partir daqui.
4. Pagamentos individuais: `PATCH .../barbers/{barberId} { status: PAID }`.

**Verificação obrigatória antes de APPROVED:** `Σ finalAmount + accumulatedForward = availableFund`. **Invariante #14.**

---

### H.10 — Lista de espera

1. `POST /api/client/waitlist` cria `WaitlistEntry.status = WAITING`.
2. Cancelamento de agendamento dispara busca de entradas compatíveis.
3. Sistema notifica cliente elegível (via `ReminderJob`). `WaitlistEntry.status = NOTIFIED`.
4. Cria reserva temporária (TTL 15 min via Redis). `WaitlistEntry.reservedUntil` preenchido.
5. Cliente confirma dentro do TTL → cria `Appointment` em transação serializada.
6. `WaitlistEntry.status = CONVERTED`, `appointmentId` preenchido.
7. TTL expirado sem confirmação → `status = EXPIRED`, próximo cliente notificado.

---

### H.11 — Reagendamento com lembretes

1. `PUT /api/admin/appointments/{id}` com `{ memberId?, serviceIds?, dateTime? }`.
2. `$transaction`:
   - Valida `status IN (PENDING, CONFIRMED)`.
   - Lock e conflito-check no novo período.
   - Cancela `ReminderJob[]` anteriores.
   - Atualiza `Appointment`.
   - Recalcula `totalPrice` e `durationMin` se serviços mudaram.
   - Substitui `AppointmentService[]`.
   - Cria `AppointmentStatusLog` (`reason = RESCHEDULED`).
   - Cria novos `ReminderJob[]` para o novo horário.

---

## I. Invariantes

Regras que nunca podem ser violadas em nenhum estado do sistema:

1. **Um item não gera comissão normal e pontos de clube simultaneamente.** `isClubIncluded = true` → sem `CommissionEntry`. `CommissionEntry` existe → `isClubIncluded = false`.

2. **Item cancelado ou estornado não gera nem mantém comissão ou pontos.** `ComandaItem.status = CANCELLED` → reverter `CommissionEntry` e `LoyaltyEntry` / `ClubUsage`.

3. **`ClubSettlement` aprovado não é recalculado silenciosamente.** Status `APPROVED` → campos imutáveis. Correções via `ClubAdjustment` na próxima competência.

4. **Alterações históricas são realizadas por ajustes.** Nenhum UPDATE/DELETE em registros financeiros fechados. Sempre inserir novo registro de ajuste/estorno.

5. **Mensalidade não recebida não integra o fundo.** `ClubInvoice.status != PAID` → não entra em `ClubSettlement.grossRevenue`.

6. **Serviço concluído preserva o peso aplicado.** `ClubUsage.weightSnapshot` é gravado no momento da conclusão e nunca atualizado. Mudanças em `ClubPlanService.weight` não afetam `ClubUsage` existentes.

7. **Pagamento não é confundido com agendamento concluído.** `Appointment.status = COMPLETED` é independente de `Comanda.status = CLOSED`.

8. **Receita somente é reconhecida após efetivo recebimento.** `FinancialEntry` de receita gerada somente quando `Payment.status = PAID`.

9. **Um horário não pode ser reservado simultaneamente para o mesmo profissional.** Garantido por transação com lock no banco. Verificação no backend, não apenas no frontend.

10. **Operações repetidas com a mesma chave de idempotência não criam duplicidades.** `IdempotencyKey` verificada antes de qualquer criação.

11. **Dados de uma barbearia não podem ser acessados por outra.** Toda query filtra por `barbershopId`. Guards verificam `barbershopId` do membro autenticado.

12. **Valores financeiros não usam `Float`.** Todos os campos monetários usam `Decimal(12,2)`.

13. **Configurações futuras não alteram fatos históricos.** Mudanças em `CommissionConfig`, `ClubPlanService`, `LoyaltyConfig` afetam apenas operações futuras.

14. **A soma dos rateios é exatamente igual ao fundo distribuído.** `Σ ClubSettlementBarber.finalAmount + accumulatedForward = availableFund`. Verificação obrigatória antes de APPROVED.

15. **Cancelamentos e estornos preservam histórico.** Nenhum registro financeiro, de agendamento, comanda ou uso é deletado.

16. **Toda alteração manual financeira exige auditoria.** Ajustes manuais criam `AuditLog` com `performedById`, `payload` (before/after) e `ip`.

---

## J. Roadmap por Fases

O roadmap detalhado está no arquivo `docs/match-barber-roadmap.md`.

**Total de fases:** 9 (Fase 0 a Fase 8).

| Fase | Nome | Objetivo |
|---|---|---|
| 0 | Segurança e estabilidade | Base segura para todas as evoluções |
| 1 | Comandas e produtos | Registrar consumo real |
| 2 | Pagamentos e financeiro | Controlar pagamentos e caixa |
| 3 | Comissões | Calcular e pagar comissões |
| 4 | Histórico e fidelidade | Timeline e programa de pontos |
| 5 | Lembretes e lista de espera | Reduzir faltas e aproveitar vagas |
| 6 | Plano Clube | Assinatura com rateio proporcional |
| 7 | Relatórios gerenciais | Visibilidade completa |
| 8 | Infraestrutura de produção | Deploy seguro e escalável |

---

## K. Decisões Pendentes

| # | Decisão | Fases bloqueadas |
|---|---|---|
| 1 | Provedor e canal principal dos lembretes (WhatsApp Business API, Twilio, Z-API, Evolution API?) | Fase 5 |
| 2 | Gateway de pagamento das mensalidades (Stripe, PagSeguro, Asaas, Vindi, manual?) | Fase 6 |
| 3 | Destino do fundo acumulado no encerramento definitivo do Clube | Fase 6 |
| 4 | Política de suspensão temporária (prorroga vigência? desconta da mensalidade?) | Fase 6 |
| 5 | Taxas e multas por atraso na mensalidade | Fase 6 |
| 6 | Regras de cancelamento da assinatura (fidelidade mínima? multa por antecipação?) | Fase 6 |
| 7 | Comissão sobre cortesia pode ser habilitada? | Fase 3 |
| 8 | Comissão sobre permuta: regra padrão | Fase 3 |
| 9 | Taxa de cartão poderá reduzir a base de comissão em versão futura? | Fase 3 (v2) |
| 10 | Quais relatórios exigem exportação em PDF na primeira versão? | Fase 7 |
| 11 | Qual armazenamento externo será adotado (AWS S3, Cloudflare R2, Supabase Storage?) | Fase 8 |

---

*Fim da Especificação Funcional e Técnica Revisada v2.0*
*Documento criado em 2026-06-15. Qualquer alteração de regra de negócio exige atualização desta especificação e registro em `AuditLog` de documentação.*
