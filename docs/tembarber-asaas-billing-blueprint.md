# Blueprint — Integração Asaas Billing (Tem Barber SaaS)

## Visão Geral

Este documento define a arquitetura e a estratégia de integração do **Asaas** no sistema **Tem Barber**.

### Decisão de Produto Confirmada
1. **Cobrança SaaS**: O Asaas é utilizado para gerenciar a cobrança recorrente (assinatura mensal) das **barbearias/tenants** que usam a plataforma Tem Barber.
2. **Fora do Escopo Atual**:
   - NÃO usar Asaas neste momento para pagamentos dos clientes finais da barbearia (agendamentos de cortes, barbas, etc.).
   - NÃO implementar split de pagamento ou repasse para profissionais neste momento.
   - NÃO criar checkout de cartão dentro do app final.
   - NÃO alterar comanda, financeiro operacional ou comissão de barbeiros.

---

## Modelos de Dados (Prisma Schema)

Os seguintes modelos sustenta o ciclo de vida de cobrança dos tenants:

1. **`AsaasBillingCustomer`**: Mapeia o cliente Asaas vinculado a uma `Barbershop` (`asaasCustomerId`, `externalReference`).
2. **`AsaasBillingSubscription`**: Registra a assinatura recorrente do tenant (`asaasSubscriptionId`, `planCode`, `value`, `cycle`, `status`).
3. **`AsaasBillingPayment`**: Armazena o histórico e status das cobranças/faturas geradas pelo Asaas (`asaasPaymentId`, `status`, `value`, `netValue`, `dueDate`, `paymentDate`, `invoiceUrl`, `bankSlipUrl`).
4. **`AsaasWebhookEvent`**: Registra todos os webhooks recebidos do Asaas com idempotência, payload bruto e status de processamento (`PENDING`, `PROCESSED`, `IGNORED`, `FAILED`).

---

## Webhook de Cobranças (PR #27)

### Especificação Técnica
- **URL**: `https://app.tembarber.com.br/api/webhooks/asaas/billing`
- **Método**: `POST`
- **Validação de Segurança**: Header `asaas-access-token` comparado contra `process.env.ASAAS_WEBHOOK_TOKEN`.
- **Eventos Suportados**:
  - `PAYMENT_CREATED`, `PAYMENT_UPDATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `PAYMENT_RESTORED`, `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`
  - `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_UPDATED`, `SUBSCRIPTION_DELETED`
- **Idempotência**:
  - O sistema registra cada evento recebido no modelo `AsaasWebhookEvent`.
  - Eventos já processados (`PROCESSED`) com o mesmo `asaasEventId` retornam HTTP `200` com `{ ok: true, duplicate: true }` sem duplicação de dados.
- **Robustez**: Eventos desconhecidos retornam HTTP `200` com `{ ok: true, ignored: true }` garantindo que a fila do Asaas não seja travada por alterações futuras de API.
- **Regra de Acesso**: Neste PR, o recebimento do webhook atualiza os registros locais de `AsaasBillingPayment` e o status informativo da `AsaasBillingSubscription`, mas **NÃO altera nem bloqueia o acesso do tenant** (bloqueio por inadimplência fica para o PR #29).

### Instrução Operacional para Ativação em Produção
1. **Configurar o Webhook no Asaas**:
   - URL: `https://app.tembarber.com.br/api/webhooks/asaas/billing`
   - Token: Definir um token secreto forte no painel do Asaas.
   - Manter o webhook **DESATIVADO** até concluir a implantação.
2. **Deploy do PR #27**:
   - Mergear e realizar o deploy do código em produção.
   - Adicionar a variável `ASAAS_WEBHOOK_TOKEN` no `.env` do servidor de produção com o mesmo token gerado no Asaas.
   - Reiniciar a aplicação (`docker compose build app && docker compose up -d app`).
3. **Ativar no Asaas**:
   - Ativar o webhook no painel do Asaas.
   - Executar um teste com cobrança de sandbox/teste controlada.

---

## Roadmap de Implementação

- **PR #25 (Foundation / Concluído)**: Models Prisma, migration SQL aditiva, cliente server-side Asaas (`src/lib/asaas/client.ts`), mappers (`src/lib/asaas/mappers.ts`), API de readiness (`GET /api/admin/billing/asaas/status`) e testes de fundação.
- **PR #26 (Criação de Assinatura / Concluído)**: Catálogo de planos, reuso de customer, criação de assinatura (`POST /api/admin/billing/asaas/subscription`).
- **PR #27 (Processamento de Webhook / Atual)**: Endpoint de webhook para receber e processar eventos (`PAYMENT_*`, `SUBSCRIPTION_*`) com idempotência.
- **PR #28 (Painel Admin de Faturamento)**: Interface no `/admin/configuracoes` ou `/admin/plano` exibindo status do plano, fatura atual e link de boleto/Pix.
- **PR #29 (Controle de Acesso e Período de Graça)**: Bloqueio automático de acesso ou aviso de tolerância/grace period para tenants inadimplentes.

---

## Configuração e Variáveis de Ambiente

As seguintes variáveis devem ser configuradas exclusivamente no ambiente do servidor (`.env` em produção/staging):

```env
# Integração Asaas
ASAAS_API_KEY="$aact_YTU5YTE0M2M2..."
ASAAS_ENV="sandbox" # ou "production"
ASAAS_WEBHOOK_TOKEN="token_secreto_definido_no_painel_asaas"
```

### Regras Estritas de Segurança
- **Client Server-Side**: O header `access_token` é injetado **apenas** nas chamadas feitas pelo servidor Node.js (`src/lib/asaas/client.ts`).
- **Sem Vazamento**: `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` NUNCA devem ser enviados ao navegador ou expostos em respostas de APIs públicas/admin.
- **Sanitização de Logs**: O helper `sanitizeAsaasPayloadForLog` remove números de cartão, CCV e tokens de qualquer objeto antes de gerar logs.
- **Validação de Webhook**: Todas as requisições de webhook devem validar o token contido no header `asaas-access-token`.
