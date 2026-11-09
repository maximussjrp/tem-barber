# Runbook Operacional Definitivo — Deploy Seguro e Rollback dos Sorteios V1 (Tem Barber)

> **Missão de Referência:** `TEMBARBER_SORTEIOS_V1_FINAL_RUNBOOK_AND_MERGE`  
> **Escopo:** Módulo de Marketing — Sorteios Comerciais Auditáveis V1 (`CustomerSweepstake`)  
> **Regra Operacional:** Este documento descreve o procedimento homologado. **Nenhuma etapa na VPS pode ser executada sem autorização expressa do proprietário no respectivo gate.**

---

## 1. Estado Confirmado pelo GitHub (Arquivos Versionados no Repositório)

As informações abaixo foram verificadas diretamente nos arquivos versionados do repositório:

### 1.1. Migration Prisma Versionada
- **Nome exato da migration:** `20261106140000_add_marketing_customer_sweepstakes`
- **Caminho:** `prisma/migrations/20261106140000_add_marketing_customer_sweepstakes/migration.sql`
- **Natureza 100% aditiva:**
  - Cria os enums `SweepstakeParticipationMode`, `SweepstakeCustomerSegment`, `SweepstakeStatus` e `SweepstakeDrawMethod`.
  - Cria as tabelas `customer_sweepstakes`, `customer_sweepstake_prizes`, `customer_sweepstake_participants`, `customer_sweepstake_chance_origins`, `customer_sweepstake_tickets`, `customer_sweepstake_winners` e `customer_sweepstake_draw_audits`, além de índices de suporte (`appointments_barbershop_id_status_date_time_idx` e `comanda_items_comanda_id_type_status_completed_at_idx`).
  - **Não remove, não renomeia e não altera** colunas preexistentes de `Appointment`, `Comanda`, `CustomerClubSubscription`, `ClubSubscriptionPayment`, `ClubBenefitUsage` ou módulos financeiros/comissões.

### 1.2. Infraestrutura Declarada nos Arquivos Versionados (`deployment/docker-compose.yml`, `deployment/Dockerfile` e `deployment/Caddyfile`)
> **Importante:** Os itens abaixo refletem o que está declarado nos arquivos versionados no GitHub. Não assumir que a VPS utiliza apenas os defaults do arquivo sem confirmar a identidade real do projeto Compose em produção (Seção 2).

- **Serviços declarados no Compose versionado (3 serviços; NÃO há serviço Redis):**
  1. `postgres`
     - `image`: `postgres:16-alpine`
     - `container_name`: `tem-barber-postgres`
     - Variáveis: `POSTGRES_USER: ${POSTGRES_USER:-tem_barber_user}`, `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}`, `POSTGRES_DB: ${POSTGRES_DB:-tem_barber}`
     - Sem portas expostas no host (`# No ports exposed to host for database security`).
  2. `app`
     - `build`: `context: ..`, `dockerfile: deployment/Dockerfile` (`node:20-alpine` multi-stage)
     - `container_name`: `tem-barber-app`
     - `CMD` do `deployment/Dockerfile`: `["npx", "next", "start", "-p", "3000"]` (**Nota crítica:** o `Dockerfile` executa `npx prisma generate` e `npm run build` no estágio `builder`, mas **não** executa `npx prisma migrate deploy` automaticamente no `CMD`).
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
  - **Atenção:** O Docker Compose prefixa os nomes finais dos volumes e imagens no host com o nome do projeto Compose ativo (ex.: `deployment_tem_barber_postgres_data` quando executado com `-p deployment`). Nunca presumir o nome físico do volume ou da imagem sem inspeção prévia na VPS.

### 1.3. Scripts Homologados de Backup e Restauração (`deployment/scripts/`)
- `deployment/scripts/backup-postgres.sh` e `deployment/scripts/restore-postgres.sh` (versionados no GitHub):
  - Utilizam `set -Eeuo pipefail` e `docker exec -i` (sem `-t`).
  - Usam por padrão `DB_CONTAINER=tem-barber-postgres` e leem `POSTGRES_USER` / `POSTGRES_DB` diretamente do container em execução (fallback `tem_barber_user` / `tem_barber`), permitindo override explícito via variáveis de ambiente (`BACKUP_DIR`, `DB_CONTAINER`, `DB_USER`, `DB_NAME`, `RETENTION_DAYS`).
  - Gravam em arquivo temporário `.tmp.$$`, validam `gzip -t`, validam cabeçalho (`PostgreSQL database dump`) e rodapé (`PostgreSQL database dump complete`) via `awk`, geram manifesto `.sha256` obrigatório e nunca sobrescrevem arquivos preexistentes.
  - Em `restore-postgres.sh`, validam arquivo, checksum `.sha256`, `gzip -t`, marcadores SQL e conectividade **antes** de qualquer alteração no banco, bloqueiam `FORCE_RESTORE=true` em containers/bancos de produção e executam a restauração com `psql -v ON_ERROR_STOP=1 --single-transaction`.

