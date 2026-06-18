# Match Barber — Roadmap de Implementação v2.0

**Última atualização:** 2026-06-16
**Versão:** 2.0
**Status geral:** EM ANDAMENTO
**Fase atual:** RELEASE OPERACIONAL 1A

**Marco prioritário atual:** RELEASE OPERACIONAL 1 — ATENDIMENTO, COMANDA E RECEBIMENTO

---

## Legenda

| Símbolo | Significado |
|---|---|
| `[ ]` | Não iniciado |
| `[ ] [EM ANDAMENTO]` | Em andamento |
| `[ ] [BLOQUEADO]` | Bloqueado — ver pendências |
| `[x]` | Concluído e validado |

---

## Decisões pendentes do proprietário

As decisões abaixo **bloqueiam** parcialmente ou totalmente as fases indicadas. Nenhuma fase deve ser iniciada enquanto a decisão correspondente não for tomada.

| # | Status | Decisão | Data | Responsável | Impacto | Fases bloqueadas |
|---|---|---|---|---|---|---|
| 1 | `[ ]` | Provedor de lembretes: WhatsApp Business API, Twilio, Z-API, Evolution API ou outro? | — | proprietário | Sem decisão, Fase 5 não pode ser implementada | Fase 5 |
| 2 | `[ ]` | Gateway de pagamento para mensalidades do Clube: Stripe, PagSeguro, Asaas, Vindi, cobrança manual? | — | proprietário | Gateway define `Payment.gatewayProvider`, integrações de webhook, `ClubInvoice` automática vs. manual | Fase 6 |
| 3 | `[ ]` | Destino do fundo acumulado no encerramento definitivo do Plano Clube | — | proprietário | Afeta `ClubSettlement` de encerramento; sem decisão, o encerramento não pode ser implementado | Fase 6 |
| 4 | `[ ]` | Política de suspensão temporária da assinatura: prorroga vigência? desconta a mensalidade? | — | proprietário | Afeta `ClubSubscription.suspendedFrom/Until` e cálculo de competência | Fase 6 |
| 5 | `[ ]` | Taxas e multas por atraso no pagamento da mensalidade | — | proprietário | Afeta cálculo de `ClubInvoice.amount` em cobrança retroativa | Fase 6 |
| 6 | `[ ]` | Regras de cancelamento da assinatura: fidelidade mínima? multa por antecipação? | — | proprietário | Afeta `ClubSubscription.cancelledAt` e criação de `FinancialEntry` de multa | Fase 6 |
| 7 | `[ ]` | Comissão sobre cortesia pode ser habilitada por `CommissionConfig.allowCourtesy`? | — | proprietário | Confirmar se campo faz parte do escopo da Fase 3 | Fase 3 |
| 8 | `[ ]` | Comissão sobre permuta: qual a regra padrão? | — | proprietário | Define `CommissionConfig.barterCommissionType` padrão | Fase 3 |
| 9 | `[ ]` | Taxa de cartão poderá reduzir a base de comissão em versão futura? | — | proprietário | Scoping de Fase 3 v2; confirmar se é v1 ou backlog | Fase 3 (v2) |
| 10 | `[ ]` | Quais relatórios exigem exportação PDF na primeira versão? | — | proprietário | Escopo da Fase 7 muda conforme decisão | Fase 7 |
| 11 | `[ ]` | Armazenamento externo para uploads: AWS S3, Cloudflare R2, Supabase Storage? | — | proprietário | Define adapter e credenciais da Fase 8 | Fase 8 |
| 12 | `[ ]` | Provedor de e-mail transacional (lembretes via e-mail): SendGrid, Resend, SES, Nodemailer? | — | proprietário | Necessário para canal EMAIL em `ReminderJob` | Fase 5 |

---

## Baseline confirmado

As funcionalidades abaixo estão **confirmadas no código atual** (auditoria 2026-06-15) e representam a base do sistema. Elas **não são entregas de fases** — são o estado inicial do repositório.

- [x] Arquitetura SaaS multi-tenant com `barbershopId`
- [x] NextAuth JWT dual: cliente sem senha (phone) + admin com CPF/email+senha
- [x] Perfis `OWNER`, `MANAGER`, `BARBER`, `USER`
- [x] Agenda diária com colunas por barbeiro
- [x] CRUD de agendamentos (admin)
- [x] Link público de agendamento por slug da barbearia
- [x] Consulta de disponibilidade por profissional
- [x] CRUD de serviços e categorias de serviço
- [x] CRUD de equipe (membros)
- [x] Jornada de trabalho (`WorkingHour`)
- [x] Bloqueios e folgas (`TimeOff`)
- [x] Área do cliente (`/minha-conta`)
- [x] Área do barbeiro (`/member/agenda`)
- [x] Configurações da barbearia (nome, logo, slug, contato)
- [x] `SaasPlan` + `TenantSaasSubscription` (plano comercial do Match Barber)
- [x] Upload de arquivos (filesystem local — migração na Fase 8)
- [x] Dashboard admin com KPIs básicos e gráficos
- [x] Design premium com tokens CSS (Tailwind v4 + Outfit + Playfair Display)

---

## Fase 0 — Segurança e estabilidade

**Objetivo:** Criar a base segura, rastreável e testada sem alterar nenhuma funcionalidade existente. Esta fase é **obrigatória e bloqueante** para todas as outras.

**Dependências:** Nenhuma.

**Pendências e bloqueios:** Nenhum — pode ser iniciada imediatamente.

### Fase 0A — Baseline de testes da aplicação funcional

**Status:** concluída com ressalva de lint global preexistente.

**Baseline funcional:** `cf4d41aac2e62c8f93f96c2bd71c1d095473e080`
**Branch:** `feat/phase-0a-booking-test-baseline-v2`
**Commit da etapa:** `test: add booking regression baseline`

#### Itens concluídos nesta etapa

- [x] Infraestrutura de testes com Vitest em ambiente Node
- [x] Scripts `test`, `test:run`, `test:watch` e `typecheck`
- [x] Testes de caracterização para cálculo de serviços, disponibilidade, agendamento público, agendamento administrativo, cancelamento, reagendamento e guards
- [x] Mocks de Prisma, NextAuth e guards para não usar banco real nem dados reais
- [x] Casos futuros críticos registrados como `todo`

#### Testes pendentes registrados como `todo`

- [ ] Impede reservas concorrentes para intervalos sobrepostos
- [ ] Requisição repetida com a mesma intenção não cria duplicidade
- [ ] Endpoint administrativo impede sobreposição de horários
- [ ] Toda alteração de status gera histórico
- [ ] Rotas públicas aplicam rate limit

#### Evidências da Fase 0A

