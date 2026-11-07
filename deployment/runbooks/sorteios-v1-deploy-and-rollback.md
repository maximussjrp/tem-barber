# Runbook Operacional Definitivo — Deploy Seguro e Rollback dos Sorteios V1 (Tem Barber)

> **Missão de Referência:** `TEMBARBER_SORTEIOS_V1_RUNBOOK_RECONCILIATION`  
> **Escopo:** Módulo de Marketing — Sorteios Comerciais Auditáveis V1 (`CustomerSweepstake`)  
> **Regra Operacional:** Este documento descreve o procedimento homologado. **Nenhuma etapa na VPS pode ser executada sem autorização expressa do proprietário no respectivo gate.**

---

## 1. Estado Confirmado pelo GitHub (Arquivos Versionados no Repositório)

As informações abaixo foram verificadas diretamente nos arquivos versionados do repositório (`master` em `836911b89fc1147f70c3d29ef4f67fe06a63ba6f` + branch local `fix/marketing-sorteios-v1-predeploy-safety`):

### 1.1. Migration Prisma Versionada
- **Nome exato da migration:** `20261106140000_add_marketing_customer_sweepstakes`
- **Caminho:** `prisma/migrations/20261106140000_add_marketing_customer_sweepstakes/migration.sql`
- **Natureza 100% aditiva:**
  - Cria os enums `SweepstakeParticipationMode`, `SweepstakeCustomerSegment`, `SweepstakeStatus` e `SweepstakeDrawMethod`.
  - Cria as tabelas `customer_sweepstakes`, `customer_sweepstake_prizes`, `customer_sweepstake_participants`, `customer_sweepstake_chance_origins`, `customer_sweepstake_tickets`, `customer_sweepstake_winners` e `customer_sweepstake_draw_audits`, além de índices de suporte (`appointments_barbershop_id_status_date_time_idx` e `comanda_items_comanda_id_type_status_completed_at_idx`).
  - **Não remove, não renomeia e não altera** colunas preexistentes de `Appointment`, `Comanda`, `CustomerClubSubscription`, `ClubSubscriptionPayment`, `ClubBenefitUsage` ou módulos financeiros/comissões.

### 1.2. Infraestrutura Declarada em `deployment/docker-compose.yml`, `deployment/Dockerfile` e `deployment/Caddyfile`
- **Serviços declarados no Compose versionado (3 serviços; NÃO há serviço Redis):**
  1. `postgres`
     - `image`: `postgres:16-alpine`
     - `container_name`: `tem-barber-postgres`
     - Variáveis: `POSTGRES_USER: ${POSTGRES_USER:-tem_barber_user}`, `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}`, `POSTGRES_DB: ${POSTGRES_DB:-tem_barber}`
     - Sem portas expostas no host (`# No ports exposed to host for database security`).
  2. `app`
     - `build`: `context: ..`, `dockerfile: deployment/Dockerfile` (`node:20-alpine` multi-stage)
     - `container_name`: `tem-barber-app`
     - `CMD` do `deployment/Dockerfile`: `["npx", "next", "start", "-p", "3000"]` (**Nota importante:** o `Dockerfile` executa `npx prisma generate` e `npm run build` no estágio `builder`, mas **não** executa `npx prisma migrate deploy` automaticamente no `CMD`; a aplicação da migration é um passo explícito e controlado).
     - Sem `ports:` publicados diretamente no host; escuta na porta `3000` da rede interna do Compose.
  3. `caddy`
     - `image`: `caddy:2-alpine`
     - `container_name`: `tem-barber-caddy`
     - Portas no host: `80:80` e `443:443`
     - `deployment/Caddyfile`: roteia `app.tembarber.com.br` via `reverse_proxy app:3000` (o domínio raiz `tembarber.com.br` permanece comentado no arquivo versionado).
- **Volumes lógicos declarados em `deployment/docker-compose.yml`:**
  - `tem_barber_postgres_data` -> montado em `/var/lib/postgresql/data` no serviço `postgres`
  - `tem_barber_uploads` -> montado em `/app/public/uploads` no serviço `app`
  - `caddy_data` -> montado em `/data` no serviço `caddy`
  - `caddy_config` -> montado em `/config` no serviço `caddy`
  - **Atenção:** Os identificadores acima são os nomes lógicos no Compose. O Docker Compose prefixa os nomes finais dos volumes no host com o nome do projeto/diretório (ex.: `<project>_tem_barber_postgres_data`). Nunca presumir o nome físico do volume sem inspeção prévia.