### 1.4. Risco Residual Documentado do Histórico do Clube (`CLUB_HISTORICAL_RESIDUAL_RISK` & `CLUB_ONLY_TEMPORAL_SEMANTICS`)
- O motor (`isCustomerClubMemberInPeriod`) exige `paidAt < endExclusiveUtc` em `ClubSubscriptionPayment` (`status = "PAID"`), `ClubBenefitUsage` (`status = "APPLIED"`, `reversedAt = null`) no período, ou assinatura atualmente em `ACTIVE`/`GRACE_PERIOD` cujo ciclo atual cubra o período.
- **Não** é utilizada janela heurística de 31 dias anteriores a `startInclusiveUtc` sobre `ClubSubscriptionPayment.paidAt`, pois a tabela `club_subscription_payments` armazena apenas `paidAt` e `competence` (`YYYY-MM`), sem `periodStart`, `periodEnd` ou `gracePeriodEnd`.
- **Semântica temporal pendente de decisão de negócio (`CLUB_ONLY_TEMPORAL_SEMANTICS=PENDING_BUSINESS_DECISION`):** permanece registrada como decisão futura de produto definir se a elegibilidade ao segmento `CLUB_ONLY` deve ser avaliada na data exata de cada atendimento elegível (`performedAt`) com persistência de `periodStartSnapshot`/`periodEndSnapshot` em `ClubSubscriptionPayment`, ou no intervalo geral da campanha.

---

## 2. Estado da Produção Ainda Não Verificado (Inspeção Read-Only Obrigatória no Gate `VPS_READ_ONLY_PREFLIGHT`)

Como nenhuma conexão à VPS foi realizada até o momento, os itens abaixo **NÃO devem ser presumidos** exclusivamente a partir do Compose versionado e precisarão ser confirmados por inspeção **somente de leitura** no próximo gate:

1. **Identidade Real do Docker Compose e Arquivo de Ambiente:**
   - Operações históricas na VPS utilizaram `-p deployment` e `--env-file deployment/.env` (ex.: `docker compose -p deployment --env-file deployment/.env -f deployment/docker-compose.yml ...`).
   - É obrigatório confirmar na VPS, via labels dos containers em execução (`com.docker.compose.project`, `com.docker.compose.project.working_dir`, `com.docker.compose.project.config_files`) e inspeção read-only do diretório, se `-p deployment` e `--env-file deployment/.env` continuam sendo os parâmetros ativos, evitando recriação acidental de rede/volumes com outro nome de projeto.
2. **Imagem Real do Container `app` em Execução:**
   - Não presumir que a imagem atual se chama `tem-barber-app:latest` (com `-p deployment`, o nome padrão gerado pelo Compose costuma ser `deployment-app:latest` ou equivalente).
   - Confirmar o `Image ID` (`sha256:...`) e a `Config.Image` reais do container `app` em execução via `docker inspect`.
3. **Política de Retenção e Script de Backup Existente na VPS:**
   - Antes de atualizar o repositório na VPS, o arquivo local `deployment/scripts/backup-postgres.sh` na VPS ainda estará na versão anterior ao commit de endurecimento.
   - Além disso, é obrigatório verificar na VPS qual diretório de backups (`BACKUP_DIR`), agendamentos (`crontab` / timers) e política de retenção (`RETENTION_DAYS`) estão efetivamente configurados em produção, preservando a política existente.
4. **Caminho do Repositório, Branch Ativa, `PROD_PREV_SHA` e `Caddyfile`:**
   - Confirmar diretório do repositório, `git status --short --branch`, SHA em execução (`PROD_PREV_SHA`) e eventuais diferenças locais em `deployment/Caddyfile`.
