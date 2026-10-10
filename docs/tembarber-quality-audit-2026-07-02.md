# Auditoria Geral de Qualidade — Tem Barber

Data: 2026-07-02
Workspace: `D:\Projetos AI\Match Barber`
Remote: `https://github.com/maximussjrp/tem-barber.git`
Branch: `master`
HEAD auditado: `6b8028c12d61b3ba2086ec299fa01a3239b1a894`
Produção: `https://app.tembarber.com.br` (Docker + Caddy + PostgreSQL, Next.js 16.2.9)

Escopo: auditoria técnica e de produto, somente leitura. Nenhuma correção foi implementada. Nenhuma migration executada. Produção não foi alterada.

---

## 1. Resumo executivo

Pronto para vender? **PARCIAL.**

O núcleo transacional do produto é sólido e maduro: isolamento multi-tenant consistente por sessão, transações atômicas, idempotência real em booking e finalização de comanda, controle de concorrência com advisory lock + serializable, e regras financeiras/estoque/comissão/clube bem cobertas por testes de integração. Isso sustenta operação real de barbearias com segurança financeira.

Porém, há riscos que impedem uma venda ampla e seseveramente responsável (inclusive LGPD) sem correção prévia:

- **Login do cliente sem verificação de posse do telefone** (passwordless com match exato de telefone e auto-criação): conhecer um número permite assumir a conta e ver histórico de agendamentos daquele cliente. Risco de privacidade/tomada de conta (P0).
- **Auto-cadastro público de barbearia sem verificação nem rate limit**: qualquer pessoa cria tenant + OWNER, que passa a ser listável publicamente após primeiro acesso. Foi a origem provável dos resíduos Smoke/Test/Temp e de barbearias com dados placeholder em produção (P1). Evidência viva: em produção `zovisk-cortes` aparece com `city: "Cidade Exemplo"`, que é exatamente o default do endpoint de registro.
- **Integridade de estoque em cancelamentos** (sem reversão automática em alguns caminhos) (P1).
- **Booking não valida se o profissional executa o serviço** (P1).
- **Ausência total de rate limiting** nas rotas públicas (P1/P2).
- Um conjunto de P2 de precisão operacional/financeira (timezone do resumo diário, recálculo de fechamento APROVADO, lançamentos manuais fora do caixa, enforcement de horário de trabalho na criação) e P3 de UX/robustez.

Principais riscos:
1. Privacidade/tomada de conta de clientes (P0).
2. Abuso de cadastro público e exposição de tenants incompletos/de teste (P1).
3. Inconsistências pontuais de estoque em cancelamento (P1).
4. Regras de agendamento incompletas no backend (P1).
5. Falta de rate limiting e de camadas anti-abuso (P1/P2).

Recomendação final: **GO condicional.** Vender para uma base inicial controlada de clientes é viável, mas o P0 de autenticação do cliente e os P1 de cadastro público, estoque e validação de agendamento devem entrar em um Sprint 1 curto antes de escalar vendas e antes de qualquer campanha de aquisição pública.

---

## 2. Achados por severidade

Legenda de severidade:
- P0: bloqueia venda ampla/produção segura; risco de segurança, privacidade ou perda de dados.
- P1: corrigir antes de vender para mais clientes.
- P2: corrigir em roadmap curto.
- P3: melhoria.

### P0

