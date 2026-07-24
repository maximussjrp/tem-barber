# Blueprint — Fila de Espera Online (Tem Barber)

## Visão Geral

A Fila de Espera Online permite que clientes entrem na fila de uma barbearia diretamente pelo link público, acompanhem sua posição em tempo real e sejam chamados pelos profissionais disponíveis sem necessidade de agendamento prévio com horário fixo.

---

## Regras de Negócio Confirmadas

1. **Escopo da Fila**: A fila é geral da barbearia inteira.
2. **Link Público Oficial**: `/[slug]/fila`.
3. **Entrada na Fila**: O cliente informa nome, WhatsApp (validado e formatado BR), escolhe o serviço desejado e, opcionalmente, um barbeiro de preferência.
4. **Token de Acesso**: O token público (`publicToken`) é gerado no ato da entrada e retornado ao cliente. O banco armazena apenas o hash (`publicTokenHash`) para garantir privacidade total.
5. **Passar a Vez**:
   - O cliente pode passar a vez até 2 vezes.
   - Ao passar a vez, cai apenas uma posição (ex: 1º passa a ser 2º, 2º passa a ser 3º).
   - Na 3ª recusa/passada de vez, o cliente precisa aceitar o barbeiro que chamou, ir para o fim da fila ou sair.
6. **Ausência (No-Show)**: Se o cliente não comparecer ao ser chamado, o barbeiro move a entrada para o fim da fila (`MOVED_TO_END`).
7. **Tolerância**: A tolerância de 2 minutos é de acionamento manual pelo barbeiro (sem disparo automático no MVP).
8. **Chamar Próximo (PR Futuro)**:
   - Ao chamar um cliente, o sistema cria um **ENCAIXE** na agenda do barbeiro que chamou.
   - **Comanda NÃO é criada** no momento do chamado.
   - A comanda só é aberta quando o profissional clica em **Abrir Atendimento**.
9. **Trava de Agenda por Barbeiro**:
   - A fila respeita a agenda individual do barbeiro usando a trava configurável (`lockBeforeAppointmentMinutes`, padrão 20 min).
   - Outros barbeiros livres na barbearia continuam podendo chamar a fila mesmo que um barbeiro específico esteja travado por ter agendamento próximo.

---

## Modelo de Dados (Prisma)

### 1. `OnlineWaitlistSession`
Controla a sessão operacional diária da fila por barbearia.
- Status: `OPEN` | `PAUSED` | `CLOSED`
- `defaultLockBeforeAppointmentMinutes`: Tempo padrão de trava de agenda antes de agendamentos futuros (padrão: 20 min).

### 2. `OnlineWaitlistEntry`
Representa cada cliente na fila de espera.
- Status: `WAITING` | `CALLED` | `FIT_IN_CREATED` | `IN_SERVICE` | `COMPLETED` | `SKIPPED` | `NO_SHOW` | `MOVED_TO_END` | `CANCELED_BY_CUSTOMER` | `CANCELED_BY_SHOP` | `EXPIRED`.
- Contadores: `skipCount` (máx 2 passadas de vez), `noShowCount`.
- Token: `publicTokenHash` e `publicTokenHint`.

### 3. `OnlineWaitlistMemberConfig`
Configuração de trava e disponibilidade por barbeiro.
- `enabled`: `boolean`
- `lockBeforeAppointmentMinutes`: Int (padrão: 20 min).

---

## Faseamento de Implementação

- **PR #19**: Modelagem Prisma, migration SQL, helpers de domínio e APIs essenciais (admin e públicas).
- **PR #20**: Interface pública `/[slug]/fila` para cliente entrar, ver posição e sair.
- **PR #21**: Painel visual administrativo e do barbeiro para gerenciar a fila.
- **PR #22**: Correção do link público da fila (canônico em produção sem localhost).
- **PR #23**: Ação de chamar próximo cliente criando agendamento de encaixe (`FIT_IN`) na agenda, pré-confirmação para preferência divergente (HTTP 409) e trava de proximidade de agendamento.
- **PR #24**: Passar a vez, no-show e tolerância.
- **PR #25**: Comunicação em tempo real via SSE (Server-Sent Events).

---

## PR #23 — Chamar Próximo como Encaixe (`FIT_IN`)

### 1. Funcionalidade
A ação de **Chamar próximo** seleciona a primeira entrada `WAITING` da fila e cria automaticamente um agendamento do tipo **Encaixe (`FIT_IN`)** na agenda do barbeiro acionado.

### 2. Endpoints da API
- `POST /api/admin/waitlist/call-next`: Exclusivo para **OWNER** e **MANAGER**. Exige `memberId` no corpo da requisição. Retorna HTTP 403 para `BARBER`.
- `POST /api/member/waitlist/call-next`: Exclusivo para **BARBER** (ou membro agindo como profissional). O `memberId` é forçado para o membro autenticado e qualquer `memberId` informado no body é ignorado.

### 3. Regras e Validações
1. **Status da Entrada**: A entrada passa de `WAITING` para `FIT_IN_CREATED`, registrando `calledByMemberId`, `calledAt` e `fitInAppointmentId`.
2. **Sem Comanda Automática**: Nenhuma `Comanda` ou `ComandaItem` é criada no ato da chamada. A comanda só é aberta posteriormente quando o profissional clica em **Abrir Atendimento**.
3. **Trava de Agendamento Próximo**: Se o barbeiro tiver um agendamento confirmado/em andamento nos próximos `lockBeforeAppointmentMinutes` minutos, a chamada é bloqueada com o erro `MEMBER_LOCKED_BY_UPCOMING_APPOINTMENT` (HTTP 400).
4. **Pré-Confirmação de Preferência (HTTP 409)**: Se o cliente indicou preferência por outro barbeiro (`entry.preferredMemberId !== memberId`), a chamada sem o parâmetro `confirmPreferredMismatch: true` retorna **HTTP 409 PREFERRED_MEMBER_MISMATCH** sem criar agendamento nem alterar a fila, permitindo que a interface exiba um modal de confirmação prévia.
5. **Capacidade do Profissional**: O barbeiro precisa ter registro ativo em `BarberService` para o serviço da entrada. Caso contrário, retorna `MEMBER_CANNOT_EXECUTE_SERVICE`.
6. **Proteção Contra Concorrência**: Transação com `isolationLevel: Serializable` e atualização condicional da entrada com `status === "WAITING"`, garantindo idempotência e evitando duplicidade em chamadas simultâneas.

### 4. Interface do Usuário
- **Painel Admin (`/admin/fila`)**: Exibe seletor de barbeiro e botão **Chamar próximo**, com modal de confirmação para preferência divergente.
- **Painel do Membro (`/member/fila`)**: Rota dedicada para barbeiros com visualização simplificada e botão de chamada individual sem seleção de outros barbeiros.