5. **Nomes Reais dos Containers, Volumes Físicos e Banco PostgreSQL:**
   - Confirmar via `docker ps`, `docker volume ls` e `docker inspect` os nomes exatos dos containers (`tem-barber-postgres`, `tem-barber-app`, `tem-barber-caddy`), dos volumes montados em `/var/lib/postgresql/data` e `/app/public/uploads`, e das variáveis `POSTGRES_USER` / `POSTGRES_DB`.
6. **Estado Atual das Migrations e Espaço Livre em Disco:**
   - Confirmar via `npx prisma migrate status` quais migrations já constam em `_prisma_migrations` e verificar espaço livre em disco (`df -h`).

### Comandos Read-Only de Inspeção para o Gate `VPS_READ_ONLY_PREFLIGHT` (Executar Somente Quando Autorizado)
```bash
# Somente leitura — NÃO altera containers, banco, volumes ou arquivos
pwd && git status --short --branch && git rev-parse HEAD
docker compose ls
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
docker inspect -f '{{.Name}} | project={{index .Config.Labels "com.docker.compose.project"}} | workdir={{index .Config.Labels "com.docker.compose.project.working_dir"}} | config={{index .Config.Labels "com.docker.compose.project.config_files"}} | image={{.Config.Image}} ({{.Image}})' $(docker ps -q)
docker volume ls
docker inspect -f '{{.Name}} -> Mounts: {{range .Mounts}}{{.Name}}:{{.Destination}} {{end}}' $(docker ps -q)
ls -la /var/backups/tembarber 2>/dev/null || true
crontab -l 2>/dev/null || true
df -h
```

---

## 3. Procedimentos que Exigirão Autorização Expressa

Nenhuma das ações abaixo pode ser executada sem autorização específica do proprietário em seu respectivo gate:

1. **Gate `VPS_READ_ONLY_PREFLIGHT`:** conexão SSH à VPS exclusivamente para leitura e confirmação dos parâmetros reais da Seção 2.
2. **Gate de Backup Pré-Deploy e Preparação de Rollback na VPS:** obtenção segura do script de backup homologado sem tocar no worktree ativo, geração e validação do backup pré-deploy e criação validada da tag de rollback da imagem Docker atual.
3. **Gate de Build, Migration Prévia e Troca Controlada da Aplicação:**
   - Atualização do código, build da nova imagem, execução e validação da migration `20261106140000_add_marketing_customer_sweepstakes` **antes** de substituir o container `app` anterior, e posterior recriação de `app`.
4. **Habilitação eventual de Simulação Técnica em Produção (Desabilitada por Padrão):**
   - Em produção (`NODE_ENV=production`), simulações técnicas permanecem **bloqueadas por padrão**. Sua abertura exigiria decisão expressa adicionando `SWEEPSTAKE_ENABLE_TECH_SIMULATION=true` e `SWEEPSTAKE_TECH_SIMULATION_ALLOWED_USERS=<id_ou_email>` no ambiente do servidor.
5. **Qualquer Operação de Rollback ou Restauração de Banco:**
   - **Jamais** executar restauração destrutiva de banco (`restore-postgres.sh`) como procedimento automático ou sem autorização explícita do proprietário.

---

## 4. Condições Objetivas de GO / NO-GO

### Critérios Obrigatórios para GO (Prosseguir com o Deploy)
- [ ] **GO-1 (Inspeção Read-Only Confirmada):** Identidade do projeto Compose (ex.: `-p deployment`), caminho do `--env-file` (ex.: `deployment/.env`), nomes de containers e volumes físicos confirmados na VPS.
- [ ] **GO-2 (Worktree e Containers Estáveis):** `git status` na VPS limpo (sem modificações conflitantes) e containers `postgres`, `app` e `caddy` em execução estável.
- [ ] **GO-3 (Espaço em Disco):** Espaço livre em disco na partição de `/var/lib/docker` e do diretório de backups `>= 5 GB` (ou `>= 20%`).
- [ ] **GO-4 (Imagem de Rollback Preservada e Validada):** Identificação do `Image ID` real do container `app` em execução, criação da tag de rollback (`tem-barber-app-rollback:<PROD_PREV_SHA_CURTO>`) e confirmação via `docker image inspect` concluídas com código `0`.
- [ ] **GO-5 (Backup Pré-Deploy Homologado e Verificado):** Execução do script homologado de backup concluída com código `0`, preservando os backups existentes, com arquivo `.sql.gz` não vazio, `gzip -t` aprovado e `sha256sum -c` validado sobre o arquivo `.sha256`.
- [ ] **GO-6 (Migration Aplicada e Validada Antes da Troca do App):** `npx prisma migrate deploy` e `npx prisma migrate status` executados com sucesso na nova imagem antes de substituir o container `app` em execução.
- [ ] **GO-7 (Trava de Simulação em Produção):** Variável `SWEEPSTAKE_ENABLE_TECH_SIMULATION` ausente ou definida como `false` no arquivo `.env` de produção.