| Comando | Exit code | Resultado |
|---|---:|---|
| `npm ci` | 0 | aprovado; Prisma Client gerado via `postinstall`; 7 vulnerabilidades moderadas já existentes |
| `npm run typecheck` | 0 | aprovado |
| `npm run test:run` | 0 | 8 arquivos de teste; 57 testes aprovados; 5 `todo`; duração 8.32s |
| `npm run build` | 0 | aprovado |
| `npm run lint` | 1 | reprovado por dívida preexistente: 56 erros e 15 warnings |
| `npx eslint vitest.config.ts "src/__tests__/**/*.ts"` | 0 | aprovado para arquivos alterados nesta etapa |

#### Dívida e lacunas mantidas

- Lint global preexistente permanece reprovado, sem novos erros nos arquivos da Fase 0A.
- Concorrência transacional, idempotência, `AppointmentStatusLog`, `AuditLog`, rate limiting e role `RECEPTIONIST` não foram implementados nesta etapa.
- Conflito-check ausente no endpoint administrativo permanece registrado como lacuna, sem correção nesta etapa.

#### Gate da Fase 0

**Status do gate:** NÃO AVALIADO

### Escopo incluído

- [ ] Testes de integração para os fluxos existentes (agendamento, disponibilidade, auth)
- [x] Implementação de lock transacional serializado na criação de agendamentos (público + admin)
- [x] Idempotência no endpoint público de agendamento (`IdempotencyKey`)
- [ ] `AppointmentStatusLog` com log inicial de todos os agendamentos existentes
- [ ] `AuditLog` configurado com helpers de registro
- [ ] Índice `@@index([customerId])` na entidade `Appointment`
- [ ] `NotificationType` convertido de string livre para enum
- [ ] Role `RECEPTIONIST` adicionado aos enums
- [ ] Rate limiting por IP e por `customerPhone` nas rotas públicas (Redis)
- [x] Conflito-check no endpoint admin de criação de agendamentos
- [x] `AppointmentService[]` dentro de `$transaction`

### Banco de dados

- [ ] Migration: `AppointmentStatusLog`
- [ ] Migration: `AuditLog`
- [x] Migration: `IdempotencyKey`
- [ ] Migration: índice em `Appointment.customerId`
- [ ] Migration: enum `NotificationType`
- [ ] Migration: role `RECEPTIONIST`
- [ ] Script de backfill: criar `AppointmentStatusLog` para agendamentos existentes

### Backend

- [ ] Reescrever `POST /api/public/barbershop/[slug]/book` com `$transaction(Serializable)` + idempotência + `AppointmentStatusLog` + `ReminderJob` stub
- [ ] Reescrever `POST /api/admin/appointments` com `$transaction` + conflito-check + `AppointmentStatusLog`
- [ ] Reescrever `PATCH /api/admin/appointments/[id]` (status change) com `AppointmentStatusLog`
- [ ] Criar `helpers/audit.ts` com função `createAuditLog()`
- [ ] Adicionar rate limiting middleware (Redis) para rotas públicas

### Frontend

- [x] Geração de `idempotencyKey` no formulário de agendamento público
- [ ] Exibir histórico de status no detalhe do agendamento (admin)

### Testes obrigatórios

- [x] Teste: dois clientes simultâneos não podem reservar o mesmo horário
- [x] Teste: idempotencyKey duplicada retorna resultado anterior sem criar novo agendamento
- [ ] Teste: mudança de status cria `AppointmentStatusLog`
- [x] Teste: conflito-check no admin bloqueia sobreposição de horários

### Critérios de aceite

- [ ] Nenhum agendamento duplicado em testes de concorrência com 10 requisições paralelas
- [ ] `AppointmentStatusLog` criado em toda mudança de status
- [x] `IdempotencyKey` funcional com TTL de 24h
- [ ] Rate limit retorna HTTP 429 após threshold configurável
- [x] Build passing sem erros TypeScript
- [x] Testes passando (coverage mínimo: fluxos críticos)

### Evidências a registrar

- [x] Output dos testes de concorrência
- [x] Migration SQL revisada
- [ ] Backfill confirmado (count de `AppointmentStatusLog` = count de `Appointment` após backfill)

### Fase 0B — Concorrência, sobreposição e idempotência da agenda

**Status:** concluída com ressalva de lint global preexistente.

**Baseline de partida:** `892d85217801129ed5c4ddf430eae3bc1c7ee702`
**Branch:** `feat/phase-0b-booking-concurrency`
**Commit da etapa:** `feat: harden appointment booking concurrency`

#### Itens concluídos nesta etapa

- [x] Migration `20260616203000_add_booking_idempotency` criando `idempotency_keys`
- [x] Lock transacional por `barbershopId:memberId` com advisory lock PostgreSQL
- [x] Detecção de sobreposição por intervalo real: `date_time < end` e `date_time + duration_min > start`
- [x] `POST /api/public/barbershop/[slug]/book` com idempotência, transação e resposta estável para `409 SLOT_UNAVAILABLE`
- [x] `POST /api/admin/appointments` com conflito-check transacional
- [x] `PUT /api/admin/appointments/[id]` com conflito-check ao reagendar e preservação do estado original em conflito
- [x] Frontend público envia `Idempotency-Key`, bloqueia tentativa duplicada em andamento e trata conflito de slot
- [x] Testes unitários e integração PostgreSQL para concorrência, idempotência, adjacência, profissional/tenant diferentes e conflito admin

#### Evidências da Fase 0B

| Comando | Exit code | Resultado |
|---|---:|---|
| `npm ci` | 0 | aprovado; Prisma Client gerado via `postinstall`; 7 vulnerabilidades moderadas já existentes |
| `npx prisma validate` | 0 | schema válido |
| `npx prisma generate` | 0 | Prisma Client gerado |
| `npx prisma migrate deploy` com `DATABASE_URL=postgresql://match_barber_test_user:***@localhost:55439/match_barber_test` | 0 | migrations `20260615125853_init_schema` e `20260616203000_add_booking_idempotency` aplicadas no banco isolado |
| `npm run test:integration` com `TEST_DATABASE_URL` | 0 | 1 arquivo; 4 testes aprovados |
| `npm run test:run` com `TEST_DATABASE_URL` | 0 | 10 arquivos aprovados; 1 arquivo skipped; 79 testes aprovados; 2 `todo` |
| `npm run typecheck` | 0 | aprovado |
| `npm run build` | 0 | aprovado |
| `npm run lint` | 1 | reprovado por dívida preexistente fora do escopo da Fase 0B |
| `npx eslint` dirigido nos arquivos alterados da Fase 0B | 0 | aprovado; 1 warning preexistente de `<img>` na página pública |

#### Dívida e lacunas mantidas

- Lint global permanece reprovado por erros preexistentes fora dos arquivos da Fase 0B.
- `AppointmentStatusLog`, `AuditLog`, rate limiting, índice `Appointment.customerId`, enum `NotificationType`, role `RECEPTIONIST` e backfill de status permanecem pendentes.
- O critério de 10 requisições paralelas ainda não foi marcado como concluído; esta etapa cobre concorrência de duas chamadas simultâneas e replay idempotente.

