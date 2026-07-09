# Auditoria de Integridade de Agendamentos e Bug de Rolagem

Este documento apresenta a análise técnica aprofundada realizada na agenda do sistema **Tem Barber**, contemplando a segurança de agendamento (jornada, pausas, folgas e bloqueios temporários) e o diagnóstico preciso do bug de rolagem nos modos desktop e mobile.

---

## 1. Resumo Executivo

A auditoria identificou um cenário de alta criticidade em relação à integridade das regras de negócio no banco de dados e à usabilidade da interface da agenda administrativa. 

1. **Integridade de Agendamento:** O motor de agendamento valida corretamente colisões de horários (overlaps) e capacidades profissionais (Professional ↔ Service), mas **não revalida limites de jornada, pausas ou bloqueios temporários (timeOffs) nas rotas de escrita final do banco de dados (booking público, criação administrativa e reagendamento)**. A validação dessas restrições ocorre exclusivamente no passo anterior de cálculo de slots de disponibilidade (`availability`), deixando a API final exposta a manipulações diretas via requisições HTTP (por exemplo, agendamento em feriados ou de madrugada).
2. **Bug de UX / Rolagem:** A rolagem da agenda administrativa está severamente comprometida. A causa raiz reside em uma **arquitetura de scroll aninhado e desassociado**, onde a barra de cabeçalhos de profissionais e as colunas da grade de horários rolam em contêineres independentes (sem sincronização via JS) e com larguras mínimas distintas. Adicionalmente, o uso de `snap-x snap-mandatory` no contêiner da grade aliado a estilos de viewport e elementos interativos captura gestos verticais no mobile, travando a navegação da página. No desktop, a ocultação da barra de rolagem impede a rolagem horizontal para usuários que utilizam mouses convencionais.

---

## 2. Veredito

- **Integridade Funcional:** **RISCO CONFIRMADO (P1)**. O banco de dados aceita agendamentos fora de jornada ou em períodos de pausa/folga se forem requisitados diretamente pela API.
- **Rolagem / UX:** **BUG CONFIRMADO (P1 UX)**. O uso da agenda administrativa no mobile e desktop convencional está inviabilizado para layouts de múltiplas colunas de profissionais.
- **Ação Recomendada:** Correção em duas fases:
  1. Criação de um helper centralizado de revalidação de regras de jornada/time-off a ser injetado nas transações de escrita da API.
  2. Refatoração do layout CSS da agenda administrativa para unificar a rolagem sob um único contêiner ou sincronizar os eixos horizontais por JavaScript, removendo o comportamento de bloqueio gestual.

---

## 3. Fluxos da Agenda e Componentes Envolvidos

Mapeamos a jornada de agendamento e o consumo de dados da agenda no repositório:

- **Booking Público (Cliente):**
  - Interface: `src/app/[slug]/agendar/page.tsx`
  - Endpoint de escrita: `POST /api/public/barbershop/[slug]/book`
  - Controlador de transação: `src/app/api/public/barbershop/[slug]/book/route.ts`
- **Availability Pública:**
  - Endpoint de consulta: `GET /api/public/barbershop/[slug]/availability`
  - Controlador de cálculo: `src/lib/appointments/availability.ts`
- **Agenda Administrativa (Painel Admin):**
  - Interface: `src/app/admin/agendamentos/page.tsx` (Componentes `AgendamentosContent`, `CalendarGrid`, `AppointmentModal` e `AppointmentBlock` inline)
  - Endpoint de escrita (Criação): `POST /api/admin/appointments`
  - Endpoint de escrita (Edição/Reagendamento): `PUT /api/admin/appointments/[id]`
- **Agenda do Profissional (Member Portal):**
  - Interface: `src/app/member/agenda/page.tsx`
  - Endpoint de listagem: `GET /api/member/agenda`

---

## 4. Modelo de Jornada e Bloqueios (Schema Database)

Os modelos de controle temporal estão definidos em `prisma/schema.prisma`:

### `WorkingHour` (Jornada e Pausa Diária)
- **Representação:** Define o horário comercial do profissional.
- **Campos chaves:** `startTime` ("HH:MM"), `endTime` ("HH:MM"), `breakStart` ("HH:MM"?), `breakEnd` ("HH:MM"?), `dayOfWeek` (Int de 0 a 6), `isActive` (Boolean).
- **Escopo:** Member-scoped (`memberId`) e implicitamente Tenant-scoped (através do membro vinculado à barbearia).
- **Timezone:** Sem fuso horário explícito. Armazena strings locais ("HH:MM").

