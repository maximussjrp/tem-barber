# Blueprint P1 - Validacao profissional x servico

## 1. Resumo executivo

Este blueprint define a correcao tecnica para o P1 confirmado em `docs/tembarber-public-booking-professional-service-audit.md`: o sistema permite criar ou alterar appointments combinando um profissional ativo com servicos ativos do mesmo tenant, mesmo quando nao existe vinculo `BarberService` entre eles.

Escopo deste documento:

- Definir regra formal de negocio.
- Centralizar validacao profissional x servico.
- Planejar alteracoes em booking publico, availability, admin create e reagendamento.
- Preservar multi-tenancy, idempotencia e protecao de conflito de agenda.
- Preparar a arquitetura para uma futura feature de encaixe operacional sem implementa-la agora.

Fora do escopo:

- Implementacao.
- Migration.
- Correcao de appointments legados.
- Encaixe operacional.
- Revalidacao completa de jornada/folga/timeOff no booking final.

## 2. Problema confirmado

O endpoint publico `POST /api/public/barbershop/[slug]/book` valida:

- barbearia publica e assinatura;
- `memberId` dentro do tenant e ativo;
- `serviceIds` dentro do tenant e ativos;
- conflito temporal via `createAppointmentWithScheduleLock`.

Mas nao valida que o `memberId` selecionado executa todos os `serviceIds`. A relacao existe no schema como `BarberService`, com `@@id([barberId, serviceId])`, mas nao e consultada no booking final.

O mesmo padrao aparece em:

- `src/lib/appointments/availability.ts`: com `memberId` informado nao valida capacidade; sem `memberId` usa `some`, que significa "qualquer servico", nao "todos".
- `src/app/api/admin/appointments/route.ts`: admin create valida membro/servicos separadamente.
- `src/app/api/admin/appointments/[id]/route.ts` e `src/lib/appointments/reschedule-appointment.ts`: reagendamento valida membro/servicos separadamente.

## 3. Regra formal

Um profissional so pode ser associado a um appointment se todas as condicoes abaixo forem verdadeiras:

1. O profissional (`BarbershopMember`) pertence ao mesmo `barbershopId`.
2. O profissional esta ativo (`isActive = true`).
3. Todos os servicos selecionados (`Service`) pertencem ao mesmo `barbershopId`.
4. Todos os servicos selecionados estao ativos (`isActive = true`).
5. Existe uma linha `BarberService` para `memberId + serviceId` para cada servico selecionado.

Para multi-servico, a regra e E, nao OU.

```text
serviceIds = [A, B, C]

requiredServiceCount = numero de serviceIds unicos validos
linkedServiceCount = numero de BarberService encontrados para memberId e serviceIds unicos

Permitido somente se:
linkedServiceCount === requiredServiceCount
```

IDs duplicados devem ser normalizados de forma deterministica antes da validacao. Exemplo: `[A, A, B]` vira `[A, B]`. Lista vazia deve ser rejeitada.

## 4. Compatibilidade vs disponibilidade

Separar tres conceitos:

- Compatibilidade: o profissional executa todos os servicos selecionados.
- Disponibilidade: o profissional pode atender naquele horario considerando jornada, folgas, timeOff, conflitos e duracao.
- Modo de agendamento: fluxo normal ou futuro encaixe operacional.

Compatibilidade e sempre obrigatoria.

Disponibilidade pode ter excecoes futuras para encaixe, mas isso nao deve afetar a regra profissional x servico. A capacidade do profissional nao deve morar dentro do check de overlap, nem depender dele.

## 5. Arquitetura central

Criar uma camada central de capacidade em `src/lib/appointments`, reutilizada por todas as superficies que criam, alteram ou calculam disponibilidade de appointment.

Nome recomendado:

`src/lib/appointments/professional-service-capability.ts`

Responsabilidades:

- Normalizar `serviceIds`.
- Validar membro e servicos no tenant.
- Validar `BarberService` para todos os servicos.
- Retornar dados validados para calculo de preco/duracao.
- Evitar vazamento cross-tenant em mensagens publicas.
- Servir tanto para transacoes de escrita quanto para consultas read-only.

Chamadores previstos:

- `src/app/api/public/barbershop/[slug]/book/route.ts`
- `src/lib/appointments/availability.ts`
- `src/app/api/admin/appointments/route.ts`
- `src/app/api/admin/appointments/[id]/route.ts`
- `src/lib/appointments/reschedule-appointment.ts`, se a validacao ficar no helper de operacao

