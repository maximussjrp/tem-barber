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

Os seguintes modelos foram criados para sustentar o ciclo de vida de cobrança dos tenants:

1. **`AsaasBillingCustomer`**: Mapeia o cliente Asaas vinculado a uma `Barbershop` (`asaasCustomerId`, `externalReference`).
2. **`AsaasBillingSubscription`**: Registra a assinatura recorrente do tenant (`asaasSubscriptionId`, `planCode`, `value`, `cycle`, `status`).
3. **`AsaasBillingPayment`**: Armazena o histórico e status das cobranças/faturas geradas pelo Asaas (`asaasPaymentId`, `status`, `value`, `netValue`, `dueDate`, `paymentDate`, `invoiceUrl`, `bankSlipUrl`).
4. **`AsaasWebhookEvent`**: Registra todos os webhooks recebidos do Asaas com idempotência, payload bruto e status de processamento (`PENDING`, `PROCESSED`, `IGNORED`, `FAILED`).

---

## Roadmap de Implementação

- **PR #25 (Foundation / Atual)**: Models Prisma, migration SQL aditiva, cliente server-side Asaas (`src/lib/asaas/client.ts`), mappers (`src/lib/asaas/mappers.ts`), API de readiness (`GET /api/admin/billing/asaas/status`) e testes de fundação.
- **PR #26 (Criação de Assinatura)**: Helpers e fluxos server-side para criar/vincular cliente e assinatura no Asaas.
- **PR #27 (Processamento de Webhook)**: Endpoint de webhook para receber e processar eventos (`PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `SUBSCRIPTION_DELETED`) com idempotência.
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
