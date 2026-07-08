# Auditoria P1 - Booking publico profissional x servico

## 1. Resumo executivo

Auditoria realizada na branch `master`, com working tree limpa, apos `git fetch origin`.

- Branch local: `master`
- `HEAD`: `8a43f5fbcba815a85f72b451558ca15d8fa2540e`
- `origin/master`: `8a43f5fbcba815a85f72b451558ca15d8fa2540e`
- Escopo: analise estatica do codigo atual e cobertura de testes existente.
- Teste com payload manipulado em banco seguro: nao executado. Nao havia fixture local dedicado para os oito cenarios solicitados sem alterar dados; os resultados abaixo se baseiam em codigo e testes existentes.

Conclusao: bug confirmado. O endpoint publico de booking valida tenant, profissional ativo, servicos ativos e conflito de horario, mas nao valida que o profissional escolhido executa todos os servicos solicitados.

## 2. Veredito

BUG CONFIRMADO.

O POST `/api/public/barbershop/[slug]/book` aceita `memberId` e `serviceIds`, busca o profissional por `{ id, barbershopId, isActive: true }` e os servicos por `{ id in serviceIds, barbershopId, isActive: true }`, mas nao consulta `barber_services` / `BarberService` para provar a relacao profissional x servico antes de criar o appointment.

Evidencias principais:

- `src/app/api/public/barbershop/[slug]/book/route.ts:311` valida profissional apenas por id, tenant e ativo.
- `src/app/api/public/barbershop/[slug]/book/route.ts:320` valida servicos apenas por ids, tenant e ativo.
- `src/app/api/public/barbershop/[slug]/book/route.ts:421` chama `createAppointmentWithScheduleLock`.
- `src/lib/appointments/create-appointment.ts:37` a `:48` valida lock/conflito de agenda.
- `src/lib/appointments/create-appointment.ts:50` a `:65` cria `Appointment` e `AppointmentService` sem validacao de capacidade.
- `src/__tests__/public-booking.test.ts:244` registra explicitamente a lacuna atual: nao valida se o profissional executa todos os servicos.

## 3. Severidade

P1.

Motivo: cliente publico pode manipular payload e criar agendamento operacionalmente invalido dentro do mesmo tenant, afetando agenda, atendimento e relatorios. Nao encontrei evidencia de cross-tenant grave para classificar como P0: serviceId e memberId sao escopados por `barbershopId` no booking final.

## 4. Fluxo publico real

Diagrama do fluxo atual:

```text
GET /[slug]/agendar
  -> frontend busca GET /api/public/barbershop/[slug]
  -> API retorna categorias/servicos ativos e membros ativos com serviceIds
  -> cliente seleciona servicos
  -> UI calcula eligibleMembers no cliente
  -> cliente seleciona profissional ou "qualquer disponivel"
  -> UI chama GET /api/public/barbershop/[slug]/availability?serviceIds=...&memberId=...
  -> availability calcula slots por jornada, folga e conflitos
  -> cliente escolhe slot
  -> UI envia POST /api/public/barbershop/[slug]/book
  -> booking valida barbearia publica/assinatura
  -> booking valida memberId no tenant e ativo
  -> booking valida serviceIds no tenant e ativos
  -> booking resolve cliente e limites
  -> createAppointmentWithScheduleLock valida conflito
  -> cria Appointment
  -> cria AppointmentService para cada servico
```

## 5. Modelo profissional x servico

Entidade de profissional: `BarbershopMember`.

- `prisma/schema.prisma:118` define `model BarbershopMember`.
- Campo de tenant: `barbershopId` em `prisma/schema.prisma:120`.
- Flag de estado: `isActive` em `prisma/schema.prisma:125`.
- Unique: `@@unique([barbershopId, userId])` em `prisma/schema.prisma:145`.

Entidade de servico: `Service`.

- `prisma/schema.prisma:167` define `model Service`.
- Campo de tenant: `barbershopId` em `prisma/schema.prisma:169`.
- Flag de estado: `isActive` em `prisma/schema.prisma:175`.

Relacao profissional x servico: `BarberService`.