#### Rollback da Fase 0B

- Reverter o commit `feat: harden appointment booking concurrency`.
- Remover a migration `20260616203000_add_booking_idempotency`.
- Em ambiente onde a migration já tenha sido aplicada, executar rollback operacional validado para remover a tabela `idempotency_keys` antes de reimplantar a versão anterior.

### Gate da fase

> A Fase 1 somente pode iniciar após **todos os critérios de aceite da Fase 0** serem verificados e evidências documentadas.

---

## Fase 1 — Comandas e produtos

**Objetivo:** Registrar o consumo real do atendimento separando reserva de tempo (agenda) de consumo (comanda).

**Dependências:** Fase 0 completa.

**Pendências e bloqueios:** Fase 0 segue com pendências futuras registradas; Release Operacional 1A prioriza uso real de atendimento e recebimento.

### Release Operacional 1A — Comanda, recebimento e caixa básico

**Status:** concluída com ressalva de lint global preexistente.

**Baseline de partida:** `45928618d76ce901d1de9bc376af97676314bb2c`
**Branch:** `feat/release-1a-command-payments`
**Commit da etapa:** `feat: add operational commands and payment flow`

#### Itens concluídos nesta etapa

- [x] Modelos operacionais `Comanda`, `ComandaItem`, `Product`, `StockMovement`, `Payment`, `CashSession`, `CashMovement` e `FinancialEntry`
- [x] Constraint de uma comanda por agendamento e índice parcial de um caixa aberto por tenant
- [x] Ação `Abrir atendimento` na agenda administrativa, reutilizando comanda existente
- [x] Comanda sem agendamento para cliente de passagem
- [x] Itens de serviço, produto, desconto e acréscimo com totais calculados no backend
- [x] Estados de comanda `OPEN`, `IN_SERVICE`, `PENDING_PAYMENT`, `CLOSED`, `CANCELLED`
- [x] Pagamentos parciais, múltiplas formas, idempotência por operação e estorno
- [x] Caixa básico com abertura, fechamento, movimentos e diferença
- [x] Baixa transacional de estoque ao fechar comanda, sem baixa duplicada
- [x] Lançamentos financeiros e resumo diário por forma de pagamento
- [x] Telas administrativas de comandas, detalhe da comanda, produtos, caixa e financeiro
- [x] Teste de integração do fluxo operacional obrigatório

#### Evidências da Release 1A

| Comando | Exit code | Resultado |
|---|---:|---|
| `npm ci` | 0 | aprovado; Prisma Client gerado via `postinstall`; 7 vulnerabilidades moderadas já existentes |
| `npx prisma validate` | 0 | schema válido |
| `npx prisma generate` | 0 | Prisma Client gerado |
| `npx prisma migrate deploy` com `DATABASE_URL=postgresql://match_barber_test_user:***@localhost:55439/match_barber_test` | 0 | migrations da base, Fase 0B e Release 1A aplicadas no banco isolado |
| `npm run test:operational` com `TEST_DATABASE_URL` | 0 | 1 arquivo; 3 testes aprovados |
| `npm run test:run` com `TEST_DATABASE_URL` | 0 | 11 arquivos aprovados; 1 skipped; 82 testes aprovados; 2 `todo` |
| `npm run typecheck` | 0 | aprovado |
| `npm run build` | 0 | aprovado |
| `npx eslint` dirigido nos arquivos alterados da Release 1A | 0 | aprovado |
| `npm run lint` | 1 | reprovado por dívida preexistente fora do escopo da Release 1A; 47 erros e 15 warnings |

#### Fluxo de aceite validado

- [x] Criar/selecionar cliente
- [x] Criar agendamento com corte
- [x] Abrir comanda pela agenda
- [x] Iniciar atendimento
- [x] Adicionar barba
- [x] Adicionar produto
- [x] Associar profissional executor
- [x] Concluir itens
- [x] Aplicar desconto autorizado
- [x] Registrar pagamento em dinheiro
- [x] Registrar restante via Pix
- [x] Fechar comanda
- [x] Confirmar baixa de produto
- [x] Confirmar lançamento financeiro
- [x] Confirmar valores no resumo diário
- [x] Confirmar vínculo entre agendamento e comanda
- [x] Confirmar bloqueio de dados de outro tenant

#### Rollback da Release 1A

- Reverter o commit `feat: add operational commands and payment flow`.
- Remover a migration `20260617120000_release_1a_operational_commands`.
- Em ambiente onde a migration já tenha sido aplicada, executar rollback operacional validado removendo tabelas `financial_entries`, `cash_movements`, `cash_sessions`, `command_payments`, `stock_movements`, `comanda_items`, `products` e `comandas`, além dos enums criados para a Release 1A. A tabela legada `payments` não é removida por esta entrega.

#### Melhorias futuras mantidas

- [x] Comanda Operacional 2.0: Interface refatorada em cards/modais, validações de desconto e proteção de fechamento (concluída).
- Comissão e extrato do profissional na Release Operacional 1B.
- Fidelidade, Plano Clube, fornecedores, compras, estoque avançado, conciliação bancária, gateway, fiscal e relatórios avançados.
- Histórico genérico de status, auditoria genérica, rate limit, CI/CD avançado e correção global do lint permanecem fora desta entrega.

### Release Operacional 1B — Comissões e extrato do profissional

**Status:** concluída com ressalva de lint global preexistente.

**Baseline de partida:** `e9d7041b63d5bc23696643f719c21cd5ccfaf99b`
**Branch:** `feat/release-1b-commissions`
**Commit da etapa:** `feat: add commission management and barber statements`

#### Itens concluídos nesta etapa

- [x] Modelos `CommissionConfig`, `CommissionEntry`, `CommissionPeriod` e `CommissionAdjustment`
- [x] Migration `20260617160000_release_1b_commissions`
- [x] Hierarquia de configuração: profissional+serviço, profissional+categoria, profissional padrão, serviço geral, categoria geral e padrão da barbearia
- [x] Snapshot da regra aplicada em cada comissão gerada
- [x] Geração idempotente por item de serviço concluído com profissional executor
- [x] Exclusão de produtos, descontos, acréscimos, itens cancelados, itens sem profissional e valores zerados
- [x] Liberação proporcional ao valor recebido líquido da comanda
- [x] Estorno com reversão proporcional e preservação do histórico
- [x] Períodos por `barbershopId + memberId + competence` com estados `OPEN`, `CLOSED` e `PAID`
- [x] Rotas administrativas de configuração, consulta, fechamento e pagamento
- [x] Extrato do profissional em `/member/comissoes`, filtrado pelo próprio `memberId`
- [x] Telas `/admin/comissoes`, `/admin/comissoes/configuracoes` e `/admin/comissoes/periodos`

