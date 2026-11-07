# Runbook Operacional — Deploy Seguro e Rollback dos Sorteios V1 (Tem Barber)

> **Status:** Homologado para execução manual controlada pelo proprietário  
> **Escopo:** Módulo de Marketing — Sorteios Comerciais Auditáveis V1 (`CustomerSweepstake`)  
> **Arquitetura Alvo:** Docker Compose (`tembarber-app`, `tembarber-postgres`, `tembarber-redis`, `tembarber-caddy`)

---

## 1. Pré-Flight Obrigatório na VPS (Somente Leitura + Backup)

### 1.1. Confirmação do SHA Atual em Produção
Antes de atualizar o repositório na VPS, registre o SHA exatamente em execução para permitir rollback imediato de código/imagem se necessário:

```bash
cd /opt/tembarber # (ajustar para o diretório oficial do repositório na VPS)
git status --short --branch
PROD_PREV_SHA="$(git rev-parse HEAD)"
echo "PROD_PREV_SHA=${PROD_PREV_SHA}"

# Taggear a imagem Docker atualmente em execução como fallback imediato
docker tag tembarber-app:latest "tembarber-app:rollback-${PROD_PREV_SHA:0:12}" || true
```

### 1.2. Checagem de Espaço em Disco e Saúde dos Containers
Exigir no mínimo **20% de espaço livre** (ou `>= 5 GB` livres na partição de `/var/lib/docker` e `/var/backups/tembarber`) e todos os containers com status `Up (healthy)`:

```bash
df -h / /var/lib/docker /var/backups/tembarber 2>/dev/null || df -h
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
docker inspect -f '{{.Name}}: status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' \
  tembarber-postgres tembarber-redis tembarber-app tembarber-caddy
```

> **Critério de Parada #1:** Se `tembarber-postgres` ou `tembarber-redis` não estiverem `healthy`, ou se o espaço livre em disco for inferior a 5 GB, **ABORTAR** o deploy antes de qualquer alteração.

### 1.3. Backup Consistente e Verificado do PostgreSQL + Preservação de Volumes
Utilizar o script endurecido `deployment/scripts/backup-postgres.sh` (com `set -Eeuo pipefail`, sem TTY `-t`, verificação `gzip -t`, validação de cabeçalho/rodapé do `pg_dump` e arquivo `.sha256`):

```bash
chmod +x ./deployment/scripts/backup-postgres.sh ./deployment/scripts/restore-postgres.sh
./deployment/scripts/backup-postgres.sh

LATEST_BACKUP="$(ls -1t /var/backups/tembarber/db_backup_*.sql.gz | head -n 1)"
echo "LATEST_BACKUP=${LATEST_BACKUP}"
sha256sum -c "${LATEST_BACKUP}.sha256"
gzip -t "${LATEST_BACKUP}"
```

> **Critério de Parada #2:** Se o script retornar código diferente de `0`, se o `.sha256` não conferir ou se `gzip -t` falhar, **NÃO PROSSEGUIR** com migrations ou deploy.

---

## 2. Validação da Migration Prisma (Natureza Aditiva)

A migration dos Sorteios V1 (`20261106200000_add_customer_sweepstakes_v1`) é **100% aditiva**:
- Cria exclusivamente novos enums (`SweepstakeStatus`, `SweepstakeParticipationMode`, `SweepstakeCustomerSegment`, `SweepstakeDrawMethod`) e novas tabelas (`customer_sweepstakes`, `customer_sweepstake_prizes`, `customer_sweepstake_participants`, `customer_sweepstake_chance_origins`, `customer_sweepstake_tickets`, `customer_sweepstake_winners`, `customer_sweepstake_draw_audits`).
- **Não remove, não renomeia e não altera** colunas existentes de `Appointment`, `Comanda`, `CustomerClubSubscription`, `FinancialTransaction`, `Customer` ou `Barbershop`.

Conferir estado das migrations antes de aplicar:

```bash
docker exec -i tembarber-app npx prisma migrate status
```

---

## 3. Sequência de Build, Migration e Substituição da Aplicação

> **Regra de Ouro:** Nunca utilizar `docker compose down -v`. Os volumes `postgres-data`, `redis-data`, `uploads-data`, `caddy-data` e `caddy-config` devem permanecer intocados.

```bash
# 1. Atualizar código para o commit homologado na master
git fetch origin
git checkout master
git pull --ff-only origin master

# 2. Garantir que simulações técnicas continuem DESABILITADAS em produção (.env)
# (Não definir SWEEPSTAKE_ENABLE_TECH_SIMULATION=true em produção sem autorização formal)
grep -E '^SWEEPSTAKE_' .env || echo "Simulações técnicas desabilitadas por padrão (seguro)."

# 3. Build da nova imagem da aplicação (com cache limpo de camadas de código)
docker compose -f deployment/docker-compose.yml build app

# 4. Subir o novo container da aplicação (o entrypoint executa `npx prisma migrate deploy` antes de `node server.js`)
docker compose -f deployment/docker-compose.yml up -d --no-deps app
```

---

## 4. Health Checks e Verificações Pós-Deploy