- `prisma/schema.prisma:193` a `:202` define `model BarberService`.
- Campos: `barberId` e `serviceId`.
- FKs: `barber` para `BarbershopMember`, `service` para `Service`.
- Unique/PK: `@@id([barberId, serviceId])`.
- Nao ha campo `active`, `deletedAt` ou tenant explicito na relacao. O tenant e implicito pelas entidades relacionadas.

Banco/constraint nao impede `Appointment.memberId` e `AppointmentService.serviceId` incompatíveis, porque `Appointment` aponta para membro e `AppointmentService` aponta para servico separadamente.

## 6. UI

A UI filtra profissionais compativeis no cliente.

- `src/app/api/public/barbershop/[slug]/route.ts:31` a `:36` retorna membros ativos com seus servicos.
- `src/app/api/public/barbershop/[slug]/route.ts:106` retorna `serviceIds` de cada membro.
- `src/app/[slug]/agendar/page.tsx:182` a `:187` calcula `eligibleMembers` exigindo que todo servico selecionado esteja em `m.serviceIds`.
- `src/app/[slug]/agendar/page.tsx:199` monta query de availability com `serviceIds`.
- `src/app/[slug]/agendar/page.tsx:296` envia `serviceIds` no POST final.

Observacao: existe uma excecao na UI. Profissionais com `m.serviceIds.length === 0` sao considerados elegiveis em `src/app/[slug]/agendar/page.tsx:184`. Se um membro ativo sem servicos aparecer no payload publico, ele pode ser exibido para qualquer servico.

Mesmo quando a UI filtra corretamente, o backend nao pode confiar nesse filtro. O risco permanece para payload manipulado.

Cache: nao encontrei cache explicito nessa rota. O endpoint publico e um route handler dinamico que consulta banco.

## 7. Availability

Endpoint: `GET /api/public/barbershop/[slug]/availability`.

- Recebe `serviceIds`: sim, `src/app/api/public/barbershop/[slug]/availability/route.ts:18` e `:28`.
- Recebe `memberId`: sim, `src/app/api/public/barbershop/[slug]/availability/route.ts:17` e repassa em `:56`.
- Valida barbearia publica e assinatura: sim, `:36` a `:49`.
- Usa duracao dos servicos ativos do tenant: sim, `src/lib/appointments/availability.ts:29` a `:35`.
- Valida conflito, jornada e folgas: sim, `src/lib/appointments/availability.ts:69` a `:146`.
- Valida profissional x servico: parcialmente/incorreto.

Detalhes:

- Se `memberId` e informado, `src/lib/appointments/availability.ts:46` a `:47` simplesmente usa esse membro. A busca posterior em `:69` a `:83` valida apenas `{ id, barbershopId, isActive }`, jornada e folga. Nao valida `services`.
- Se `memberId` nao e informado, a busca de candidatos usa `services: { some: { serviceId: { in: serviceIds } } }` em `src/lib/appointments/availability.ts:50` a `:55`. Isso exige pelo menos um dos servicos, nao todos. O comentario em `:49` diz "all selected services", mas a query implementa "some".
- Availability pode retornar horarios para combinacao incompatível se o atacante informar `memberId`, ou para multi-servico parcialmente compativel quando `memberId` omitido.

Consistencia: availability aceita combinacoes que booking tambem aceita incorretamente. Nao ha uma rejeicao final que compense.

## 8. Booking

Endpoint: `POST /api/public/barbershop/[slug]/book`.

Validacoes existentes:

- `slug`: sanitizado em `src/app/api/public/barbershop/[slug]/book/route.ts:240` e buscado com `publicBarbershopWhere` em `:245` a `:249`.
- assinatura ativa: `:253` a `:258`.
- `memberId` obrigatorio: `:228` a `:232`.
- `serviceIds` obrigatorio: `:228` a `:232`.
- `dateTime` valido: `:235` a `:238`.
- profissional pertence ao tenant e ativo: `:311` a `:318`.
- servicos pertencem ao tenant e ativos: `:320` a `:327`.
- cliente, duplicidade no mesmo horario e limite semanal: `:331` a `:419`.
- conflito de horario: via `createAppointmentWithScheduleLock`, `src/lib/appointments/create-appointment.ts:37` a `:48`.