### `TimeOff` (Folgas, Férias e Bloqueios)
- **Representação:** Define suspensões temporárias da agenda por data de início/fim.
- **Campos chaves:** `startDate` (DateTime UTC), `endDate` (DateTime UTC), `reason` (String?).
- **Escopo:** Member-scoped (`memberId`).
- **Soft Delete:** Não possui. Registros são criados e deletados fisicamente.

---

## 5. Auditoria de Availability (Consulta de Slots)

O arquivo `src/lib/appointments/availability.ts` calcula os slots livres no dia:

1. Filtra os membros capazes através de `findEligibleMembersForServices` (relação `BarberService`).
2. Converte a data alvo ("YYYY-MM-DD") para limites de dia em UTC (`startOfDayUTC`, `endOfDayUTC`) respeitando o dia da semana.
3. Carrega o profissional ativo, pulando o dia se ele possuir qualquer `TimeOff` ativo na faixa de data (`timeOffs.length > 0`).
4. Ignora profissionais sem regras de jornada ativa para o dia (`!wh`).
5. Varre o dia de `startTime` a `endTime - totalDuration` em intervalos de 30 minutos:
   - Descarta o slot se houver overlap com o intervalo de almoço/pausa (`breakStart` e `breakEnd`).
   - Descarta o slot se colidir com agendamentos existentes ativos (`status` em `PENDING`/`CONFIRMED`).
   - Descarta slots anteriores ao horário de Brasília atual se for hoje (`brNowMinutes` via `nowBR()`).
6. **Veredito da Consulta:** A validação é rigorosa e contempla **todas** as restrições operacionais da barbearia.

---

## 6. Auditoria de Booking Público Final

A rota `POST /api/public/barbershop/[slug]/book/route.ts` é executada sob nível de isolamento serializável. 

### O Problema da Escrita Cega:
A rota executa:
1. Validação de capacidade (`validateProfessionalServiceCapability`).
2. Resolução do cliente.
3. Verificação de limite de agendamento semanal do cliente.
4. **Chamada direta** a `createAppointmentWithScheduleLock`.

**Falha Crítica:** A função `createAppointmentWithScheduleLock` apenas executa a busca de colisões físicas com outros agendamentos existentes (`findOverlappingAppointment`). **Não há validação de `workingHours`, `breaks` ou `timeOffs` na escrita.** 

Se um payload manipulado for disparado para a API com `dateTime` fora do expediente do barbeiro (ex: 03:00 da manhã) ou em um dia de folga (onde `availability` retornaria zero slots), o banco de dados irá inserir o agendamento normalmente, sem retornar erros.

---

## 7. Auditoria de Criação Administrativa (Admin Create)

### Agendamento NORMAL
No controlador administrativo (`src/app/api/admin/appointments/route.ts`), o fluxo segue o mesmo padrão da API pública. É validada apenas a capability do barbeiro com o serviço selecionado e colisão de horários. 
- **Comportamento Encontrado:** Admins podem agendar atendimentos normais fora da jornada comercial ou em dias de folga/pausa.
- **Classificação:** *Comportamento operacional flexível*. No ecossistema de barbearias, administradores rotineiramente forçam horários (ex: estender o expediente em 30 min para um cliente antigo). Bloquear de forma dura a jornada para administradores prejudicaria a operação flexível. Contudo, a ausência de um aviso na UI de que o horário está fora do expediente é uma lacuna de UX.

---

## 8. Auditoria de Encaixe (FIT_IN)

O encaixe operacional (`bookingMode: "FIT_IN"`) foi modelado especificamente para burlar colisões de horário.
- **Ignora Overlap:** Sim (comportamento intencional, gravando as colisões no `conflictSnapshot`).
- **Expediente/Jornada/Pausa/Folgas:** São completamente ignorados, pois o agendamento normal já os ignora a nível de API.
- **Risco:** Um administrador pode encaixar um cliente para um barbeiro inativo, fora do expediente ou de folga sem nenhum alerta impeditivo, o que pode gerar ruídos operacionais se o barbeiro não estiver presente na loja.

---

## 9. Auditoria de Reagendamento (Reschedule)

A rota `PUT /api/admin/appointments/[id]/route.ts` delega a lógica para `rescheduleAppointmentWithScheduleLock`.
- **Validação temporal:** Verifica colisões de horário (`findOverlappingAppointment`) excluindo o próprio ID do agendamento editado. Lança erro se houver colisão.
- **Restrições operacionais:** Não revalida jornada, pausas, folgas ou time-offs.
- **Comportamento com FIT_IN:** Um encaixe original, ao ser reagendado para um novo horário, **não pode ser colocado sobre outro conflito**, pois o helper de reschedule sempre impõe a regra de colisão dura.

---

## 10. Auditoria de Timezone e Deslocamento Temporal