Regra de camada:

- Rotas nao devem reimplementar a query de capacidade.
- Helpers de appointment devem receber dados ja validados ou chamar o helper central dentro da mesma transaction.
- Availability deve usar uma funcao em lote para evitar N+1.

## 6. Helper proposto

Funcoes conceituais:

- `validateProfessionalServiceCapability`
- `assertMemberCanPerformServices`
- `findEligibleMembersForServices`

Assinatura conceitual para validacao individual:

```ts
validateProfessionalServiceCapability(db, {
  barbershopId,
  memberId,
  serviceIds,
  requireActiveMember: true,
  requireActiveServices: true,
})
```

`db` deve aceitar `PrismaClient` ou `Prisma.TransactionClient`, para uso dentro e fora de transaction.

Retorno conceitual:

```ts
{
  member,
  services,
  normalizedServiceIds,
}
```

Regras internas:

1. Remover duplicados preservando comportamento deterministico.
2. Rejeitar lista vazia.
3. Buscar membro com `{ id: memberId, barbershopId, isActive: true }`.
4. Buscar servicos com `{ id: { in: normalizedServiceIds }, barbershopId, isActive: true }`.
5. Rejeitar se `services.length !== normalizedServiceIds.length`.
6. Buscar `BarberService` com `{ barberId: memberId, serviceId: { in: normalizedServiceIds } }`.
7. Rejeitar se `links.length !== normalizedServiceIds.length`.
8. Retornar os servicos validados, preferencialmente na ordem normalizada ou numa ordem documentada.

Erros conceituais:

- `InvalidServiceSelectionError`
- `ProfessionalNotAvailableError`
- `ProfessionalServiceMismatchError`

O helper nao deve fazer check de conflito temporal. Isso fica com `createAppointmentWithScheduleLock` / `rescheduleAppointmentWithScheduleLock`.

Para availability em lote:

```ts
findEligibleMembersForServices(db, {
  barbershopId,
  serviceIds,
  memberId?: string,
})
```

Retorno conceitual:

```ts
{
  services,
  normalizedServiceIds,
  members,
}
```

## 7. Booking publico

Arquivo: `src/app/api/public/barbershop/[slug]/book/route.ts`.

Mudanca futura:

1. Manter validacao de slug, barbearia publica e assinatura.
2. Dentro da transaction serializable existente, substituir as queries separadas de membro e servicos pelo helper central.
3. Usar `services` retornados pelo helper para `calculateAppointmentTotals`.
4. Criar appointment somente apos a validacao de capacidade.
5. Manter idempotencia, limite semanal, duplicidade e lock/conflito como hoje.

Payload manipulado:

```text
memberId = Joao
serviceIds = [Barba]
```

Se Joao nao executa Barba, rejeitar antes de `createAppointmentWithScheduleLock` e antes de qualquer `Appointment`/`AppointmentService`.

Erro recomendado:

- HTTP `422`
- `PROFESSIONAL_SERVICE_MISMATCH`
- Mensagem publica: `Profissional indisponivel para um ou mais servicos selecionados.`

Justificativa para 422: o payload e sintaticamente valido e as entidades podem existir, mas a combinacao viola regra de negocio. Para evitar enumeracao, a rota publica pode reutilizar mensagem generica quando membro/servico nao esta disponivel no tenant.

## 8. Availability

Arquivos:

- `src/app/api/public/barbershop/[slug]/availability/route.ts`
- `src/lib/appointments/availability.ts`

Regra futura:

- Se `memberId` for informado, availability deve validar que esse membro executa todos os servicos. Se incompatível, retornar resultado vazio ou erro consistente.
- Se `memberId` for omitido, availability deve considerar apenas membros que executam todos os servicos.

Recomendacao de resposta:

- Para `memberId` incompatível em endpoint publico: retornar `200` com `{ results: [], totalDuration }`, ou `422` com `PROFESSIONAL_SERVICE_MISMATCH`.
- Escolha recomendada: `200` vazio para availability, porque availability e consulta de opcoes; booking final continua retornando erro de regra de negocio. Isso reduz enumeracao e simplifica UX.

Abordagem correta para "todos":

- Normalizar `serviceIds`.
- Buscar servicos ativos do tenant uma vez.
- Buscar relacoes `BarberService` em lote.
- Agrupar por `barberId`.
- Considerar elegivel somente `linkedCount === normalizedServiceIds.length`.