### 1.3. Scripts de Backup e Restauração (`deployment/scripts/`)
- `deployment/scripts/backup-postgres.sh` e `deployment/scripts/restore-postgres.sh`:
  - Utilizam `set -Eeuo pipefail` e `docker exec -i` (sem `-t`).
  - Usam por padrão `DB_CONTAINER=tem-barber-postgres` e leem `POSTGRES_USER` / `POSTGRES_DB` diretamente do container em execução (fallback `tem_barber_user` / `tem_barber`), permitindo override explícito via variáveis de ambiente caso a VPS utilize nomenclatura customizada.
  - Gravam em arquivo temporário `.tmp.$$`, validam `gzip -t`, validam cabeçalho (`PostgreSQL database dump`) e rodapé (`PostgreSQL database dump complete`) via `awk`, geram manifesto `.sha256` obrigatório e preservam arquivos preexistentes em caso de falha.
  - Em `restore-postgres.sh`, validam arquivo, checksum `.sha256`, `gzip -t`, marcadores SQL e conectividade **antes** de qualquer alteração no banco, bloqueiam `FORCE_RESTORE=true` em containers/bancos de produção e executam a restauração com `psql -v ON_ERROR_STOP=1 --single-transaction`.

### 1.4. Risco Residual Documentado do Histórico do Clube (`CLUB_HISTORICAL_RESIDUAL_RISK`)
- O motor (`isCustomerClubMemberInPeriod`) exige `paidAt < endExclusiveUtc` em `ClubSubscriptionPayment` (`status = "PAID"`), `ClubBenefitUsage` (`status = "APPLIED"`, `reversedAt = null`) no período, ou assinatura atualmente em `ACTIVE`/`GRACE_PERIOD` cujo ciclo atual cubra o período.
- **Não** é utilizada janela heurística de 31 dias anteriores a `startInclusiveUtc` sobre `ClubSubscriptionPayment.paidAt`, pois a tabela `club_subscription_payments` armazena apenas `paidAt` e `competence` (`YYYY-MM`), sem `periodStart`, `periodEnd` ou `gracePeriodEnd`. Estimar cobertura retroativa a partir de `startInclusiveUtc - 31d` poderia classificar indevidamente como membro um cliente cujo ciclo pago anterior terminou **antes** da data do atendimento elegível (`performedAt`).
- **Limitação residual conhecida:** clientes que pagaram em competência anterior (`competence < startMonthCompetence`), realizaram atendimento elegível nos dias finais daquele ciclo dentro do mês da campanha sem consumir benefício (`ClubBenefitUsage`) e posteriormente tiveram a assinatura cancelada/expirada ou seu ciclo sobrescrito por renovação futura sem pagamento na competência da campanha não possuem `periodStart`/`periodEnd` históricos gravados em `ClubSubscriptionPayment`.

---

## 2. Estado da Produção Ainda Não Verificado (Inspeção Read-Only Obrigatória na VPS)

Como nenhuma conexão à VPS foi realizada nesta etapa, os itens abaixo **NÃO devem ser presumidos** e precisarão ser confirmados por comandos **somente de leitura** no gate de inspeção pré-deploy na VPS:

1. **Caminho real do repositório e estado do Git na VPS:**
   - Qual diretório hospeda o projeto em produção, qual branch está ativa, qual é o `HEAD` atual (`PROD_PREV_SHA`) e se há alterações locais não commitadas no worktree ou no `deployment/Caddyfile`.
2. **Nomes reais dos containers em execução e projeto Compose:**
   - Confirmar via `docker ps` se os containers seguem literalmente `tem-barber-postgres`, `tem-barber-app` e `tem-barber-caddy` (conforme `deployment/docker-compose.yml`) ou se há prefixo/nome distinto.
3. **Nomes reais dos volumes Docker no host:**
   - Confirmar via `docker volume ls` e `docker inspect` os nomes físicos exatos associados a `/var/lib/postgresql/data` e `/app/public/uploads`.
4. **Variáveis de ambiente efetivas do PostgreSQL (`POSTGRES_USER`, `POSTGRES_DB`):**
   - Confirmar via `docker inspect` / ambiente do container se o banco em produção utiliza os defaults do Compose (`tem_barber_user` / `tem_barber`) ou valores customizados no `.env` da VPS.
5. **Estado atual das migrations em produção:**
   - Confirmar via `npx prisma migrate status` quais migrations já estão aplicadas e se `20261106140000_add_marketing_customer_sweepstakes` é a única pendente.
