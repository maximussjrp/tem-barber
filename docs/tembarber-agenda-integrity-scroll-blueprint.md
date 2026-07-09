# Blueprint Técnico — Agenda Integrity + Scroll UX

Este documento define a especificação arquitetural para a correção da integridade de agendamentos e o refinamento de usabilidade (scroll) da agenda administrativa.

---

## 1. Resumo Executivo

O objetivo deste blueprint é detalhar as soluções técnicas para os dois problemas mais críticos da agenda do **Tem Barber**:
1. **Integridade de Escrita:** A API de agendamento público e administrativo deve validar ativamente os limites comerciais (jornada, pausas, folgas e bloqueios temporários) antes de persistir no banco de dados.
2. **Scroll da Agenda:** Unificar a experiência de rolagem no desktop e no mobile através de uma arquitetura baseada puramente em CSS (sem overhead de JS), garantindo o alinhamento nativo de cabeçalhos e colunas.

---

## 2. Achados Confirmados

- **P1 Integridade:** O agendamento público (`POST /api/public/barbershop/[slug]/book`) não valida expediente nem folga. Qualquer chamada direta por HTTP/cURL pode criar agendamentos arbitrários.
- **P1 UX Scroll:** As colunas e os cabeçalhos rolam em divs paralelas desassociadas. O grid usa `snap-x` que trava rolagem vertical no mobile e oculta a scrollbar no desktop.

---

## 3. Princípios Arquiteturais

1. **Capability (Habilidade):** O profissional deve estar ativo e explicitamente vinculado aos serviços solicitados (`validateProfessionalServiceCapability`).
2. **Temporal Availability (Expediente/TimeOff):** O horário deve estar dentro da jornada ativa, fora de intervalos de pausa/almoço e fora de períodos de `TimeOff` do profissional.
3. **Overlap (Sobreposição):** Garantia de que nenhuma outra reserva ativa colide com o horário solicitado.
4. **Operational Override (Sobrescrita Comercial):** Capacidade exclusiva de papéis autorizados (Owner/Manager) de violar deliberadamente regras de colisão e expediente, registrando os motivos.

---

## 4. Política por Fluxo

| Fluxo | Capability | Overlap | Jornada / Pausa / Folga | TimeOff | Políticas de Override |
|---|---|---|---|---|---|
| **Public Booking** | Obrigatória | Proibido | Obrigatória (Rejeita se fora) | Obrigatório (Rejeita) | Nenhum (Bypass bloqueado) |
| **Admin NORMAL** | Obrigatória | Proibido | Alerta / Warning (Permite com confirmação) | Alerta / Warning (Permite com confirmação) | Permite criar com override visual |
| **Admin FIT_IN** | Obrigatória | **Permitido** (Grava snapshot) | Alerta / Warning (Permite com confirmação) | Alerta / Warning (Permite com confirmação) | Permite overlap + bypass comercial |
| **Reschedule NORMAL** | Obrigatória | Proibido | Alerta / Warning | Alerta / Warning | Permite movimentação com aviso |
| **Reschedule FIT_IN** | Obrigatória | Proibido (Atual) | Alerta / Warning | Alerta / Warning | Preserva validação de overlap |

---

## 5. Scroll Owner Vertical

O único **Scroll Owner Vertical** da agenda deve ser a div do corpo da grade de horários.

### Estrutura de Alturas (Viewport):
- **Admin App Layout:** `flex flex-col h-screen overflow-hidden`
- **AgendamentosContent:** `flex flex-col h-[calc(100dvh-57px)] lg:h-[calc(100dvh-64px)] overflow-hidden`
- **TopBar (Toolbar):** `shrink-0`
- **Shared Calendar Viewport Container:** `flex-1 flex flex-col min-h-0 overflow-hidden`
- **Grid Body (Columns & Time Gutter):** `flex-1 overflow-y-auto` (Scroll Owner Vertical)

---

## 6. Scroll Owner Horizontal (Escolha de Arquitetura)

### Escolha: OPÇÃO A (Um Único Scroll Horizontal Nativo via CSS)
- **Como funciona:** Colocar a barra de cabeçalhos e a grade de horários dentro de um único contêiner pai flexível que possui `overflow-x-auto`.
- **Vantagens (Comparado à Opção B - Sync via JS):**
  - Complexidade nula (HTML estrutural).
  - Sem latência/lag de sincronização.
  - Zero risco de loops infinitos de scroll.
  - Alinhamento de pixels 100% garantido pelo navegador.
  - Funciona perfeitamente com qualquer mouse wheel, trackpad e mobile.