Nao usar:

```ts
services: { some: { serviceId: { in: serviceIds } } }
```

Isso significa "executa pelo menos um", e nao atende a regra multi-servico.

## 9. Multi-servico

Comportamento formal:

| Entrada | Resultado |
|---|---|
| Profissional executa A; booking `[A]` | permitido |
| Profissional executa A e B; booking `[A, B]` | permitido |
| Profissional executa A e B; booking `[A, B, C]` | rejeitado |
| Profissional executa A e B; booking `[A, A, B]` | normalizar para `[A, B]` e permitir |
| `serviceIds = []` | rejeitado |
| `serviceIds = [A, id-inexistente]` | rejeitado |
| `serviceIds = [A, service-outro-tenant]` | rejeitado |

O calculo de preco/duracao deve usar a lista normalizada e validada. Isso evita criar `AppointmentService` duplicado e evita que duplicatas alterem duracao/preco indevidamente.

## 10. UI

Arquivo: `src/app/[slug]/agendar/page.tsx`.

Problema atual: `m.serviceIds.length === 0` torna o membro elegivel universal.

Pergunta de produto: membro sem `BarberService` significa profissional universal?

Decisao proposta: NAO. Com base no schema atual, `BarberService` e a fonte de verdade de capacidade. Membro sem vinculos deve ser inelegivel para servicos selecionados.

Mudanca futura:

- Remover a condicao de universalidade para `serviceIds.length === 0`.
- Para servico selecionado, exigir `selectedServiceIds.every((id) => m.serviceIds.includes(id))`.
- Manter o backend como fonte final de verdade, porque UI pode ser manipulada.

## 11. Admin create

Arquivo: `src/app/api/admin/appointments/route.ts`.

Criacao administrativa normal tambem deve validar capacidade.

Decisao: Owner/Manager nao deve conseguir criar combinacao incompatível em fluxo normal. Permitir isso tornaria relatórios, comissoes, comandas e agenda inconsistentes.

Nao confundir com encaixe:

- Encaixe futuro pode permitir conflito temporal.
- Encaixe futuro nao deve permitir profissional incompatível com servico.

Mudanca futura:

- Dentro da transaction, usar o helper central para validar `memberId + serviceIds`.
- Remover query local que exige apenas `services: { some: {} }`.
- Usar `services` retornados pelo helper para preco/duracao.

Erro recomendado para admin:

- HTTP `422`
- `PROFESSIONAL_SERVICE_MISMATCH`
- Mensagem um pouco mais explicita: `O profissional selecionado nao executa um ou mais servicos.`

## 12. Reagendamento

Arquivos:

- `src/app/api/admin/appointments/[id]/route.ts`
- `src/lib/appointments/reschedule-appointment.ts`

Casos:

| Caso | Politica proposta |
|---|---|
| Muda so horario | Nao bloquear automaticamente appointment legado por vinculo removido, salvo decisao de produto. Manter foco em disponibilidade/conflito. |
| Muda so profissional | Validar novo profissional contra todos os servicos atuais. |
| Muda so servicos | Validar profissional atual contra todos os novos servicos. |
| Muda profissional e servicos | Validar nova combinacao completa. |
| Relacao removida desde criacao original e usuario so altera horario | Permitir por compatibilidade com legado, mas registrar risco operacional. |
| Relacao removida e usuario altera profissional ou servicos | Revalidar e bloquear se combinacao final for invalida. |

Justificativa para nao bloquear horario de legado automaticamente: como podem existir appointments invalidos ja persistidos, uma correcao que impede simples remarcacao de horario pode travar operacao diaria sem uma politica de saneamento. A restricao deve impedir novas combinacoes invalidas; legado deve ser tratado por auditoria/migracao operacional separada.

Se o produto preferir postura mais rigida, alternativa: qualquer PUT revalida a combinacao final e bloqueia legados invalidos. Essa alternativa tem maior integridade, mas maior risco operacional.

Recomendacao para primeira implementacao: politica incremental acima.

## 13. Legados invalidos

Como o bug ja existe, pode haver appointments persistidos sem relacao `BarberService`.

Politica segura:

- Nao alterar dados historicos automaticamente.
- Nao hard-delete.
- Nao corrigir silenciosamente.
- Nao exigir migration para correcao minima.
- Leitura/listagem continua funcionando.
- Novos bookings e novas combinacoes devem ser bloqueados.
- Reagendamento apenas de horario pode continuar permitido para nao travar legados.
- Mudanca de profissional/servico deve revalidar a combinacao final.