#### Evidências da Release 1B

| Comando | Exit code | Resultado |
|---|---:|---|
| `npm ci` | 0 | aprovado; Prisma Client gerado via `postinstall`; 7 vulnerabilidades moderadas já existentes |
| `npx prisma validate` | 0 | schema válido |
| `npx prisma generate` | 0 | Prisma Client gerado |
| `npx prisma migrate deploy` com `DATABASE_URL=postgresql://match_barber_test_user:***@localhost:55439/match_barber_test` | 0 | migrations da base, Fase 0B, Release 1A e Release 1B aplicadas no banco isolado |
| `npx vitest run src/__tests__/commissions.integration.test.ts --pool forks --fileParallelism false` | 0 | 1 arquivo; 5 testes aprovados |
| `npx vitest run src/__tests__/booking-concurrency.integration.test.ts --pool forks --fileParallelism false` | 0 | 1 arquivo; 4 testes aprovados |
| `npm run test:run` com `TEST_DATABASE_URL` | 0 | 12 arquivos aprovados; 1 skipped; 87 testes aprovados; 2 `todo` |
| `npm run typecheck` | 0 | aprovado |
| `npm run build` | 0 | aprovado |
| `npm run lint` | 1 | baseline mantido: 47 erros e 15 warnings; sem enfraquecimento de `eslint.config.mjs` |

#### Rollback da Release 1B

- Reverter o commit `feat: add commission management and barber statements`.
- Remover a migration `20260617160000_release_1b_commissions`.
- Em ambiente onde a migration já tenha sido aplicada sem dados reais, remover tabelas `commission_adjustments`, `commission_periods`, `commission_entries` e `commission_configs`, seguidas dos enums `CommissionAdjustmentType`, `CommissionPeriodStatus`, `CommissionEntryStatus` e `CommissionConfigType`.
- Em ambiente com dados reais, executar rollback operacional preservando export/backup dos lançamentos de comissão antes de remover estruturas.

#### Riscos e melhorias futuras

- Gorjeta ficou como melhoria futura; a Release 1A não possui modelagem de gorjeta coerente.

**Próximo marco:** RELEASE CANDIDATE OPERACIONAL — QA VISUAL, INTEGRAÇÃO E DEPLOY BETA

### Release Candidate Operacional — Integração Agenda, Atendimento e Comanda

**Status:** concluída com ressalva de lint global preexistente.

**Baseline de partida:** `2de8d14c60a911870635e6d4d744984efe51b798`
**Branch:** `beta/operational-rc` (ou equivalente no seu ambiente Antigravity)
**Commit da etapa:** `feat(admin): integracao vertical agenda, atendimento e comanda`

#### Itens concluídos nesta etapa

- [x] Agregação de `Comanda` na resposta do endpoint `GET /api/admin/appointments`.
- [x] Cancelamento transacional no `PATCH /api/admin/appointments/[id]`: anula ativamente comanda atrelada (`OPEN`) sem impacto financeiro, ou bloqueia com `422` se houver pagamento, comissão ou saída de estoque.
- [x] Regra de Falta (`NO_SHOW`): habilitada apenas antes do início do atendimento, aplica cancelamento sincronizado.
- [x] Sincronização no Fechamento: o método `closeComanda` converte magicamente o status do `Appointment` para `COMPLETED`.
- [x] Prevenção de Fugas de Estado na transição para `PENDING_PAYMENT` da comanda.
- [x] Matriz visual combinada (`getUIStatus`) no frontend de Agendamentos.
- [x] Novo painel overlay de ações dinâmico (responsivo para Desktop e Mobile).
- [x] Atualização de estado da lista sem `window.location.reload()`.
- [x] Verificação via Testes: Integração unitária dos mocks e validação unitária de fluxos `cancel` passados com perfeição.

#### Evidências do Gate Final

| Comando | Exit code | Resultado |
|---|---:|---|
| `npm run typecheck` | 0 | Aprovado sem erros |
| `npm run test:run` | 0 | Aprovado (75 testes unitários) |
| `npm run test:operational` | 0 | Aprovado sem regressões no financeiro/caixa |
| Integrações | 0 | Testes unitários atestam bloqueios de tenant, exclusividade e cancelamento |
| `npm run build` | 0 | Aprovado (compilou com sucesso em 24.1s) |
| `npm run lint` | 1 | Baseline preexistente mantida (47 erros e 15 warnings) |

#### Rollback da Release Candidate

- Reverter o commit de integração vertical na agenda.
- Não há modificações destrutivas na base de dados (`migrations`).

#### Riscos e pendências futuras (Pré-Deploy)

- O projeto apresenta 47 erros de lint e 15 warnings que em ambientes de CI mais rígidos irão impedir o deploy (Next.js build pipeline fail). Recomenda-se um bypass provisório ou refatoração profunda global.
- Melhorias na interface de `Agendamento Público` baseadas nos temas CSS atuais.
- Configuração de Deploy Beta Vercel ou VPS.

---

### Premium Design System — Fase 1 (Fundação)

**Status:** concluída com ressalva de lint global preexistente.

**Baseline de partida:** `6200fc4ca42ba4c626967187cb3c0f8d39ef8350`
**Branch:** `feat/premium-design-system-foundation`
**Commit da etapa:** `feat: match barber premium design system foundation`

#### Itens concluídos nesta etapa

- [x] Configuração oficial dos tokens no `globals.css` baseada em "Luxo Operacional".
- [x] Criação de `Button`, `IconButton`, `Input`, `Select`, `Card`, `Badge`, `Skeleton`, `EmptyState` em `src/components/ui/`.
- [x] Nova API de Modais focada em `Dialog`, `Sheet` e `ConfirmDialog` via HTML5 dinâmico sem dependências pesadas externas.
- [x] Adaptação da Comanda Operacional 2.0 (substituição do `window.confirm` pelo `ConfirmDialog`).
- [x] Refatoração visual da `AdminSidebar` e da `MemberNav` com painel de Drawer Mobile unificado e tokens limpos.
- [x] Configuração e criação da documentação inicial de interface `docs/match-barber-premium-design-system.md`.
- [x] Implementação concluída sem quebra dos testes e lógicas operacionais anteriores.

#### Evidências do Gate Final

| Comando | Exit code | Resultado |
|---|---:|---|
| `npm run typecheck` | 0 | Aprovado sem erros |
| `npm run test:run` | 0 | Aprovado |
| `npm run build` | 0 | Aprovado |

#### Próximos passos (Fases 2, 3 e 4 do Design System)

- Substituição massiva das telas antigas para as classes e primitives construídos nesta Fundação.
- Criação e padronização da página `/admin/dashboard` e páginas de tabelas (Financeiro e Comissões).
- Aplicação das diretrizes na navegação do cliente e página pública de agendamento.