```text
Shared Scroll Container (flex flex-col overflow-x-auto w-full)
 ├─ Header Row (flex shrink-0 w-max) -> Rola apenas horizontalmente com o pai
 └─ Body Grid Row (flex flex-1 w-max overflow-y-auto) -> Rola horizontal e verticalmente
```

---

## 7. Desktop Scroll Affordance

- **Scrollbar Visível:** Ocultar a scrollbar horizontal apenas em dispositivos com suporte nativo a toque. Para desktops convencionais, exibir uma scrollbar fina de 6px (`scrollbar-thin` ou customizada via CSS pseudo-elements `::-webkit-scrollbar` no hover do grid).
- **Affordance:** A existência da scrollbar na base da agenda garante que usuários de mouse sem trackpad cliquem e arrastem a barra horizontal para navegar entre profissionais.

---

## 8. Mobile Touch e Viewport

- **Remoção de Snap:** Remover a classe `snap-x snap-mandatory` da grade principal. A grade deve rolar livremente (`overflow-x-auto`), evitando conflito com o interpretador de gestos verticais do navegador.
- **Viewport Dinâmica:** Substituir `h-screen` ou `100vh` por `100dvh` (Dynamic Viewport Height) nos nós principais, evitando que o teclado virtual do mobile ou as barras de ferramentas móveis truncam a agenda.

---

## 9. Sticky Headers e Width Consistency

- **Header Fixo:** O cabeçalho dos profissionais fica fora do contêiner `overflow-y-auto` do corpo da grade. Portanto, permanece sticky no topo de forma nativa enquanto as horas rolam verticalmente.
- **Definição de Larguras Canônicas:**
  - `TIME_AXIS_WIDTH = 56px` (`w-14`)
  - `MEMBER_COLUMN_WIDTH = 280px` (`min-w-[280px] lg:min-w-[320px]`)
  - As larguras são aplicadas de forma simétrica tanto na linha do cabeçalho quanto no grid do corpo, garantindo alinhamento de pixel constante.

---

## 10. Revalidação de Integridade (Public Booking API)

O endpoint `POST /api/public/barbershop/[slug]/book/route.ts` deve revalidar as seguintes restrições temporais em nível de banco de dados (dentro do escopo serializável):

1. **Profissional Ativo:** O barbeiro selecionado deve estar ativo no tenant.
2. **Serviços Ativos:** Todos os serviços da comanda devem estar ativos.
3. **Jornada de Trabalho:** A data/hora do atendimento deve estar contida dentro de um registro ativo de `WorkingHour` do profissional.
4. **Almoço/Pausas:** O intervalo de atendimento (início \(\rightarrow\) fim estimado) não deve colidir com o intervalo do almoço (`breakStart` a `breakEnd`) configurado na jornada.
5. **Férias e TimeOffs:** A data/hora do atendimento não deve interceptar nenhum registro ativo de `TimeOff` do barbeiro.

---

## 11. Helper Central de Regras Temporais

Criar o arquivo `src/lib/appointments/schedule-constraints.ts` exportando as funções:

```typescript
export interface ScheduleCheckInput {
  db: Prisma.TransactionClient;
  barbershopId: string;
  memberId: string;
  dateTime: Date;
  durationMin: number;
}

export async function validateScheduleConstraints(
  input: ScheduleCheckInput
): Promise<{ success: boolean; errorType?: "OUTSIDE_WORKING_HOURS" | "BREAK_CONFLICT" | "TIME_OFF_CONFLICT" }> {
  // 1. Busca jornada (dayOfWeek)
  // 2. Compara slots de início e fim da duração com startTime/endTime
  // 3. Compara com breakStart/breakEnd
  // 4. Busca timeOffs sobrepostos
}
```

Tanto a API de `availability` quanto o `booking` final utilizarão este helper para garantir uniformidade.

---

## 12. Transação e Consistência (TOCTOU)

A validação de colisão de horários (overlap) e limites comerciais ocorre dentro da mesma transação com nível de isolamento **Serializable**. O travamento concorrido do barbeiro através de `lockAppointmentSchedule` previne que outro cliente reserve o mesmo slot simultaneamente.

---

## 13. Timezone Canônico

- **Offset Fixo:** O sistema continuará a tratar o timezone de Brasília (`America/Sao_Paulo`) como base.
- **Armazenamento:** As datas são persistidas no banco utilizando strings UTC com a hora local (ex: agendamento às 14:30 local é salvo como `14:30:00.000Z`).
- **Comparações:** Os helpers de jornada convertem a hora local para minutos inteiros para comparar com as strings `HH:MM` do banco de dados, eliminando deslocamentos.