### Critérios Imediatos de NO-GO (Parada Obrigatória)
- **NO-GO-1:** Qualquer falha ao identificar o `Image ID` atual do container `app` ou ao criar/verificar a tag Docker de rollback (`docker tag` / `docker image inspect`). **Proibido ignorar falhas com `|| true`.**
- **NO-GO-2:** Falha na obtenção, validação sintática, execução ou verificação (`gzip -t` / `.sha256`) do backup pré-deploy.
- **NO-GO-3:** Divergência nos parâmetros do Compose/volumes ou erro em `npx prisma migrate deploy` / `npx prisma migrate status` (neste caso, como a migration roda em container efêmero antes do `up -d app`, o container `app` antigo permanece em execução sem impacto).
- **NO-GO-4:** Container `app` reiniciando em loop (`Restarting`) após a troca, ou falha de resposta na porta interna `3000` (`/login`) e via Caddy (`https://app.tembarber.com.br/login`).
- **NO-GO-5:** Qualquer regressão funcional pós-subida em Agenda (`/admin/agendamentos`), Comandas (`/admin/comandas`), Clube (`/admin/clube`), Financeiro (`/admin/financeiro`), Comissões (`/admin/comissoes`) ou Uploads (`/uploads/...`).

---

## 5. Sequência Controlada de Preparação e Deploy (Somente Após Confirmação na VPS e Autorização)

> **Nota:** As variáveis `COMPOSE_PROJECT` (ex.: `deployment`), `ENV_FILE` (ex.: `deployment/.env`), `APP_CONTAINER` (ex.: `tem-barber-app`), `DB_CONTAINER` (ex.: `tem-barber-postgres`), `BACKUP_DIR` (ex.: `/var/backups/tembarber`) e `EXISTING_RETENTION_DAYS` abaixo devem ser preenchidas com os valores exatos confirmados no gate `VPS_READ_ONLY_PREFLIGHT`. Todos os comandos devem ser executados com `set -Eeuo pipefail`.

### 5.1. Etapa 1 — Identificação e Preservação Obrigatória da Imagem de Rollback (Sem `|| true`)
```bash
set -Eeuo pipefail

COMPOSE_PROJECT="deployment"          # Confirmar no gate read-only da VPS
ENV_FILE="deployment/.env"            # Confirmar no gate read-only da VPS
APP_CONTAINER="tem-barber-app"        # Confirmar no gate read-only da VPS
DB_CONTAINER="tem-barber-postgres"    # Confirmar no gate read-only da VPS

PROD_PREV_SHA="$(git rev-parse HEAD)"
[ -n "${PROD_PREV_SHA}" ]
echo "PROD_PREV_SHA=${PROD_PREV_SHA}"

# Obter o Image ID real em execução no container app (NÃO presumir tem-barber-app:latest)
APP_RUNNING_IMAGE_ID="$(docker inspect -f '{{.Image}}' "${APP_CONTAINER}")"
APP_RUNNING_IMAGE_REF="$(docker inspect -f '{{.Config.Image}}' "${APP_CONTAINER}")"
[ -n "${APP_RUNNING_IMAGE_ID}" ]
echo "Imagem em execução: ${APP_RUNNING_IMAGE_REF} (${APP_RUNNING_IMAGE_ID})"

# Taggear a imagem exata para rollback imediato e validar sua existência (qualquer falha = NO-GO imediato)
ROLLBACK_IMAGE_TAG="tem-barber-app-rollback:${PROD_PREV_SHA:0:12}"
docker tag "${APP_RUNNING_IMAGE_ID}" "${ROLLBACK_IMAGE_TAG}"
docker image inspect "${ROLLBACK_IMAGE_TAG}" >/dev/null
echo "✔ Imagem de rollback preservada e verificada: ${ROLLBACK_IMAGE_TAG}"
```