Validacao ausente:

- Nao existe consulta a `tx.barberService`, `BarberService` ou `barbershopMember.findFirst` com `services` exigindo os `serviceIds`.
- Multi-servico: valida existencia/atividade de todos os servicos, mas nao que o profissional execute todos.
- Relacao ativa: N/A no schema atual, porque `BarberService` nao tem flag de ativo.
- Soft delete: nao ha `deletedAt` nos modelos relevantes.

Resultado por analise estatica: payload `serviceIds = [Barba]` e `memberId = Joao` sera aceito se ambos pertencerem ao mesmo tenant, estiverem ativos e o horario estiver livre, mesmo que nao exista linha em `barber_services`.

## 9. Reagendamento

Endpoint principal: `PUT /api/admin/appointments/[id]`.

- Busca o appointment por `{ id, barbershopId }`: `src/app/api/admin/appointments/[id]/route.ts:77` a `:79`.
- Se `memberId` vier, valida apenas `{ id, barbershopId, isActive }`: `:92` a `:100`.
- Se `serviceIds` vierem, valida apenas servicos `{ id in serviceIds, barbershopId, isActive }`: `:106` a `:119`.
- Chama `rescheduleAppointmentWithScheduleLock`: `:133` a `:145`.
- Helper de reagendamento valida conflito e substitui servicos, mas nao valida capacidade: `src/lib/appointments/reschedule-appointment.ts:21` a `:42`.

Conclusao: reagendamento administrativo possui risco semelhante. Um appointment valido pode ser alterado para profissional incompatível, servico incompatível, ou ambos, desde que membro/servico sejam do tenant, ativos e sem conflito de agenda.

Nao encontrei endpoint publico de reagendamento de cliente. O endpoint cliente encontrado cancela/lista appointments, nao altera servico/profissional.

## 10. Multi-tenancy

Booking publico protege cross-tenant para as entidades principais:

- Barbershop e obtida pelo slug publico.
- Profissional e buscado com `barbershopId: barbershop.id`.
- Servicos sao buscados com `barbershopId: barbershop.id`.
- Appointment e criado com `barbershopId: barbershop.id`.

Cenarios cross-tenant por analise estatica:

- `serviceId` de outro tenant: rejeitado, porque `services.length !== serviceIds.length`.
- `memberId` de outro tenant: rejeitado, porque `member` nao e encontrado.
- `slug` tenant C + service tenant A + member tenant B: rejeitado.

Risco cross-tenant elevado nao confirmado nesta auditoria.

## 11. Testes existentes

Arquivos relevantes:

- `src/__tests__/public-booking.test.ts`
  - `exige chave de idempotencia`: prova idempotencia obrigatoria.
  - `valida profissional dentro da barbearia`: prova query `{ id, barbershopId, isActive }`.
  - `rejeita profissional invalido`: prova rejeicao quando member nao existe no tenant.
  - `valida servicos ativos do tenant`: prova query `{ id in, barbershopId, isActive }`.
  - `rejeita horario indisponivel por conflito ativo`: prova conflito via overlap.
  - `registra a lacuna atual: nao valida explicitamente se o profissional executa todos os servicos`: prova que a ausencia da validacao e conhecida na suite.
- `src/__tests__/availability.test.ts`
  - Prova jornada, pausa, timeOff, conflitos, isolamento por membro e tenant.
  - `isola por barbearia ao buscar servicos e membros`: prova `services: { some: { serviceId: { in: [...] } } }`, nao prova "todos os servicos".
- `src/__tests__/booking-calculation.test.ts`
  - Prova soma de preco/duracao, multi-servico, servico faltante/outro tenant e inativo.
  - Nao prova compatibilidade profissional x servico.
- `src/__tests__/booking-concurrency.integration.test.ts`
  - Prova conflito concorrente, idempotencia e isolamento de tenant em horarios.
  - Nao prova incompatibilidade profissional x servico.
- `src/__tests__/admin-appointments.test.ts`
  - Prova criacao admin, tenant e conflito.
  - Nao prova compatibilidade com todos os servicos; query do membro exige apenas `services: { some: {} }`.