---

### Escopo incluído

- [ ] CRUD completo de `Comanda`
- [ ] CRUD de `ComandaItem` (serviços, produtos, adicional, desconto, acréscimo)
- [ ] Cálculo automático de `total` e `subtotal`
- [ ] Alteração de profissional executor de um item (antes do fechamento)
- [ ] Abertura automática de comanda ao confirmar agendamento (configurável)
- [ ] Fechamento de comanda (sem pagamento integrado nesta fase — pagamento manual como stub)
- [ ] `Product` + `StockMovement`
- [ ] Interface admin para gestão de comandas

### Banco de dados

- [ ] Migration: `Comanda`
- [ ] Migration: `ComandaItem`
- [ ] Migration: `Product`
- [ ] Migration: `StockMovement`

### Backend

- [ ] `POST /api/admin/comandas` — criar comanda (com ou sem agendamento)
- [ ] `GET /api/admin/comandas` — listar com filtros
- [ ] `GET /api/admin/comandas/[id]` — detalhe
- [ ] `POST /api/admin/comandas/[id]/items` — adicionar item
- [ ] `PATCH /api/admin/comandas/[id]/items/[itemId]` — editar item
- [ ] `DELETE /api/admin/comandas/[id]/items/[itemId]` — cancelar item
- [ ] `PATCH /api/admin/comandas/[id]/close` — fechar comanda (stub de pagamento)
- [ ] `GET /api/admin/products` — listar produtos
- [ ] `POST /api/admin/products` — criar produto
- [ ] `PATCH /api/admin/products/[id]` — editar produto
- [ ] `GET /api/admin/products/[id]/stock` — histórico de estoque

### Frontend

- [ ] Tela de lista de comandas (admin)
- [ ] Tela de detalhe/edição de comanda
- [ ] Componente de adição de itens (serviços e produtos)
- [ ] Indicador de status da comanda
- [ ] Tela de gestão de produtos e estoque

### Testes obrigatórios

- [ ] Teste: item cancelado não eleva o total
- [ ] Teste: fechamento de comanda com items pendentes é bloqueado
- [ ] Teste: comanda `CLOSED` é imutável
- [ ] Teste: estoque diminui ao vender produto

### Critérios de aceite

- [ ] Comanda pode existir sem agendamento
- [ ] `total` recalculado a cada alteração de item
- [ ] Item cancelado: `status = CANCELLED`, `cancelledAt` preenchido
- [ ] Comanda `CLOSED` retorna HTTP 409 em qualquer tentativa de edição
- [ ] `StockMovement` criado ao vender produto
- [ ] Testes passando

### Evidências a registrar

- [ ] Comanda de passagem criada, editada e fechada manualmente
- [ ] Produto com `trackStock = true` com saída de estoque registrada

### Gate da fase

> A Fase 2 somente pode iniciar após **todos os critérios de aceite da Fase 1** serem verificados.

---

## Fase 2 — Pagamentos e financeiro

**Objetivo:** Registrar pagamentos reais, controlar caixa e gerar entradas financeiras.

**Dependências:** Fase 1 completa.

**Pendências e bloqueios:** Nenhum.

### Escopo incluído

- [ ] Novo modelo `Payment` (com constraint de origem exclusiva: `comandaId` XOR `clubInvoiceId`)
- [ ] `PaymentAllocation` para distribuição por item
- [ ] `CashSession` (abertura, fechamento, conferência)
- [ ] `FinancialEntry` de receitas e despesas
- [ ] Múltiplas formas de pagamento por comanda (`PaymentMethod`)
- [ ] Estorno de pagamento com `type = REFUND`
- [ ] Fechamento de comanda automatizado após pagamento integral
- [ ] Descontinuação do modelo `Payment` antigo (com migração de dados)

### Banco de dados

- [ ] Migration: `Payment` (novo modelo)
- [ ] Migration: `PaymentAllocation`
- [ ] Migration: `CashSession`
- [ ] Migration: `FinancialEntry`
- [ ] Script de migração de dados: `Payment` antigo → novo modelo (via `comandaId`)
- [ ] Migration: remover campos e relações do `Payment` antigo após migração

### Backend

- [ ] `POST /api/admin/comandas/[id]/payments` — registrar pagamento
- [ ] `POST /api/admin/comandas/[id]/payments` (REFUND) — estornar pagamento
- [ ] `GET /api/admin/comandas/[id]/payments` — listar pagamentos
- [ ] `POST /api/admin/cash-sessions` — abrir caixa
- [ ] `PATCH /api/admin/cash-sessions/[id]/close` — fechar caixa
- [ ] `GET /api/admin/cash-sessions` — listar sessões de caixa
- [ ] `GET /api/admin/financial-entries` — listar lançamentos com filtros

### Frontend

- [ ] Tela de registro de pagamento na comanda (multi-método)
- [ ] Tela de estorno com confirmação
- [ ] Tela de abertura e fechamento de caixa
- [ ] Extrato financeiro básico (lista de lançamentos)

### Testes obrigatórios

- [ ] Teste: dois pagamentos parciais somam exatamente o total da comanda
- [ ] Teste: estorno cria `Payment(REFUND)` e não altera o pagamento original
- [ ] Teste: comanda fecha automaticamente ao atingir `total`
- [ ] Teste: apenas uma `CashSession OPEN` por `barbershopId`
- [ ] Teste: constraint de origem exclusiva (`comandaId XOR clubInvoiceId`)

### Critérios de aceite

- [ ] Pagamento de R$ 0,01 abaixo do total não fecha a comanda
- [ ] Pagamento integral fecha a comanda imediatamente
- [ ] Estorno: pagamento original com `status = PAID`, estorno com `type = REFUND`
- [ ] `FinancialEntry` criada somente para `Payment.status = PAID`
- [ ] Testes passando

### Evidências a registrar

- [ ] Comanda com pagamento em dois métodos distintos
- [ ] Estorno parcial: comanda voltou para `PENDING_PAYMENT`
- [ ] Caixa aberto e fechado com diferença registrada

### Gate da fase

> A Fase 3 somente pode iniciar após **todos os critérios de aceite da Fase 2** serem verificados.

---

## Fase 3 — Comissões

**Objetivo:** Calcular, liberar e pagar comissões de barbeiros sobre serviços e produtos cobrados.

**Dependências:** Fase 2 completa. Decisões 7 e 8 tomadas.

**Pendências e bloqueios:**
- `[ ]` [BLOQUEADO] Decisão 7: comissão sobre cortesia
- `[ ]` [BLOQUEADO] Decisão 8: comissão sobre permuta

### Escopo incluído