#### P0-1 — Login de cliente permite assumir conta de terceiros pelo telefone
- Severidade: P0
- Área: Autenticação / Privacidade / LGPD
- Arquivo/rota: [src/lib/auth.ts](src/lib/auth.ts#L38) (fluxo `loginType === "client"`); consumo em [src/app/api/client/appointments/route.ts](src/app/api/client/appointments/route.ts#L15)
- Evidência: no `authorize`, o cliente é resolvido por `prisma.user.findFirst({ where: { phone: cleanPhone } })` e, se existir, a sessão daquele usuário é retornada independentemente do nome informado; se não existir, o usuário é criado automaticamente. Não há OTP/SMS nem qualquer prova de posse do número.
- Impacto comercial: exposição de dados pessoais de clientes (histórico de agendamentos, barbearias frequentadas, datas, serviços). Violação de expectativa de privacidade e risco LGPD; incidente reputacional sério para um SaaS vendido a terceiros.
- Risco técnico: tomada de conta trivial conhecendo um telefone (dado facilmente obtido). `/api/client/appointments` e `/api/client/linked-barbershops` retornam tudo daquele `customerId`.
- Proposta de correção: introduzir verificação de posse por OTP (SMS/WhatsApp) no primeiro acesso e ao trocar de dispositivo; ou emitir link mágico por WhatsApp. Enquanto não houver OTP, restringir o que a sessão de cliente expõe e exigir contexto de barbearia. Unificar normalização de telefone com `phoneLookupVariants`.
- Precisa migration? Não para o mínimo (pode usar tabela de OTP nova depois; a mitigação imediata é de fluxo). Verificação por OTP robusta pode exigir migration futura.
- Testes necessários: unit/integration de authorize rejeitando login sem OTP válido; teste de que sessão de cliente não expõe dados sem verificação; teste de normalização única de telefone.

### P1

#### P1-1 — Auto-cadastro público de barbearia sem verificação e sem rate limit
- Severidade: P1 (borderline P0 para campanhas públicas)
- Área: Segurança / Anti-abuso / Qualidade de dados / Multi-tenant
- Arquivo/rota: [src/app/api/auth/register/route.ts](src/app/api/auth/register/route.ts#L47)
- Evidência: rota `POST` pública, sem auth, sem captcha, sem rate limit, cria `User` + `Barbershop` + `OWNER` + serviço/horários padrão. Endereço recebe placeholders (`city: "Cidade Exemplo"`, `street: "Rua Não Cadastrada"`). Em produção, `zovisk-cortes` aparece publicamente com `city: "Cidade Exemplo"`, confirmando tenant incompleto listado.
- Impacto comercial: spam de tenants, poluição da listagem pública, exposição de barbearias de teste/incompletas ao cliente final; foi a origem provável do incidente Smoke/Test/Temp.
- Risco técnico: criação ilimitada de registros; slugs e dados sem validação real; primeiro acesso do OWNER cria `TenantSubscription` TRIAL via `getOrCreateSubscription`, tornando o tenant publicamente listável mesmo sem onboarding completo.
- Proposta de correção: exigir verificação de e-mail/telefone antes de ativar; adicionar rate limit por IP; exigir onboarding mínimo (endereço real, ao menos 1 serviço, logo) antes de `publicListed`; considerar flag explícita `publicListed`/`isTest`/`environment` (governança definitiva). Não listar publicamente tenants com dados placeholder.
- Precisa migration? Não para rate limit/verificação por fluxo. Sim (opcional) se adicionar `publicListed`/`isTest`/`environment`.
- Testes necessários: registro sem verificação não fica público; rate limit retorna 429; listagem pública exclui tenant com placeholder/onboarding incompleto.

#### P1-2 — Estoque não é revertido ao cancelar item após finalização / cancelamento de comanda depende de passo manual
- Severidade: P1
- Área: Estoque / Financeiro
- Arquivo/rota: baixa em [src/lib/operations/payments.ts](src/lib/operations/payments.ts#L294); cancelamento de item em [src/app/api/admin/comandas/[id]/items/[itemId]/route.ts](src/app/api/admin/comandas/[id]/items/[itemId]/route.ts#L36); bloqueio em cancelamento de agendamento em [src/app/api/admin/appointments/[id]/route.ts](src/app/api/admin/appointments/[id]/route.ts#L201)
- Evidência: a baixa de estoque cria `StockMovement` do tipo SALE na finalização de forma idempotente e correta; porém o cancelamento de item (`status = CANCELLED`) reverte benefício de clube mas não cria movimento de reversão de estoque. Se o item for cancelado após a comanda fechada, o estoque não é restaurado. O cancelamento de agendamento é bloqueado quando há `stockMovements`, empurrando a reversão para um fluxo manual de estorno.
- Impacto comercial: divergência de inventário; relatórios de estoque incorretos; atrito operacional.
- Risco técnico: perda silenciosa de acurácia de estoque; ausência de transação compensatória.
- Proposta de correção: ao cancelar item de comanda já fechada, criar `StockMovement` de reversão e reincrementar `currentStock` na mesma transação; padronizar reversão de estoque no cancelamento/estorno de comanda.
- Precisa migration? Não.
- Testes necessários: cancelar item pós-finalização restaura estoque exatamente uma vez; estorno de comanda com produto restaura estoque; idempotência da reversão.

#### P1-3 — Agendamento não valida se o profissional executa os serviços solicitados
- Severidade: P1
- Área: Agenda
- Arquivo/rota: público [src/app/api/public/barbershop/[slug]/book/route.ts](src/app/api/public/barbershop/[slug]/book/route.ts#L270); admin [src/app/api/admin/appointments/route.ts](src/app/api/admin/appointments/route.ts#L337)
- Evidência: o membro é validado por `id + barbershopId + isActive`, sem verificar `BarberService` (relação profissional↔serviço). A operação de comanda valida executor↔serviço, mas a criação de agendamento não — inconsistência.
- Impacto comercial: cliente agenda serviço que o profissional não realiza; retrabalho, cancelamentos, insatisfação.
- Risco técnico: dado inconsistente entre agenda e capacidade real de execução.
- Proposta de correção: exigir `services: { some: { serviceId: { in: serviceIds } } }` na validação do membro (ou permitir explicitamente membros sem serviços vinculados, se essa for a regra de negócio, de forma consciente).
- Precisa migration? Não.
- Testes necessários: booking rejeita profissional que não executa o serviço; admin idem; caso de owner sem serviços vinculados conforme regra.

#### P1-4 — Ausência de rate limiting em rotas públicas sensíveis
- Severidade: P1 (para `register`/`client-lookup`), P2 (demais)
- Área: Segurança / Anti-abuso
- Arquivo/rota: [src/app/api/auth/register/route.ts](src/app/api/auth/register/route.ts#L47), [src/app/api/public/client-lookup/route.ts](src/app/api/public/client-lookup/route.ts#L6), [src/app/api/public/barbershop/[slug]/book/route.ts](src/app/api/public/barbershop/[slug]/book/route.ts)
- Evidência: nenhuma implementação de rate limit no código; apenas menções em docs/roadmap e `it.todo("rotas publicas aplicam rate limit")` em [src/__tests__/known-gaps.test.ts](src/__tests__/known-gaps.test.ts#L5). Redis está disponível no compose mas não é usado para limitar.
- Impacto comercial: enumeração de telefones no `client-lookup` (privacidade), spam de cadastro, abuso de booking.
- Risco técnico: brute force/enumeração; custo de infra; poluição de dados.
- Proposta de correção: rate limit por IP e por `customerPhone` usando o Redis existente; 429 com mensagem segura.
- Precisa migration? Não.
- Testes necessários: 429 após threshold; lookup limitado por telefone/IP.

### P2

#### P2-1 — Middleware de páginas não está ativo (arquivo `proxy.ts` fora da convenção)
- Severidade: P2
- Área: Segurança (defense-in-depth) / Configuração
- Arquivo/rota: [src/proxy.ts](src/proxy.ts#L1); [next.config.ts](next.config.ts#L1) vazio; não existe `middleware.ts`.
- Evidência: o Next.js carrega middleware apenas de `middleware.ts`. O arquivo se chama `proxy.ts`, então o `withAuth`/matcher não executa. A proteção de páginas hoje depende exclusivamente dos guards de layout ([src/app/admin/layout.tsx](src/app/admin/layout.tsx#L9) usa `requireAdmin`; [src/app/member/layout.tsx](src/app/member/layout.tsx#L9) usa `requireMember`), o que cobre as áreas atuais.
- Impacto comercial: baixo hoje; risco futuro se uma nova página admin/member for criada sem guard de layout.
- Risco técnico: perda da camada global de proteção e do redirecionamento por papel (BARBER → /member/agenda).
- Proposta de correção: renomear para `middleware.ts` (ou `src/middleware.ts`) e validar matcher; manter guards de layout como defesa em profundidade.
- Precisa migration? Não.
- Testes necessários: e2e de acesso não autenticado a /admin e /member redirecionando; BARBER bloqueado em /admin.

#### P2-2 — Resumo financeiro diário usa fronteira UTC em vez do dia local (UTC-3)
- Severidade: P2
- Área: Financeiro / Relatórios
- Arquivo/rota: [src/app/api/admin/financial/daily-summary/route.ts](src/app/api/admin/financial/daily-summary/route.ts#L11)
- Evidência: `start/end` calculados em `Date.UTC(...)` 00:00–23:59, enquanto a operação é BR (UTC-3). Transações após 21:00 BR caem no dia seguinte do relatório.
- Impacto comercial: fechamento de caixa/dia divergente do operacional.
- Proposta de correção: usar meia-noite local (offset -3) nas fronteiras; tratar DST se aplicável.
- Precisa migration? Não. Testes: somatórios por dia local corretos em bordas 21:00–23:59 BR.

#### P2-3 — Fechamento de clube APROVADO pode ser recalculado
- Severidade: P2
- Área: Clube / Financeiro
- Arquivo/rota: [src/lib/operations/club.ts](src/lib/operations/club.ts#L589); [src/app/api/admin/clube/settlements/calculate/route.ts](src/app/api/admin/clube/settlements/calculate/route.ts#L28)
- Evidência: recálculo bloqueia status `PAID`, mas `APPROVED` é deletado e recriado; mudança de pagamentos altera rateio silenciosamente sem trilha de auditoria.
- Impacto comercial: barbeiro pode perder repasse sem histórico.
- Proposta de correção: bloquear recálculo em `APPROVED` (422) e/ou registrar auditoria/estado “congelado”.
- Precisa migration? Não (opcional para log de auditoria). Testes: APPROVED não recalcula; auditoria registrada.

#### P2-4 — Lançamentos financeiros manuais não exigem caixa aberto
- Severidade: P2
- Área: Caixa / Financeiro
- Arquivo/rota: [src/app/api/admin/financial/entries/route.ts](src/app/api/admin/financial/entries/route.ts#L139)
- Evidência: `MANUAL_IN`/`MANUAL_OUT` são criados sem exigir sessão de caixa aberta; entram no resumo diário, mas sem vínculo/reconciliação com caixa.
- Impacto comercial: caixa reportado pode divergir do físico.
- Proposta de correção: exigir caixa aberto (ou vincular explicitamente) para lançamentos de dinheiro; documentar a política.
- Precisa migration? Não. Testes: MANUAL_IN de dinheiro sem caixa é bloqueado/vinculado.

#### P2-5 — Regras de horário de trabalho/TimeOff não são aplicadas na criação do agendamento
- Severidade: P2
- Área: Agenda
- Arquivo/rota: disponibilidade em [src/lib/appointments/availability.ts](src/lib/appointments/availability.ts#L73); criação pública/admin sem revalidar.
- Evidência: a disponibilidade respeita jornada e TimeOff apenas para a UI; a criação não revalida servidor-side, permitindo bypass fora do horário.
- Impacto comercial: agendamentos fora de expediente.
- Proposta de correção: revalidar jornada/TimeOff na criação (público e admin).
- Precisa migration? Não. Testes: criação fora da jornada/TimeOff rejeitada.

#### P2-6 — PWA global (`start_url: "/"`) sem escopo por barbearia
- Severidade: P2
- Área: PWA / UX
- Arquivo/rota: [public/manifest.json](public/manifest.json#L6); mitigação em [src/app/page.tsx](src/app/page.tsx#L19), [src/app/(auth)/login/page.tsx](src/app/(auth)/login/page.tsx#L106), [src/app/[slug]/agendar/page.tsx](src/app/[slug]/agendar/page.tsx#L127)
- Evidência: manifest global sem `scope`/service worker; contexto de barbearia é mantido via `localStorage`/cookie e redirecionamento em standalone (hotfix recente). Não há manifest contextual por slug.
- Impacto comercial: app instalado abre no contexto global; experiência “app da barbearia” depende do fallback de slug salvo.
- Proposta de correção: decidir estratégia (PWA por barbearia com manifest dinâmico e `scope`, ou PWA global com escolha segura). Persistência de contexto já implementada ajuda.
- Precisa migration? Não. Testes: instalação a partir do slug abre no contexto correto; sem exposição de tenants indevidos.

#### P2-7 — Lacunas conhecidas: histórico de status e rate limit marcados como `todo`
- Severidade: P2
- Área: Auditoria/Observabilidade e Testes
- Arquivo/rota: [src/__tests__/known-gaps.test.ts](src/__tests__/known-gaps.test.ts#L4)
- Evidência: `it.todo("toda alteracao de status gera historico")` e `it.todo("rotas publicas aplicam rate limit")`. Não há `AppointmentStatusLog`/`AuditLog` genérico.
- Impacto comercial: dificuldade de rastrear mudanças e disputas.
- Proposta de correção: implementar log de status/auditoria; ativar rate limit (ver P1-4).
- Precisa migration? Sim para tabelas de log/auditoria. Testes: cada mudança de status gera registro.

### P3

- P3-1 — Cliente público criado com nome padrão "Cliente" quando ausente ([src/lib/customers.ts](src/lib/customers.ts#L150) e fluxo de booking): qualidade de dados. Migration: não.
- P3-2 — Offset UTC-3 fixo (sem DST) em utilitários de tempo ([src/lib/time-utils.ts](src/lib/time-utils.ts)): robustez. Migration: não.
- P3-3 — Regra temporal de `PAST_DUE` na listagem pública é replicada em SQL ([src/lib/public-barbershops.ts](src/lib/public-barbershops.ts#L15)) e não reutiliza o helper oficial `isSubscriptionActive` ([src/lib/subscription-utils.ts](src/lib/subscription-utils.ts#L11)); risco de divergência futura. Migration: não.
- P3-4 — `client-lookup` retorna `phoneHint` que confirma indiretamente existência/ausência de telefone; combinar com rate limit para reduzir enumeração. Migration: não.
- P3-5 — Sem constraint de banco para “um único caixa OPEN por barbearia” (garantido só em app + serializable) ([src/lib/operations/cash.ts](src/lib/operations/cash.ts)): robustez. Migration: sim (índice parcial único) se adotado.

---

## 3. Mapa de fluxos críticos

- Agenda: disponibilidade respeita jornada/TimeOff (UI); criação com overlap protegido por advisory lock + serializable e testes de concorrência (forte). Lacunas: validação profissional↔serviço (P1-3) e enforcement de jornada na criação (P2-5).
- Comanda: finalização atômica, idempotente, pagamentos validados (exato/misto), CASH exige caixa aberto; baixa de estoque idempotente. Lacuna: reversão de estoque no cancelamento (P1-2).
- Caixa: uma sessão OPEN por barbearia (app-level), pagamentos vinculados a caixa e a lançamento financeiro; estorno com trilha. Lacunas: lançamentos manuais fora do caixa (P2-4) e timezone do resumo (P2-2).
- Comissão: hierarquia de config com snapshot; serviço incluso no clube não gera comissão tradicional; desconto sobre base líquida; troca de executor pago bloqueada (409); reversão proporcional transacional. Estado: forte.
- Clube: UNLIMITED sem saldo numérico; MONTHLY_LIMIT com saldo correto; `ClubBenefitUsage`/`ClubPointEntry` criados só na finalização e idempotentes por `comandaItemId`; assinatura sobreposta bloqueada; carry-over correto. Lacuna: recálculo de fechamento APROVADO (P2-3).
- Login cliente/PWA: fluxo passwordless com contexto de slug preservado (hotfix). Risco central: ausência de verificação de posse do telefone (P0-1) e PWA global (P2-6).
- Platform admin: PUT de assinatura restrito a `isPlatformAdmin(email)`; guards de acesso admin/member validam assinatura via `isSubscriptionActive`; tenant suspenso bloqueado no admin e fora da listagem pública. Estado: adequado.
- Agendamento público: valida barbearia ativa + assinatura ativa + serviços ativos + idempotência; escopo por slug (não confia em body). Lacuna: profissional↔serviço (P1-3) e rate limit (P1-4).

---

## 4. Checklist “pronto para venda”

Verde (sólido):
- Isolamento multi-tenant por sessão (nenhuma rota admin confia em `body.barbershopId`).
- Transações atômicas em finalização/booking; idempotência real.
- Concorrência de agenda (advisory lock + serializable + retry) com testes.
- Comissão e Clube: regras corretas e bem testadas.
- Guards de assinatura (TRIAL/ACTIVE/PAST_DUE-grace) e bloqueio de suspensos.
- Listagem pública já filtra Smoke/Test/Temp e status bloqueados (hotfix aplicado e em produção).

Amarelo (corrigir em roadmap curto):
- Middleware `proxy.ts` não ativo (P2-1).
- Timezone do resumo diário (P2-2).
- Recálculo de fechamento APROVADO (P2-3).
- Lançamentos manuais fora do caixa (P2-4).
- Enforcement de jornada na criação (P2-5).
- Estratégia de PWA por barbearia (P2-6).
- Logs de status/auditoria (P2-7).

Vermelho (bloqueia venda ampla):
- Verificação de posse do telefone no login do cliente (P0-1).
- Auto-cadastro público sem verificação/rate limit (P1-1).
- Reversão de estoque em cancelamentos (P1-2).
- Validação profissional↔serviço no agendamento (P1-3).
- Rate limiting em rotas públicas (P1-4).

---

## 5. Plano de correção sugerido

Sprint 1 (P0 + P1 — pré-requisito para escalar vendas):
1. P0-1: verificação por OTP (SMS/WhatsApp) no login do cliente; unificar normalização de telefone; limitar exposição da sessão de cliente.
2. P1-1: verificação de e-mail/telefone no registro + rate limit; não listar tenants incompletos/placeholder; iniciar governança `publicListed`.
3. P1-2: reversão transacional de estoque em cancelamento de item/comanda.
4. P1-3: validação profissional↔serviço em booking público e admin.
5. P1-4: rate limit (Redis) em `register`, `client-lookup`, `book`.

Sprint 2 (P2 importantes):
6. P2-1: renomear middleware para `middleware.ts` e validar matcher.
7. P2-2: fronteiras de dia local no resumo financeiro.
8. P2-3: bloquear/auditar recálculo de fechamento APROVADO.
9. P2-4: política de caixa para lançamentos manuais.
10. P2-5: enforcement de jornada/TimeOff na criação.

Sprint 3 (qualidade/UX/premium):
11. P2-6: definição e implementação da estratégia PWA por barbearia.
12. P2-7: `AppointmentStatusLog`/`AuditLog`.
13. P3-1..P3-5: qualidade de dados, DST, unificação de regra de assinatura, hardening de enumeração, constraint de caixa único.

---

## 6. Recomendações de testes

Criar:
- OTP de cliente: rejeita login sem verificação; aceita com código válido; expira/reenvia.
- Registro público: sem verificação não fica público; 429 após threshold; onboarding incompleto não listado.
- Estoque: cancelar item pós-finalização restaura estoque; estorno de comanda restaura; reversão idempotente.
- Agenda: booking/admin rejeitam profissional que não executa o serviço; criação fora de jornada/TimeOff bloqueada.
- Financeiro: resumo diário correto em bordas 21:00–23:59 BR; lançamento manual de dinheiro exige/vincula caixa.
- Clube: fechamento APROVADO não recalcula; auditoria registrada.

Ativar/padronizar:
- Rate limit (remover `it.todo` de [src/__tests__/known-gaps.test.ts](src/__tests__/known-gaps.test.ts#L5) ao implementar).
- Histórico de status (remover `it.todo` correspondente ao implementar).
- Smoke tests públicos padronizados que não deixem resíduos em produção (usar ambiente/tenant de teste isolado, nunca o banco de produção).

Observações sobre a suíte atual:
- Os testes de integração usam `describe.skip` quando `TEST_DATABASE_URL` não é válido; com o banco de teste configurado, executam de fato (validado nesta base). Sem o banco, passam “por ausência” — padronizar CI para sempre prover `TEST_DATABASE_URL`.
- `known-gaps.test.ts` contém apenas `it.todo` (2), refletindo lacunas reais (histórico de status e rate limit).

---

## 7. Confirmações

- Não implementou correções: confirmado.
- Não fez commit: confirmado (apenas este relatório foi criado em `docs/`, sem `git commit`).
- Não fez push: confirmado.
- Não fez deploy: confirmado.
- Não alterou produção: confirmado (consultas de produção foram somente leitura).
- Não rodou migration: confirmado.
- Não expôs `.env`, secrets, tokens ou dados sensíveis de clientes: confirmado.