- `src/__tests__/reschedule.test.ts`
  - Prova alteracao de profissional/servico por tenant e conflito.
  - Nao prova compatibilidade entre novo profissional e novos servicos.

Cobertura ausente:

- Payload publico com profissional incompatível.
- Multi-servico com um servico incompatível.
- Relacao removida/inexistente.
- Availability com `memberId` incompatível.
- Reagendamento para combinacao incompatível.

## 12. Matriz de validacao

| Regra | UI valida? | Availability valida? | Booking valida? | Banco/constraint protege? | Status |
|---|---|---|---|---|---|
| servico pertence ao tenant | Sim, via API publica | Sim | Sim | FK apenas, nao tenant composto | OK |
| profissional pertence ao tenant | Sim, via API publica | Sim | Sim | FK apenas, nao tenant composto | OK |
| servico ativo | Sim, API publica retorna ativos | Sim | Sim | Nao | OK |
| profissional ativo | Sim, API publica retorna ativos | Sim | Sim | Nao | OK |
| relacao profissional x servico | Sim no cliente, com excecao para membro sem servicos | Parcial/incorreto | Nao | Nao | BUG |
| relacao ativa | N/A | N/A | N/A | N/A | N/A |
| multiplos servicos compativeis | Sim no cliente para membros com serviceIds | Nao, usa `some` | Nao | Nao | BUG |
| conflito de horario | Via availability | Sim | Sim | Nao | OK |
| horario de trabalho | Via availability | Sim | Nao diretamente no booking | Nao | Risco separado |
| duracao | Sim, soma no cliente | Sim, soma servicos ativos | Sim, soma servicos ativos | Nao | OK |
| cross-tenant serviceId | Sim, API nao lista | Sim | Sim | Nao composto | OK |
| cross-tenant professionalId | Sim, API nao lista | Sim | Sim | Nao composto | OK |

Observacao: booking final revalida conflito, mas nao revalida jornada/folga/timeOff. Isso e risco relacionado, separado da compatibilidade profissional x servico.

## 13. Matriz de payload manipulado

Nao executado contra banco local seguro; resultado real abaixo e "real por analise estatica/testes existentes".

| Caso | Resultado esperado | Resultado real | Booking criado? | Bug? |
|---|---|---|---|---|
| 1. profissional incompatível | 400/422 e sem appointment | Aceito se mesmo tenant, ativos e horario livre | Sim | Sim |
| 2. servico de outro tenant | 400 e sem appointment | Rejeitado por `service.findMany` escopado por tenant | Nao | Nao |
| 3. profissional de outro tenant | 404 e sem appointment | Rejeitado por `barbershopMember.findFirst` escopado por tenant | Nao | Nao |
| 4. servico inativo | 400 e sem appointment | Rejeitado por `isActive: true` | Nao | Nao |
| 5. profissional inativo | 404 e sem appointment | Rejeitado por `isActive: true` | Nao | Nao |
| 6. vinculo removido | 400/422 e sem appointment | Aceito se entidades existem/ativas e horario livre | Sim | Sim |
| 7. multi-servico parcialmente incompatível | 400/422 e sem appointment | Aceito se todos servicos existem/ativos e horario livre | Sim | Sim |
| 8. horario indisponivel | 409 e sem appointment | Rejeitado por overlap no helper | Nao | Nao |

## 14. Causa raiz

Causa raiz especifica: frontend filtra usando `serviceIds`, mas o backend de booking final valida profissional e servicos como entidades independentes. A relacao `BarberService` existe no schema, mas nao e consultada no POST publico antes de criar `Appointment`/`AppointmentService`.

Fatores adicionais:

- `createAppointmentWithScheduleLock` centraliza conflito de agenda, nao capacidade profissional.
- `availability` mistura disponibilidade de horario com uma nocao incompleta de capacidade: com `memberId` nao valida capacidade; sem `memberId` usa `some`, nao "todos".
- O teste `public-booking.test.ts` documenta a lacuna em vez de bloquear regressao.
- Fluxo admin e reagendamento repetem a mesma falta de validacao.

## 15. Impacto

Impacto comprovado por codigo:

- Pode haver `Appointment.memberId` apontando para profissional ativo do tenant e `AppointmentService.serviceId` apontando para servico ativo do mesmo tenant sem linha correspondente em `barber_services`.
- O horario do profissional fica bloqueado por um servico que ele nao executa.
- Relatorios/comandas/comissoes podem herdar atribuicao operacional incorreta, pois usam o profissional do appointment e os servicos do appointment.

Impacto potencial:

- Cliente chega para servico que o profissional nao executa.
- Operador precisa remanejar, atrasar ou cancelar.
- Agenda perde capacidade real.
- Experiencia do cliente e confianca da barbearia sao afetadas.

## 16. Migration SIM/NAO

Migration necessaria? NAO para a correcao minima.

Prova: a relacao ja existe em `prisma/schema.prisma:193` a `:202` como `BarberService`, com chave composta `@@id([barberId, serviceId])`.

Migration so seria necessaria se o produto decidir adicionar estado na relacao, como `isActive` ou `deletedAt`. No schema atual, remover o vinculo significa deletar a linha.

## 17. Proposta de correcao em alto nivel

Criar helper central de validacao de capacidade, por exemplo em `src/lib/appointments`, que receba:

- `tx`
- `barbershopId`
- `memberId`
- `serviceIds`
- opcionalmente flags para exigir membro/servico ativos

O helper deve:

- validar membro ativo no tenant;
- validar todos os servicos ativos no tenant;
- contar/buscar `BarberService` para o `memberId` e todos os `serviceIds`;
- rejeitar se qualquer servico nao estiver vinculado;
- tratar duplicidade de `serviceIds` de forma deterministica;
- retornar os servicos validados para calculo de preco/duracao;
- ser usado por booking publico, booking admin, availability e reagendamento.

Availability deve separar:

- compatibilidade: profissional executa todos os servicos;
- disponibilidade: jornada, folga, conflito, duracao.

Erros sugeridos:

- 400/422 para combinacao profissional x servico invalida.
- 404 para membro/servico inexistente no tenant, se a API quiser evitar revelar existencia.
- Testes unitarios e de integracao para payload manipulado, multi-servico e reagendamento.

## 18. Arquivos afetados

Backend obrigatorio em futura implementacao:

- `src/app/api/public/barbershop/[slug]/book/route.ts`
- `src/app/api/public/barbershop/[slug]/availability/route.ts`
- `src/lib/appointments/availability.ts`
- `src/lib/appointments/create-appointment.ts` ou novo helper central em `src/lib/appointments/*`
- `src/app/api/admin/appointments/route.ts`
- `src/app/api/admin/appointments/[id]/route.ts`
- `src/lib/appointments/reschedule-appointment.ts`

Frontend opcional:

- `src/app/[slug]/agendar/page.tsx`, para remover a regra que considera membro sem servicos como elegivel universal, se isso nao for intencional.
- `src/app/admin/agendamentos/page.tsx`, se a UI admin tambem precisar filtrar por capacidade.

Testes:

- `src/__tests__/public-booking.test.ts`
- `src/__tests__/availability.test.ts`
- `src/__tests__/booking-calculation.test.ts`
- `src/__tests__/admin-appointments.test.ts`
- `src/__tests__/reschedule.test.ts`
- possivel teste de integracao novo para banco real seguro.

Schema/migration:

- Nao obrigatorio.

## 19. Riscos

- Corrigir apenas a UI nao resolve payload manipulado.
- Corrigir apenas booking publico deixa admin/reagendamento criando combinacoes invalidas.
- Corrigir apenas availability pode melhorar a UX, mas booking continuara vulneravel.
- Exigir todos os servicos em multi-servico pode revelar dados se o erro diferenciar "servico inexistente" de "profissional nao executa"; escolher resposta de erro consistente.
- Booking final tambem nao revalida jornada/folga/timeOff; isso nao e a causa desta P1, mas deve ser considerado em blueprint separado ou na mesma fase se o objetivo for robustez total do booking final.

## 20. GO/NO-GO para blueprint

GO para criar blueprint de correcao.

O bug esta confirmado, a relacao ja existe no schema, e a correcao pode ser feita sem migration na versao minima. O blueprint deve tratar a regra como validacao central reutilizada por booking publico, availability, admin create e admin reschedule.
