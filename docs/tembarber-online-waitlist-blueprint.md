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

- **PR #19 (Atual)**: Modelagem Prisma, migration SQL, helpers de domínio e APIs essenciais (admin e públicas).
- **PR #20**: Interface pública `/[slug]/fila` para cliente entrar, ver posição e sair.
- **PR #21**: Painel visual administrativo e do barbeiro para gerenciar a fila.
- **PR #22**: Ação de chamar próximo cliente criando encaixe automático na agenda.
- **PR #23**: Comunicação em tempo real via SSE (Server-Sent Events).