### 5.2. Etapa 2 — Obtenção Segura do Script Endurecido e Backup Pré-Deploy (Antes de Alterar o Worktree)
Como o worktree da VPS ainda está em `PROD_PREV_SHA` antes do deploy, o script `backup-postgres.sh` endurecido deve ser extraído de `origin/master` após `git fetch origin` para um arquivo temporário exclusivo em `/tmp`, **sem iniciar o deploy, sem alterar o worktree ativo e sem sobrescrever arquivos existentes**:

```bash
set -Eeuo pipefail

# 1. Buscar objetos remotos no Git (não modifica o worktree nem os containers em execução)
git fetch origin
TARGET_RELEASE_SHA="$(git rev-parse origin/master)"
echo "TARGET_RELEASE_SHA=${TARGET_RELEASE_SHA}"

# 2. Extrair o script homologado para caminho temporário único (garantindo que não sobrescreve arquivo existente)
TMP_BACKUP_SCRIPT="/tmp/tembarber-backup-predeploy-${TARGET_RELEASE_SHA:0:12}-$$.sh"
if [ -e "${TMP_BACKUP_SCRIPT}" ]; then
  echo "❌ ERRO (NO-GO): Arquivo temporário ${TMP_BACKUP_SCRIPT} já existe." >&2
  exit 1
fi
git show "${TARGET_RELEASE_SHA}:deployment/scripts/backup-postgres.sh" > "${TMP_BACKUP_SCRIPT}"
chmod 700 "${TMP_BACKUP_SCRIPT}"

# 3. Validar sintaxe bash e registrar checksum do script extraído antes de executar
bash -n "${TMP_BACKUP_SCRIPT}"
sha256sum "${TMP_BACKUP_SCRIPT}"

# 4. Executar o backup pré-deploy preservando integralmente os backups existentes na VPS:
#    Usa-se RETENTION_DAYS=36500 na captura pré-deploy (ou o valor confirmado da política da VPS)
#    para impedir que a rotação remova backups históricos antes da confirmação da política da VPS.
BACKUP_DIR="/var/backups/tembarber" \
DB_CONTAINER="${DB_CONTAINER}" \
RETENTION_DAYS="36500" \
  "${TMP_BACKUP_SCRIPT}"

rm -f "${TMP_BACKUP_SCRIPT}"

# 5. Validar o backup recém-gerado antes de prosseguir (qualquer falha = NO-GO imediato)
LATEST_BACKUP="$(ls -1t /var/backups/tembarber/db_backup_*.sql.gz | head -n 1)"
[ -s "${LATEST_BACKUP}" ]
[ -s "${LATEST_BACKUP}.sha256" ]
(cd /var/backups/tembarber && sha256sum -c "$(basename "${LATEST_BACKUP}.sha256")")
gzip -t "${LATEST_BACKUP}"
echo "✔ Backup pré-deploy íntegro e verificado: ${LATEST_BACKUP}"
```

### 5.3. Etapa 3 — Build da Nova Imagem e Aplicação da Migration ANTES de Substituir a Aplicação
Para garantir que a aplicação nova **nunca seja iniciada antes que a migration `20261106140000_add_marketing_customer_sweepstakes` esteja aplicada e validada**, e ao mesmo tempo preservar o container `app` anterior em execução até o instante final da troca:

```bash
set -Eeuo pipefail

# 1. Atualizar o worktree para a master homologada
git checkout master
git pull --ff-only origin master
chmod +x ./deployment/scripts/backup-postgres.sh ./deployment/scripts/restore-postgres.sh

# 2. Construir APENAS a nova imagem do serviço `app`
#    (O container `tem-barber-app` anterior permanece em execução com a imagem antiga durante o build)
docker compose -p "${COMPOSE_PROJECT}" --env-file "${ENV_FILE}" -f deployment/docker-compose.yml build app

# 3. Aplicar e validar a migration 20261106140000_add_marketing_customer_sweepstakes ANTES de subir o novo `app`:
#    Usa-se `docker compose run --rm --no-deps --name ...` para executar um container efêmero com a nova imagem
#    na mesma rede e com o mesmo DATABASE_URL do Compose, sem colidir com `container_name: tem-barber-app`
#    e sem interromper o container `app` anterior.
#    (Se a migration falhar, o container `app` anterior continua rodando intacto -> NO-GO imediato).
docker compose -p "${COMPOSE_PROJECT}" --env-file "${ENV_FILE}" -f deployment/docker-compose.yml \
  run --rm --no-deps --name "tem-barber-migrate-${TARGET_RELEASE_SHA:0:8}" app \
  npx prisma migrate deploy

docker compose -p "${COMPOSE_PROJECT}" --env-file "${ENV_FILE}" -f deployment/docker-compose.yml \
  run --rm --no-deps --name "tem-barber-migrate-status-${TARGET_RELEASE_SHA:0:8}" app \
  npx prisma migrate status

# 4. SOMENTE após a confirmação de sucesso da migration acima, substituir o container `app`:
docker compose -p "${COMPOSE_PROJECT}" --env-file "${ENV_FILE}" -f deployment/docker-compose.yml \
  up -d --no-deps app

# 5. Verificação imediata de prontidão e logs
docker ps --filter "name=${APP_CONTAINER}"
docker logs --tail 80 "${APP_CONTAINER}"
docker compose -p "${COMPOSE_PROJECT}" --env-file "${ENV_FILE}" -f deployment/docker-compose.yml \
  exec -T app wget --spider -S http://127.0.0.1:3000/login
```