6. **Espaço em disco disponível e diretório de backups (`/var/backups/tembarber`):**
   - Confirmar via `df -h` o espaço livre real na VPS e permissões de escrita em `/var/backups/tembarber`.

### Comandos Read-Only de Inspeção (Para Execução Futura Quando Autorizado)
```bash
# Somente leitura — NÃO altera containers, banco ou arquivos
pwd && git status --short --branch && git rev-parse HEAD
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
docker volume ls
docker inspect -f '{{.Name}} ->Mounts: {{range .Mounts}}{{.Name}}:{{.Destination}} {{end}}' $(docker ps -q)
df -h
```

---

## 3. Procedimentos que Exigirão Autorização Expressa

Nenhuma das ações abaixo pode ser executada sem autorização específica do proprietário em seu respectivo gate:

1. **Gate de Push e Merge na `master`:** envio do commit da branch `fix/marketing-sorteios-v1-predeploy-safety` para `origin` e fast-forward na `master`.
2. **Gate de Inspeção Read-Only e Backup na VPS:** conexão SSH à VPS, leitura do estado atual e execução de `./deployment/scripts/backup-postgres.sh`.
3. **Gate de Deploy e Migration em Produção:**
   - `git pull --ff-only origin master` na VPS;
   - `docker compose -f deployment/docker-compose.yml build app`;
   - `docker compose -f deployment/docker-compose.yml up -d --no-deps app`;
   - `docker exec -i <APP_CONTAINER> npx prisma migrate deploy` (aplicação da migration aditiva `20261106140000_add_marketing_customer_sweepstakes`).
4. **Habilitação eventual de Simulação Técnica em Produção (Desabilitada por Padrão):**
   - Em produção (`NODE_ENV=production`), simulações técnicas permanecem **bloqueadas por padrão**. Sua abertura exigiria decisão expressa adicionando `SWEEPSTAKE_ENABLE_TECH_SIMULATION=true` e `SWEEPSTAKE_TECH_SIMULATION_ALLOWED_USERS=<id_ou_email>` no ambiente do servidor.
5. **Qualquer Operação de Rollback ou Restauração de Banco:**
   - Mesmo em caso de incidente, **jamais** executar restauração destrutiva de banco (`restore-postgres.sh`) de forma automática ou sem autorização explícita do proprietário.

---

## 4. Condições Objetivas de GO / NO-GO

### Critérios Obrigatórios para GO (Prosseguir com o Deploy)
- [ ] **GO-1:** `git status` na VPS limpo (sem modificações conflitantes não rastreadas em arquivos versionados) e `PROD_PREV_SHA` registrado.
- [ ] **GO-2:** Containers `postgres`, `app` e `caddy` em execução e estáveis antes da janela.
- [ ] **GO-3:** Espaço livre em disco na partição de `/var/lib/docker` e `/var/backups/tembarber` `>= 5 GB` (ou `>= 20%`).
- [ ] **GO-4:** Execução de `./deployment/scripts/backup-postgres.sh` concluída com código `0`, arquivo `.sql.gz` não vazio, `gzip -t` aprovado e `sha256sum -c` validado sobre o arquivo `.sha256`.
- [ ] **GO-5:** `npx prisma migrate status` aponta o schema atual íntegro, tendo apenas `20261106140000_add_marketing_customer_sweepstakes` pendente de aplicação.
- [ ] **GO-6:** Variável `SWEEPSTAKE_ENABLE_TECH_SIMULATION` ausente ou definida como `false` no `.env` de produção (garantindo simulações bloqueadas por padrão).

### Critérios Imediatos de NO-GO (Abortar Antes ou Durante a Janela)
- **NO-GO-1:** Falha na geração ou na verificação (`gzip -t` / `.sha256`) do backup pré-deploy.
- **NO-GO-2:** Divergência de migrations ou erro em `npx prisma migrate deploy`.
- **NO-GO-3:** Container `tem-barber-app` reiniciando em loop (`Restarting`) ou falha ao responder na porta interna `3000` (`/login`) e via Caddy (`https://app.tembarber.com.br/login`).
- **NO-GO-4:** Qualquer regressão funcional nos fluxos críticos pós-subida:
  - Agenda (`/admin/agendamentos`),
  - Comandas (`/admin/comandas`),
  - Clube (`/admin/clube`),
  - Financeiro (`/admin/financeiro`) e Comissões (`/admin/comissoes`),
  - Uploads públicos (`/uploads/...`).

---

## 5. Sequência Controlada de Deploy (Somente Após Autorização do Gate de Deploy)