### 4.1. Health Check Técnico do Container e Logs de Inicialização
```bash
docker ps --filter "name=tembarber-app"
docker logs --tail 80 tembarber-app
curl -fsS http://127.0.0.1:3000/api/health
```

### 4.2. Checklist de Regressão Funcional (Smoke Tests em Produção)
1. **Agenda (`/admin/agenda`):** abertura da grade diária/semanal, listagem de agendamentos existentes e criação/edição sem erros.
2. **Comandas (`/admin/comandas`):** abertura de comanda, cálculo de itens e fechamento financeiro íntegros.
3. **Clube do Cliente (`/admin/clube`):** listagem de assinaturas vigentes, planos e histórico de pagamentos/usos de benefício.
4. **Financeiro (`/admin/financeiro`):** KPIs de receitas/despesas, fluxo de caixa e comissões sem divergência.
5. **Sorteios V1 (`/admin/marketing/sorteios`):**
   - Listagem e criação de campanha em `DRAFT` funcionando.
   - Simulação técnica e apuração oficial **bloqueadas por padrão em produção** (`APURACAO_OFICIAL_BLOQUEADA_V1` / `SIMULACAO_TECNICA_DESABILITADA`).
6. **Uploads (`/uploads/...`):** logos de barbearias e avatares carregando normalmente a partir do volume `uploads-data`.

---

## 5. Critérios Claros de Parada e Estratégias de Rollback Separadas

Qualquer falha em `prisma migrate deploy`, falha no `/api/health` após 60 segundos, erro HTTP 5xx recorrente nos módulos críticos (Agenda, Comandas, Clube, Financeiro) ou corrupção visual aciona imediatamente o protocolo abaixo conforme o cenário:

### Cenário A — Rollback de Aplicação Docker (Falha de Código/UI/API sem Corrupção de Banco)
Quando a falha está apenas na camada da aplicação Next.js e o banco de dados continua íntegro:

```bash
# Reverter o código para o SHA anterior confirmado no pré-flight
git checkout "${PROD_PREV_SHA}"

# Restaurar a imagem anterior (ou reconstruir a partir de PROD_PREV_SHA) e recriar apenas o container app
docker compose -f deployment/docker-compose.yml build app
docker compose -f deployment/docker-compose.yml up -d --no-deps app
curl -fsS http://127.0.0.1:3000/api/health
```
- **Impacto em dados:** Zero perda de dados. Nenhum agendamento, comanda ou pagamento realizado após o deploy é perdido.

### Cenário B — Tratamento da Migration Aditiva Já Aplicada durante Rollback de Aplicação
Como a migration `20261106200000_add_customer_sweepstakes_v1` é **estritamente aditiva** (apenas novas tabelas e enums `customer_sweepstake*` e índices de suporte):
- **NÃO execute `DROP TABLE` nem restaure o backup do banco** se o objetivo for apenas reverter a versão da aplicação para `PROD_PREV_SHA`.
- O código anterior (`PROD_PREV_SHA`) ignora completamente as tabelas novas `customer_sweepstake*` e continua operando normalmente sobre `Appointment`, `Comanda`, `CustomerClubSubscription` e `FinancialTransaction`.
- Manter as tabelas aditivas preserva eventuais rascunhos criados e evita qualquer risco às tabelas operacionais.

### Cenário C — Recuperação do Banco em Falha Catastrófica (Corrupção de Dados)
Somente em caso extremo de corrupção estrutural do banco de dados durante a janela de manutenção:

```bash
# 1. Parar o container da aplicação para cessar conexões e escritas
docker compose -f deployment/docker-compose.yml stop app

# 2. Executar o restore-postgres.sh endurecido (valida SHA-256, gzip -t e marcadores SQL ANTES de DROP SCHEMA,
#    e executa a restauração inteira com ON_ERROR_STOP=1 e --single-transaction)
./deployment/scripts/restore-postgres.sh "${LATEST_BACKUP}"

# 3. Subir a aplicação na versão anterior estável
git checkout "${PROD_PREV_SHA}"
docker compose -f deployment/docker-compose.yml up -d --no-deps app
```

### Cenário D — Preservação de Dados Gerados Após o Deploy (Se o Sistema Já Recebeu Tráfego)
Se uma falha for detectada **após** clientes ou recepcionistas já terem registrado novos agendamentos, comandas ou pagamentos pós-deploy:
1. **Proibido sobrescrever o banco com o backup pré-deploy sem antes exportar o delta pós-deploy.**
2. Preferir sempre o **Cenário A (Rollback apenas do container `tembarber-app`)**, pois preserva 100% dos agendamentos, comandas, pagamentos do Clube e transações financeiras gravados após o deploy.
3. Caso seja estritamente necessário intervir no banco, gerar primeiro um novo backup completo do estado pós-deploy (`./deployment/scripts/backup-postgres.sh`) e extrair os registros criados após o timestamp do deploy (`created_at >= '<TIMESTAMP_DO_DEPLOY>'` em `appointments`, `comandas`, `comanda_items`, `financial_transactions`, `club_subscription_payments`, `club_benefit_usages`) antes de qualquer restauração.