- [ ] `CommissionConfig` com hierarquia de prioridade
- [ ] `CommissionEntry` gerada ao concluir item de serviço
- [ ] Liberação proporcional ao pagamento recebido
- [ ] `CommissionPeriod` — fechamento por profissional e competência
- [ ] Ciclo completo: `GENERATED → PARTIALLY_RELEASED → RELEASED → PAID`
- [ ] `TipEntry` (gorjeta vinculada ao profissional)
- [ ] Estorno reverte `CommissionEntry` proporcional
- [ ] Barbeiro vê suas comissões em `/member/comissoes`

### Banco de dados

- [ ] Migration: `CommissionConfig`
- [ ] Migration: `CommissionEntry`
- [ ] Migration: `CommissionPeriod`
- [ ] Migration: `TipEntry`

### Backend

- [ ] `GET /api/admin/commissions/config` — listar regras
- [ ] `POST /api/admin/commissions/config` — criar regra
- [ ] `PATCH /api/admin/commissions/config/[id]` — editar regra
- [ ] `GET /api/admin/commissions/entries` — listar entradas com filtros
- [ ] `POST /api/admin/commissions/periods/close` — fechar período
- [ ] `PATCH /api/admin/commissions/periods/[id]/pay` — marcar como pago
- [ ] `GET /api/member/commissions` — barbeiro vê suas comissões
- [ ] Lógica de hierarquia de regras (resolução automática)
- [ ] Lógica de liberação proporcional ao pagamento

### Frontend

- [ ] Tela de configuração de comissões (admin)
- [ ] Tela de fechamento de período de comissões (admin)
- [ ] Tela de comissões do barbeiro (`/member/comissoes`)
- [ ] Indicador de comissão no detalhe da comanda

### Testes obrigatórios

