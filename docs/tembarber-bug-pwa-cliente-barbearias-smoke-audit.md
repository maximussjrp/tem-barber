# Auditoria - PWA/Login Cliente exibindo barbearias Smoke/Test

Data da auditoria: 2026-07-02

## 1. Workspace confirmado

- Workspace: `D:\Projetos AI\Match Barber`
- Remote: `https://github.com/maximussjrp/tem-barber.git`
- Branch: `master`
- HEAD: `e299199474b8165464ae6d0f78783349dbe20711`
- Package: `match-barber`
- Next.js: `16.2.9`

Tambem foram encontradas no codigo as strings esperadas do produto/fluxo: `TEM BARBER`, `Sou Cliente`, `Sou Barbearia`, `Entrar para Agendar`, `Nao encontramos uma barbearia vinculada a este telefone`, `don-brio`, `agendar`, `comandas` e `clube`.

## 2. Arquivos auditados

- `src/app/(auth)/login/page.tsx`
- `src/app/api/public/client-lookup/route.ts`
- `src/app/api/public/barbershops/route.ts`
- `src/app/[slug]/agendar/page.tsx`
- `src/app/api/public/barbershop/[slug]/route.ts`
- `src/app/api/public/barbershop/[slug]/book/route.ts`
- `src/lib/auth.ts`
- `src/lib/customers.ts`
- `src/app/layout.tsx`
- `public/manifest.json`
- `src/proxy.ts`
- `src/__tests__/login.ui.test.tsx`
- `prisma/schema.prisma`

Por regra local do projeto, a documentacao local do Next em `node_modules/next/dist/docs/` foi consultada antes da analise de rotas/PWA, especialmente App Router, Route Handlers, Metadata e PWA.

## 3. Rota/tela do login cliente

A tela do print e renderizada por `src/app/(auth)/login/page.tsx`, rota `/login`.

O componente possui duas abas controladas por query string:

- `Sou Cliente`: padrao quando `tab` nao e `admin`.
- `Sou Barbearia`: ativa quando `?tab=admin` ou `?registered=true`.

No fluxo `Sou Cliente`, o botao `Entrar para Agendar` executa `handleClientSubmit`.

Passos do submit:

1. Remove tudo que nao e digito de `clientPhone`.
2. Rejeita apenas se tiver menos de 10 digitos.
3. Chama `POST /api/public/client-lookup` com body `{ name: clientName, phone: clientPhone }`.
4. Se a API retornar `linkedBarbershops.length > 0`, faz `signIn("credentials", { loginType: "client", name, phone })`.
5. Se houver `callbackUrl`, redireciona para ele.
6. Se houver uma barbearia vinculada, redireciona para `/${slug}/agendar`.
7. Se houver multiplas, redireciona para `/minha-conta`.
8. Se nao houver vinculo, seta `showDiscovery=true`.

Quando `showDiscovery=true`, a propria pagina chama `GET /api/public/barbershops` e renderiza a mensagem:

> Nao encontramos uma barbearia vinculada a este telefone.

Logo abaixo, lista as barbearias retornadas pela API publica e cada card aponta para `/${p.slug}/agendar`.

Conclusao: a listagem apos telefone sem vinculo e fallback intencional no codigo atual. Isso esta coberto por teste em `src/__tests__/login.ui.test.tsx`: o caso "lookup sem barbearias vinculadas nao realiza login e exibe descoberta de barbearias" espera chamada a `/api/public/barbershops`.

## 4. API usada pelo login cliente

Endpoint: `POST /api/public/client-lookup`

Arquivo: `src/app/api/public/client-lookup/route.ts`

Body enviado pelo frontend:

```json
{ "name": "...", "phone": "(79) 88240-050" }
```

Regra atual:

- Exige `phone`.
- Normaliza localmente com `phone.replace(/\D/g, "")`.
- Rejeita apenas se o resultado tiver menos de 10 digitos.
- Busca `User` por igualdade exata: `where: { phone: cleanPhone }`.
- Se nao encontrar usuario, retorna `{ linkedBarbershops: [] }`.
- Se encontrar usuario, busca barbearias vinculadas por:
  - `Appointment.customerId = user.id`
  - `Comanda.customerId = user.id`
- Deduplica por `barbershop.id`.
- Retorna `{ linkedBarbershops }`.

O endpoint nao lista todas as barbearias. Quem lista todas e a tela `/login` depois que recebe `linkedBarbershops: []`.

Filtros ausentes no `client-lookup`:

- Nao filtra barbearia inativa nos vinculos retornados.
- Nao verifica assinatura/tenant ativo.
- Nao filtra slug real.
- Nao filtra nomes Smoke/Test/Temp.
- Nao usa a funcao compartilhada `normalizePhone` de `src/lib/customers.ts`.
- Nao trata DDI `55`.
- Nao tenta equivalencia com nono digito.

## 5. API/listagem publica de barbearias

Endpoint: `GET /api/public/barbershops`

Arquivo: `src/app/api/public/barbershops/route.ts`

Regra atual:

```ts
where: {
  active: true,
}
```

Campos retornados:

- `slug`
- `name`
- `logoUrl`
- `coverUrl`
- `city`
- `neighborhood`
- `latitude`
- `longitude`

Problema: a API publica lista toda barbearia com `active=true`. Ela nao filtra:

- tenant/assinatura ativa;
- `TenantSubscription.status`;
- barbearias criadas por smoke/test;
- slugs temporarios;
- barbearias sem configuracao real;
- dados duplicados de teste;
- nomes contendo `Smoke`, `Test` ou `Temp`.

Isso explica por que qualquer `Barbearia Smoke Test Temp` ativa em producao apareceria para cliente final no fallback do login.

## 6. PWA / app instalado

Manifest declarado em `src/app/layout.tsx`:

```ts
manifest: "/manifest.json"
```

Manifest real em `public/manifest.json`:

```json
{
  "name": "Tem Barber",
  "short_name": "Tem Barber",
  "theme_color": "#050505",
  "background_color": "#050505",
  "display": "standalone",
  "start_url": "/"
}
```

Achados:

- `start_url` e `/`.
- Nao ha `scope` explicito.
- Nao foi encontrado `public/sw.js`, `service-worker.js`, registro de `navigator.serviceWorker`, `beforeinstallprompt` ou fallback de navegacao customizado.
- Nao foi encontrada persistencia de barbearia escolhida via `localStorage`.
- Nao ha logica para redirecionar `/` para a ultima barbearia acessada.
- A home `/` tem CTA `Agendar Agora` para `/login`, nao para um slug especifico.

Conclusao PWA: se o app for instalado com esse manifest global, ao abrir pelo icone ele tende a iniciar em `/`, perdendo o contexto `/don-brio/agendar`. Como `start_url` e global, a instalacao feita a partir da pagina da Don Brio nao garante retomada em `/don-brio/agendar`.

Pergunta principal:

- O codigo atual aponta para a alternativa A: o app instalado abre em `https://app.tembarber.com.br/`, por causa de `start_url: "/"`.
- Nao ha evidencia no codigo de `start_url` dinamico para B: `https://app.tembarber.com.br/don-brio/agendar`.
- A rota global de cliente C aparece depois que o usuario toca em `Agendar Agora` e entra em `/login`.

## 7. Rota publica da barbearia

Tela: `src/app/[slug]/agendar/page.tsx`

Esse fluxo usa `useParams()` para ler `slug` e todas as chamadas publicas preservam esse contexto:

- `GET /api/public/barbershop/${slug}`
- `GET /api/public/barbershop/${slug}/availability`
- `POST /api/public/barbershop/${slug}/book`

O fluxo por slug nao depende do telefone para descobrir a barbearia. O telefone serve para identificar/criar cliente e confirmar o agendamento naquela barbearia.

No backend de booking:

- `src/app/api/public/barbershop/[slug]/book/route.ts` busca `barbershop` por `{ slug, active: true }`.
- Verifica assinatura com `getOrCreateSubscription` e `isSubscriptionActive`.
- Usa `normalizePhone` de `src/lib/customers.ts`, que remove DDI `55` quando o numero tem 12 ou 13 digitos.
- Se nao houver usuario, `resolveBarbershopCustomerForBooking` pode criar cliente automaticamente.

Conclusao: se o cliente entra diretamente em `/don-brio/agendar`, o sistema deveria manter Don Brio como contexto. O risco esta no PWA instalado abrir em `/`, ou no cliente usar a home/login global, nao na rota `/${slug}/agendar`.

## 8. Normalizacao de telefone

Telefone do print: `(79) 88240-050`

Digitos: `7988240050` (10 digitos).

Observacoes:

- O input do login global limita a 11 digitos, mas aceita 10.
- A mascara com 10 digitos fica estranha: `(79) 88240-050`, porque sempre formata como 2 + 5 + restante.
- O login global considera valido qualquer telefone com pelo menos 10 digitos.
- O sistema nao exige 11 digitos para celular brasileiro.
- O login global nao adiciona nem remove o nono digito.
- O `client-lookup` busca igualdade exata em `users.phone`.
- Se o usuario estiver salvo como `79988240050`, uma entrada `7988240050` nao encontra.
- Se o usuario estiver salvo com DDI `557988240050`, o `client-lookup` tambem nao encontra.
- `src/lib/customers.ts` tem uma normalizacao melhor para DDI `55`, mas ela nao e usada no `client-lookup` nem no authorize do login global.