---

## 6. Estratégia de Rollback Sem Perda de Dados Posteriores ao Deploy

> **PROIBIÇÃO ABSOLUTA:** O rollback destrutivo de banco (`restore-postgres.sh`) **NÃO** é procedimento padrão nem automático de rollback. Sobrescrever o banco com o backup pré-deploy descartaria agendamentos, comandas, pagamentos e lançamentos financeiros criados após o deploy.

### 6.1. Procedimento Padrão de Rollback (Camada de Aplicação Docker — Zero Perda de Dados)
Como a migration `20261106140000_add_marketing_customer_sweepstakes` é **100% aditiva** (apenas novas tabelas/enums `customer_sweepstake*` e índices de leitura), o código e a imagem anteriores (`PROD_PREV_SHA` / `${ROLLBACK_IMAGE_TAG}`) são totalmente compatíveis com o banco já migrado:

```bash
set -Eeuo pipefail

# 1. Confirmar que a imagem de rollback preservada na Etapa 5.1 está disponível localmente
docker image inspect "${ROLLBACK_IMAGE_TAG}" >/dev/null

# 2. Restaurar a tag da imagem do serviço `app` do projeto Compose para a imagem de rollback validada
#    (onde APP_RUNNING_IMAGE_REF foi capturado na Etapa 5.1, ex.: deployment-app:latest)
docker tag "${ROLLBACK_IMAGE_TAG}" "${APP_RUNNING_IMAGE_REF}"

# 3. Voltar o worktree para o SHA anterior confirmado antes do deploy e recriar apenas o container `app`
git checkout "${PROD_PREV_SHA}"
docker compose -p "${COMPOSE_PROJECT}" --env-file "${ENV_FILE}" -f deployment/docker-compose.yml \
  up -d --no-deps --no-build app

# 4. Confirmar saúde da aplicação revertida
docker logs --tail 50 "${APP_CONTAINER}"
docker compose -p "${COMPOSE_PROJECT}" --env-file "${ENV_FILE}" -f deployment/docker-compose.yml \
  exec -T app wget --spider -S http://127.0.0.1:3000/login
```

- **Tratamento da migration aditiva já aplicada:** Manter as tabelas `customer_sweepstake*` intactas no banco. **Não** executar `DROP TABLE` nem reverter o banco.
- **Preservação de dados pós-deploy:** 100% dos agendamentos, comandas, pagamentos do Clube, comissões, transações financeiras e arquivos no volume de uploads gerados após o deploy permanecem integralmente preservados.

### 6.2. Recuperação de Banco em Falha Catastrófica (Exclusivamente Mediante Autorização Humana Expressa)
Caso ocorra uma falha catastrófica de infraestrutura no banco e o proprietário autorize expressamente uma restauração:
1. **Antes de qualquer restauração**, se o sistema tiver recebido tráfego após o deploy, executar primeiro um novo backup do estado atual (ou exportar o delta de registros com `created_at >= '<TIMESTAMP_DO_DEPLOY>'`) para não perder movimentações pós-deploy.
2. Parar o container `app` (`docker compose -p "${COMPOSE_PROJECT}" --env-file "${ENV_FILE}" -f deployment/docker-compose.yml stop app`) para encerrar conexões ativas.
3. Executar manualmente `./deployment/scripts/restore-postgres.sh "${LATEST_BACKUP}"` (que exigirá confirmação interativa digitando `SIM`, validará `.sha256`, `gzip -t` e marcadores SQL antes de tocar no schema e executará a restauração inteira em transação única `ON_ERROR_STOP=1 --single-transaction`).