Para contornar o problema de timezone do servidor (como Vercel em UTC):
- O sistema grava a data e hora local do agendamento **dentro de um timestamp formatado como UTC** (ex: 14:30 em Brasília é gravado como `14:30.000Z`).
- O frontend recupera o horário forçando o fuso horário de exibição em UTC:
  ```typescript
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "UTC", ... });
  ```
- O cálculo de minutos utiliza `getUTCHours()` e `getUTCMinutes()`.
- **Risco de Horário Deslocado:** Zero. A simetria entre gravação mascarada e leitura forçada de fuso garante consistência em múltiplos navegadores e fusos de clientes.

---

## 11. Arquitetura Visual da Agenda e Causa Raiz do Scroll

A interface administrativa da agenda em `src/app/admin/agendamentos/page.tsx` está estruturada da seguinte forma:

```text
html
 └─ body (overflow-x: hidden)
     └─ AppShell (min-h-screen)
         └─ main (min-h-screen, flex flex-col)
             └─ AgendamentosContent (h-[calc(100vh-57px)] ou lg:h-[calc(100vh-64px)], flex flex-col)
                 ├─ TopBar (shrink-0)
                 ├─ Member Headers Wrapper (shrink-0, overflow-x: auto) -> Rola horizontalmente os nomes dos barbeiros (min-w-[160px])
                 └─ Calendar Body Wrapper (flex-1, overflow-auto)
                     └─ CalendarGrid (flex, min-w-0)
                         ├─ Time Gutter (shrink-0, w-14, altura fixa: 1560px)
                         └─ Member Columns (flex-1, overflow-x: auto, snap-x snap-mandatory, hide-scrollbar)
                             └─ BarbershopMember Columns (min-w-[280px] ou lg:min-w-[320px], altura fixa: 1560px)
```

### Causa Raiz do Travamento de Rolagem (Scroll Bug):

1. **Desacoplamento de Scroll Horizontal (Double Scroll Horizontal):**
   Os nomes dos profissionais (cabeçalho) estão em um contêiner com `overflow-x-auto` e min-width de `160px`. A grade de horários correspondente (colunas) está em outro contêiner separado com `overflow-x-auto` e min-width de `280px`/`320px`. **Não há sincronização via JS**. Ao rolar as colunas, o cabeçalho fica parado, desconfigurando a identificação de quem é cada coluna.
2. **Ocultação de Scrollbar no PC:**
   A classe `hide-scrollbar` é aplicada nas colunas da grade de horários. Um usuário com mouse convencional (sem roda de scroll horizontal / scroll inclinado) fica completamente impossibilitado de mover a grade horizontalmente para ver outros profissionais da equipe.
3. **Sequestro de Gesto (Touch Interception) no Mobile:**
   O contêiner de colunas possui a propriedade `snap-x snap-mandatory`. No mobile, quando o usuário tenta rolar a página verticalmente para ver horários mais tarde (como 18:00), se o movimento do dedo contiver o menor desvio horizontal, o interpretador de gestos do navegador captura o evento para o eixo X do `snap-x`. Como o movimento X é priorizado pelo contêiner interno, o scroll vertical do pai (`flex-1 overflow-auto`) é suspenso (sequestrado), dando a sensação de que a tela travou ou emperrou.

---

## 12. Matrizes Funcionais e de Diagnóstico

### Matriz de Validação Funcional (Escrita no Banco)

| Fluxo | Verifica Capability | Verifica Colisão (Overlap) | Valida Jornada (Expediente) | Valida Almoço (Pausa) | Valida Folgas | Valida TimeOff |
|---|---|---|---|---|---|---|
| **Public Availability** | SIM | SIM | SIM | SIM | SIM | SIM |
| **Public Booking** | SIM | SIM | **NÃO** | **NÃO** | **NÃO** | **NÃO** |
| **Admin NORMAL (Create)** | SIM | SIM | **NÃO** | **NÃO** | **NÃO** | **NÃO** |
| **Admin FIT_IN (Create)** | SIM | **NÃO** (Registra) | **NÃO** | **NÃO** | **NÃO** | **NÃO** |
| **Reschedule NORMAL** | SIM | SIM | **NÃO** | **NÃO** | **NÃO** | **NÃO** |
| **Reschedule FIT_IN** | SIM | SIM (Forçado) | **NÃO** | **NÃO** | **NÃO** | **NÃO** |

---

### Matriz de Diagnóstico do Bug de Scroll