Recomendacao adicional: criar auditoria posterior read-only para listar appointments futuros ativos cuja combinacao nao possui `BarberService`, para decisao operacional manual.

## 14. Erros HTTP

Convenções atuais observadas:

- 400 para body/parametros invalidos e servicos invalidos.
- 404 para barbearia/profissional/agendamento nao encontrado.
- 409 para conflito de horario.
- 422 para regra de negocio, como duplicidade ou limite semanal.

Proposta:

| Caso | Public booking | Admin |
|---|---|---|
| membro inexistente no tenant | 404 `PROFESSIONAL_NOT_AVAILABLE` | 404 `PROFESSIONAL_NOT_AVAILABLE` |
| membro inativo | 404 `PROFESSIONAL_NOT_AVAILABLE` | 404 `PROFESSIONAL_NOT_AVAILABLE` |
| servico inexistente/outro tenant | 400 `INVALID_SERVICE_SELECTION` | 400 `INVALID_SERVICE_SELECTION` |
| servico inativo | 400 `INVALID_SERVICE_SELECTION` | 400 `INVALID_SERVICE_SELECTION` |
| profissional incompatível | 422 `PROFESSIONAL_SERVICE_MISMATCH` | 422 `PROFESSIONAL_SERVICE_MISMATCH` |
| multi-servico parcialmente incompatível | 422 `PROFESSIONAL_SERVICE_MISMATCH` | 422 `PROFESSIONAL_SERVICE_MISMATCH` |

Mensagem publica recomendada:

`Profissional indisponivel para um ou mais servicos selecionados.`

Essa mensagem evita revelar se o servico existe em outro tenant ou se o profissional existe fora do tenant.

## 15. Transacao/TOCTOU

Risco TOCTOU:

1. O sistema valida `BarberService`.
2. O vinculo e removido.
3. O appointment e criado.

Desenho recomendado:

- Booking publico e admin create devem chamar o helper dentro da mesma transaction que cria o appointment.
- Manter a transaction serializable ja usada no booking publico/admin create.
- Usar os dados retornados pelo helper dentro da mesma transaction para calcular preco/duracao e criar `AppointmentService`.
- Manter `createAppointmentWithScheduleLock` para conflito temporal.

O helper deve aceitar `tx` para evitar leitura fora da transaction. Isso reduz janela de TOCTOU e mantem o desenho atual de retry para erros serializaveis.

Nao e necessario lock exclusivo em `barber_services` para a correcao minima. Serializable + validacao dentro da transaction e consistencia aceitavel para o risco. Se no futuro houver alta concorrencia de alteracao de equipe/servicos durante booking, avaliar lock adicional ou policy operacional.

## 16. Concorrencia

Cenarios:

- `BarberService` removido simultaneamente ao booking: validacao dentro da transaction reduz risco. Em serializable, conflito deve ser retryable quando o banco detectar conflito de serializacao; se nao detectar, a janela residual e baixa e aceitavel para correcao minima.
- Profissional desativado simultaneamente ao booking: validacao de `isActive` dentro da transaction reduz risco.
- Servico desativado simultaneamente ao booking: validacao de `isActive` dentro da transaction reduz risco.
- Dois bookings simultaneos: nao alterar o mecanismo atual de lock/conflito (`lockAppointmentSchedule` + `findOverlappingAppointment`).

Requisito: a correcao de capacidade nao deve mover o overlap check para fora da transaction nem remover o retry existente.

## 17. Performance

Custo esperado por booking individual:

- 1 query para membro.
- 1 query para servicos.
- 1 query para `BarberService`.

Isso e aceitavel para booking publico e admin create.

Para availability com "qualquer profissional", evitar N+1:

1. Buscar servicos ativos do tenant uma vez.
2. Buscar membros ativos candidatos uma vez.
3. Buscar `BarberService` para todos os candidatos e servicos selecionados em uma query.
4. Agrupar em memoria por `barberId`.
5. Calcular slots apenas para membros elegiveis.

Exemplo conceitual:

```text
relations = BarberService where serviceId in normalizedServiceIds and barberId in candidateMemberIds
eligible = groupBy(barberId).count === normalizedServiceIds.length
```

Casos:

- 1 servico: custo baixo.
- 3 servicos: custo baixo.
- 10 profissionais: usar query em lote.
- Availability diaria: calcular slots so depois de filtrar capacidade.

