# Tem Barber - Blueprint Tecnico Faseado

Data: 2026-07-02
Escopo: Seguranca de autenticacao do cliente + preservacao do agendamento publico rapido
Status: Proposta tecnica (sem implementacao)

## 1. Diagnostico

### 1.1 Decisao de produto (base deste blueprint)

- Agendamento publico deve continuar rapido: nome + telefone + servico + horario.
- Nao exigir OTP para agendar.
- Nao exigir senha/documento para agendar.
- Telefone e identificacao leve operacional.
- Telefone sozinho nao pode dar acesso a historico, cancelamento, remarcacao e dados sensiveis.

### 1.2 Problema atual confirmado

Hoje o fluxo cliente em auth permite:

1. Nome + telefone autenticam no NextAuth.
2. Essa autenticacao gera sessao completa.
3. Com essa sessao, APIs de area cliente retornam dados sensiveis.

Arquivo raiz:
- [src/lib/auth.ts](src/lib/auth.ts#L37)

Rotas impactadas por essa sessao:
- [src/app/api/client/appointments/route.ts](src/app/api/client/appointments/route.ts#L8)
- [src/app/api/client/linked-barbershops/route.ts](src/app/api/client/linked-barbershops/route.ts#L12)

Tela que consome essas rotas:
- [src/app/minha-conta/page.tsx](src/app/minha-conta/page.tsx#L70)

Conclusao: o risco P0 nao esta no booking publico; esta na mistura entre "identificacao leve por telefone" e "sessao forte de area cliente".

---

## 2. Auditoria obrigatoria de rotas sensiveis

### 2.1 Rotas que hoje aceitam sessao cliente e dados retornados

1. [src/app/api/client/appointments/route.ts](src/app/api/client/appointments/route.ts#L8)
- Metodo GET: retorna historico completo do cliente autenticado.
- Dados retornados: barbearia (nome/slug/cidade/estado), barbeiro (nome/avatar), servicos, status, notas, review, data/hora, valor.
- Metodo PATCH: permite cancelar agendamento futuro por id (desde que customerId da sessao seja o dono).

2. [src/app/api/client/linked-barbershops/route.ts](src/app/api/client/linked-barbershops/route.ts#L12)
- Metodo GET: retorna `linkedBarbershopIds` de appointments/comandas do usuario autenticado.

3. [src/app/minha-conta/page.tsx](src/app/minha-conta/page.tsx#L70)
- Chama automaticamente as duas APIs acima quando a sessao esta autenticada.

### 2.2 Rotas publicas (nao devem virar area sensivel)

1. [src/app/api/public/client-lookup/route.ts](src/app/api/public/client-lookup/route.ts)
- Deve permanecer com retorno minimo para agendamento.

2. [src/app/api/public/barbershop/[slug]/book/route.ts](src/app/api/public/barbershop/[slug]/book/route.ts#L220)
- Deve continuar aceitando agendamento sem OTP.

3. [src/app/api/public/barbershops/route.ts](src/app/api/public/barbershops/route.ts)
- Lista publica controlada (ja com filtros de status/Smoke/Test/Temp).

---

## 3. Arquitetura alvo (separacao obrigatoria)

### 3.1 Public booking flow (friccao minima)

- Nao cria sessao forte de cliente.
- Pode identificar/reciclar cliente internamente por telefone para uso operacional.
- Nao concede historico/cancelamento/remarcacao.

### 3.2 Client area autenticada/signed

- Requer fator forte diferente de telefone puro:
	- `verified_link` (preferencia de produto), ou
	- `verified_otp`, ou
	- token assinado temporario com escopo.
- So esse nivel acessa:
	- historico,
	- cancelar,
	- remarcar,
	- dados pessoais adicionais.

---

## 4. Fase 1 - Mitigacao rapida P0

Objetivo: fechar risco LGPD sem quebrar agendamento publico rapido.

### 4.1 Mudanca de modelo de sessao cliente (preferencia: separacao forte)

Opcao recomendada: **Separar total** public booking de client area.

- Public booking nao deve depender de `signIn("credentials", loginType="client")` para operar.
- O fluxo de login cliente por telefone em [src/lib/auth.ts](src/lib/auth.ts#L37) deve deixar de emitir sessao capaz de acessar `/api/client/*`.

Alternativas tecnicas aceitas (escolher 1):

1. Opcao A (mais limpa): remover signIn cliente por telefone para area cliente.
2. Opcao B (transicional): manter token, mas marcar `authLevel: "phone_lookup"` e bloquear `/api/client/*` para esse nivel.
3. Opcao C equivalente: claim `clientAccessScope` com deny default para area sensivel.

Impacto de produto:
- `Agendar agora`: igual (sem friccao).
- `Minha conta`: passa a exigir link seguro/codigo.

Arquivos impactados (planejados):
- [src/lib/auth.ts](src/lib/auth.ts)
- [src/app/(auth)/login/page.tsx](src/app/(auth)/login/page.tsx)
- [src/app/minha-conta/page.tsx](src/app/minha-conta/page.tsx)
- [src/app/api/client/appointments/route.ts](src/app/api/client/appointments/route.ts)
- [src/app/api/client/linked-barbershops/route.ts](src/app/api/client/linked-barbershops/route.ts)

Precisa migration? **Nao** (fase minima).

### 4.2 Bloqueio de rotas sensiveis para sessao fraca

Regra alvo:
- `/api/client/appointments` exige `authLevel >= verified_link|verified_otp`.
- `/api/client/linked-barbershops` idem.
- Futuras rotas de cancelar/remarcar tambem.

Comportamento antes:
- qualquer sessao cliente criada com telefone acessa.

Comportamento depois:
- sessao fraca recebe 401/403 com mensagem segura.

Precisa migration? **Nao**.

### 4.3 Client lookup minimalista

Regra:
- manter retorno estritamente operacional para agendar.
- sem historico.
- sem lista de agendamentos.
- sem dados sensiveis extras.

Arquivo:
- [src/app/api/public/client-lookup/route.ts](src/app/api/public/client-lookup/route.ts)

Precisa migration? **Nao**.

### 4.4 Limite operacional (2 futuros por semana)

Regra:
- maximo 2 agendamentos futuros por semana por telefone/cliente por barbearia.
- validacao no backend.
- retorno 422 com copy:
	- "Voce ja possui o limite de agendamentos futuros nesta semana. Fale com a barbearia para ajustar."

Arquivo:
- [src/app/api/public/barbershop/[slug]/book/route.ts](src/app/api/public/barbershop/[slug]/book/route.ts#L220)

Precisao da regra semanal sugerida:
- semana ISO local da barbearia (ou UTC consistente, documentado).
- considerar status ativos (PENDING/CONFIRMED) como consumo.

Precisa migration? **Nao** para regra basica.

### 4.5 Bloqueio de duplicidade de agendamento no mesmo horario

Regra adicional a manter/alinhar:
- impedir mesmo cliente/telefone na mesma barbearia no mesmo horario.
- backend-only (nao confiar frontend).

Arquivo:
- [src/app/api/public/barbershop/[slug]/book/route.ts](src/app/api/public/barbershop/[slug]/book/route.ts#L220)

Observacao:
- ja existe protecao de conflito de agenda por profissional (lock + serializable).
- esta regra adiciona politica por cliente.

Precisa migration? **Nao** (minimo). Opcional indice unico parcial no futuro.

### 4.6 Rate limit publico

Aplicar em:
- `client-lookup`
- `public booking`
- `public barbershops`
- futuro envio de link/codigo

Arquivos alvo:
- [src/app/api/public/client-lookup/route.ts](src/app/api/public/client-lookup/route.ts)
- [src/app/api/public/barbershop/[slug]/book/route.ts](src/app/api/public/barbershop/[slug]/book/route.ts)
- [src/app/api/public/barbershops/route.ts](src/app/api/public/barbershops/route.ts)

Sem Redis (mitigacao temporaria):
- rate limit por janela em memoria por instancia (nao ideal em multi-replica).
- fallback por tabela SQL simples de contagem por chave/janela (com limpeza).

Solucao ideal:
- Redis/Upstash com chave por IP + telefone + slug.
- resposta 429 padronizada.

Precisa migration? **Nao** se Redis puro. **Sim** se optar por tabela SQL de throttle.

---

## 5. Fase 2 - Area do cliente segura

Objetivo: disponibilizar historico/cancelamento/remarcacao com seguranca e baixa friccao.

### 5.1 Mecanismo recomendado

Link seguro temporario (preferencia):
- emissao por WhatsApp/SMS/e-mail.
- token assinado (HMAC/JWT) ou token opaco armazenado.
- expira em curto prazo (ex: 10-30 min).
- escopo limitado (`appointments:read`, `appointments:cancel`, `appointments:reschedule`).

Sem senha, sem documento.

### 5.2 Fluxos da area cliente

1. Ver agendamentos futuros.
2. Cancelar agendamento.
3. Remarcar.
4. Preparar para clube/pacote no futuro.

### 5.3 Endpoints novos/sugeridos (desenho)

- `POST /api/client/access-link/request` (publico + rate limit)
- `GET /api/client/access-link/verify?token=...`
- `GET /api/client/appointments` (somente sessao/token forte)
- `PATCH /api/client/appointments/:id/cancel` (somente forte)
- `PATCH /api/client/appointments/:id/reschedule` (somente forte)

Observacao:
- manter compatibilidade transitoria para nao quebrar front enquanto migra.

Precisa migration? **Opcional**.
- Nao se token assinado sem persistencia (com trade-offs de revogacao).
- Sim se usar tabela de tokens/nonce/revogacao/auditoria (recomendado para maturidade).

---

## 6. Fase 3 - UX final

Objetivo: experiencia clara e sem confusao entre cliente e barbearia.

### 6.1 Jornada proposta

- "Agendar agora" -> fluxo publico direto, sem login.
- "Minha conta" -> pede link seguro temporario.
- "Sou Barbearia" -> login admin tradicional.

### 6.2 Ajustes de UX/copy

- diferenciar "agendamento rapido" de "acesso a historico".
- mensagens explicitas de seguranca sem termos tecnicos.
- evitar que cliente ache que telefone sozinho da acesso total.

Arquivo principal:
- [src/app/(auth)/login/page.tsx](src/app/(auth)/login/page.tsx)

Precisa migration? **Nao**.

---

## 7. Matriz antes/depois (resumo tecnico)

### 7.1 Antes

- Telefone + nome gera sessao cliente plena.
- Sessao cliente acessa `/api/client/appointments` e `/api/client/linked-barbershops`.
- Booking publico rapido.
- Sem rate limit robusto.

### 7.2 Depois (alvo)

- Booking publico continua rapido sem OTP.
- Telefone sozinho nao cria acesso sensivel.
- Area cliente exige sessao/token forte temporario.
- Limite semanal 2 futuros por barbearia.
- Duplicidade mesmo horario bloqueada no backend.
- Rate limit nas rotas publicas.

---

## 8. Testes obrigatorios (plano)

### 8.1 Public booking

1. Agendamento publico funciona sem OTP.
2. Nome+telefone+servico+horario cria agendamento normalmente.

### 8.2 Seguranca de area cliente

3. Telefone sozinho nao acessa historico.
4. Telefone sozinho nao cancela agendamento.
5. Sessao fraca rejeitada em `/api/client/appointments`.
6. Sessao/token forte acessa quando fase 2 estiver implementada.

### 8.3 Lookup e minimizacao

7. `client-lookup` nao retorna historico.
8. `client-lookup` nao retorna lista de agendamentos.

### 8.4 Regras operacionais

9. Maximo 2 agendamentos futuros por semana por barbearia.
10. Terceiro agendamento retorna 422 com mensagem amigavel.
11. Limite e por barbearia (nao global).
12. Duplicado mesmo horario bloqueado no backend.

### 8.5 Regressao

13. Admin/barbearia nao quebra.
14. Clube/comanda nao quebram no fluxo de finalizacao.
15. Agendamento por slug continua preservando contexto.

---

## 9. Riscos de implementacao

1. Quebrar UX do cliente se trocar login sem copy/fluxo claro.
2. Regressao em `minha-conta` durante transicao de sessao fraca para forte.
3. Rate limit agressivo bloquear usuario legitimo (ajuste de thresholds).
4. Limite semanal conflitar com politicas de negocio de algumas barbearias (considerar override administrativo futuro).
5. Tokens assinados sem persistencia dificultam revogacao imediata.

Mitigacoes:
- feature flag por etapa,
- rollout progressivo,
- telemetry de erros 401/403/422/429,
- fallback de suporte manual no inicio.

---

## 10. Arquivos/rotas impactados por fase

### Fase 1

- [src/lib/auth.ts](src/lib/auth.ts)
- [src/app/(auth)/login/page.tsx](src/app/(auth)/login/page.tsx)
- [src/app/api/client/appointments/route.ts](src/app/api/client/appointments/route.ts)
- [src/app/api/client/linked-barbershops/route.ts](src/app/api/client/linked-barbershops/route.ts)
- [src/app/api/public/client-lookup/route.ts](src/app/api/public/client-lookup/route.ts)
- [src/app/api/public/barbershop/[slug]/book/route.ts](src/app/api/public/barbershop/[slug]/book/route.ts)
- [src/app/api/public/barbershops/route.ts](src/app/api/public/barbershops/route.ts)
- [src/lib/customers.ts](src/lib/customers.ts) (helpers de telefone/limite)
- testes em `src/__tests__/...`

### Fase 2

- novas rotas de emissao/verificacao de link seguro (em `src/app/api/client/...`)
- camada de token/session forte para area cliente
- adaptacao de [src/app/minha-conta/page.tsx](src/app/minha-conta/page.tsx)

### Fase 3

- UX de [src/app/(auth)/login/page.tsx](src/app/(auth)/login/page.tsx)
- possivel nova pagina dedicada de "Minha conta"/"Acessar com link"

---

## 11. GO/NO-GO para implementacao

Recomendacao: **GO para implementacao faseada imediata**.

Justificativa:
- Resolve o risco P0 sem comprometer o agendamento rapido.
- Mantem decisao de produto (sem OTP no booking).
- Separa claramente autenticacao leve (operacional) de acesso sensivel.
- Pode ser entregue sem migration na fase inicial.

Ordem sugerida:
1. Fase 1 completa (seguranca + limites + rate limit).
2. Fase 2 (area cliente segura por link/token temporario).
3. Fase 3 (acabamento UX e consolidacao da jornada).

---

## 12. Confirmacoes

- Nao houve implementacao de codigo nesta entrega.
- Nao houve commit.
- Nao houve push.
- Nao houve deploy.
- Nao houve migration.
- Nao houve alteracao de producao.