---

## 14. Fluxo de Warnings Administrativos e overrides

Se um administrador (Owner/Manager) criar um agendamento fora dos limites de jornada/pausa:
1. A API retorna um código específico (ex: `CONFIRMATION_REQUIRED` com as violações encontradas).
2. O painel administrativo exibe um modal de aviso: *"Atenção: Este agendamento está fora do horário do profissional. Deseja prosseguir?"*.
3. O administrador confirma de forma consciente, retransmitindo a requisição com a flag `forceOverride: true`.
4. A capability (Professional-Service) e overlaps (no modo NORMAL) continuam **estritamente bloqueados**, sem possibilidade de override.

---

## 15. Erros HTTP Públicos (API)

A API pública retornará os seguintes códigos padronizados em caso de violação de escrita:
- **`OUTSIDE_WORKING_HOURS`**: O horário solicitado está fora do expediente comercial do profissional.
- **`BREAK_CONFLICT`**: O horário colide com a pausa/almoço do profissional.
- **`PROFESSIONAL_TIME_OFF`**: O profissional está ausente por férias ou folga manual.
- **`SLOT_UNAVAILABLE`**: Horário já ocupado (overlap clássico).

---

## 16. Planejamento de Testes

### Testes Unitários de Integridade (Jest / Vitest)
- Mock de banco de dados testando:
  - Reserva no início do expediente comercial (Aceita).
  - Reserva 15 minutos antes do expediente (Rejeita).
  - Reserva durante o intervalo de almoço do profissional (Rejeita).
  - Reserva durante período de TimeOff (Rejeita).
  - Teste de timezone e manipulação de milissegundos.

### Testes de Integração de API (PostgreSQL Local)
- Execução de requisições HTTP manuais simulando clientes mal-intencionados injetando payloads fora da jornada comercial.

### Testes Visuais e de Rolagem (Manual / Playwright)
- Cenários:
  - Rolagem horizontal no Chrome (PC) usando roda do mouse + clique-arraste da barra.
  - Swipe rápido vertical e horizontal no mobile simulado.
  - Confirmação de alinhamento visual de cabeçalho de profissional com as colunas do grid.

---

## 17. Plano de Faseamento (PRs)

- **PR 1: `fix/agenda-scroll-ux`** (Sem migrations, focado em HTML/CSS)
  - Novo layout CSS para Option A (único contêiner de scroll horizontal).
  - Remoção de `snap-x` e exibição de scrollbar em desktops comuns.
- **PR 2: `fix/public-booking-schedule-integrity`** (Sem migrations, focado em Backend)
  - Helper central de regras temporais.
  - Bloqueio de escrita no endpoint público.
  - Testes unitários e de integração de API.
- **PR 3: `feat/admin-schedule-overrides`** (Opcional, com opção de log)
  - Warnings administrativos de expediente.
  - Retorno de flags para confirmação consciente de Owners/Managers.

---

## 18. Critérios de Aceite

### Para Scroll (UX):
1. Usuário com mouse comum consegue rolar horizontalmente.
2. Cabeçalho e corpo da grade rolam em perfeita sincronia física.
3. Swipes verticais e gestos diagonais no mobile não travam a navegação da página.

### Para Integridade (API):
1. Booking público fora da jornada é rejeitado com erro `OUTSIDE_WORKING_HOURS`.
2. Reservas públicas em time-offs ou almoço são rejeitadas.
3. Não há colisão de dados por TOCTOU sob Serializable.

---

## 19. Riscos e Mitigações

- **Risco de loops de scroll:** Eliminado ao escolher a **Opção A** (layout nativo em CSS).
- **Risco de quebra de fuso horário:** Mitigado pelo uso das convenções de leitura UTC forçadas (`timeZone: "UTC"`) já existentes e consolidadas no projeto.
- **Perda de flexibilidade admin:** Mitigada pela permissão de alertas de aviso administrados no painel em vez de bloqueio duro.

---

## 20. Veredito de GO/NO-GO

- **GO para PR 1 (Scroll UX):** Recomendado iniciar imediatamente para resolver o maior gargalo de usabilidade.
- **GO para PR 2 (Integridade):** Recomendado iniciar após estabilização do PR 1.
- **GO para PR 3 (Overrides Admin):** Opcional, sob demanda de produto.