```bash
# 1. Registrar SHA atual de produção e criar tag de imagem para rollback rápido de aplicação
PROD_PREV_SHA="$(git rev-parse HEAD)"
echo "PROD_PREV_SHA=${PROD_PREV_SHA}"
docker tag tem-barber-app:latest "tem-barber-app:rollback-${PROD_PREV_SHA:0:12}" 2>/dev/null || true

# 2. Executar backup consistente e verificado do PostgreSQL
chmod +x ./deployment/scripts/backup-postgres.sh ./deployment/scripts/restore-postgres.sh
./deployment/scripts/backup-postgres.sh
LATEST_BACKUP="$(ls -1t /var/backups/tembarber/db_backup_*.sql.gz | head -n 1)"
(cd /var/backups/tembarber && sha256sum -c "$(basename "${LATEST_BACKUP}.sha256")")
gzip -t "${LATEST_BACKUP}"

# 3. Atualizar código para a master homologada
git fetch origin
git checkout master
git pull --ff-only origin master

# 4. Construir e atualizar apenas o container da aplicação (preservando volumes e postgres/caddy)
docker compose -f deployment/docker-compose.yml build app
docker compose -f deployment/docker-compose.yml up -d --no-deps app

# 5. Aplicar explicitamente a migration aditiva 20261106140000_add_marketing_customer_sweepstakes
docker compose -f deployment/docker-compose.yml exec -T app npx prisma migrate deploy
docker compose -f deployment/docker-compose.yml exec -T app npx prisma migrate status

# 6. Verificação de prontidão da aplicação e logs
docker ps --filter "name=tem-barber"
docker logs --tail 80 tem-barber-app
docker compose -f deployment/docker-compose.yml exec -T app wget --spider -S http://127.0.0.1:3000/login
```

---

## 6. Estratégia de Rollback Sem Perda de Dados Posteriores ao Deploy

> **PROIBIÇÃO ABSOLUTA:** O rollback destrutivo de banco (`restore-postgres.sh`) **NÃO** é procedimento padrão nem automático de rollback. Sobrescrever o banco com o backup pré-deploy descartaria agendamentos, comandas, pagamentos e lançamentos financeiros criados após o deploy.

### 6.1. Procedimento Padrão de Rollback (Camada de Aplicação Docker — Zero Perda de Dados)
Como a migration `20261106140000_add_marketing_customer_sweepstakes` é **100% aditiva** (apenas novas tabelas/enums `customer_sweepstake*` e índices de leitura), o código anterior (`PROD_PREV_SHA`) é totalmente compatível com o banco já migrado:

```bash
# 1. Voltar o worktree para o SHA anterior confirmado antes do deploy
git checkout "${PROD_PREV_SHA}"

# 2. Reconstruir e subir apenas o container `app` na versão anterior
docker compose -f deployment/docker-compose.yml build app
docker compose -f deployment/docker-compose.yml up -d --no-deps app

# 3. Confirmar saúde da aplicação revertida
docker logs --tail 50 tem-barber-app
docker compose -f deployment/docker-compose.yml exec -T app wget --spider -S http://127.0.0.1:3000/login
```

- **Tratamento da migration aditiva já aplicada:** Manter as tabelas `customer_sweepstake*` intactas no banco. **Não** executar `DROP TABLE` nem reverter o banco.
- **Preservação de dados pós-deploy:** 100% dos agendamentos, comandas, pagamentos do Clube, comissões, transações financeiras e arquivos em `tem_barber_uploads` gerados após o deploy permanecem integralmente preservados.

### 6.2. Recuperação de Banco em Falha Catastrófica (Exclusivamente Mediante Autorização Humana Expressa)
Caso ocorra uma falha catastrófica de infraestrutura no banco e o proprietário autorize expressamente uma restauração:
1. **Antes de qualquer restauração**, se o sistema tiver recebido tráfego após o deploy, executar primeiro um novo `./deployment/scripts/backup-postgres.sh` (ou exportar o delta de registros com `created_at >= '<TIMESTAMP_DO_DEPLOY>'`) para não perder movimentações pós-deploy.
2. Parar o container `app` (`docker compose -f deployment/docker-compose.yml stop app`) para encerrar conexões ativas.
3. Executar manualmente `./deployment/scripts/restore-postgres.sh "${LATEST_BACKUP}"` (que exigirá confirmação interativa digitando `SIM`, validará `.sha256`, `gzip -t` e marcadores SQL antes de tocar no schema e executará a restauração inteira em transação única `ON_ERROR_STOP=1 --single-transaction`).
