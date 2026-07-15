# Blueprint e Auditoria — Validação e Confirmação de Telefone do Cliente

**Contexto:** Match Barber (Tem Barber)  
**Status:** Auditado / Proposta de Arquitetura (Não Implementar Ainda)  
**Data:** 14 de Julho de 2026  

---

## 1. Resumo Executivo

Este documento apresenta a auditoria técnica e o plano de implementação (*blueprint*) para mitigar o cadastro de números de telefone falsos, inválidos ou inconsistentes no sistema **Tem Barber**. 

A auditoria revelou que:
- Atualmente, **30,67% dos usuários** no banco de dados local possuem números de telefone considerados inválidos, suspeitos ou meramente de teste (ex: `11999999999`, `11111111111`, fixos sem DDD, etc.).
- Existe uma **inconsistência de normalização** crítica: a API e o lookup removem o DDI `55`, enquanto o login via NextAuth e a rota `/api/auth/register` realizam apenas a limpeza de não-dígitos (`\D`), permitindo o armazenamento de números duplicados (com e sem `55`) para a mesma pessoa, quebrando a integridade de histórico de agendamentos do cliente.
- Não existem validações de padrões falsos (ex: dígitos repetidos, sequenciais) nem verificações de DDDs reais.

Propomos a centralização da lógica em um helper canônico `src/lib/phone/br-phone.ts`, a unificação da persistência em formato E.164 limpo (apenas dígitos, ex: `5517991089190`), e o faseamento da verificação de posse em WhatsApp/SMS de maneira progressiva (iniciando com validações rigorosas e suporte semiautomático via links `wa.me`).

---

## 2. Pontos que Aceitam Telefone (Rotas e Arquivos)

Mapeamos todos os locais do código que recebem, validam, normalizam ou consultam telefones de clientes:

### Frontend
- **Login do Cliente por Telefone:**
  - [src/app/(auth)/login/page.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/app/(auth)/login/page.tsx#L62) — Formata entrada usando máscara `(99) 99999-9999` e faz requisição para `/api/public/client-lookup`.
- **Cadastro de Barbearia/Admin:**
  - [src/app/(auth)/register/page.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/app/(auth)/register/page.tsx#L17) — Máscara de input e envio para `/api/auth/register`.
- **Booking Público (Agendamento):**
  - [src/app/\[slug\]/agendar/page.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/app/[slug]/agendar/page.tsx#L110) — Captura telefone do cliente sem máscara de formatação na digitação e envia para a API de agendamento.
- **Criação de Agendamento pelo Admin:**
  - [src/app/admin/agendamentos/page.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/app/admin/agendamentos/page.tsx#L702) — Input de telefone do cliente para agendamentos ou criação de walk-in, sem máscara ativa de digitação.
- **Abertura de Comandas pelo Admin:**
  - [src/app/admin/comandas/page.tsx](file:///d:/Projetos%20AI/Match%20Barber/src/app/admin/comandas/page.tsx#L94) — Diálogo de abertura rápida ("walk-in") com input de telefone, sem máscara de digitação.

### Backend e APIs
- **NextAuth (Provider de Autenticação):**
  - [src/lib/auth.ts](file:///d:/Projetos%20AI/Match%20Barber/src/lib/auth.ts#L43) — Higieniza telefone do cliente apenas com `replace(/\D/g, "")` e busca/cria o registro `User`.
- **Lookup de Barbearias Vinculadas:**
  - [src/app/api/public/client-lookup/route.ts](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/public/client-lookup/route.ts#L23) — POST público. Normaliza o número e retorna as barbearias associadas.
- **API Pública de Agendamento:**
  - [src/app/api/public/barbershop/\[slug\]/book/route.ts](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/public/barbershop/[slug]/book/route.ts#L332) — POST público. Valida comprimento mínimo de 10 dígitos.
- **API de Agendamento Administrativo:**
  - [src/app/api/admin/appointments/route.ts](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/appointments/route.ts#L335) — Resolve o cliente pelo telefone e cria o agendamento.
- **API de Comandas:**
  - [src/app/api/admin/comandas/route.ts](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/comandas/route.ts#L152) — Associa/cria o cliente na comanda com base no telefone informado.
- **Busca de Clientes Administrativa:**
  - [src/app/api/admin/clients/search/route.ts](file:///d:/Projetos%20AI/Match%20Barber/src/app/api/admin/clients/search/route.ts#L21) — Filtra clientes por correspondências no telefone.

---

## 3. Auditoria da Normalização Atual

O comportamento de normalização atual do sistema é **inconsistente e falho**:

1. **O sistema normaliza telefone?** Parcialmente. Existem lógicas espalhadas.
2. **Para qual formato?** 
   - `normalizePhone` em `src/lib/customers.ts` remove o DDI `55` se o número começar com 55 e tiver 12 ou 13 dígitos, retornando apenas `DDD + Número` (ex: `17991089190`).
   - O fluxo de login (`src/lib/auth.ts`) e cadastro de barbearia (`src/app/api/auth/register/route.ts`) removem apenas caracteres não numéricos. Se o usuário digitar `5517991089190`, ele é armazenado exatamente com `55`. Se digitar `17991089190`, é armazenado sem `55`.
3. **Usa E.164?** Não. O sistema tenta remover o código do país na maioria das consultas internas, gerando divergência com o banco onde alguns usuários contêm `55` e outros não.
4. **Salva com +55 ou só dígitos?** Salva apenas dígitos. Nunca inclui o caractere `+`.
5. **Aceita telefone sem DDD?** Sim. Se a entrada possuir de 8 a 9 dígitos, o sistema salva e processa sem DDD.
6. **Aceita fixo?** Sim. Não há nenhuma verificação limitando o input a celulares (dígito 9 inicial).
7. **Aceita celular sem nono dígito?** Sim. O sistema aceita 10 dígitos (DDD + 8 dígitos) e tenta aplicar lógica de compatibilidade dinâmica em `phoneLookupVariants` gerando a variação com o nono dígito.
8. **Aceita caracteres aleatórios?** O input aceita, mas a normalização no backend remove letras e símbolos, retendo apenas os números.
9. **Bloqueia números repetidos tipo 11111111111?** Não. We found `11111111111` in the database.
10. **Bloqueia 00000000000?** Não.
11. **Bloqueia sequenciais?** Não.
12. **Existe lógica diferente entre booking público e admin?** Sim. O booking público rejeita entradas menores que 10 dígitos no backend (`cleanPhone.length < 10`), enquanto a rota do admin permite criar agendamentos com telefones curtos (ex: `1`, `123`), o que polui o cadastro global de usuários.

---

## 4. Definição do Formato Canônico

Para garantir unicidade no banco de dados e compatibilidade com APIs de mensagens (WhatsApp / SMS), propomos o seguinte padrão:

- **Formato de Persistência (Banco de Dados):**
  Dígitos E.164 puros, sem o caractere `+` e sem formatação visual.
  - Exemplo: `5517991089190` (13 dígitos: 55 = DDI, 17 = DDD, 9 = Prefixo Celular, 91089190 = Número).
- **Formato de Exibição (UI):**
  Máscara tradicional brasileira com parênteses e hífen.
  - Celular: `(17) 99108-9190`
  - Fixo (se suportado operacionalmente): `(17) 3224-2222`
- **Formatos de Entrada Aceitos (Inputs do Usuário):**
  O sistema deve ser tolerante na entrada, limpando e formatando para o formato canônico:
  - `17991089190` $\rightarrow$ `5517991089190`
  - `(17) 99108-9190` $\rightarrow$ `5517991089190`
  - `+55 17 99108-9190` $\rightarrow$ `5517991089190`
  - `5517991089190` $\rightarrow$ `5517991089190`

---

## 5. Validação Brasil — Celular

A validação de celulares brasileiros deve ocorrer após a extração apenas de dígitos do input:

1. **DDI obrigatório:** O número deve iniciar com `55` (ou ser inferido se o usuário digitar 10/11 dígitos).
2. **DDD Válido:** Os dígitos nas posições 3 e 4 devem corresponder a um DDD brasileiro homologado pela ANATEL.
3. **Comprimento:** O número normalizado final deve possuir exatamente **13 dígitos**.
4. **Prefixo de Celular:** O primeiro dígito após o DDD deve ser obrigatoriamente **`9`** (ex: `5517[9]91089190`).
5. **Bloqueios Anti-Fraude:**
   - Rejeitar números onde todos os dígitos locais são iguais (ex: `5511999999999`, `5517911111111`, etc.).
   - Rejeitar sequenciais simples no número local (ex: `5511912345678`, `5517998765432`).
   - Rejeitar números contendo mais de 5 zeros consecutivos ou padrões impossíveis.

---

## 6. Lista de DDDs Brasileiros Válidos

Para evitar falsificação de DDDs (como `00`, `99`), usaremos uma lista estática.

- **Usará lista estática?** **SIM**. Não há necessidade de consultar APIs externas para isso.
- **Onde ficará?** No arquivo central do helper de telefones (`src/lib/phone/br-phone.ts`).
- **Lista de DDDs:**
  ```typescript
  const VALID_DDDS = new Set([
    11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
    21, 22, 24,                         // RJ
    27, 28,                             // ES
    31, 32, 33, 34, 35, 37, 38,         // MG
    41, 42, 43, 44, 45, 46,             // PR
    47, 48, 49,                         // SC
    51, 53, 54, 55,                     // RS
    61,                                 // DF
    62, 64,                             // GO
    63,                                 // TO
    65, 66,                             // MT
    67,                                 // MS
    68,                                 // AC
    69,                                 // RO
    71, 73, 74, 75, 77,                 // BA
    79,                                 // SE
    81, 87,                             // PE
    82,                                 // AL
    83,                                 // PB
    84,                                 // RN
    85, 88,                             // CE
    86, 89,                             // PI
    91, 93, 94,                         // PA
    92, 97,                             // AM
    95,                                 // RR
    96,                                 // AP
    98, 99                              // MA
  ]);
  ```
- **Como será testada?** Através de testes unitários automatizados cobrindo DDDs válidos (ex: `17`, `11`) e inválidos (ex: `99`, `00`).

---

## 7. Helper Centralizado (`src/lib/phone/br-phone.ts`)

A assinatura e a lógica recomendada do helper são descritas a seguir:

```typescript
// src/lib/phone/br-phone.ts

const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 64, 63, 65, 66, 67, 68,
  69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95,
  96, 97, 98, 99
]);

/**
 * Retorna apenas os dígitos numéricos de uma string
 */
export function getDigits(input: string | null | undefined): string {
  return (input ?? "").replace(/\D/g, "");
}

/**
 * Normaliza uma entrada de telefone para o formato canônico E.164 sem o '+' (ex: 5517991089190).
 * Se o input não incluir o DDI 55, o adiciona.
 */
export function normalizeBrazilianMobilePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = getDigits(input);

  // Se o número começar com 55 e tiver 12 ou 13 dígitos
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    // Normalização opcional: se tiver 12 dígitos (ex: 551791234567 sem o nono dígito do celular antigo)
    if (digits.length === 12) {
      // Injeta o dígito 9 após o DDD (posições 0-3 são 55 + DDD)
      return `${digits.slice(0, 4)}9${digits.slice(4)}`;
    }
    return digits;
  }

  // Se não tem 55 mas tem DDD (10 ou 11 dígitos)
  if (digits.length === 10 || digits.length === 11) {
    if (digits.length === 10) {
      // Injeta o 9 do celular
      digits = `${digits.slice(0, 2)}9${digits.slice(2)}`;
    }
    return `55${digits}`;
  }

  return digits; // Retorna os dígitos brutos se estiver fora das regras para a validação pegar
}

/**
 * Verifica se um telefone é sabidamente um padrão falso
 */
export function isLikelyFakePhone(phone: string): boolean {
  const digits = getDigits(phone);
  
  // Extrai a parte local do número (removendo DDI 55 e DDD se houver)
  let local = digits;
  if (digits.startsWith("55") && digits.length === 13) {
    local = digits.slice(4);
  } else if (digits.length === 11) {
    local = digits.slice(2);
  }

  if (local.length === 0) return true;

  // Todos os dígitos iguais (ex: 999999999)
  if (/^(\d)\1+$/.test(local)) return true;

  // Sequencial simples (ex: 123456789 ou 987654321)
  const sequentialUp = "01234567890123456789";
  const sequentialDown = "98765432109876543210";
  if (sequentialUp.includes(local) || sequentialDown.includes(local)) return true;

  // Mais de 5 zeros consecutivos
  if (/0{5,}/.test(local)) return true;

  return false;
}

/**
 * Valida se o número atende a todos os critérios de celular brasileiro canônico
 */
export function validateBrazilianMobilePhone(input: string | null | undefined): boolean {
  if (!input) return false;
  
  const normalized = normalizeBrazilianMobilePhone(input);
  if (!normalized || normalized.length !== 13) return false;
  if (!normalized.startsWith("55")) return false;

  const ddd = parseInt(normalized.slice(2, 4), 10);
  if (!VALID_DDDS.has(ddd)) return false;

  const localPart = normalized.slice(4);
  
  // Primeiro dígito do número local precisa ser 9
  if (localPart[0] !== "9") return false;

  // Evita padrões suspeitos
  if (isLikelyFakePhone(normalized)) return false;

  return true;
}

/**
 * Formata o número canônico para exibição (ex: (17) 99108-9190)
 */
export function formatBrazilianMobilePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = getDigits(phone);
  
  // Se for canônico (13 dígitos)
  if (digits.startsWith("55") && digits.length === 13) {
    const ddd = digits.slice(2, 4);
    const firstHalf = digits.slice(4, 9);
    const secondHalf = digits.slice(9);
    return `(${ddd}) ${firstHalf}-${secondHalf}`;
  }

  // Fallback se for DDD + celular sem DDI
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  
  // Fallback se for DDD + fixo
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return phone;
}
```

---

## 8. Frontend e Backend: Estratégia de Bloqueio

### No Frontend (UX)
1. **Máscara de Entrada e Feedback em Tempo Real:**
   - Adicionar máscara automática nos campos de digitação (ex: `react-input-mask` ou lógica interna simples similar à do login) nos formulários de **booking público**, **agendamentos admin** e **comandas**.
   - Exibir feedback visual discreto (borda amarela/vermelha ou aviso "Telefone inválido") antes mesmo de enviar o formulário.
2. **Bloqueio no Submit:**
   - Desabilitar ou travar o botão de agendamento caso a validação do celular falhe.
   - Retornar uma mensagem de erro amigável na tela: *"Por favor, informe um número de WhatsApp celular válido com DDD (Exemplo: (17) 99108-9190)."*

### No Backend (Segurança)
Nunca confiar nas validações do cliente.
1. **Middleware de Sanitização/Validação:**
   - As APIs `/api/public/barbershop/[slug]/book`, `/api/admin/appointments`, `/api/admin/comandas` e `/api/public/client-lookup` devem sanitizar e passar a entrada pelo helper `validateBrazilianMobilePhone`.
2. **Resposta de Erro Padronizada:**
   - Caso falhe, a API retornará `status: 400` com um JSON estruturado:
     `{ error: "INVALID_PHONE", message: "O número de telefone informado não é um celular válido no Brasil." }`

---

## 9. Compatibilidade com Clientes Existentes

### Diagnóstico Técnico (Banco Local/Dev)
A execução de nossa auditoria local obteve o seguinte resultado:
- **Total de usuários no banco:** 75
- **Telefones inválidos/suspeitos:** 23 (30,67%)
- **Tipos de falhas encontradas:**
  - Dígitos repetidos: `11999999999`, `17988888888`, `11111111111`
  - Telefones de teste com 10 dígitos (sem o 9º dígito): `1188888888`
  - Telefones fixos: `1732242222` (Cliente Fixo)
  - Números absurdos ou meramente curtos gerados por rotinas administrativas sem validação.

### Como lidar sem quebrar o login de clientes antigos?
1. **Sem Migração Destrutiva Imediata:** Não podemos simplesmente deletar ou forçar a invalidação dos registros legados no banco de dados, caso contrário, clientes reais que tenham cadastrado números fora do padrão canônico perderão o acesso ao histórico de agendamentos.
2. **Lógica de Login Flexível com Fallback:**
   - Quando o cliente digita o número no login, o backend deve gerar variantes de pesquisa utilizando `phoneLookupVariants(phone)`. Ele pesquisa tanto o formato canônico `5517991089190` quanto o formato antigo `17991089190` ou com o 9º dígito omitido.
3. **Normalização na Primeira Interação (Auto-correção):**
   - Quando um cliente com telefone antigo fizer login com sucesso (usando o fallback de variantes), a aplicação pode automaticamente atualizar o registro no banco de dados para o formato canônico (se a entrada limpa for passível de conversão).
4. **Relatório Administrativo:**
   - Criar uma página simples no painel de administração (ou um script executável) para listar clientes com telefones "não higienizáveis" para que a equipe da barbearia possa contatá-los manualmente e ajustar os cadastros.

---

## 10. Opções para Confirmação de Posse do Telefone

Abaixo, as opções avaliadas para verificação de posse do telefone, visando custo zero ou baixo custo:

### Comparativo de Soluções

| Opção | Funcionamento | Custos | Complexidade | Prós | Contras |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **A. WhatsApp API Oficial (Meta)** | Envio automático de OTP por modelo aprovado pela Meta. | R$ 0,25 a R$ 0,35 por disparo (tarifas Meta Cloud API). | **Alta** (exige conta Business Manager, templates, webhooks). | Entrega rápida, verificação 100% automatizada e profissional. | Custo inviabiliza para barbearias de pequeno/médio porte. |
| **B. SMS OTP tradicional** | Envio de código numérico via SMS (Ex: Twilio, Zenvia). | R$ 0,08 a R$ 0,15 por disparo. | **Média** (Integração de API simples). | Funciona em celulares antigos sem WhatsApp ou dados móveis. | Custos recorrentes altos e problemas de entrega em operadoras BR. |
| **C. WhatsApp via wa.me (Semiautômico/Grátis)** | O cliente clica no link e envia um texto pré-definido contendo um token (ex: *"Confirmar código 4983 no Match Barber"*). | **Zero** | **Baixa a Média** | Gratuito e incentiva o cliente a iniciar uma conversa com o WhatsApp da barbearia. | Exige ação ativa do cliente (enviar a mensagem) e validação manual/bot do outro lado. |
| **D. Confirmação Manual pelo Admin** | O barbeiro/admin recebe o agendamento pendente, clica em "Enviar WhatsApp" para confirmar e marca a flag no painel. | **Zero** | **Nula** (Apenas frontend do admin). | Custo zero, aumenta o engajamento pessoal do estabelecimento. | Processo estritamente manual e operacionalmente cansativo em alto volume. |
| **E. Apenas Validação Forte (Sem OTP)** | Implementa apenas as restrições de formatação descritas na Seção 5. | **Zero** | **Nula** (Apenas código). | Elimina 95% do "lixo" acidental ou tentativas de testes bobos de clientes. | Não impede que alguém coloque o telefone real de outra pessoa. |

### Recomendação Técnica
Recomendamos um fluxo em **fases**:
1. Iniciar imediatamente com a **Opção E (Apenas Validação Forte)** para estancar a entrada de dados inválidos sem custo ou complexidade.
2. Adotar a **Opção C (WhatsApp via wa.me) integrada a um Gateway Não-Oficial de WhatsApp** (ex: Z-API ou Evolution API hospedada em VPS própria de baixo custo, cerca de R$ 30 a R$ 50/mês fixos para disparos ilimitados para todas as barbearias da plataforma), permitindo automação a custo fixo insignificante por estabelecimento.

---

## 11. Proposta de Faseamento (Roadmap)

Propomos a divisão da implementação em 3 Pull Requests (PRs) separados e um plano futuro para evitar sobrecarregar a produção.

```
                  ┌──────────────────────────────┐
                  │ PR 1: Validação e Normalização│
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ PR 2: Higienização do Banco  │
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │ PR 3: Confirmação wa.me      │
                  └──────────────────────────────┘
```

### PR 1: Validação Forte Backend/Frontend & Helper Central
- **Escopo:** Criação do helper `br-phone.ts`, integração nos formulários frontend (com máscara básica) e nos endpoints backend (`/api/public/...`, `/api/admin/...`, NextAuth).
- **Meta:** Estancar lixo novo.
- **Duração:** 3 dias.

### PR 2: Auditoria e Relatório de Inconsistências
- **Escopo:** Criação de script CLI (ou rota administrativa restrita) para listar dados inválidos legados.
- **Meta:** Mapear e preparar os dados antigos para unificação.
- **Duração:** 2 dias.

### PR 3: Confirmação Manual no Painel Admin & Fluxo wa.me
- **Escopo:** Criação dos campos de verificação no banco de dados. Geração de botões de verificação manual no admin e link `wa.me` para clientes confirmarem.
- **Meta:** Adicionar segurança de posse de telefone sem custos de SMS.
- **Duração:** 5 dias.

---

## 12. Modelagem de Dados Futura

Para suportar a verificação de posse do telefone, planejamos a adição dos seguintes campos à tabela `User` (sem criar migrações nesta fase de blueprint):

```prisma
// Campos a serem adicionados ao model User futuramente
model User {
  // ... campos existentes
  
  phoneVerifiedAt        DateTime? @map("phone_verified_at")
  phoneVerificationToken String?   @map("phone_verification_token")
  phoneVerificationSentAt DateTime? @map("phone_verification_sent_at")
}
```

- **Validação forte exige migration?** **NÃO**. É puramente lógica de software.
- **Verificação real (OTP) exige migration?** **SIM (Provável)**, para armazenar o token temporário e a data de expiração/verificação.
- **Confirmação manual exige migration?** **SIM (Simples)**, necessita do campo `phoneVerifiedAt` no model `User`.

---

## 13. LGPD, Privacidade e Segurança

No tratamento de telefones (Dados Pessoais segundo a LGPD), os seguintes princípios devem ser seguidos:

1. **Minimização de Exposição em Logs e Erros:**
   - Mensagens de erro de login/validação não devem revelar se o telefone já está cadastrado para evitar **solicitações maliciosas** (enumeração de usuários).
   - O endpoint `/api/public/client-lookup` já possui rate limit de 15 requisições por minuto por IP, o que é excelente. Devemos manter logs de tentativas sem armazenar os números em texto claro em arquivos de logs públicos.
2. **Armazenamento e Exibição Segura:**
   - Exibir telefones mascarados no admin quando for seguro, ou apenas para usuários autorizados (membros da barbearia vinculados).
   - Armazenar tokens de verificação temporários (OTP) utilizando hashes criptográficos de via única no banco (ex: SHA-256) caso sejam enviados via SMS/WhatsApp oficial, para que vazamentos de banco de dados não permitam o sequestro de sessões ativas de login de clientes.
3. **Consentimento:**
   - Incluir aviso no momento do agendamento informando que o número será utilizado para envio de confirmações de agendamentos e lembretes automáticos via WhatsApp/SMS.

---

## 14. Plano de Testes

### Testes Unitários (`br-phone.test.ts`)
- **Cenários de Normalização:**
  - `(17) 99108-9190` $\rightarrow$ `5517991089190` (Celular válido)
  - `17991089190` $\rightarrow$ `5517991089190` (Falta DDI)
  - `+55 17 99108-9190` $\rightarrow$ `5517991089190` (Formato internacional completo)
  - `1732242222` $\rightarrow$ `5517932242222` (Fixo normalizado como celular com injeção de 9 — deve falhar na validação subsequente)
- **Cenários de Validação (Celular BR):**
  - Retornar `true` para `5517991089190`.
  - Retornar `false` para DDDs inexistentes (ex: `5599991089190`).
  - Retornar `false` para números fixos (ex: `551732242222` — não começa com 9 no número local).
  - Retornar `false` para números fraudulentos conhecidos (ex: `5511999999999`, `5511912345678`).
  - Retornar `false` para entradas muito curtas ou vazias.

### Testes de Integração
- Simular requisição de agendamento em `/api/public/barbershop/[slug]/book` com telefone inválido (ex: `111`) e validar resposta `400 Bad Request`.
- Simular login com telefone em formato diferente do banco e validar que a pesquisa por variantes (`phoneLookupVariants`) encontra o usuário legado sem travar a autenticação.

---

## 15. Riscos Mapeados

1. **Bloqueio de Clientes Legítimos (Falso Positivo):** 
   - A regra de exigir o dígito `9` inicial no número local é válida para celulares no Brasil, mas se a barbearia aceitar agendamentos vinculados a números fixos residenciais ou comerciais, esses clientes serão bloqueados.
   - *Mitigação:* Alinhar com a gestão do Tem Barber se o uso de WhatsApp é 100% mandatório para todos os clientes. Caso contrário, permitir telefones fixos na retaguarda (admin) e apenas restringir celulares no booking público.
2. **Duplicidade de Cadastros Existentes:**
   - Ao alterar o formato canônico no banco para iniciar com `55`, se criarmos um novo usuário com `5517991089190` quando já existia `17991089190` (antigo), geramos duplicidades de perfil.
   - *Mitigação:* O script de higienização de banco (PR 2) deve rodar antes da validação rígida de cadastro para converter todos os telefones antigos para o formato com `55`.

---

## 16. GO/NO-GO para Implementar PR 1

**RECOMENDAÇÃO: GO**

A implementação da **Fase 1 (PR 1)** é altamente recomendada e urgente. Ela não gera custos financeiros adicionais para a plataforma, resolve imediatamente a inconsistência técnica de cadastros duplicados (com/sem 55) e impede que novos agendamentos com telefones falsos continuem poluindo a base de dados.
Os riscos de impacto em clientes antigos são mitigados pelo uso das variantes de pesquisa de login já existentes no projeto.