Classificacao do numero: com DDD + 8 digitos, `7988240050` e compativel com telefone de 10 digitos, mas nao com o formato usual de celular brasileiro atual com 11 digitos (`79 9xxxx-xxxx`). Se o numero real for celular, provavelmente esta incompleto ou foi digitado sem o nono digito.

Mensagem atual:

- Menos de 10 digitos: `Telefone invalido. Informe o DDD + Numero.`
- 10 digitos: passa na validacao e pode falhar silenciosamente como "sem vinculo".

## 9. Dados Smoke/Test/Temp

Foi feita consulta somente leitura no banco configurado em `.env`.

Importante: o `DATABASE_URL` local aponta para `localhost:5439`, banco `match_barber`, usuario `match_barber_user`. Portanto esta consulta nao comprova o estado de producao real, a menos que esse banco seja um snapshot fiel de producao.

Resultado da base local configurada:

- Total de barbearias: `0`
- Barbearias ativas: `0`
- Barbearias com nome/slug contendo `Smoke`, `Test` ou `Temp`: `0`
- Barbearias Smoke/Test/Temp que a API publica incluiria: `0`
- Don Brio encontrada por slug/nome: `0`
- Cliente/nome/telefone parecido com Maykon/Viola ou `7988240050`: `0`
- Vinculos de candidatos com Don Brio: `0`

Conclusao: nao foi possivel auditar dados reais de producao com o acesso disponivel nesta workspace. Para fechar o item de producao, e necessario acesso read-only ao banco real ou dump/snapshot atualizado.

## 10. Smoke tests / residuos

No codigo de aplicacao nao foi encontrado script que crie explicitamente `Barbearia Smoke Test Temp`.

Ocorrencias encontradas:

- `src/__tests__/login.ui.test.tsx` usa `Smoke Premium` como mock de barbearia vinculada.
- `src/__tests__/sidebar.ui.test.tsx` usa nomes Smoke em testes de UI.
- Outros testes usam nomes de smoke em dados mockados.

Esses testes unitarios nao deveriam criar dados em producao. A existencia de `Barbearia Smoke Test Temp` em producao, se confirmada no banco real, provavelmente vem de smoke test externo, automacao de deploy/CI, teste manual em ambiente errado ou cadastro real feito com nome temporario.

## 11. Causa raiz provavel

Classificacao:

- A) PWA `start_url "/"` perde slug da barbearia: provavel.
- B) Login cliente global lista barbearias indevidas: confirmado no codigo como fallback intencional, mas inseguro.
- C) Dados `Smoke Test Temp` ficaram ativos em producao: provavel pela evidencia visual, nao confirmado no banco real por falta de acesso.
- D) Telefone digitado/normalizado nao encontra cliente: provavel, pois `(79) 88240-050` tem 10 digitos e a busca e exata.
- E) Cliente nao esta vinculado a Don Brio: possivel, nao confirmado no banco real.
- F) API publica nao filtra tenants/barbearias de teste: confirmado.
- G) Fluxo de instalacao PWA esta errado: provavel, dado `start_url: "/"`.
- H) Rota publica `/[slug]/agendar` redireciona indevidamente para login global: nao confirmado; o codigo dessa rota preserva slug.

Causa raiz composta mais provavel:

1. Cliente instalou/abriu PWA global que inicia em `/`, nao em `/don-brio/agendar`.
2. Ao usar `/login`, o telefone informado nao encontrou usuario/vinculo por busca exata e validacao permissiva.
3. O fallback global de descoberta carregou `/api/public/barbershops`.
4. A API publica retornou todas as barbearias `active=true`, incluindo residuos Smoke/Test/Temp em producao.

## 12. Proposta de hotfix minimo

### A) Correcao imediata

- Alterar `GET /api/public/barbershops` para nao retornar barbearias de teste em producao.
- Exigir assinatura/tenant publicamente agendavel, reaproveitando a mesma regra de `isSubscriptionActive` usada nas rotas por slug.
- Ocultar barbearias sem slug valido, sem owner ativo ou sem configuracao minima publica.
- Remover ou restringir o fallback do login global:
  - preferivel: quando telefone nao tem vinculo, mostrar mensagem segura e pedir link/codigo da barbearia;
  - alternativa: manter descoberta, mas somente com tenants verificados e nunca com dados de teste.