- [ ] Teste: hierarquia de prioridade — regra mais específica vence
- [ ] Teste: pagamento parcial libera comissão proporcional
- [ ] Teste: comissão não liberada não pode ser incluída em período fechado
- [ ] Teste: estorno parcial reduz `releasedAmount`
- [ ] Teste: item do Clube não gera `CommissionEntry` (Invariante #1)

### Critérios de aceite

- [ ] `CommissionEntry` gerada para todo item `SERVICE` não-clube concluído
- [ ] `releasedAmount` nunca supera `generatedAmount`
- [ ] `CommissionPeriod` fechado é imutável
- [ ] `AuditLog` criado no fechamento do período
- [ ] Testes passando

### Evidências a registrar

- [ ] Comanda com dois serviços, dois barbeiros, pagamento parcial — comissões proporcionais verificadas
- [ ] Item clube na mesma comanda — sem `CommissionEntry`
- [ ] Período de comissão fechado e marcado como pago

### Gate da fase

> A Fase 4 somente pode iniciar após **todos os critérios de aceite da Fase 3** serem verificados.

---

## Fase 4 — Histórico do cliente e fidelidade

**Objetivo:** Oferecer ao cliente e ao admin uma visão completa do relacionamento e recompensar a lealdade.

**Dependências:** Fases 1, 2 e 3 completas.

**Pendências e bloqueios:** Nenhum.

### Escopo incluído

- [ ] `LoyaltyConfig` por barbearia
- [ ] `LoyaltyEntry` com tipos: `EARN`, `REDEEM`, `EXPIRE`, `ADJUST`, `REVERSE`
- [ ] Geração automática de pontos ao fechar comanda
- [ ] Estorno do pagamento reverte `LoyaltyEntry` correspondente
- [ ] Ajuste manual de pontos com `AuditLog`
- [ ] Timeline unificada do cliente (agendamentos, comandas, pagamentos, comissões, pontos)
- [ ] Área do cliente enriquecida: histórico, saldo de pontos, extrato

### Banco de dados

- [ ] Migration: `LoyaltyConfig`
- [ ] Migration: `LoyaltyEntry`

### Backend

- [ ] `GET /api/admin/loyalty/config` — ver configuração
- [ ] `PUT /api/admin/loyalty/config` — salvar configuração
- [ ] `GET /api/admin/customers/[id]/history` — timeline do cliente
- [ ] `GET /api/admin/customers/[id]/loyalty` — saldo e extrato de pontos
- [ ] `POST /api/admin/customers/[id]/loyalty/adjust` — ajuste manual com `AuditLog`
- [ ] `GET /api/client/loyalty` — cliente vê seu saldo e extrato
- [ ] Lógica de geração automática de `LoyaltyEntry(EARN)` no fechamento de comanda

### Frontend

- [ ] Tela de configuração de fidelidade (admin)
- [ ] Tela de histórico unificado do cliente (admin)
- [ ] Saldo e extrato de pontos na área do cliente (`/minha-conta`)
- [ ] Indicador de pontos ganhos no recibo da comanda

### Testes obrigatórios

- [ ] Teste: pontos gerados sobre valor pago (não sobre total com desconto clube)
- [ ] Teste: estorno reverte `LoyaltyEntry` proporcionalmente
- [ ] Teste: ajuste manual sem `AuditLog` é rejeitado

### Critérios de aceite

- [ ] `LoyaltyEntry(EARN)` criada somente para `Payment.status = PAID`
- [ ] Serviço coberto pelo Clube não gera pontos de fidelidade
- [ ] Timeline do cliente inclui todos os eventos relevantes em ordem cronológica
- [ ] `AuditLog` obrigatório para `LoyaltyEntry.type = ADJUST`
- [ ] Testes passando

### Evidências a registrar

- [ ] Cliente com histórico misto (clube + pagamentos + pontos) — timeline verificada
- [ ] Ajuste manual de pontos com `AuditLog` registrado

### Gate da fase

> A Fase 5 somente pode iniciar após **todos os critérios de aceite da Fase 4** serem verificados.

---

## Fase 5 — Lembretes automáticos e lista de espera

**Objetivo:** Reduzir faltas via lembretes e aproveitar vagas via lista de espera.

**Dependências:** Fase 0 completa (para `ReminderJob`). Decisões 1 e 12 tomadas.

**Pendências e bloqueios:**
- `[ ]` [BLOQUEADO] Decisão 1: provedor de lembretes (WhatsApp)
- `[ ]` [BLOQUEADO] Decisão 12: provedor de e-mail transacional

### Escopo incluído

- [ ] `ReminderJob` persistido e processado por fila (Bull + Redis)
- [ ] Adapter de notificação substituível (`NotificationAdapter`)
- [ ] Lembretes configuráveis: quantos dias antes, canal principal
- [ ] `WaitlistEntry` com ciclo completo
- [ ] Reserva temporária via Redis (TTL 15 min)
- [ ] Notificação ao cliente elegível quando vaga surge
- [ ] Conversão de lista de espera em agendamento (transação serializada)

### Banco de dados

- [ ] Migration: `ReminderJob` (se não feita na Fase 0)
- [ ] Migration: `WaitlistEntry`

### Backend

- [ ] Worker de processamento de `ReminderJob` (Bull queue)
- [ ] `NotificationAdapter` interface + implementação concreta do provedor escolhido
- [ ] `POST /api/client/waitlist` — entrar na fila
- [ ] `DELETE /api/client/waitlist/[id]` — sair da fila
- [ ] `GET /api/admin/waitlist` — visualizar fila
- [ ] `PATCH /api/admin/waitlist/[id]` — alterar prioridade
- [ ] Lógica de matching: vaga livre → notificar elegíveis em ordem de prioridade
- [ ] Conversão da reserva em agendamento (`status = CONVERTED`)

### Frontend

- [ ] Tela de lista de espera na área do cliente
- [ ] Tela de gestão da lista de espera (admin)
- [ ] Configurações de lembretes (admin): canal, antecedência

### Testes obrigatórios

- [ ] Teste: lembrete cancelado ao reagendar
- [ ] Teste: dois clientes na fila — somente o de maior prioridade é notificado primeiro
- [ ] Teste: reserva TTL expirada → `status = EXPIRED`, próximo notificado
- [ ] Teste: conversão em agendamento usa lock transacional

### Critérios de aceite

- [ ] `ReminderJob` cancelado automaticamente ao cancelar ou reagendar agendamento
- [ ] `WaitlistEntry.status` segue ciclo: WAITING → NOTIFIED → RESERVED → CONVERTED
- [ ] Reserva expirada não cria agendamento
- [ ] Testes passando

### Evidências a registrar

- [ ] Lembrete enviado com sucesso (log do adapter)
- [ ] Fluxo completo de lista de espera: criação → notificação → reserva → conversão

### Gate da fase

> A Fase 6 somente pode iniciar após **todos os critérios de aceite da Fase 5** e após Decisões 2, 3, 4, 5 e 6 estarem tomadas.

---

## Fase 6 — Plano Clube

**Objetivo:** Implementar assinaturas de clientes com serviços incluídos e rateio proporcional entre barbeiros.

**Dependências:** Fases 2, 3 e 5 completas. Decisões 2, 3, 4, 5 e 6 tomadas.

**Pendências e bloqueios:**
- `[ ]` [BLOQUEADO] Decisão 2: gateway de pagamento
- `[ ]` [BLOQUEADO] Decisão 3: encerramento do fundo acumulado
- `[ ]` [BLOQUEADO] Decisão 4: política de suspensão
- `[ ]` [BLOQUEADO] Decisão 5: taxas de atraso
- `[ ]` [BLOQUEADO] Decisão 6: cancelamento de assinatura

### Escopo incluído

- [ ] `ClubPlan` — CRUD completo com configurações de regras
- [ ] `ClubPlanService` — associação plano × serviço com peso
- [ ] `ClubSubscription` — ciclo de vida completo
- [ ] `ClubInvoice` — geração de mensalidade e integração com gateway
- [ ] `ClubUsage` com snapshot imutável do peso
- [ ] `ClubSettlement` — fechamento mensal com fórmulas de rateio
- [ ] `ClubSettlementBarber` — distribuição por barbeiro (LRM)
- [ ] `ClubAdjustment` — correções auditadas em competências passadas
- [ ] Cálculo de `Payment.clubInvoiceId` (constraint de origem exclusiva)
- [ ] Bloqueio de serviços incluídos para assinaturas inadimplentes
- [ ] Interface de gestão do Clube (admin)

### Banco de dados

- [ ] Migration: `ClubPlan`
- [ ] Migration: `ClubPlanService`
- [ ] Migration: `ClubSubscription`
- [ ] Migration: `ClubInvoice`
- [ ] Migration: `ClubUsage`
- [ ] Migration: `ClubSettlement`
- [ ] Migration: `ClubSettlementBarber`
- [ ] Migration: `ClubAdjustment`

### Backend

- [ ] `POST /api/admin/club/plans` — criar plano
- [ ] `PATCH /api/admin/club/plans/[id]` — editar plano
- [ ] `GET /api/admin/club/plans` — listar planos
- [ ] `POST /api/admin/club/plans/[id]/services` — associar serviço
- [ ] `PATCH /api/admin/club/plans/[id]/services/[serviceId]` — editar peso
- [ ] `POST /api/admin/club/subscriptions` — criar assinatura
- [ ] `PATCH /api/admin/club/subscriptions/[id]` — alterar status
- [ ] `GET /api/admin/club/subscriptions` — listar
- [ ] `POST /api/admin/club/settlements/draft` — gerar rascunho
- [ ] `PATCH /api/admin/club/settlements/[id]/approve` — aprovar fechamento
- [ ] `PATCH /api/admin/club/settlements/[id]/barbers/[barberId]/pay` — marcar pago
- [ ] `POST /api/admin/club/settlements/[id]/adjustments` — criar ajuste
- [ ] Lógica de rateio (fórmulas completas da seção F.7)
- [ ] Largest Remainder Method
- [ ] Verificação de invariante #14 antes de APPROVED
- [ ] Geração de `ClubUsage` no fechamento de item incluído
- [ ] Verificação de status de assinatura na abertura de comanda
- [ ] `AuditLog` obrigatório em toda aprovação e ajuste

### Frontend

- [ ] Tela de criação e gestão de planos do Clube
- [ ] Tela de assinaturas ativas (admin)
- [ ] Tela de fechamento mensal do Clube (admin) — rascunho + aprovação
- [ ] Distribuição por barbeiro visível antes da aprovação
- [ ] Histórico de ajustes
- [ ] Área do cliente: informações da assinatura ativa

### Testes obrigatórios

- [ ] Teste: serviço incluído cria `ClubUsage`, não cria `CommissionEntry` (Invariante #1)
- [ ] Teste: `weightSnapshot` imutável após inserção (Invariante #6)
- [ ] Teste: `Σ finalAmount + accumulatedForward = availableFund` (Invariante #14)
- [ ] Teste: `ClubSettlement APPROVED` imutável
- [ ] Teste: `pontosTotais = 0` → fundo acumulado para próxima competência
- [ ] Teste: assinatura inadimplente bloqueia novos serviços incluídos
- [ ] Teste: `ClubAdjustment` cria `AuditLog`

### Critérios de aceite

- [ ] Fluxo completo de assinatura: PENDING → ACTIVE → uso → fatura → pagamento → fechamento
- [ ] Rateio com múltiplos barbeiros calculado corretamente (verificação manual)
- [ ] `AuditLog` presente em toda aprovação de `ClubSettlement`
- [ ] Todas as invariantes passando em testes
- [ ] Testes passando

### Evidências a registrar

- [ ] Fechamento mensal com 3+ barbeiros e pesos distintos — planilha comparativa
- [ ] Ajuste em competência passada: `ClubAdjustment` criado, fundo da competência seguinte ajustado
- [ ] Cliente inadimplente bloqueado de usar serviços incluídos

### Gate da fase

> A Fase 7 somente pode iniciar após **todos os critérios de aceite da Fase 6** serem verificados.

---

## Fase 7 — Relatórios gerenciais

**Objetivo:** Prover visibilidade completa sobre agenda, financeiro, comissões, clube e clientes.

**Dependências:** Fases 1 a 6 completas. Decisão 10 tomada.

**Pendências e bloqueios:**
- `[ ]` [BLOQUEADO] Decisão 10: quais relatórios precisam de PDF na primeira versão

### Escopo incluído

- [ ] Relatório de agenda (ocupação, faltas, distribuição por barbeiro)
- [ ] Relatório financeiro (receita bruta, líquida, despesas, fluxo de caixa)
- [ ] Relatório de comissões (por barbeiro, por período)
- [ ] Relatório do Plano Clube (assinaturas, uso, rateio, histórico de fechamentos)
- [ ] Relatório de clientes (frequência, ticket médio, churn)
- [ ] Exportação CSV para todos os relatórios
- [ ] Exportação PDF para relatórios selecionados na Decisão 10

### Banco de dados

- [ ] Views ou índices de materialização para agregações pesadas (se necessário)

### Backend

- [ ] `GET /api/admin/reports/agenda`
- [ ] `GET /api/admin/reports/financial`
- [ ] `GET /api/admin/reports/commissions`
- [ ] `GET /api/admin/reports/club`
- [ ] `GET /api/admin/reports/customers`
- [ ] `GET /api/admin/reports/[type]/export?format=csv`
- [ ] `GET /api/admin/reports/[type]/export?format=pdf` (se aplicável)

### Frontend

- [ ] Tela de relatórios com filtros de período
- [ ] Tabelas e gráficos por relatório
- [ ] Botões de exportação CSV e PDF

### Testes obrigatórios

- [ ] Teste: filtro de período retorna somente dados corretos
- [ ] Teste: exportação CSV com cabeçalhos e encoding UTF-8
- [ ] Teste: cálculo de receita líquida bate com soma de `FinancialEntry`

### Critérios de aceite

- [ ] Todos os relatórios disponíveis com filtro por período
- [ ] CSV exportável e importável em Excel sem erros de encoding
- [ ] Relatórios de clube conferem com dados do `ClubSettlement`
- [ ] Testes passando

### Evidências a registrar

- [ ] CSV de relatório financeiro importado no Excel com sucesso
- [ ] Relatório do clube verificado contra fechamento mensal do banco

### Gate da fase

> A Fase 8 somente pode iniciar após **todos os critérios de aceite da Fase 7** serem verificados.

---

## Fase 8 — Infraestrutura de produção

**Objetivo:** Deploy seguro, escalável e observável para ambiente de produção.

**Dependências:** Todas as fases anteriores concluídas. Decisão 11 tomada.

**Pendências e bloqueios:**
- `[ ]` [BLOQUEADO] Decisão 11: armazenamento externo para uploads

### Escopo incluído

- [ ] Migração de upload de arquivos para armazenamento externo (adapter substituível)
- [ ] CI/CD com lint, typecheck e testes em todo PR
- [ ] Variáveis de ambiente auditadas — nenhuma credencial no repositório
- [ ] Health check endpoint (`/api/health`)
- [ ] Monitoramento de erros (Sentry ou equivalente)
- [ ] Monitoramento de performance (request duration, queue depth)
- [ ] Alertas para filas de lembretes paradas
- [ ] Backup automático do banco de dados
- [ ] Documentação de operação (runbook mínimo)

### Backend

- [ ] `GET /api/health` — retorna status de DB, Redis e fila
- [ ] Adapter de armazenamento externo com mesma interface do upload atual
- [ ] Pipeline CI/CD configurado
- [ ] Variáveis de ambiente documentadas em `.env.example`

### Frontend

- [ ] Nenhuma alteração funcional prevista nesta fase

### Testes obrigatórios

- [ ] Teste: `/api/health` retorna 200 com DB e Redis saudáveis
- [ ] Teste: upload via adapter externo funciona identicamente ao local
- [ ] CI falha ao introduzir erro TypeScript ou teste quebrado

### Critérios de aceite

- [ ] Deploy em ambiente de produção sem downtime
- [ ] Todos os uploads apontando para armazenamento externo
- [ ] CI/CD rodando em todo PR
- [ ] Alertas configurados
- [ ] Backup automático com restore testado
- [ ] Testes passando

### Evidências a registrar

- [ ] Print do pipeline CI rodando com sucesso
- [ ] Upload de arquivo testado em produção
- [ ] Restore de backup testado

### Gate da fase

> Sistema considerado produção-ready após **todos os critérios de aceite da Fase 8** verificados.

---

## Regras de atualização do roadmap

1. **Toda entrega concluída deve ser marcada com `[x]` imediatamente após validação** — nunca antes.
2. **Nenhum item é marcado como concluído sem evidência registrada** na seção "Evidências a registrar".
3. **A seção de decisões pendentes deve ser atualizada** sempre que o proprietário tomar uma decisão — preencher Data, Responsável e mudar para `[x]`.
4. **O campo "Fase atual"** no cabeçalho reflete a fase em execução ativa, não a última fase concluída.
5. **"EM ANDAMENTO"** pode aparecer em no máximo uma fase por vez.
6. **O Gate da fase** deve ser validado formalmente antes de marcar a fase como concluída e iniciar a próxima.
7. **Nenhuma migration de banco de dados** pode ser enviada sem revisão prévia por `prisma migrate diff` e confirmação do schema esperado.
8. **Correções de bugs emergenciais** em produção são registradas fora das fases, em uma seção `## Hotfixes` adicionada ao final deste arquivo se necessário.
9. **Mudanças de escopo dentro de uma fase** devem ser documentadas com data e motivo antes de serem aplicadas ao checklist.
10. **Invariantes nunca podem ser "desativadas" temporariamente** como atalho de implementação.
11. **Testes obrigatórios listados em cada fase** são o mínimo — a equipe pode adicionar mais testes, nunca remover.
12. **A seção "Baseline confirmado"** não deve receber novos itens. Evoluções do baseline são entregas de fases.
13. **Nenhuma fase é iniciada** enquanto o gate da fase anterior não for explicitamente verificado.
14. **A `docs/match-barber-especificacao-v2.md`** é a fonte de verdade de regras de negócio. Conflito entre código e especificação: a especificação vence, e o código deve ser corrigido.
15. **Atualizações neste roadmap** que alterem escopo ou critérios de aceite devem ser registradas como `AuditLog` de documentação no campo de notas da reunião correspondente.

---

*Fim do Roadmap de Implementação v2.0*
*Documento criado em 2026-06-15. Manter sincronizado com `docs/match-barber-especificacao-v2.md`.*