## 18. Migration

Migration necessaria? NAO para correcao minima.

Prova:

- `prisma/schema.prisma:194` define `model BarberService`.
- `prisma/schema.prisma:201` define `@@id([barberId, serviceId])`.

Limitacoes do schema atual:

- `BarberService` nao tem `barbershopId` explicito.
- `BarberService` nao tem `isActive`.
- `BarberService` nao tem `deletedAt`.

Essas limitacoes nao impedem a correcao minima. O tenant pode ser garantido validando membro e servicos separadamente no mesmo `barbershopId`, depois exigindo o par `barberId + serviceId`.

Migration futura so seria necessaria se o produto quiser vinculo inativo, historico de remocao ou constraint composta com tenant.

## 19. Testes unitarios

Planejar testes do helper central:

1. Membro executa 1 servico -> aceita.
2. Membro nao executa servico -> rejeita.
3. Membro executa todos de multi-servico -> aceita.
4. Membro executa apenas alguns -> rejeita.
5. `serviceIds` duplicados -> normaliza de forma deterministica.
6. Membro de outro tenant -> rejeita.
7. Servico de outro tenant -> rejeita.
8. Membro inativo -> rejeita.
9. Servico inativo -> rejeita.
10. Vinculo removido/inexistente -> rejeita.
11. Membro sem servicos -> rejeita.
12. Lista vazia -> rejeita.

Arquivos provaveis:

- Novo `src/__tests__/professional-service-capability.test.ts`, ou incorporar em testes de appointments se o padrao do repo preferir.

## 20. Testes integracao

Planejar PostgreSQL local seguro.

Cenario base:

- Tenant A:
  - Servico Corte.
  - Servico Barba.
  - Joao -> Corte.
  - Pedro -> Barba.
  - Ana -> Corte e Barba.
- Tenant B:
  - Servico Outro.
  - Profissional Outro.

Casos:

1. Joao + Corte -> cria.
2. Joao + Barba -> rejeita.
3. Joao + `[Corte, Barba]` -> rejeita.
4. Ana + `[Corte, Barba]` -> cria.
5. Servico de outro tenant -> rejeita.
6. Membro de outro tenant -> rejeita.
7. Membro inativo -> rejeita.
8. Servico inativo -> rejeita.
9. Vinculo removido -> rejeita.
10. Availability com membro incompatível -> vazio/erro conforme decisao.
11. Availability qualquer profissional -> retorna so elegiveis.
12. Reschedule para incompatível -> rejeita.
13. Admin create incompatível -> rejeita.
14. Payload duplicado de `serviceIds` -> comportamento deterministico.

## 21. Regressao

Garantir que continuam funcionando:

- Booking publico normal.
- Calculo de duracao.
- Calculo de preco.
- Snapshot `priceApplied`.
- Limite semanal.
- Duplicidade de appointment no mesmo horario para cliente.
- Idempotencia.
- Concorrencia de horario.
- Tenant isolation.
- PWA/login.
- Public barbershop eligibility.
- Cancelamento/status de appointment.

## 22. Risco jornada/folga/timeOff

Risco relacionado fora do escopo: a auditoria apontou que o booking final revalida conflito temporal, mas nao necessariamente revalida jornada, folga e timeOff no momento final da criacao.

Impacto potencial:

- Payload manipulado pode tentar horario fora da jornada se nao houver conflito.
- Availability pode esconder o horario, mas booking final precisa ser fonte de verdade.

Nao corrigir silenciosamente neste P1. Misturar jornada/timeOff com capacidade profissional x servico aumenta escopo e risco.

Recomendacao:

- Criar auditoria separada para "booking final revalida disponibilidade completa".
- A correcao atual nao deve piorar esse risco.
- A separacao proposta entre capacidade e disponibilidade facilita tratar isso depois.

## 23. Compatibilidade futura com Encaixe

Nao implementar encaixe agora.

Decisao arquitetural:

```text
Appointment normal:
  - capacidade obrigatoria
  - disponibilidade obrigatoria
  - overlap proibido

Encaixe operacional futuro:
  - capacidade obrigatoria
  - tenant obrigatorio
  - membro ativo obrigatorio
  - servico ativo obrigatorio
  - overlap pode ser explicitamente permitido

Booking publico:
  - nunca cria encaixe
```

Papeis futuros a avaliar:

- OWNER.
- MANAGER.
- BARBER apenas para si mesmo.

O helper de capacidade deve ser independente do overlap check. Assim, uma futura flag de encaixe pode alterar somente a politica de conflito temporal, sem ignorar profissional x servico.

## 24. Faseamento

Recomendacao: uma implementacao coerente em um unico PR, desde que o escopo permaneça somente profissional x servico.

Justificativa:

- Corrigir apenas booking publico deixa availability inconsistente.
- Corrigir apenas availability nao protege payload manipulado.
- Corrigir apenas publico deixa admin create/reagendamento criando combinacoes invalidas.
- Um helper central reduz duplicacao e risco de regras divergentes.

Sequencia dentro do PR:

1. Criar helper central de capacidade com testes unitarios.
2. Integrar booking publico.
3. Integrar availability em modo individual e em lote.
4. Integrar admin create.
5. Integrar reagendamento com politica para legados.
6. Ajustar UI publica para membro sem servicos nao ser universal.
7. Adicionar/atualizar testes de regressao e integracao.

Alternativa se for necessario reduzir risco:

- Fase 1: helper + booking publico + testes.
- Fase 2: availability + UI.
- Fase 3: admin create + reschedule.

Mas a alternativa deixa janelas temporarias de inconsistência. Preferencia tecnica: PR unico.

## 25. Arquivos

Backend:

- Novo `src/lib/appointments/professional-service-capability.ts`.
- `src/app/api/public/barbershop/[slug]/book/route.ts`.
- `src/app/api/public/barbershop/[slug]/availability/route.ts`.
- `src/lib/appointments/availability.ts`.
- `src/app/api/admin/appointments/route.ts`.
- `src/app/api/admin/appointments/[id]/route.ts`.
- `src/lib/appointments/reschedule-appointment.ts`, se a validacao for encapsulada no helper de operacao.
- Possivelmente `src/lib/appointments/errors.ts` para novos erros tipados.

Frontend:

- `src/app/[slug]/agendar/page.tsx`.
- Possivelmente `src/app/admin/agendamentos/page.tsx`, se o admin UI precisar filtrar antes do backend.

Testes:

- Novo teste unitario para helper.
- `src/__tests__/public-booking.test.ts`.
- `src/__tests__/availability.test.ts`.
- `src/__tests__/booking-calculation.test.ts`.
- `src/__tests__/admin-appointments.test.ts`.
- `src/__tests__/reschedule.test.ts`.
- Possivel novo integration test PostgreSQL para payload manipulado.

Schema:

- Nenhum arquivo de schema/migration para correcao minima.

## 26. Criterios de aceite

1. Booking publico incompatível nao cria `Appointment`.
2. Booking publico incompatível nao cria `AppointmentService`.
3. Multi-servico exige todos os vinculos.
4. `serviceIds` duplicados sao normalizados.
5. Availability nao oferece profissional parcial.
6. Availability com "qualquer profissional" retorna somente elegiveis.
7. Admin create nao cria combinacao invalida.
8. Reschedule nao cria nova combinacao invalida.
9. Cross-tenant continua protegido.
10. Servico inativo bloqueia.
11. Membro inativo bloqueia.
12. Membro sem `BarberService` nao e universal.
13. Conflito de agenda continua protegido.
14. Idempotencia continua funcionando.
15. Sem migration.
16. Testes existentes continuam passando.

## 27. Riscos residuais

- Appointments legados invalidos continuarao existindo ate auditoria/correcao operacional.
- Booking final ainda precisa de auditoria separada para jornada/folga/timeOff.
- Sem lock explicito em `barber_services`, permanece pequena janela operacional se equipe/servicos forem alterados ao mesmo tempo que booking; validacao dentro de transaction serializable reduz o risco para nivel aceitavel.
- Mensagens muito detalhadas podem facilitar enumeracao; usar erros publicos genericos quando necessario.
- Se produto decidir que membro sem servicos e "universal", o schema atual nao expressa isso formalmente; seria necessario decisao explicita e possivelmente modelagem propria.

## 28. GO/NO-GO para implementacao

GO para implementacao.

Condicoes:

- Manter escopo restrito a profissional x servico.
- Nao criar migration.
- Centralizar a regra em helper unico.
- Integrar todas as superficies de criacao/alteracao relevantes no mesmo PR, preferencialmente.
- Nao implementar encaixe operacional neste PR.
- Registrar risco de jornada/folga/timeOff como fora do escopo.