- Fazer limpeza operacional dos dados Smoke/Test/Temp em producao com backup, lista de IDs, aprovacao e auditoria. Nao deletar direto sem plano.

### B) Correcao PWA

- Revisar `public/manifest.json`.
- Se o produto for PWA por barbearia, gerar manifest contextual por slug com `start_url` apontando para `/${slug}/agendar` e `scope` adequado.
- Se o PWA for global, manter `start_url: "/"`, mas a home/login nao pode expor tenants de teste e deve oferecer escolha segura.
- Considerar persistir ultima barbearia acessada localmente e redirecionar somente quando o contexto for confiavel e explicito.

### C) Correcao telefone

- Criar normalizacao unica e usar em todos os fluxos: login global, `client-lookup`, NextAuth credentials e booking.
- Tratar DDI `55`.
- Validar celular brasileiro de forma clara:
  - aceitar 10 digitos apenas se regra de negocio permitir fixo/legado;
  - para celular, orientar 11 digitos.
- Para telefone de 10 digitos como `(79) 88240-050`, exibir mensagem amigavel de numero possivelmente incompleto em vez de cair no fallback global.
- Se for aceitavel procurar equivalencia com/sem nono digito, fazer isso de forma deterministica e testada.

### D) Correcao UX

- Se o cliente entrou por `/don-brio/agendar`, telefone deve identificar/criar cliente, nao descobrir barbearia.
- Se o telefone nao existir, permitir continuar cadastro/agendamento naquela barbearia.
- Se o login global nao souber a barbearia, nao deve expor dados de tenants indevidos.
- Copy recomendada: "Nao encontramos agendamentos vinculados a este telefone. Acesse pelo link da barbearia ou escolha uma barbearia verificada."

## 13. Migration

Hotfix minimo nao exige migration se for implementado apenas com filtros por campos existentes (`active`, `TenantSubscription.status`, `slug`, relacoes existentes).

Pode exigir migration em uma correcao mais robusta para adicionar flags como:

- `barbershops.isTest`
- `barbershops.publiclyListed`
- `barbershops.environment`
- metadados de origem de smoke test

Recomendacao: hotfix sem migration primeiro; migration/flags depois para governanca permanente.

## 14. Testes necessarios

- Login cliente com telefone vinculado a uma barbearia redireciona para `/${slug}/agendar`.
- Login cliente com telefone vinculado a varias barbearias redireciona para `/minha-conta` ou fluxo definido.
- Login cliente com telefone sem vinculo nao expoe barbearias Smoke/Test/Temp.
- Login cliente com telefone sem vinculo nao lista tenants suspensos/inativos.
- Telefone com mascara e salvo sem mascara encontra usuario.
- Telefone com DDI `55` encontra usuario salvo sem DDI, se essa for a regra.
- Telefone incompleto/10 digitos no formato de celular exibe mensagem clara.
- `/don-brio/agendar` preserva slug em perfil, disponibilidade e booking.
- PWA/manifest: instalacao pela barbearia abre no slug correto, ou app global nao promete contexto de barbearia.
- `GET /api/public/barbershops` nao retorna Smoke/Test/Temp em ambiente de producao.
- `GET /api/public/barbershops` nao retorna barbearias com assinatura suspensa/cancelada/expirada.
- Fallback sem barbearia nao revela dados indevidos.

## 15. Riscos

- Privacidade: listar barbearias vinculadas a um telefone pode revelar relacao do cliente com estabelecimentos. Hoje isso ocorre depois de o usuario informar nome e telefone, mas sem verificacao forte.
- Exposicao de tenants: listar todas as barbearias ativas no fallback global expoe tenants indevidos, inclusive teste/smoke se ativos.
- UX: `start_url: "/"` faz o app instalado parecer app da Don Brio, mas abre Tem Barber global.
- Dados: residuos de smoke em producao indicam falha de isolamento/limpeza de testes, caso a evidencia visual reflita o banco real.
- Telefone: validacao permissiva e comparacao exata geram falso negativo e empurram usuario para fallback publico.

## 16. GO/NO-GO

Recomendacao: GO para implementar hotfix minimo, mas NO-GO para deploy sem antes confirmar dados reais de producao ou, no minimo, aplicar filtros defensivos que independem dessa confirmacao.

Prioridade:

1. Bloquear Smoke/Test/Temp e tenants nao agendaveis em `GET /api/public/barbershops`.
2. Ajustar fallback do login cliente para nao expor listagem publica ampla.
3. Corrigir PWA `start_url`/contexto.
4. Unificar normalizacao/validacao de telefone.
5. Planejar limpeza segura dos residuos de producao com backup e auditoria.