| Ambiente | Scroll Vertical | Scroll Horizontal | Travamento / Engasgo | Causa Provável | Evidência |
|---|---|---|---|---|---|
| **Desktop Mouse** | Fluido | **Inexistente** | Travado no eixo X | Ocultação de scrollbar via `hide-scrollbar`. | Classe `hide-scrollbar` aplicada na linha 1315 do Grid. |
| **Desktop Trackpad**| Fluido | Fluido | Desalinhado | Ausência de sincronização física entre cabeçalho de barbeiro e colunas do grid. | Cabeçalho e colunas em elementos DOM irmãos sem ponte de scroll. |
| **Mobile (360px)** | Duro / Travando | Sensível / Desalinhado | Alto | `snap-x` disputa prioridade de gesto no touch com o scroll Y do contêiner pai. | Swipe vertical é cancelado ao arrastar o dedo levemente em diagonal. |
| **Mobile (390px)** | Duro / Travando | Sensível / Desalinhado | Alto | Mesma causa gestual. | Conflito de overflow nativo. |
| **Mobile (412px)** | Duro / Travando | Sensível / Desalinhado | Alto | Mesma causa gestual. | Conflito de overflow nativo. |

---

## 13. Classificação dos Achados (Severidade)

### [P1] Falha de Integridade Física de Agendamento (API)
- **Impacto:** Clientes mal-intencionados ou scripts externos podem realizar agendamentos em horários em que a barbearia está fechada ou o barbeiro está de folga.
- **Relação com Encaixe:** Como o encaixe também ignora essas restrições, a falha afeta ambos os modos, mas é crítica no agendamento público (NORMAL).

### [P1 UX] Bloqueio de Navegação na Agenda Administrativa (Mobile e Desktop Mouse)
- **Impacto:** A equipe de recepção/administração não consegue visualizar barbeiros adicionais no desktop comum e sofre com travamento constante do toque no celular.

### [P2] Desalinhamento do Eixo de Scroll (Headers vs Columns)
- **Impacto:** Confusão visual extrema na leitura da agenda. O admin vê o nome do Barbeiro A em cima da coluna do Barbeiro B caso deslize a tela horizontalmente.

---

## 14. Proposta de Correção (Alto Nível)

### Solução para Integridade Temporal:
1. Criar um helper central de verificação de elegibilidade de horário comercial em `src/lib/appointments/validate-schedule-limits.ts`:
   - Verifica se o horário escolhido está dentro da jornada (`WorkingHour`) ativa do profissional.
   - Verifica se não colide com o horário de almoço/pausa configurado na jornada.
   - Verifica se não colide com períodos de `TimeOff` configurados para o barbeiro.
2. Injetar esta validação na transação de escrita do **Booking Público**.
3. **Decisão de Produto sobre a Administração:**
   - **Opção A:** Validar estritamente as regras também para o Administrador, bloqueando agendamento fora de jornada.
   - **Opção B (Recomendada):** Permitir que o Administrador fure a jornada/pausas no agendamento **NORMAL** e **FIT_IN**, mas exibir um aviso na UI do Modal (ex: *"Atenção: Horário fora do expediente ou em período de pausa do profissional"*).

### Solução para o Bug de Rolagem:
1. **Sincronização de Scroll:**
   Vincular uma referência DOM (`useRef`) ao scroll do cabeçalho e outro ao grid de colunas. Ao disparar o evento `onScroll` em um, atualizar a propriedade `scrollLeft` do outro de forma síncrona.
2. **Remoção do snap-x mobile:**
   Remover as classes `snap-x` e `snap-mandatory` do contêiner da grade para suavizar o gesto e evitar que o navegador trave o scroll vertical.
3. **Scrollbar Visível no Desktop:**
   Substituir a ocultação cega da scrollbar por scrollbars convencionais do sistema ou customizadas apenas em hover de dispositivos que não possuem suporte a toque.

---

## 15. Necessidade de Migrations

- **Mudança de Jornada/TimeOff:** **NÃO** exige migrations (o schema atual é suficiente, a lógica de revalidação será 100% de software/API).
- **Correção de Scroll:** **NÃO** exige migrations (código visual e CSS client-side).

---

## 16. Blueprint e Próximos Passos (Faseamento)

### Fase 1: Correção do Bug de Rolagem & Desalinhamento da Agenda (Foco em Usabilidade)
- Acoplamento do scroll horizontal de cabeçalhos e colunas.
- Remoção do snap e suavização de gestos touch.
- Tratamento de scrollbars no desktop.

### Fase 2: Proteção da API de Booking Público (Foco em Segurança)
- Implementação do validador de jornada/pausa/timeOff no endpoint `/api/public/barbershop/[slug]/book`.
- Testes automatizados simulando bypass de data/hora pelo cliente.

### Fase 3: Alertas Visuais no Painel Administrativo (Foco em Alinhamento de Negócio)
- Exibição de avisos de expediente/pausa nos modais de criação/reagendamento de agendamentos administrativos (NORMAL/FIT_IN).
